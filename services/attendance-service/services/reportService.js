'use strict';
// Reports — part of the Attendance & Reliability service (owner: Youssef Khaled Mokhtar).
// Combines data from all three services:
//   class-service   -> sessions in the range (capacity, category, trainer, time)
//   booking-service -> confirmed bookings per session (fill rate)
//   this service    -> attendance records (attendance / no-show rates)
// Calculations
//   fillRate       = booked / capacity
//   attendanceRate = (present + late) / booked             (completed sessions only)
//   noShowRate     = noShow / booked                        (completed sessions only)
//   popularity     = categories and weekly time slots ranked by average fill rate
// CSV exports are written to S3 (SSE-KMS) and shared via a 5-minute pre-signed URL.

const { internal, time, sdk, aws, clock } = require('gym-shared');
const store = require('./attendanceStore');

const { PutObjectCommand, GetObjectCommand } = sdk.s3;
const { getSignedUrl } = sdk.presign;
const BUCKET = process.env.REPORTS_BUCKET || 'gym-reports';
const KMS_KEY = process.env.REPORTS_KMS_KEY_ID || 'alias/gym-reports';

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const slotOf = (iso) => {
  const p = time.parts(new Date(iso));
  const band = p.hour < 12 ? 'Morning' : p.hour < 17 ? 'Afternoon' : 'Evening';
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.weekday]} ${band}`;
};

async function build({ from, to, trainerId }, requestId) {
  const qs = new URLSearchParams({ from, to, statuses: 'PUBLISHED,COMPLETED' });
  if (trainerId) qs.set('trainerId', trainerId);
  const { classes } = await internal.callService('class-service', 'GET', `/internal/classes?${qs}`, null, { requestId });
  const counts = classes.length
    ? (await internal.callService('booking-service', 'POST', '/internal/booking-counts', { classIds: classes.map((c) => c.classId) }, { requestId })).counts
    : {};
  const rows = [];
  for (const c of classes.sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const booked = (counts[c.classId] || {}).booked || 0;
    const waitlist = (counts[c.classId] || {}).waitlist || 0;
    const session = await store.session(c.classId);
    const closed = Boolean(session && session.closedAt);
    let present = null; let late = null; let noShow = null; let excused = null;
    if (closed) {
      const recs = await store.recordsForClass(c.classId);
      present = recs.filter((r) => r.status === 'PRESENT').length;
      late = recs.filter((r) => r.status === 'LATE').length;
      noShow = recs.filter((r) => r.status === 'NO_SHOW').length;
      excused = recs.filter((r) => r.status === 'EXCUSED').length;
    }
    rows.push({
      classId: c.classId, title: c.title, category: c.category, trainerName: c.trainerName, startTime: c.startTime,
      slot: slotOf(c.startTime), capacity: c.capacity, booked, waitlist, fillRate: pct(booked, c.capacity), closed,
      present, late, excused, noShow,
      attendanceRate: closed ? pct(present + late, booked) : null,
      noShowRate: closed ? pct(noShow, booked) : null,
    });
  }
  const group = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      const g = m.get(k) || { key: k, sessions: 0, booked: 0, capacity: 0, attended: 0, closedBooked: 0, noShow: 0 };
      g.sessions += 1; g.booked += r.booked; g.capacity += r.capacity;
      if (r.closed) { g.attended += r.present + r.late; g.closedBooked += r.booked; g.noShow += r.noShow; }
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({
      key: g.key, sessions: g.sessions, booked: g.booked, avgFillRate: pct(g.booked, g.capacity),
      attendanceRate: pct(g.attended, g.closedBooked), noShowRate: pct(g.noShow, g.closedBooked),
    })).sort((a, b) => (b.avgFillRate || 0) - (a.avgFillRate || 0) || b.booked - a.booked);
  };
  const closedRows = rows.filter((r) => r.closed);
  const totals = {
    sessions: rows.length,
    booked: rows.reduce((s, r) => s + r.booked, 0),
    capacity: rows.reduce((s, r) => s + r.capacity, 0),
    closedSessions: closedRows.length,
    attended: closedRows.reduce((s, r) => s + r.present + r.late, 0),
    noShow: closedRows.reduce((s, r) => s + r.noShow, 0),
  };
  totals.avgFillRate = pct(totals.booked, totals.capacity);
  totals.attendanceRate = pct(totals.attended, closedRows.reduce((s, r) => s + r.booked, 0));
  totals.noShowRate = pct(totals.noShow, closedRows.reduce((s, r) => s + r.booked, 0));
  return { from, to, trainerId: trainerId || null, totals, byCategory: group((r) => r.category), bySlot: group((r) => r.slot).slice(0, 10), sessions: rows };
}

// CSV with protection against spreadsheet formula injection (=, +, -, @ prefixes).
function toCsv(report) {
  const cols = ['startTime', 'title', 'category', 'trainerName', 'slot', 'capacity', 'booked', 'waitlist', 'fillRate', 'present', 'late', 'excused', 'noShow', 'attendanceRate', 'noShowRate'];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...report.sessions.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

async function exportCsv(report, userId) {
  const key = `reports/${userId}/${clock.now().toISOString().replace(/[:.]/g, '-')}.csv`;
  await aws.s3().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: toCsv(report), ContentType: 'text/csv',
    ServerSideEncryption: 'aws:kms', SSEKMSKeyId: KMS_KEY,
  }));
  const url = await getSignedUrl(aws.s3Public(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
  return { key, url, expiresIn: 300 };
}

module.exports = { build, toCsv, exportCsv };

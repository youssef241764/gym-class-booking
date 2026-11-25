'use strict';
// Attendance business logic — owner: Youssef Khaled Mokhtar (245609).
// This is the ONLY place attendance is decided. Booking & Waitlist never stores
// attendance; it only provides the roster of confirmed bookings.
//
//  A1 Attendance can be recorded only inside the window
//     [start - checkinOpensBeforeMin, end + checkinClosesAfterEndMin]
//  A2 Only members with a CONFIRMED booking (roster from booking-service) can be marked/check in
//  A3 Only the class's assigned trainer or an admin can mark attendance / issue codes / close
//  A4 Self check-in uses a 6-digit one-time code: random, stored only as a SHA-256 hash,
//     valid for codeTtlMin minutes, max maxCodeAttempts wrong tries per member per class
//  A5 Check-in later than lateAfterMin after start is recorded as LATE
//  A6 Closing a session turns every unmarked booked member into NO_SHOW, adds a strike,
//     locks the records and publishes SessionClosed (class-service marks the class COMPLETED)
//  A7 After closing, only an admin may correct a record, within correctionWindowHours, with a reason

const crypto = require('crypto');
const {
  internal, errors, clock, events, metrics, log,
} = require('gym-shared');
const store = require('./attendanceStore');
const reliability = require('./reliabilityService');

const PRESENTISH = new Set(['PRESENT', 'LATE']);

async function getClass(classId, requestId) {
  try {
    return (await internal.callService('class-service', 'GET', `/internal/classes/${classId}`, null, { requestId })).class;
  } catch (err) {
    if (err.status === 404) throw errors.notFound('Class');
    throw err;
  }
}

async function roster(classId, requestId) {
  return (await internal.callService('booking-service', 'GET', `/internal/classes/${classId}/roster`, null, { requestId })).roster;
}

function assertStaffForClass(user, cls, denyNotOwner, req) {
  if (user.role === 'admin') return;
  if (user.role === 'trainer' && cls.trainerId === user.id) return;
  throw denyNotOwner(req, 'NOT_ASSIGNED_TRAINER');
}

function windowFor(cls, p) {
  const opens = new Date(cls.startTime).getTime() - p.checkinOpensBeforeMin * 60000;
  const closes = new Date(cls.endTime).getTime() + p.checkinClosesAfterEndMin * 60000;
  return { opens, closes };
}

function assertInWindow(cls, p) {
  if (cls.status === 'CANCELLED') throw errors.conflict('CLASS_CANCELLED', 'This class was cancelled');
  const { opens, closes } = windowFor(cls, p);
  const now = clock.nowMs();
  if (now < opens) throw errors.conflict('ATTENDANCE_NOT_OPEN', `Attendance opens ${p.checkinOpensBeforeMin} minutes before the class`, { opensAt: new Date(opens).toISOString() });
  if (now > closes) throw errors.conflict('ATTENDANCE_WINDOW_CLOSED', 'The attendance window for this class has closed', { closedAt: new Date(closes).toISOString() });
}

const hashCode = (classId, code) => crypto.createHash('sha256').update(`${classId}:${code}`).digest('hex');

async function sheet(classId, requestId) {
  const [list, records, session] = await Promise.all([roster(classId, requestId), store.recordsForClass(classId), store.session(classId)]);
  const byMember = new Map(records.map((r) => [r.memberId, r]));
  const rows = list.map((b) => {
    const r = byMember.get(b.memberId);
    return { memberId: b.memberId, memberName: b.memberName, bookingId: b.bookingId, status: r ? r.status : 'UNMARKED', method: r && r.method, recordedAt: r && r.recordedAt };
  });
  // Members whose record exists but who are no longer on the roster (e.g. corrected after close)
  for (const r of records) if (!rows.find((x) => x.memberId === r.memberId)) rows.push({ memberId: r.memberId, memberName: r.memberName, status: r.status, method: r.method, recordedAt: r.recordedAt });
  return {
    rows,
    session: session ? { closedAt: session.closedAt || null, codeActive: Boolean(session.codeExpiresAt && session.codeExpiresAt > clock.nowMs() && !session.closedAt), codeExpiresAt: session.codeExpiresAt ? new Date(session.codeExpiresAt).toISOString() : null, summary: session.summary } : { closedAt: null, codeActive: false },
  };
}

async function mark(req, cls, records) {
  const p = await reliability.loadPolicy();
  assertInWindow(cls, p);
  const session = await store.session(cls.classId);
  if (session && session.closedAt) throw errors.conflict('SESSION_CLOSED', 'This session is closed; ask an administrator for a correction');
  const list = await roster(cls.classId, req.id);
  const booked = new Map(list.map((b) => [b.memberId, b]));
  const notBooked = records.filter((r) => !booked.has(r.memberId)).map((r) => r.memberId);
  if (notBooked.length) throw errors.badRequest('NOT_BOOKED', 'Some members do not have a confirmed booking for this class', notBooked.map((m) => ({ field: 'memberId', message: m })));
  const now = clock.now().toISOString();
  const items = records.map((r) => ({
    classId: cls.classId, memberId: r.memberId, memberName: booked.get(r.memberId).memberName, bookingId: booked.get(r.memberId).bookingId,
    status: r.status, method: 'TRAINER', recordedBy: req.user.id, recordedAt: now, classStart: cls.startTime, category: cls.category,
  }));
  await store.putRecords(items);
  return items;
}

async function issueCode(req, cls) {
  const p = await reliability.loadPolicy();
  assertInWindow(cls, p);
  const session = await store.session(cls.classId);
  if (session && session.closedAt) throw errors.conflict('SESSION_CLOSED', 'This session is closed');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = Math.min(clock.nowMs() + p.codeTtlMin * 60000, windowFor(cls, p).closes);
  await store.updateSession(cls.classId, 'SET codeHash = :h, codeExpiresAt = :e, codeIssuedBy = :u, codeIssuedAt = :now',
    undefined, { ':h': hashCode(cls.classId, code), ':e': expiresAt, ':u': req.user.id, ':now': clock.now().toISOString() });
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}

async function checkIn(req, cls, code) {
  const p = await reliability.loadPolicy();
  assertInWindow(cls, p);
  const memberId = req.user.id;
  const attempts = await store.attempts(cls.classId, memberId);
  if (attempts >= p.maxCodeAttempts) {
    log.security('CHECKIN_LOCKED', { requestId: req.id, userId: memberId, classId: cls.classId });
    throw new errors.HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes for this class. Ask your trainer to mark you present.');
  }
  const session = await store.session(cls.classId);
  if (!session || !session.codeHash || session.closedAt || session.codeExpiresAt < clock.nowMs()) {
    throw errors.conflict('NO_ACTIVE_CODE', 'There is no active check-in code for this class');
  }
  const ok = crypto.timingSafeEqual(Buffer.from(hashCode(cls.classId, code)), Buffer.from(session.codeHash));
  if (!ok) {
    const n = await store.addAttempt(cls.classId, memberId, 6 * 3600);
    metrics.putMetric('CheckInFailures');
    log.security('CHECKIN_CODE_INVALID', { requestId: req.id, userId: memberId, classId: cls.classId, attempts: n });
    throw errors.badRequest('INVALID_CHECKIN_CODE', `Wrong code (${p.maxCodeAttempts - n} attempts left)`);
  }
  const list = await roster(cls.classId, req.id);
  const b = list.find((x) => x.memberId === memberId);
  if (!b) throw errors.forbidden('NOT_BOOKED', 'You do not have a confirmed booking for this class');
  const late = clock.nowMs() > new Date(cls.startTime).getTime() + p.lateAfterMin * 60000;
  const item = {
    classId: cls.classId, memberId, memberName: b.memberName, bookingId: b.bookingId, status: late ? 'LATE' : 'PRESENT',
    method: 'CODE', recordedBy: memberId, recordedAt: clock.now().toISOString(), classStart: cls.startTime, category: cls.category,
  };
  try {
    await store.putRecord(item, {
      ConditionExpression: 'attribute_not_exists(memberId) OR NOT (#s IN (:p, :l))',
      ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':p': 'PRESENT', ':l': 'LATE' },
    });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') throw errors.conflict('ALREADY_CHECKED_IN', 'You are already checked in');
    throw err;
  }
  return item;
}

// Used by the trainer/admin endpoint AND the scheduled auto-close job.
async function close(cls, actor, requestId) {
  const p = await reliability.loadPolicy();
  if (cls.status === 'CANCELLED') throw errors.conflict('CLASS_CANCELLED', 'This class was cancelled');
  if (clock.nowMs() < new Date(cls.endTime).getTime()) throw errors.conflict('SESSION_NOT_ENDED', 'A session can only be closed after it ends');
  const existing = await store.session(cls.classId);
  if (existing && existing.closedAt) throw errors.conflict('SESSION_ALREADY_CLOSED', 'This session is already closed');
  const list = await roster(cls.classId, requestId);
  const records = await store.recordsForClass(cls.classId);
  const marked = new Map(records.map((r) => [r.memberId, r]));
  const now = clock.now().toISOString();
  const noShows = list.filter((b) => !marked.has(b.memberId)).map((b) => ({
    classId: cls.classId, memberId: b.memberId, memberName: b.memberName, bookingId: b.bookingId, status: 'NO_SHOW',
    method: 'AUTO_CLOSE', recordedBy: actor.id, recordedAt: now, classStart: cls.startTime, category: cls.category,
  }));
  const explicitNoShows = records.filter((r) => r.status === 'NO_SHOW');
  await store.putRecords(noShows);
  const all = [...records, ...noShows];
  const summary = {
    booked: list.length,
    present: all.filter((r) => r.status === 'PRESENT').length,
    late: all.filter((r) => r.status === 'LATE').length,
    excused: all.filter((r) => r.status === 'EXCUSED').length,
    noShow: all.filter((r) => r.status === 'NO_SHOW').length,
  };
  try {
    await store.updateSession(cls.classId, 'SET closedAt = :now, closedBy = :by, summary = :s REMOVE codeHash',
      undefined, { ':now': now, ':by': actor.id, ':s': summary }, 'attribute_not_exists(closedAt)');
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') throw errors.conflict('SESSION_ALREADY_CLOSED', 'This session is already closed');
    throw err;
  }
  for (const r of [...noShows, ...explicitNoShows]) {
    await reliability.addStrike(r.memberId, 'NO_SHOW', cls.classId, { at: cls.startTime });
  }
  if (summary.noShow) metrics.putMetric('NoShowsRecorded', summary.noShow);
  await events.publish('SessionClosed', { classId: cls.classId, ...summary });
  return summary;
}

async function correct(req, cls, memberId, newStatus, reason) {
  const p = await reliability.loadPolicy();
  const session = await store.session(cls.classId);
  if (!session || !session.closedAt) throw errors.conflict('SESSION_NOT_CLOSED', 'Use the attendance sheet while the session is open');
  if (clock.nowMs() - new Date(session.closedAt).getTime() > p.correctionWindowHours * 3600000) {
    throw errors.conflict('CORRECTION_WINDOW_PASSED', `Corrections are allowed for ${p.correctionWindowHours} hours after closing`);
  }
  const rec = await store.getRecord(cls.classId, memberId);
  if (!rec) throw errors.notFound('Attendance record');
  if (rec.status === newStatus) return rec;
  const updated = { ...rec, status: newStatus, method: 'ADMIN_CORRECTION', correctedBy: req.user.id, correctedAt: clock.now().toISOString(), correctionReason: reason, previousStatus: rec.status };
  await store.putRecord(updated);
  if (rec.status === 'NO_SHOW' && newStatus !== 'NO_SHOW') await reliability.removeStrike(memberId, 'NO_SHOW', cls.classId);
  if (rec.status !== 'NO_SHOW' && newStatus === 'NO_SHOW') await reliability.addStrike(memberId, 'NO_SHOW', cls.classId, { at: cls.startTime });
  return updated;
}

// Scheduled job (EventBridge rule every 15 minutes): close sessions that ended
// more than autoCloseAfterEndMin ago and were not closed by the trainer.
async function autoClose() {
  const p = await reliability.loadPolicy();
  const now = clock.nowMs();
  const from = new Date(now - 2 * 86400000).toISOString();
  const to = new Date(now).toISOString();
  const { classes } = await internal.callService('class-service', 'GET', `/internal/classes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&statuses=PUBLISHED`);
  let closed = 0;
  for (const cls of classes) {
    if (new Date(cls.endTime).getTime() + p.autoCloseAfterEndMin * 60000 > now) continue;
    const s = await store.session(cls.classId);
    if (s && s.closedAt) continue;
    try {
      await close(cls, { id: 'system:auto-close' });
      closed += 1;
    } catch (err) {
      log.warn('AUTO_CLOSE_SKIPPED', { classId: cls.classId, reason: err.code || err.message });
    }
  }
  log.info('AUTO_CLOSE_RUN', { checked: classes.length, closed });
  return closed;
}

module.exports = {
  getClass, roster, sheet, mark, issueCode, checkIn, close, correct, autoClose, assertStaffForClass, PRESENTISH,
};

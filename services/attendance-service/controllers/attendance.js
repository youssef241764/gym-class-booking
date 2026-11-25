'use strict';
// Controller: reads the request, validates it, calls the services and chooses the HTTP response.
// Attendance & Reliability service — owner: Youssef Khaled Mokhtar (245609)

const {
  auth, errors, validate, audit, internal, sdk, clock, log,
} = require('gym-shared');
const store = require('../services/attendanceStore');
const attendance = require('../services/attendanceService');
const reliability = require('../services/reliabilityService');
const reports = require('../services/reportService');

const { z } = sdk.zod;
const v = validate.validate;
const uuid = z.string().uuid();
const classParam = z.object({ classId: uuid });
const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s).toISOString());

const markSchema = z.object({
  records: z.array(z.object({ memberId: uuid, status: z.enum(['PRESENT', 'LATE', 'EXCUSED', 'NO_SHOW']) }).strict()).min(1).max(100),
}).strict().refine((b) => new Set(b.records.map((r) => r.memberId)).size === b.records.length, { message: 'Duplicate memberId' });
const checkInSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') }).strict();
const correctionSchema = z.object({ status: z.enum(['PRESENT', 'LATE', 'EXCUSED', 'NO_SHOW']), reason: z.string().trim().min(5).max(200) }).strict();
const liftSchema = z.object({ reason: z.string().trim().min(5).max(200) }).strict();
const reportQuery = z.object({ from: isoDate, to: isoDate, trainerId: uuid.optional() }).strict()
  .refine((q) => new Date(q.to) > new Date(q.from), { message: '"to" must be after "from"' })
  .refine((q) => new Date(q.to) - new Date(q.from) <= 92 * 86400000, { message: 'Maximum range is 92 days' });
const auditQuery = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), action: z.string().regex(/^[A-Z_]{3,40}$/).optional(), service: z.string().regex(/^[a-z-]{3,30}$/).optional() }).strict();

async function staffClass(req) {
  const cls = await attendance.getClass(req.params.classId, req.id);
  attendance.assertStaffForClass(req.user, cls, auth.denyNotOwner, req);
  return cls;
}

// Trainers may only report on their own classes; the restriction is applied on
// the server, whatever the browser sends.
function reportScope(req) {
  const q = req.validQuery;
  if (req.user.role === 'trainer') {
    if (q.trainerId && q.trainerId !== req.user.id) throw auth.denyNotOwner(req, 'TRAINER_OWN_REPORTS_ONLY');
    return { ...q, trainerId: req.user.id };
  }
  return q;
}

// GET /api/attendance/:classId
const getSheet = [v(classParam, 'params'), async (req, res) => {
  const cls = await staffClass(req);
  const data = await attendance.sheet(cls.classId, req.id);
  res.json({ class: { classId: cls.classId, title: cls.title, startTime: cls.startTime, endTime: cls.endTime, status: cls.status, capacity: cls.capacity }, ...data });
}];

// PUT /api/attendance/:classId
const markAttendance = [v(classParam, 'params'), v(markSchema), async (req, res) => {
  const cls = await staffClass(req);
  const items = await attendance.mark(req, cls, req.body.records);
  await audit.audit(req, 'ATTENDANCE_MARKED', { targetType: 'class', targetId: cls.classId, details: { count: items.length } });
  res.json({ recorded: items.map((i) => ({ memberId: i.memberId, status: i.status })) });
}];

// POST /api/attendance/:classId/code
const createCheckInCode = [v(classParam, 'params'), async (req, res) => {
  const cls = await staffClass(req);
  const out = await attendance.issueCode(req, cls);
  await audit.audit(req, 'CHECKIN_CODE_ISSUED', { targetType: 'class', targetId: cls.classId, details: { expiresAt: out.expiresAt } });
  res.status(201).json(out);
}];

// POST /api/attendance/:classId/check-in
const checkIn = [v(classParam, 'params'), v(checkInSchema), async (req, res) => {
  const cls = await attendance.getClass(req.params.classId, req.id);
  const item = await attendance.checkIn(req, cls, req.body.code);
  await audit.audit(req, 'MEMBER_CHECKED_IN', { targetType: 'class', targetId: cls.classId, details: { status: item.status } });
  res.status(201).json({ attendance: { classId: item.classId, status: item.status, recordedAt: item.recordedAt } });
}];

// POST /api/attendance/:classId/close
const closeSession = [v(classParam, 'params'), async (req, res) => {
  const cls = await staffClass(req);
  const summary = await attendance.close(cls, req.user, req.id);
  await audit.audit(req, 'SESSION_CLOSED', { targetType: 'class', targetId: cls.classId, details: summary });
  res.json({ summary });
}];

// PATCH /api/attendance/:classId/:memberId
const correctRecord = [v(z.object({ classId: uuid, memberId: uuid }), 'params'), v(correctionSchema), async (req, res) => {
  const cls = await attendance.getClass(req.params.classId, req.id);
  const rec = await attendance.correct(req, cls, req.params.memberId, req.body.status, req.body.reason);
  await audit.audit(req, 'ATTENDANCE_CORRECTED', { targetType: 'attendance', targetId: `${cls.classId}#${req.params.memberId}`, details: { from: rec.previousStatus, to: rec.status, reason: req.body.reason } });
  res.json({ attendance: { classId: rec.classId, memberId: rec.memberId, status: rec.status, previousStatus: rec.previousStatus } });
}];

// GET /api/reliability/me
const myReliability = async (req, res) => {
  const st = await reliability.status(req.user.id);
  const history = (await store.recordsForMember(req.user.id)).slice(0, 50)
    .map((r) => ({ classId: r.classId, classStart: r.classStart, category: r.category, status: r.status, method: r.method }));
  const done = history.filter((h) => h.status !== 'EXCUSED');
  const attended = done.filter((h) => attendance.PRESENTISH.has(h.status)).length;
  res.json({ ...st, attendanceRate: done.length ? Math.round((attended / done.length) * 1000) / 10 : null, history });
};

// GET /api/reliability/:memberId
const memberReliability = [v(z.object({ memberId: uuid }), 'params'), async (req, res) => {
  res.json(await reliability.status(req.params.memberId));
}];

// POST /api/reliability/:memberId/lift
const liftSuspension = [v(z.object({ memberId: uuid }), 'params'), v(liftSchema), async (req, res) => {
  const st = await store.standing(req.params.memberId);
  if (!st || !st.suspendedUntil || new Date(st.suspendedUntil).getTime() <= clock.nowMs()) throw errors.conflict('NOT_SUSPENDED', 'This member is not suspended');
  await store.putStanding({ memberId: req.params.memberId, suspendedUntil: null, reason: 'LIFTED_BY_ADMIN', liftedBy: req.user.id, liftReason: req.body.reason, updatedAt: clock.now().toISOString() });
  await audit.audit(req, 'SUSPENSION_LIFTED', { targetType: 'member', targetId: req.params.memberId, details: { reason: req.body.reason } });
  res.json(await reliability.status(req.params.memberId));
}];

// GET /api/reports/classes
const classReport = [v(reportQuery, 'query'), async (req, res) => {
  res.json(await reports.build(reportScope(req), req.id));
}];

// POST /api/reports/export
const exportReport = [v(z.object({ from: isoDate, to: isoDate }).strict()), async (req, res) => {
  req.validQuery = req.body;
  const parsed = reportQuery.safeParse(req.body);
  if (!parsed.success) throw errors.badRequest('VALIDATION_FAILED', parsed.error.issues[0].message);
  const report = await reports.build(reportScope(req), req.id);
  const out = await reports.exportCsv(report, req.user.id);
  await audit.audit(req, 'REPORT_EXPORTED', { targetType: 'report', targetId: out.key, details: { sessions: report.sessions.length } });
  log.info('REPORT_EXPORTED', { userId: req.user.id, sessions: report.sessions.length });
  res.status(201).json({ url: out.url, expiresIn: out.expiresIn, sessions: report.sessions.length });
}];

// GET /api/audit
const listAudit = [v(auditQuery, 'query'), async (req, res) => {
  let items = await store.auditForDay(req.validQuery.day);
  if (req.validQuery.action) items = items.filter((i) => i.action === req.validQuery.action);
  if (req.validQuery.service) items = items.filter((i) => i.service === req.validQuery.service);
  res.json({ entries: items.map((i) => ({ at: i.at, service: i.service, action: i.action, outcome: i.outcome, actorId: i.actorId, actorRole: i.actorRole, targetType: i.targetType, targetId: i.targetId, details: i.details })) });
}];

// GET /internal/members/:memberId/eligibility
const internalEligibility = [v(z.object({ memberId: uuid }), 'params'), async (req, res) => {
  const st = await reliability.status(req.params.memberId);
  res.json({ eligible: !st.suspended, suspendedUntil: st.suspendedUntil, strikeCount: st.strikeCount, strikeLimit: st.strikeLimit });
}];

module.exports = {
  getSheet,
  markAttendance,
  createCheckInCode,
  checkIn,
  closeSession,
  correctRecord,
  myReliability,
  memberReliability,
  liftSuspension,
  classReport,
  exportReport,
  listAudit,
  internalEligibility,
};

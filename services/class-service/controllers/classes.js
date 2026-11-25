'use strict';
// Controller: reads the request, validates it, calls the services and chooses the HTTP response.
// Class & Schedule service — owner: Youssef Ahmed Ibrahim (241764)

const crypto = require('crypto');
const {
  auth, errors, validate, audit, events, internal, clock, log, time, sdk,
} = require('gym-shared');
const store = require('../services/classStore');
const rules = require('../services/schedulingRules');

const { z } = sdk.zod;
const v = validate.validate;
const STAFF = ['trainer', 'admin'];
const CATEGORIES = ['yoga', 'pilates', 'hiit', 'spinning', 'strength', 'boxing', 'zumba', 'crossfit', 'stretching', 'other'];

const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s).toISOString());
const baseFields = {
  title: z.string().trim().min(3).max(80),
  category: z.enum(CATEGORIES),
  description: z.string().trim().max(500).optional(),
  trainerId: z.string().uuid().optional(),
  studioId: z.string().uuid(),
  durationMin: z.number().int().min(5).max(240),
  capacity: z.number().int().min(1).max(100),
  publish: z.boolean().optional(),
  allowHoliday: z.boolean().optional(),
};
const createSchema = z.object({ ...baseFields, startTime: isoDate }).strict();
const seriesSchema = z.object({
  ...baseFields,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  weeks: z.number().int().min(1).max(12),
}).strict();
const patchSchema = z.object({
  title: baseFields.title.optional(), category: baseFields.category.optional(), description: baseFields.description,
  trainerId: baseFields.trainerId, studioId: baseFields.studioId.optional(), startTime: isoDate.optional(),
  durationMin: baseFields.durationMin.optional(), capacity: baseFields.capacity.optional(),
  version: z.number().int().min(1), allowHoliday: z.boolean().optional(),
}).strict().refine((b) => Object.keys(b).some((k) => !['version', 'allowHoliday'].includes(k)), { message: 'No changes supplied' });
const cancelSchema = z.object({ reason: z.string().trim().min(3).max(200) }).strict();
const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  from: isoDate.optional(), to: isoDate.optional(), category: z.enum(CATEGORIES).optional(),
  trainerId: z.string().uuid().optional(), status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
  scope: z.enum(['mine']).optional(),
}).strict();
const studioSchema = z.object({ name: z.string().trim().min(2).max(60), capacity: z.number().int().min(1).max(100), location: z.string().trim().max(80).optional() }).strict();

// What anonymous visitors / members may see.
function publicView(c, availability) {
  return {
    classId: c.classId, title: c.title, category: c.category, description: c.description,
    trainerName: c.trainerName, studioName: c.studioName, startTime: c.startTime, endTime: c.endTime,
    durationMin: c.durationMin, capacity: c.capacity, status: c.status,
    availability: availability || null,
  };
}
function staffView(c, availability) {
  return { ...publicView(c, availability), trainerId: c.trainerId, studioId: c.studioId, seriesId: c.seriesId, version: c.version,
    holidayCheck: c.holidayCheck, createdBy: c.createdBy, createdAt: c.createdAt, updatedAt: c.updatedAt, cancelReason: c.cancelReason };
}

function canManage(user, cls) {
  return user.role === 'admin' || (user.role === 'trainer' && cls.trainerId === user.id);
}

async function availabilityFor(classIds, requestId) {
  if (!classIds.length) return {};
  try {
    const res = await internal.callService('booking-service', 'POST', '/internal/booking-counts', { classIds }, { requestId });
    return res.counts || {};
  } catch (err) {
    log.warn('AVAILABILITY_DEGRADED', { reason: err.code });
    return {};
  }
}

async function resolveTrainer(req, requestedTrainerId) {
  if (req.user.role === 'trainer') {
    if (requestedTrainerId && requestedTrainerId !== req.user.id) throw auth.denyNotOwner(req, 'TRAINER_CAN_ONLY_SCHEDULE_SELF');
    return req.user.id;
  }
  if (!requestedTrainerId) throw errors.badRequest('VALIDATION_FAILED', 'trainerId is required for administrators', [{ field: 'trainerId', message: 'Required' }]);
  return requestedTrainerId;
}

async function trainerName(trainerId) {
  const { users } = require('gym-shared');
  const profile = await users.getProfile(trainerId);
  if (!profile || profile.role !== 'trainer' || profile.status === 'disabled') {
    throw errors.badRequest('INVALID_TRAINER', 'trainerId does not belong to an active trainer');
  }
  return profile.name;
}

function buildClass(req, body, trainerId, tName, evaluation, extra = {}) {
  const now = clock.now().toISOString();
  return {
    classId: crypto.randomUUID(), title: body.title, category: body.category, description: body.description,
    trainerId, trainerName: tName, studioId: body.studioId, studioName: evaluation.studio.name,
    startTime: body.startTime, endTime: evaluation.endTime, durationMin: body.durationMin, capacity: body.capacity,
    status: body.publish ? 'PUBLISHED' : 'DRAFT', holidayCheck: evaluation.holidayCheck,
    version: 1, createdBy: req.user.id, createdAt: now, updatedAt: now, ...extra,
  };
}

function rejectIfViolations(evaluation) {
  if (evaluation.violations.length) {
    throw errors.conflict('SCHEDULING_RULES_FAILED', evaluation.violations.map((x) => x.message).join('; '), evaluation.violations);
  }
}

// GET /api/classes
const listClasses = [v(listQuery, 'query'), async (req, res) => {
  const q = req.validQuery;
  const from = q.from || clock.now().toISOString();
  const to = q.to || new Date(new Date(from).getTime() + 14 * 86400000).toISOString();
  if (new Date(to) <= new Date(from)) throw errors.badRequest('INVALID_RANGE', '"to" must be after "from"');
  if (new Date(to) - new Date(from) > 62 * 86400000) throw errors.badRequest('RANGE_TOO_LARGE', 'Maximum range is 62 days');
  const user = req.user;
  const isStaff = user && STAFF.includes(user.role);
  let items;
  if (q.scope === 'mine') {
    if (!user || user.role !== 'trainer') throw errors.forbidden('ROLE_NOT_ALLOWED', 'scope=mine is for trainers');
    items = await store.byTrainer(user.id, from, to);
  } else if (q.status && q.status !== 'PUBLISHED') {
    if (!isStaff) throw errors.forbidden('ROLE_NOT_ALLOWED', 'Only staff can list non-published sessions');
    items = await store.byStatus(q.status, from, to);
    if (user.role === 'trainer') items = items.filter((c) => c.trainerId === user.id);
  } else {
    items = await store.byStatus('PUBLISHED', from, to);
  }
  if (q.category) items = items.filter((c) => c.category === q.category);
  if (q.trainerId) items = items.filter((c) => c.trainerId === q.trainerId);
  items.sort((a, b) => a.startTime.localeCompare(b.startTime));
  const avail = await availabilityFor(items.filter((c) => c.status === 'PUBLISHED').map((c) => c.classId), req.id);
  const view = isStaff ? staffView : publicView;
  res.json({ classes: items.map((c) => view(c, avail[c.classId])), from, to });
}];

// GET /api/classes/:id
const getClass = [v(idParams, 'params'), async (req, res) => {
  const c = await store.getClass(req.params.id);
  const user = req.user;
  if (!c) throw errors.notFound('Class');
  const visibleToAll = ['PUBLISHED', 'COMPLETED', 'CANCELLED'].includes(c.status);
  if (!visibleToAll && !(user && canManage(user, c))) throw errors.notFound('Class');
  const avail = (await availabilityFor([c.classId], req.id))[c.classId];
  res.json({ class: user && canManage(user, c) ? staffView(c, avail) : publicView(c, avail) });
}];

// POST /api/classes
const createClass = [v(createSchema), async (req, res) => {
  const body = req.body;
  if (body.allowHoliday && req.user.role !== 'admin') throw errors.forbidden('ROLE_NOT_ALLOWED', 'Only administrators can override the holiday rule');
  const trainerId = await resolveTrainer(req, body.trainerId);
  const tName = await trainerName(trainerId);
  const evaluation = await rules.evaluate({ ...body, trainerId }, { allowHoliday: body.allowHoliday });
  rejectIfViolations(evaluation);
  const item = await store.putClass(buildClass(req, body, trainerId, tName, evaluation));
  await audit.audit(req, 'CLASS_CREATED', { targetType: 'class', targetId: item.classId, details: { status: item.status, startTime: item.startTime } });
  res.status(201).json({ class: staffView(item), warnings: evaluation.warnings });
}];

// POST /api/classes/series
const createSeries = [v(seriesSchema), async (req, res) => {
  const body = req.body;
  if (body.allowHoliday && req.user.role !== 'admin') throw errors.forbidden('ROLE_NOT_ALLOWED', 'Only administrators can override the holiday rule');
  const trainerId = await resolveTrainer(req, body.trainerId);
  const tName = await trainerName(trainerId);
  const p = await rules.loadPolicy();
  const days = new Set(body.weekdays);
  const dates = [];
  for (let i = 0; i < body.weeks * 7; i += 1) {
    const d = time.addDays(body.startDate, i);
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (days.has(wd)) dates.push(d);
  }
  if (dates.length > p.maxSeriesOccurrences) throw errors.badRequest('SERIES_TOO_LONG', `A series can have at most ${p.maxSeriesOccurrences} sessions`);
  const seriesId = crypto.randomUUID();
  const created = [];
  const skipped = [];
  for (const d of dates) {
    const startTime = time.localToUtc(d, body.time).toISOString();
    // Sessions are created one by one, so later dates also check against the
    // earlier sessions of the same series.
    const evaluation = await rules.evaluate({ ...body, startTime, trainerId }, { allowHoliday: body.allowHoliday });
    if (evaluation.violations.length) {
      skipped.push({ date: d, startTime, reasons: evaluation.violations.map((x) => x.rule) });
      continue;
    }
    const item = await store.putClass(buildClass(req, { ...body, startTime }, trainerId, tName, evaluation, { seriesId }));
    created.push(staffView(item));
  }
  await audit.audit(req, 'SERIES_CREATED', { targetType: 'series', targetId: seriesId, details: { created: created.length, skipped: skipped.length } });
  if (!created.length) throw errors.conflict('NOTHING_CREATED', 'No session in the series passed the scheduling rules', skipped);
  res.status(201).json({ seriesId, created, skipped });
}];

// PATCH /api/classes/:id
const updateClass = [v(idParams, 'params'), v(patchSchema), async (req, res) => {
  const c = await store.getClass(req.params.id);
  if (!c) throw errors.notFound('Class');
  if (!canManage(req.user, c)) throw auth.denyNotOwner(req, 'NOT_ASSIGNED_TRAINER');
  if (!rules.ACTIVE.has(c.status)) throw errors.conflict('CLASS_NOT_EDITABLE', `A ${c.status} class cannot be changed`);
  if (new Date(c.startTime) <= clock.now()) throw errors.conflict('CLASS_ALREADY_STARTED', 'The class has already started');
  const b = req.body;
  if (b.version !== c.version) throw errors.conflict('STALE_VERSION', 'The class was changed by someone else. Reload and try again.');
  if (b.trainerId && b.trainerId !== c.trainerId && req.user.role !== 'admin') throw errors.forbidden('ROLE_NOT_ALLOWED', 'Only administrators can reassign trainers');
  if (b.allowHoliday && req.user.role !== 'admin') throw errors.forbidden('ROLE_NOT_ALLOWED', 'Only administrators can override the holiday rule');

  const next = { ...c, ...Object.fromEntries(Object.entries(b).filter(([k]) => !['version', 'allowHoliday'].includes(k))) };
  const changes = {};
  for (const k of ['title', 'category', 'description', 'trainerId', 'studioId', 'startTime', 'durationMin', 'capacity']) {
    if (b[k] !== undefined && b[k] !== c[k]) changes[k] = b[k];
  }
  if (!Object.keys(changes).length) return res.json({ class: staffView(c), warnings: [] });

  const scheduleChanged = ['trainerId', 'studioId', 'startTime', 'durationMin', 'capacity'].some((k) => k in changes);
  let warnings = [];
  if (scheduleChanged) {
    const evaluation = await rules.evaluate(next, { excludeClassId: c.classId, allowHoliday: b.allowHoliday });
    rejectIfViolations(evaluation);
    warnings = evaluation.warnings;
    changes.endTime = evaluation.endTime;
    changes.studioName = evaluation.studio.name;
    changes.holidayCheck = evaluation.holidayCheck;
  }
  if (changes.trainerId) changes.trainerName = await trainerName(changes.trainerId);

  // Cross-service rule: capacity can never drop below confirmed bookings.
  // Fail-closed: if Booking cannot answer, the change is refused.
  if (changes.capacity !== undefined && changes.capacity < c.capacity && c.status === 'PUBLISHED') {
    const counts = await internal.callService('booking-service', 'POST', '/internal/booking-counts', { classIds: [c.classId] }, { requestId: req.id });
    const booked = (counts.counts[c.classId] || { booked: 0 }).booked;
    if (changes.capacity < booked) throw errors.conflict('CAPACITY_BELOW_BOOKINGS', `${booked} members are already booked; capacity cannot be lower`);
  }
  changes.updatedAt = clock.now().toISOString();
  let updated;
  try {
    updated = await store.updateClass(c.classId, c.version, changes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') throw errors.conflict('STALE_VERSION', 'The class was changed by someone else. Reload and try again.');
    throw err;
  }
  if (c.status === 'PUBLISHED') {
    if (changes.startTime || changes.durationMin) {
      await events.publish('ClassRescheduled', { classId: c.classId, title: updated.title, oldStartTime: c.startTime, startTime: updated.startTime, endTime: updated.endTime });
    }
    if (changes.capacity !== undefined) {
      await events.publish('ClassCapacityChanged', { classId: c.classId, oldCapacity: c.capacity, capacity: updated.capacity });
    }
  }
  await audit.audit(req, 'CLASS_UPDATED', { targetType: 'class', targetId: c.classId, details: { fields: Object.keys(changes) } });
  res.json({ class: staffView(updated), warnings });
}];

// POST /api/classes/:id/publish
const publishClass = [v(idParams, 'params'), async (req, res) => {
  const c = await store.getClass(req.params.id);
  if (!c) throw errors.notFound('Class');
  if (!canManage(req.user, c)) throw auth.denyNotOwner(req, 'NOT_ASSIGNED_TRAINER');
  if (c.status !== 'DRAFT') throw errors.conflict('INVALID_TRANSITION', `Only DRAFT classes can be published (current: ${c.status})`);
  // Re-check the rules: something may have changed since the draft was made.
  const evaluation = await rules.evaluate(c, { excludeClassId: c.classId, allowHoliday: c.holidayCheck === 'HOLIDAY_OVERRIDDEN' });
  rejectIfViolations(evaluation);
  const updated = await store.updateClass(c.classId, c.version, { status: 'PUBLISHED', publishedAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() });
  await audit.audit(req, 'CLASS_PUBLISHED', { targetType: 'class', targetId: c.classId });
  res.json({ class: staffView(updated) });
}];

// POST /api/classes/:id/cancel
const cancelClass = [v(idParams, 'params'), v(cancelSchema), async (req, res) => {
  const c = await store.getClass(req.params.id);
  if (!c) throw errors.notFound('Class');
  if (!canManage(req.user, c)) throw auth.denyNotOwner(req, 'NOT_ASSIGNED_TRAINER');
  if (!rules.ACTIVE.has(c.status)) throw errors.conflict('INVALID_TRANSITION', `A ${c.status} class cannot be cancelled`);
  if (new Date(c.startTime) <= clock.now()) throw errors.conflict('CLASS_ALREADY_STARTED', 'A class that has started cannot be cancelled');
  const updated = await store.updateClass(c.classId, c.version, {
    status: 'CANCELLED', cancelReason: req.body.reason, cancelledBy: req.user.id, updatedAt: clock.now().toISOString(),
  });
  if (c.status === 'PUBLISHED') {
    // Booking & Waitlist reacts: cancels bookings, clears the waitlist, notifies members.
    await events.publish('ClassCancelled', { classId: c.classId, title: c.title, startTime: c.startTime, reason: req.body.reason });
  }
  await audit.audit(req, 'CLASS_CANCELLED', { targetType: 'class', targetId: c.classId, details: { reason: req.body.reason } });
  res.json({ class: staffView(updated) });
}];

// DELETE /api/classes/:id
const deleteDraft = [v(idParams, 'params'), async (req, res) => {
  const c = await store.getClass(req.params.id);
  if (!c) throw errors.notFound('Class');
  if (!canManage(req.user, c)) throw auth.denyNotOwner(req, 'NOT_ASSIGNED_TRAINER');
  if (c.status !== 'DRAFT') throw errors.conflict('ONLY_DRAFTS_DELETABLE', 'Published classes must be cancelled, not deleted');
  await store.deleteClass(c.classId);
  await audit.audit(req, 'CLASS_DELETED', { targetType: 'class', targetId: c.classId });
  res.status(204).end();
}];

// GET /api/studios
const listStudios = async (_req, res) => {
  const list = await store.listStudios();
  res.json({ studios: list.sort((a, b) => a.name.localeCompare(b.name)) });
};

// POST /api/studios
const createStudio = [v(studioSchema), async (req, res) => {
  const item = await store.putStudio({ studioId: crypto.randomUUID(), ...req.body, status: 'active', createdAt: clock.now().toISOString() });
  await audit.audit(req, 'STUDIO_CREATED', { targetType: 'studio', targetId: item.studioId });
  res.status(201).json({ studio: item });
}];

// GET /internal/classes/:id
const internalGetClass = [v(idParams, 'params'), async (req, res) => {
  const c = await store.getClass(req.params.id);
  if (!c) throw errors.notFound('Class');
  res.json({ class: staffView(c) });
}];

// POST /internal/classes/batch
const internalBatch = [v(z.object({ ids: z.array(z.string().uuid()).max(500) }).strict()), async (req, res) => {
  const items = await store.batchGet(req.body.ids);
  res.json({ classes: items.map((c) => staffView(c)) });
}];

const internalListQuery = z.object({
    from: isoDate, to: isoDate, trainerId: z.string().uuid().optional(),
    statuses: z.string().regex(/^[A-Z,]+$/).optional(),
  }).strict();

// GET /internal/classes
const listInternal = [v(internalListQuery, 'query'), async (req, res) => {
  const q = req.validQuery;
  const statuses = (q.statuses || 'PUBLISHED,COMPLETED').split(',').filter((s) => ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'].includes(s));
  let items = [];
  for (const s of statuses) items.push(...await store.byStatus(s, q.from, q.to));
  if (q.trainerId) items = items.filter((c) => c.trainerId === q.trainerId);
  res.json({ classes: items.map((c) => staffView(c)) });
}];

module.exports = {
  listClasses,
  getClass,
  createClass,
  createSeries,
  updateClass,
  publishClass,
  cancelClass,
  deleteDraft,
  listStudios,
  createStudio,
  internalGetClass,
  internalBatch,
  listInternal,
};

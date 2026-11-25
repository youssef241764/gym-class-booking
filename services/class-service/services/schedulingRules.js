'use strict';
// Scheduling business rules for the Class & Schedule service.
// A session is only accepted if ALL of these hold:
//   R1 start is at least `minLeadMinutes` in the future
//   R2 duration within [minDurationMin, maxDurationMin]
//   R3 inside opening hours (gym local time, same day)
//   R4 capacity <= studio capacity (studio must exist and be active)
//   R5 the trainer has no overlapping session (incl. changeover buffer)
//   R6 the studio has no overlapping session (incl. changeover buffer)
//   R7 not on a public holiday (Nager.Date API) unless an admin overrides
// Policy values live in SSM Parameter Store: /gym/class-service/policy

const { policy, time, clock } = require('gym-shared');
const store = require('./classStore');
const holidays = require('./holidayService');

const POLICY_NAME = process.env.POLICY_PARAMETER || '/gym/class-service/policy';
const DEFAULTS = {
  openHour: 6, closeHour: 23, minDurationMin: 15, maxDurationMin: 180, minLeadMinutes: 30,
  changeoverMin: 10, blockHolidays: true, holidayCountry: 'EG', maxSeriesOccurrences: 60, maxCapacity: 60,
};

const ACTIVE = new Set(['DRAFT', 'PUBLISHED']);
const loadPolicy = () => policy.loadPolicy(POLICY_NAME, DEFAULTS);

function overlaps(aStart, aEnd, bStart, bEnd, bufferMs) {
  return aStart < bEnd + bufferMs && bStart < aEnd + bufferMs;
}

function endOf(startIso, durationMin) {
  return new Date(new Date(startIso).getTime() + durationMin * 60000).toISOString();
}

async function findClashes(kind, key, startIso, durationMin, excludeId, p) {
  const start = new Date(startIso).getTime();
  const end = start + durationMin * 60000;
  const buffer = p.changeoverMin * 60000;
  const from = new Date(start - (p.maxDurationMin + p.changeoverMin) * 60000).toISOString();
  const to = new Date(end + buffer).toISOString();
  const items = kind === 'trainer' ? await store.byTrainer(key, from, to) : await store.byStudio(key, from, to);
  return items.filter((c) => c.classId !== excludeId && ACTIVE.has(c.status)
    && overlaps(start, end, new Date(c.startTime).getTime(), new Date(c.endTime).getTime(), buffer))
    .map((c) => ({ classId: c.classId, title: c.title, startTime: c.startTime }));
}

// Returns { violations: [{rule, message, details}], warnings: [], holidayCheck }
async function evaluate(candidate, { excludeClassId, allowHoliday = false } = {}) {
  const p = await loadPolicy();
  const violations = [];
  const warnings = [];
  const start = new Date(candidate.startTime);
  const now = clock.now();

  if (start.getTime() < now.getTime() + p.minLeadMinutes * 60000) {
    violations.push({ rule: 'R1_LEAD_TIME', message: `Sessions must start at least ${p.minLeadMinutes} minutes from now` });
  }
  if (candidate.durationMin < p.minDurationMin || candidate.durationMin > p.maxDurationMin) {
    violations.push({ rule: 'R2_DURATION', message: `Duration must be between ${p.minDurationMin} and ${p.maxDurationMin} minutes` });
  }
  const endIso = endOf(candidate.startTime, candidate.durationMin);
  const ls = time.parts(start);
  const le = time.parts(new Date(endIso));
  const endMinutes = le.date === ls.date ? le.hour * 60 + le.minute : 24 * 60 + le.hour * 60 + le.minute;
  if (ls.hour < p.openHour || endMinutes > p.closeHour * 60) {
    violations.push({ rule: 'R3_OPENING_HOURS', message: `Sessions must run between ${p.openHour}:00 and ${p.closeHour}:00 (${time.TZ})` });
  }
  const studio = await store.getStudio(candidate.studioId);
  if (!studio || studio.status === 'inactive') {
    violations.push({ rule: 'R4_STUDIO', message: 'Studio does not exist or is inactive' });
  } else if (candidate.capacity > Math.min(studio.capacity, p.maxCapacity)) {
    violations.push({ rule: 'R4_CAPACITY', message: `Capacity cannot exceed ${Math.min(studio.capacity, p.maxCapacity)} for ${studio.name}` });
  }
  const trainerClash = await findClashes('trainer', candidate.trainerId, candidate.startTime, candidate.durationMin, excludeClassId, p);
  if (trainerClash.length) violations.push({ rule: 'R5_TRAINER_CLASH', message: 'Trainer already has a session at this time', details: trainerClash });
  if (studio) {
    const studioClash = await findClashes('studio', candidate.studioId, candidate.startTime, candidate.durationMin, excludeClassId, p);
    if (studioClash.length) violations.push({ rule: 'R6_STUDIO_CLASH', message: 'Studio is already booked at this time', details: studioClash });
  }
  let holidayCheck = 'SKIPPED';
  if (p.blockHolidays) {
    const h = await holidays.checkHoliday(ls.date, p.holidayCountry);
    if (!h.checked) {
      holidayCheck = 'UNAVAILABLE';
      warnings.push({ rule: 'R7_HOLIDAY', message: 'Holiday calendar unavailable; date not verified' });
    } else if (h.isHoliday && !allowHoliday) {
      holidayCheck = 'HOLIDAY';
      violations.push({ rule: 'R7_HOLIDAY', message: `${ls.date} is a public holiday (${h.name}); the gym is closed` });
    } else {
      holidayCheck = h.isHoliday ? 'HOLIDAY_OVERRIDDEN' : 'OK';
    }
  }
  return { violations, warnings, holidayCheck, endTime: endIso, studio, policy: p };
}

module.exports = { evaluate, loadPolicy, endOf, ACTIVE };

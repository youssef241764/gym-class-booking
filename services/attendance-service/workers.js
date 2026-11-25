'use strict';
// Background work for the Attendance & Reliability service.
//  gym-attendance-events <- EventBridge rule: BookingLateCancelled (booking-service) -> LATE_CANCEL strike
//  EventBridge schedule rate(15 minutes) -> auto-close sessions that trainers forgot to close

const { events, log } = require('gym-shared');
const reliability = require('./services/reliabilityService');
const attendance = require('./services/attendanceService');

const QUEUE = process.env.ATTENDANCE_EVENTS_QUEUE || 'gym-attendance-events';

async function onEvent(type, detail) {
  if (type === 'BookingLateCancelled') {
    await reliability.addStrike(detail.memberId, 'LATE_CANCEL', detail.classId, { at: detail.cancelledAt });
    return;
  }
  log.warn('EVENT_IGNORED', { type });
}

module.exports = {
  startLocal() {
    if (process.env.DISABLE_WORKERS === 'true') return;
    events.startPoller(QUEUE, onEvent);
    const every = Number(process.env.AUTO_CLOSE_INTERVAL_MS || 15 * 60 * 1000);
    setInterval(() => attendance.autoClose().catch((e) => log.error('AUTO_CLOSE_FAILED', { reason: e.message })), every).unref();
  },
  onSqs: (type, detail) => onEvent(type, detail),
  onSchedule: () => attendance.autoClose(),
};

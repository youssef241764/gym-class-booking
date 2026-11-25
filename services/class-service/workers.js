'use strict';
// Event consumer for the Class & Schedule service.
// Queue gym-class-events receives (via EventBridge rule):
//   SessionClosed (from attendance-service) -> class status becomes COMPLETED

const { events, log, clock } = require('gym-shared');
const store = require('./services/classStore');

const QUEUE = process.env.CLASS_EVENTS_QUEUE || 'gym-class-events';

async function onEvent(type, detail) {
  if (type === 'SessionClosed') {
    const c = await store.getClass(detail.classId);
    if (!c || c.status !== 'PUBLISHED') return; // idempotent: already completed/cancelled
    await store.updateClass(c.classId, c.version, { status: 'COMPLETED', completedAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() });
    log.info('CLASS_COMPLETED', { classId: c.classId });
    return;
  }
  log.warn('EVENT_IGNORED', { type });
}

module.exports = {
  startLocal() {
    if (process.env.DISABLE_WORKERS === 'true') return;
    events.startPoller(QUEUE, onEvent);
  },
  onSqs: (type, detail) => onEvent(type, detail),
  onSchedule: null,
};

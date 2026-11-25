'use strict';
// Member reliability policy — part of the Attendance & Reliability service
// (owner: Youssef Khaled Mokhtar, 245609).
//
//  P1 Each NO_SHOW and each LATE_CANCEL is one strike.
//  P2 Strikes expire after `strikeWindowDays` (rolling window; DynamoDB TTL cleans up).
//  P3 Reaching `strikeLimit` active strikes suspends new bookings for `suspensionDays`.
//  P4 Booking & Waitlist asks /internal/members/:id/eligibility before every booking,
//     waitlist join and waitlist promotion.
//  P5 An admin can lift a suspension (audited); correcting a NO_SHOW removes its
//     strike and re-evaluates the member.

const { clock, policy, events, log, metrics } = require('gym-shared');
const store = require('./attendanceStore');

const POLICY_NAME = process.env.POLICY_PARAMETER || '/gym/attendance-service/policy';
const DEFAULTS = {
  strikeLimit: 3, strikeWindowDays: 30, suspensionDays: 7,
  checkinOpensBeforeMin: 15, checkinClosesAfterEndMin: 30, lateAfterMin: 10,
  codeTtlMin: 10, maxCodeAttempts: 5, correctionWindowHours: 48, autoCloseAfterEndMin: 30,
};
const loadPolicy = () => policy.loadPolicy(POLICY_NAME, DEFAULTS);

async function activeStrikes(memberId, p) {
  const cutoff = clock.nowMs() - p.strikeWindowDays * 86400000;
  return (await store.strikesFor(memberId)).filter((s) => new Date(s.at).getTime() >= cutoff);
}

async function status(memberId) {
  const p = await loadPolicy();
  const strikes = await activeStrikes(memberId, p);
  const st = await store.standing(memberId);
  const suspended = Boolean(st && st.suspendedUntil && new Date(st.suspendedUntil).getTime() > clock.nowMs());
  return {
    memberId,
    strikes: strikes.map((s) => ({ type: s.type, classId: s.classId, at: s.at, expiresOn: new Date(new Date(s.at).getTime() + p.strikeWindowDays * 86400000).toISOString() })),
    strikeCount: strikes.length,
    strikeLimit: p.strikeLimit,
    suspended,
    suspendedUntil: suspended ? st.suspendedUntil : null,
    suspensionReason: suspended ? st.reason : null,
  };
}

async function evaluate(memberId) {
  const p = await loadPolicy();
  const strikes = await activeStrikes(memberId, p);
  const st = await store.standing(memberId);
  const alreadySuspended = st && st.suspendedUntil && new Date(st.suspendedUntil).getTime() > clock.nowMs();
  if (strikes.length >= p.strikeLimit && !alreadySuspended) {
    const until = new Date(clock.nowMs() + p.suspensionDays * 86400000).toISOString();
    await store.putStanding({ memberId, suspendedUntil: until, reason: 'AUTO_STRIKES', strikesAtSuspension: strikes.length, updatedAt: clock.now().toISOString() });
    metrics.putMetric('MembersSuspended');
    log.info('MEMBER_SUSPENDED', { memberId, strikes: strikes.length, until });
    await events.publish('MemberSuspended', { memberId, suspendedUntil: until, strikes: strikes.length, windowDays: p.strikeWindowDays });
    return { suspended: true, until };
  }
  // A correction can bring the member back under the limit: lift an automatic suspension.
  if (alreadySuspended && st.reason === 'AUTO_STRIKES' && strikes.length < p.strikeLimit) {
    await store.putStanding({ memberId, suspendedUntil: null, reason: 'AUTO_LIFTED_AFTER_CORRECTION', updatedAt: clock.now().toISOString() });
    log.info('SUSPENSION_AUTO_LIFTED', { memberId });
  }
  return { suspended: Boolean(alreadySuspended) };
}

async function addStrike(memberId, type, classId, extra = {}) {
  const p = await loadPolicy();
  const at = extra.at || clock.now().toISOString();
  await store.putStrike({
    memberId, sk: `${type}#${classId}`, type, classId, at,
    expiresAt: Math.floor(new Date(at).getTime() / 1000) + p.strikeWindowDays * 86400,
  });
  log.info('STRIKE_RECORDED', { memberId, type, classId });
  return evaluate(memberId);
}

async function removeStrike(memberId, type, classId) {
  await store.deleteStrike(memberId, `${type}#${classId}`);
  return evaluate(memberId);
}

module.exports = { loadPolicy, status, evaluate, addStrike, removeStrike, DEFAULTS };

// End-to-end test against the DEPLOYED system (Lambda + API Gateway on Floci), in real time.
//
// tests/integration.mjs moves a test clock to reach class time. That clock is switched off
// inside Lambda on purpose (shared/src/clock.js), so this suite uses real time instead:
// the main class starts ~32 minutes from now, which makes a cancellation "late" (< 2 h)
// without any clock tricks. With --live it also waits for the check-in window (15 min
// before the start) and runs the attendance check-in flow for real.
//
//   GYM_TARGET=floci GYM_RESULTS_DIR=floci node tests/floci-e2e.mjs          (~1 minute)
//   GYM_TARGET=floci GYM_RESULTS_DIR=floci node tests/floci-e2e.mjs --live   (~18 minutes)
//
// Only freshly registered members book, so the seeded demo members are never given strikes.

import { createRequire } from 'node:module';
import { call, login, SEED, eventually, Recorder, sleep, API } from './lib.mjs';

const require = createRequire(import.meta.url);
const time = require('../shared/src/time.js');
const LIVE = process.argv.includes('--live');
const R = new Recorder('End-to-end tests on the deployed system (Floci, real time)');
const STUDIO_A = '5e2a7c1e-0000-4000-8000-000000000001';
const STUDIO_B = '5e2a7c1e-0000-4000-8000-000000000002';
const STUDIO_B_CAPACITY = 15;

const roundUp5 = (ms) => Math.ceil(ms / 300000) * 300000;
const iso = (ms) => new Date(ms).toISOString();
const minus = (s, min) => iso(new Date(s).getTime() - min * 60000);
const plus = (s, min) => iso(new Date(s).getTime() + min * 60000);

const NAMES = { m1: 'Mona Test', m2: 'Karim Test', m3: 'Laila Test', m4: 'Tarek Test' };
async function register(tag) {
  const email = `e2e.${tag}.${Date.now()}@gym.local`;
  const password = 'E2e-Member-Pass-2026';
  const r = await call('identity', 'POST', '/api/auth/register', { body: { name: NAMES[tag], email, password } });
  const l = await call('identity', 'POST', '/api/auth/login', { body: { email, password } });
  return { email, password, id: r.data && r.data.user && r.data.user.id, token: l.data && l.data.accessToken, reg: r };
}

async function main() {
  if (!API.identity || API.identity.includes('localhost:300')) throw new Error('Run with GYM_TARGET=floci after bash infra/deploy-backend.sh all');
  const [admin, sara, omar] = await Promise.all(['admin', 'sara', 'omar'].map(login));

  // ---------------- Identity ----------------
  const m1 = await register('m1');
  R.check('E2E-01', 'Register a new member (identity Lambda -> Cognito + DynamoDB)', '201 role member', m1.reg, (x) => x.status === 201 && x.data.user.role === 'member');
  let r = await call('identity', 'POST', '/api/auth/register', { body: { name: NAMES.m1, email: m1.email, password: m1.password } });
  R.check('E2E-02', 'Register the same email again', '409 EMAIL_IN_USE', r, (x) => x.status === 409 && x.data.error.code === 'EMAIL_IN_USE');
  r = await call('identity', 'POST', '/api/auth/login', { body: { email: m1.email, password: 'Wrong-Password-1' } });
  R.check('E2E-03', 'Login with a wrong password', '401', r, (x) => x.status === 401);
  R.check('E2E-04', 'Login with the right password', '200 + access token', { status: m1.token ? 200 : 401 }, () => Boolean(m1.token));
  const [m2, m3, m4] = await Promise.all(['m2', 'm3', 'm4'].map(register));

  // ---------------- Class & Schedule ----------------
  const start1 = roundUp5(Date.now() + 32 * 60000);
  const { hour } = time.parts(new Date(start1));
  if (hour < 6 || hour >= 22) throw new Error(`Cairo time ${hour}:00 is outside opening hours; run between 06:00 and 22:00 Cairo time`);
  r = await call('classes', 'POST', '/api/classes', { token: m1.token, body: { title: 'Member class', category: 'yoga', studioId: STUDIO_A, startTime: iso(start1), durationMin: 30, capacity: 2, publish: true } });
  R.check('E2E-05', 'Member tries to create a class', '403 ROLE_NOT_ALLOWED', r, (x) => x.status === 403);
  r = await call('classes', 'POST', '/api/classes', { body: { title: 'No token', category: 'yoga', studioId: STUDIO_A, startTime: iso(start1), durationMin: 30, capacity: 2 } });
  R.check('E2E-06', 'Create a class without a token', '401', r, (x) => x.status === 401);
  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'X', category: 'yoga', studioId: STUDIO_A, startTime: 'tomorrow', durationMin: -5, capacity: 2 } });
  R.check('E2E-07', 'Create a class with invalid fields', '400 VALIDATION_FAILED', r, (x) => x.status === 400 && x.data.error.code === 'VALIDATION_FAILED');
  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'Too soon', category: 'yoga', studioId: STUDIO_A, startTime: iso(roundUp5(Date.now() + 5 * 60000)), durationMin: 30, capacity: 2 } });
  R.check('E2E-08', 'Class starting in 5 minutes (30-minute lead time rule)', '409 SCHEDULING_RULES_FAILED (R1)', r, (x) => x.status === 409 && JSON.stringify(x.data).includes('R1_LEAD_TIME'));

  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'E2E Evening Yoga', category: 'yoga', studioId: STUDIO_A, startTime: iso(start1), durationMin: 30, capacity: 2, publish: true } });
  R.check('E2E-09', 'Trainer creates and publishes a class starting in ~32 minutes', '201 PUBLISHED', r, (x) => x.status === 201 && x.data.class.status === 'PUBLISHED');
  const C1 = r.data.class;
  if (!C1) throw new Error(`cannot continue without the class: ${JSON.stringify(r.data)}`);
  r = await call('classes', 'POST', '/api/classes', { token: omar, body: { title: 'Clash', category: 'hiit', studioId: STUDIO_A, startTime: plus(C1.startTime, 10), durationMin: 30, capacity: 2 } });
  R.check('E2E-10', 'Another class in the same studio at an overlapping time', '409 SCHEDULING_RULES_FAILED (R6)', r, (x) => x.status === 409 && JSON.stringify(x.data).includes('R6_STUDIO_CLASH'));
  r = await call('classes', 'POST', '/api/classes', { token: omar, body: { title: 'Huge', category: 'hiit', studioId: STUDIO_B, startTime: plus(C1.startTime, 120), durationMin: 30, capacity: STUDIO_B_CAPACITY + 5 } });
  R.check('E2E-11', 'Capacity larger than the studio', '409 SCHEDULING_RULES_FAILED (R4)', r, (x) => x.status === 409 && JSON.stringify(x.data).includes('R4_CAPACITY'));

  // ---------------- Booking & Waitlist ----------------
  r = await call('bookings', 'POST', '/api/bookings', { token: m1.token, body: { classId: C1.classId } });
  R.check('E2E-12', 'Member books a place (Booking asks Class: bookable? and Attendance: suspended?)', '201 CONFIRMED', r, (x) => x.status === 201 && x.data.booking.status === 'CONFIRMED');
  const b1 = r.data.booking;
  r = await call('bookings', 'POST', '/api/bookings', { token: m2.token, body: { classId: C1.classId } });
  R.check('E2E-13', 'Second member takes the last place', '201', r, (x) => x.status === 201);
  const b2 = r.data.booking;
  r = await call('bookings', 'POST', '/api/bookings', { token: m3.token, body: { classId: C1.classId } });
  R.check('E2E-14', 'Third member tries to book the full class', '409 CLASS_FULL', r, (x) => x.status === 409 && x.data.error.code === 'CLASS_FULL');
  r = await call('bookings', 'POST', '/api/waitlist', { token: m3.token, body: { classId: C1.classId } });
  R.check('E2E-15', 'Third member joins the waitlist', '201 position 1', r, (x) => x.status === 201 && x.data.entry.position === 1);
  r = await call('bookings', 'POST', '/api/bookings', { token: m1.token, body: { classId: C1.classId } });
  R.check('E2E-16', 'Member books the same class twice', '409 ALREADY_BOOKED', r, (x) => x.status === 409 && x.data.error.code === 'ALREADY_BOOKED');
  r = await call('bookings', 'POST', '/api/bookings', { token: m1.token, body: { classId: 'not-a-uuid' } });
  R.check('E2E-17', 'Booking with a malformed class id', '400 VALIDATION_FAILED', r, (x) => x.status === 400);
  r = await call('bookings', 'DELETE', `/api/bookings/${encodeURIComponent(b1.bookingId)}`, { token: m2.token });
  R.check('E2E-18', "Member cancels someone else's booking (IDOR)", '403 NOT_BOOKING_OWNER', r, (x) => x.status === 403);

  r = await call('classes', 'GET', `/api/classes?from=${encodeURIComponent(minus(C1.startTime, 30))}&to=${encodeURIComponent(plus(C1.startTime, 30))}`);
  const listed = r.data && r.data.classes && r.data.classes.find((c) => c.classId === C1.classId);
  R.check('E2E-19', 'Public timetable shows live availability from Booking (no trainerId exposed)', '200 booked 2/2', r, (x) => x.status === 200 && listed && listed.availability.booked === 2 && listed.trainerId === undefined);
  r = await call('classes', 'PATCH', `/api/classes/${C1.classId}`, { token: sara, body: { capacity: 1, version: C1.version } });
  R.check('E2E-20', 'Reduce capacity below confirmed bookings (Class asks Booking)', '409 CAPACITY_BELOW_BOOKINGS', r, (x) => x.status === 409 && x.data.error.code === 'CAPACITY_BELOW_BOOKINGS');
  r = await call('classes', 'PATCH', `/api/classes/${C1.classId}`, { token: omar, body: { capacity: 3, version: C1.version } });
  R.check('E2E-21', 'Another trainer edits Sara\'s class', '403', r, (x) => x.status === 403);
  r = await call('classes', 'PATCH', `/api/classes/${C1.classId}`, { token: sara, body: { capacity: 3, version: C1.version } });
  R.check('E2E-22', 'Assigned trainer increases capacity to 3', '200 capacity 3', r, (x) => x.status === 200 && x.data.class.capacity === 3);
  const promoted = await eventually(async () => {
    const mine = await call('bookings', 'GET', '/api/bookings/mine', { token: m3.token });
    return mine.data.bookings.find((b) => b.classId === C1.classId && b.status === 'CONFIRMED' && b.source === 'WAITLIST') ? mine : null;
  }, { timeoutMs: 45000 });
  R.check('E2E-23', 'Waitlisted member promoted (ClassCapacityChanged -> EventBridge -> SQS -> Booking)', 'CONFIRMED, source WAITLIST', promoted || { status: 'not promoted' }, (x) => x && x.status === 200);
  const notif = await eventually(async () => {
    const n = await call('bookings', 'GET', '/api/notifications/mine', { token: m3.token });
    return n.data.notifications.find((x) => x.kind === 'WAITLIST_PROMOTED') ? n : null;
  }, { timeoutMs: 45000 });
  const emailStatus = notif && notif.data.notifications.find((n) => n.kind === 'WAITLIST_PROMOTED').emailStatus;
  R.check('E2E-24', 'Promoted member gets an in-app notification (Brevo e-mail status recorded)', 'WAITLIST_PROMOTED', notif || { status: 'none' }, (x) => x && x.status === 200, `emailStatus ${emailStatus}`);

  r = await call('bookings', 'DELETE', `/api/bookings/${encodeURIComponent(b2.bookingId)}`, { token: m2.token });
  R.check('E2E-25', 'Member cancels ~30 minutes before the start (< 2 h)', '200 LATE_CANCELLED', r, (x) => x.status === 200 && x.data.booking.status === 'LATE_CANCELLED');
  const strike = await eventually(async () => {
    const s = await call('attendance', 'GET', `/api/reliability/${m2.id}`, { token: admin });
    return s.data && s.data.strikes && s.data.strikes.some((k) => k.type === 'LATE_CANCEL' && k.classId === C1.classId) ? s : null;
  }, { timeoutMs: 45000 });
  R.check('E2E-26', 'Late cancellation becomes a strike in Attendance (BookingLateCancelled event)', 'LATE_CANCEL strike', strike || { status: 'none' }, (x) => x && x.status === 200);
  r = await call('attendance', 'GET', '/api/reliability/me', { token: m2.token });
  R.check('E2E-27', 'Member sees own strike on the reliability page', '200 strikeCount 1', r, (x) => x.status === 200 && x.data.strikeCount === 1);
  r = await call('attendance', 'GET', `/api/reliability/${m1.id}`, { token: m2.token });
  R.check('E2E-28', "Member reads another member's reliability record", '403', r, (x) => x.status === 403);

  // ---------------- Attendance & Reports ----------------
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/code`, { token: sara });
  R.check('E2E-29', 'Check-in code requested 30 minutes before the class (window opens at 15)', '409 ATTENDANCE_NOT_OPEN', r, (x) => x.status === 409 && x.data.error.code === 'ATTENDANCE_NOT_OPEN');
  r = await call('attendance', 'GET', `/api/attendance/${C1.classId}`, { token: sara });
  R.check('E2E-30', 'Attendance sheet built from the Booking roster', '200, 2 rows UNMARKED', r, (x) => x.status === 200 && x.data.rows.length === 2 && x.data.rows.every((w) => w.status === 'UNMARKED'));
  r = await call('attendance', 'GET', `/api/attendance/${C1.classId}`, { token: m1.token });
  R.check('E2E-31', 'Member opens the attendance sheet', '403', r, (x) => x.status === 403);
  const from = iso(Date.now() - 86400000);
  const to = iso(Date.now() + 3 * 86400000);
  r = await call('attendance', 'GET', `/api/reports/classes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token: sara });
  R.check('E2E-32', 'Trainer report (own classes only)', '200, only Sara', r, (x) => x.status === 200 && x.data.sessions.some((s) => s.classId === C1.classId) && x.data.sessions.every((s) => s.trainerName === 'Sara Trainer'));
  r = await call('attendance', 'GET', `/api/reports/classes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&trainerId=${SEED.omar.id}`, { token: sara });
  R.check('E2E-33', "Trainer requests another trainer's report", '403 TRAINER_OWN_REPORTS_ONLY', r, (x) => x.status === 403);
  r = await call('attendance', 'POST', '/api/reports/export', { token: admin, body: { from, to } });
  R.check('E2E-34', 'Admin exports CSV to S3 (SSE-KMS) and gets a 5-minute pre-signed URL', '201 + signed url', r, (x) => x.status === 201 && x.data.url.includes('X-Amz-Signature'));
  if (r.status === 201) {
    const csv = await (await fetch(r.data.url)).text();
    R.check('E2E-35', 'Download the CSV through the pre-signed URL', 'CSV header row', { status: csv.startsWith('startTime,title') ? 'CSV ok' : 'bad', data: csv.slice(0, 120) }, () => csv.startsWith('startTime,title'));
  }
  r = await call('attendance', 'POST', '/api/reports/export', { token: omar, body: { from, to } });
  const omarCsv = r.status === 201 ? await (await fetch(r.data.url)).text() : '';
  R.check('E2E-36', "Trainer's CSV export is scoped to his own classes (no Sara classes)", '201, no Sara Trainer rows', { status: r.status, data: omarCsv.slice(0, 120) }, (x) => x.status === 201 && !omarCsv.includes('Sara Trainer'));

  // ---------------- Cascades from Class service ----------------
  const start2 = roundUp5(Date.now() + 2 * 86400000);
  const s2 = time.parts(new Date(start2));
  const day2 = s2.date;
  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'E2E Pilates', category: 'pilates', studioId: STUDIO_B, startTime: time.localToUtc(day2, '08:00').toISOString(), durationMin: 45, capacity: 5, publish: true } });
  const C2 = r.data.class;
  R.check('E2E-37', 'Trainer creates a second class (2 days ahead)', '201', r, (x) => x.status === 201);
  r = await call('bookings', 'POST', '/api/bookings', { token: m4.token, body: { classId: C2.classId } });
  R.check('E2E-38', 'Member books it', '201', r, (x) => x.status === 201);
  r = await call('classes', 'PATCH', `/api/classes/${C2.classId}`, { token: sara, body: { startTime: time.localToUtc(day2, '09:00').toISOString(), version: C2.version } });
  R.check('E2E-39', 'Trainer reschedules the booked class', '200', r, (x) => x.status === 200);
  r = await call('classes', 'PATCH', `/api/classes/${C2.classId}`, { token: sara, body: { capacity: 6, version: C2.version } });
  R.check('E2E-40', 'Edit with an out-of-date version (optimistic locking)', '409', r, (x) => x.status === 409);
  const resched = await eventually(async () => {
    const n = await call('bookings', 'GET', '/api/notifications/mine', { token: m4.token });
    return n.data.notifications.find((x) => x.kind === 'CLASS_RESCHEDULED') ? n : null;
  }, { timeoutMs: 45000 });
  R.check('E2E-41', 'Booked member notified of the new time (ClassRescheduled event)', 'CLASS_RESCHEDULED', resched || { status: 'none' }, (x) => x && x.status === 200);
  r = await call('classes', 'POST', `/api/classes/${C2.classId}/cancel`, { token: sara, body: { reason: 'Studio maintenance' } });
  R.check('E2E-42', 'Trainer cancels the class', '200 CANCELLED', r, (x) => x.status === 200 && x.data.class.status === 'CANCELLED');
  const cascade = await eventually(async () => {
    const m = await call('bookings', 'GET', '/api/bookings/mine', { token: m4.token });
    return m.data.bookings.find((b) => b.classId === C2.classId && b.status === 'CANCELLED_BY_GYM') ? m : null;
  }, { timeoutMs: 45000 });
  R.check('E2E-43', 'Bookings cancelled by the gym (ClassCancelled event)', 'CANCELLED_BY_GYM', cascade || { status: 'none' }, (x) => x && x.status === 200);
  r = await call('bookings', 'POST', '/api/bookings', { token: m1.token, body: { classId: C2.classId } });
  R.check('E2E-44', 'Booking a cancelled class', '409 CLASS_NOT_BOOKABLE', r, (x) => x.status === 409 && x.data.error.code === 'CLASS_NOT_BOOKABLE');

  // ---------------- Admin ----------------
  r = await call('attendance', 'GET', `/api/audit?day=${new Date().toISOString().slice(0, 10)}`, { token: admin });
  const actions = new Set((r.data && r.data.entries || []).map((e) => e.action));
  R.check('E2E-45', 'Admin audit log has actions from every service', 'USER_REGISTERED, CLASS_CREATED, BOOKING_CREATED', r, (x) => x.status === 200 && ['CLASS_CREATED', 'BOOKING_CREATED', 'USER_REGISTERED'].every((a) => actions.has(a)), [...actions].join(', '));
  r = await call('attendance', 'GET', `/api/audit?day=${new Date().toISOString().slice(0, 10)}`, { token: sara });
  R.check('E2E-46', 'Trainer opens the audit log', '403', r, (x) => x.status === 403);

  // ---------------- Live check-in (optional, waits for the real window) ----------------
  if (LIVE) {
    const opens = new Date(C1.startTime).getTime() - 14 * 60000;
    const waitMs = opens - Date.now();
    if (waitMs > 0) { console.log(`  .. waiting ${Math.round(waitMs / 60000)} min for the check-in window`); await sleep(waitMs); }
    r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/code`, { token: omar });
    R.check('E2E-47', 'Trainer not assigned to the class issues a code', '403 NOT_ASSIGNED_TRAINER', r, (x) => x.status === 403);
    r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/code`, { token: sara });
    R.check('E2E-48', 'Assigned trainer issues a one-time check-in code', '201 + 6 digits', r, (x) => x.status === 201 && /^\d{6}$/.test(x.data.code));
    const code = r.data && r.data.code;
    r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/check-in`, { token: m1.token, body: { code: code === '000000' ? '111111' : '000000' } });
    R.check('E2E-49', 'Member enters a wrong code', '400 INVALID_CHECKIN_CODE', r, (x) => x.status === 400 && x.data.error.code === 'INVALID_CHECKIN_CODE');
    r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/check-in`, { token: m1.token, body: { code } });
    R.check('E2E-50', 'Member checks in with the right code', '201 PRESENT', r, (x) => x.status === 201 && x.data.attendance.status === 'PRESENT');
    r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/check-in`, { token: m2.token, body: { code } });
    R.check('E2E-51', 'Member whose booking was cancelled uses the code', '403 NOT_BOOKED', r, (x) => x.status === 403 && x.data.error.code === 'NOT_BOOKED');
    r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/close`, { token: sara });
    R.check('E2E-52', 'Close the session before it ends', '409 SESSION_NOT_ENDED', r, (x) => x.status === 409);
    r = await call('attendance', 'GET', `/api/attendance/${C1.classId}`, { token: sara });
    R.check('E2E-53', 'Attendance sheet shows the checked-in member', '200, m1 PRESENT', r, (x) => x.status === 200 && x.data.rows.find((w) => w.memberId === m1.id).status === 'PRESENT');
  }

  // Clean up: cancel the main class so the next run can use the same slot (not part of the results).
  await call('classes', 'POST', `/api/classes/${C1.classId}/cancel`, { token: sara, body: { reason: 'End-to-end test finished' } });
  const ok = R.write(LIVE ? 'floci-e2e-live-results' : 'floci-e2e-results');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });

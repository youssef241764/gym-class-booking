// End-to-end integration test across all three services (+ identity).
// Normal and invalid cases for the main workflows. Requires the test clock, so
// it runs against local mode started with ALLOW_TEST_CLOCK=true (see README).
//
//   node tests/integration.mjs

import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  call, login, SEED, setClock, resetClock, eventually, Recorder, sleep,
} from './lib.mjs';

const require = createRequire(import.meta.url);
const time = require('../shared/src/time.js');
const R = new Recorder('Integrated tests - Gym Class Booking System');
const STUDIO_A = '5e2a7c1e-0000-4000-8000-000000000001';
const STUDIO_B = '5e2a7c1e-0000-4000-8000-000000000002';
const SPIN = '5e2a7c1e-0000-4000-8000-000000000003';

const today = time.parts(new Date()).date;
const D = time.addDays(today, 3);
const at = (day, hhmm) => time.localToUtc(day, hhmm).toISOString();
const minus = (iso, min) => new Date(new Date(iso).getTime() - min * 60000).toISOString();
const plus = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString();

async function main() {
  resetClock();
  const [admin, sara, omar, ali, nour, hana] = await Promise.all(['admin', 'sara', 'omar', 'ali', 'nour', 'hana'].map(login));

  // ---------------- Identity ----------------
  const email = `tester.${Date.now()}@gym.local`;
  const password = 'Tester-Pass-2026';
  let r = await call('identity', 'POST', '/api/auth/register', { body: { name: 'Test Member', email, password } });
  R.check('INT-01', 'Register a new member account', '201, role member', r, (x) => x.status === 201 && x.data.user.role === 'member');
  const testerId = r.data.user && r.data.user.id;
  r = await call('identity', 'POST', '/api/auth/register', { body: { name: 'Test Member', email, password } });
  R.check('INT-02', 'Register the same email again', '409 EMAIL_IN_USE', r, (x) => x.status === 409);
  r = await call('identity', 'POST', '/api/auth/login', { body: { email, password } });
  R.check('INT-03', 'Login with the new account', '200 + access token', r, (x) => x.status === 200 && x.data.accessToken);
  const tester = r.data.accessToken;

  // ---------------- Class & Schedule ----------------
  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'Morning Yoga', category: 'yoga', studioId: STUDIO_B, startTime: at(D, '10:00'), durationMin: 60, capacity: 2, publish: true } });
  R.check('INT-04', 'Trainer creates and publishes a class (capacity 2)', '201 PUBLISHED', r, (x) => x.status === 201 && x.data.class.status === 'PUBLISHED');
  const C1 = r.data.class;
  r = await call('classes', 'POST', '/api/classes', { token: omar, body: { title: 'HIIT Blast', category: 'hiit', studioId: STUDIO_B, startTime: at(D, '10:30'), durationMin: 45, capacity: 10 } });
  R.check('INT-05', 'Second class in the same studio at an overlapping time', '409 R6_STUDIO_CLASH', r, (x) => x.status === 409 && x.data.error.details.some((d) => d.rule === 'R6_STUDIO_CLASH'));
  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'Pilates', category: 'pilates', studioId: STUDIO_A, startTime: at(D, '11:05'), durationMin: 45, capacity: 10 } });
  R.check('INT-06', 'Same trainer, 5 minutes after her class ends (10-min changeover)', '409 R5_TRAINER_CLASH', r, (x) => x.status === 409 && x.data.error.details.some((d) => d.rule === 'R5_TRAINER_CLASH'));
  const holiday = process.env.STUB_HOLIDAY_DATE;
  if (holiday) {
    r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'Holiday Spin', category: 'spinning', studioId: SPIN, startTime: at(holiday, '12:00'), durationMin: 45, capacity: 10 } });
    R.check('INT-07', 'Class on a public holiday (Nager.Date API)', '409 R7_HOLIDAY', r, (x) => x.status === 409 && x.data.error.details.some((d) => d.rule === 'R7_HOLIDAY'));
    r = await call('classes', 'POST', '/api/classes', { token: admin, body: { title: 'Holiday Spin', category: 'spinning', trainerId: SEED.sara.id, studioId: SPIN, startTime: at(holiday, '12:00'), durationMin: 45, capacity: 10, allowHoliday: true } });
    R.check('INT-08', 'Admin overrides the holiday rule', '201 holidayCheck HOLIDAY_OVERRIDDEN', r, (x) => x.status === 201 && x.data.class.holidayCheck === 'HOLIDAY_OVERRIDDEN');
  }
  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'Late Night', category: 'yoga', studioId: STUDIO_A, startTime: at(D, '22:30'), durationMin: 60, capacity: 10 } });
  R.check('INT-09', 'Class that ends after closing time (23:00)', '409 R3_OPENING_HOURS', r, (x) => x.status === 409 && x.data.error.details.some((d) => d.rule === 'R3_OPENING_HOURS'));
  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'Big Yoga', category: 'yoga', studioId: STUDIO_B, startTime: at(D, '15:00'), durationMin: 60, capacity: 40 } });
  R.check('INT-10', 'Capacity larger than the studio (Studio B = 15)', '409 R4_CAPACITY', r, (x) => x.status === 409 && x.data.error.details.some((d) => d.rule === 'R4_CAPACITY'));
  r = await call('classes', 'POST', '/api/classes/series', { token: omar, body: { title: 'Evening Spin', category: 'spinning', studioId: SPIN, startDate: D, time: '18:00', weekdays: [0, 1, 2, 3, 4, 5, 6], weeks: 1, durationMin: 45, capacity: 12, ...(holiday ? {} : {}) } });
  R.check('INT-11', 'Recurring series (7 days), holiday date skipped', '201 created + skipped list', r, (x) => x.status === 201 && x.data.created.length >= 5 && (!holiday || x.data.skipped.some((s) => s.reasons.includes('R7_HOLIDAY'))), r.data && `created ${r.data.created && r.data.created.length}, skipped ${r.data.skipped && r.data.skipped.length}`);

  // ---------------- Booking & Waitlist ----------------
  r = await call('bookings', 'POST', '/api/bookings', { token: ali, body: { classId: C1.classId } });
  R.check('INT-12', 'Member books a place', '201 CONFIRMED', r, (x) => x.status === 201 && x.data.booking.status === 'CONFIRMED');
  const aliBooking = r.data.booking;
  r = await call('bookings', 'POST', '/api/bookings', { token: nour, body: { classId: C1.classId } });
  R.check('INT-13', 'Second member takes the last place', '201', r, (x) => x.status === 201);
  const nourBooking = r.data.booking;
  r = await call('bookings', 'POST', '/api/bookings', { token: hana, body: { classId: C1.classId } });
  R.check('INT-14', 'Third member tries to book the full class', '409 CLASS_FULL', r, (x) => x.status === 409 && x.data.error.code === 'CLASS_FULL');
  r = await call('bookings', 'POST', '/api/waitlist', { token: hana, body: { classId: C1.classId } });
  R.check('INT-15', 'Third member joins the waitlist', '201 position 1', r, (x) => x.status === 201 && x.data.entry.position === 1);
  r = await call('bookings', 'POST', '/api/bookings', { token: ali, body: { classId: C1.classId } });
  R.check('INT-16', 'Member books the same class twice', '409 ALREADY_BOOKED', r, (x) => x.status === 409 && x.data.error.code === 'ALREADY_BOOKED');
  r = await call('bookings', 'POST', '/api/waitlist', { token: ali, body: { classId: C1.classId } });
  R.check('INT-17', 'Booked member tries to join the waitlist', '409 ALREADY_BOOKED', r, (x) => x.status === 409);

  r = await call('classes', 'POST', '/api/classes', { token: omar, body: { title: 'Boxing 1:1', category: 'boxing', studioId: STUDIO_A, startTime: at(D, '13:00'), durationMin: 30, capacity: 1, publish: true } });
  const C2 = r.data.class;
  const race = await Promise.all([ali, nour, hana].map((t) => call('bookings', 'POST', '/api/bookings', { token: t, body: { classId: C2.classId } })));
  const winners = race.filter((x) => x.status === 201).length;
  R.check('INT-18', 'Three simultaneous bookings for one remaining seat', 'exactly one 201, others 409', { status: winners === 1 ? 'one winner' : `${winners} winners`, data: race.map((x) => x.status) }, () => winners === 1 && race.filter((x) => x.status === 409).length === 2);

  r = await call('classes', 'GET', `/api/classes?from=${encodeURIComponent(minus(C1.startTime, 60))}&to=${encodeURIComponent(plus(C1.startTime, 60))}`);
  const listed = r.data.classes && r.data.classes.find((c) => c.classId === C1.classId);
  R.check('INT-19', 'Public timetable shows live availability from Booking', '200, booked 2 / capacity 2, no trainerId exposed', r, (x) => x.status === 200 && listed && listed.availability.booked === 2 && listed.trainerId === undefined);

  r = await call('classes', 'PATCH', `/api/classes/${C1.classId}`, { token: sara, body: { capacity: 1, version: C1.version } });
  R.check('INT-20', 'Reduce capacity below confirmed bookings (asks Booking)', '409 CAPACITY_BELOW_BOOKINGS', r, (x) => x.status === 409 && x.data.error.code === 'CAPACITY_BELOW_BOOKINGS');
  r = await call('classes', 'PATCH', `/api/classes/${C1.classId}`, { token: sara, body: { capacity: 3, version: C1.version } });
  R.check('INT-21', 'Increase capacity to 3', '200, ClassCapacityChanged event', r, (x) => x.status === 200 && x.data.class.capacity === 3);
  let promoted = await eventually(async () => {
    const mine = await call('bookings', 'GET', '/api/bookings/mine', { token: hana });
    return mine.data.bookings.find((b) => b.classId === C1.classId && b.status === 'CONFIRMED' && b.source === 'WAITLIST') ? mine : null;
  });
  R.check('INT-22', 'Waitlisted member is promoted automatically (event-driven)', 'booking source WAITLIST', promoted || { status: 'not promoted' }, (x) => x && x.status === 200);
  const notif = await eventually(async () => {
    const n = await call('bookings', 'GET', '/api/notifications/mine', { token: hana });
    return n.data.notifications.find((x) => x.kind === 'WAITLIST_PROMOTED') ? n : null;
  });
  R.check('INT-23', 'Promoted member gets an in-app notification + Brevo email', 'WAITLIST_PROMOTED, emailStatus SENT', notif || { status: 'none' }, (x) => x && x.data.notifications.find((n) => n.kind === 'WAITLIST_PROMOTED').emailStatus === 'SENT');

  r = await call('bookings', 'POST', '/api/waitlist', { token: tester, body: { classId: C1.classId } });
  R.check('INT-24', 'Class full again (3/3): new member joins the waitlist', '201 position 1', r, (x) => x.status === 201 && x.data.entry.position === 1);
  r = await call('bookings', 'DELETE', `/api/bookings/${encodeURIComponent(aliBooking.bookingId)}`, { token: nour });
  R.check('INT-25', "Member tries to cancel someone else's booking (IDOR)", '403 NOT_BOOKING_OWNER', r, (x) => x.status === 403);
  r = await call('bookings', 'DELETE', `/api/bookings/${encodeURIComponent(aliBooking.bookingId)}`, { token: ali });
  R.check('INT-26', 'Member cancels own booking 3 days ahead -> seat goes to the waitlist', '200 CANCELLED (not late), 1 promoted', r, (x) => x.status === 200 && x.data.booking.status === 'CANCELLED' && x.data.lateCancellation === false && x.data.promotedFromWaitlist === 1);

  // ---------------- Time moves to 1 hour before class ----------------
  setClock(minus(C1.startTime, 60));
  await sleep(300);
  r = await call('bookings', 'DELETE', `/api/bookings/${encodeURIComponent(nourBooking.bookingId)}`, { token: nour });
  R.check('INT-27', 'Member cancels 1 hour before start', '200 LATE_CANCELLED', r, (x) => x.status === 200 && x.data.booking.status === 'LATE_CANCELLED');
  const lateStrike = await eventually(async () => {
    const s = await call('attendance', 'GET', `/api/reliability/${SEED.nour.id}`, { token: admin });
    return s.data.strikes && s.data.strikes.some((k) => k.type === 'LATE_CANCEL' && k.classId === C1.classId) ? s : null;
  });
  R.check('INT-28', 'Late cancellation becomes a strike in Attendance (event-driven)', 'LATE_CANCEL strike', lateStrike || { status: 'none' }, (x) => x && x.status === 200);

  // ---------------- Attendance ----------------
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/code`, { token: sara });
  R.check('INT-29', 'Check-in code before the window opens (15 min before)', '409 ATTENDANCE_NOT_OPEN', r, (x) => x.status === 409 && x.data.error.code === 'ATTENDANCE_NOT_OPEN');
  setClock(minus(C1.startTime, 10));
  await sleep(300);
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/code`, { token: omar });
  R.check('INT-30', 'Trainer who is not assigned to the class issues a code', '403 NOT_ASSIGNED_TRAINER', r, (x) => x.status === 403);
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/code`, { token: sara });
  R.check('INT-31', 'Assigned trainer issues a one-time check-in code', '201 + 6-digit code', r, (x) => x.status === 201 && /^\d{6}$/.test(x.data.code));
  const code = r.data.code;
  const wrong = code === '000000' ? '111111' : '000000';
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/check-in`, { token: hana, body: { code: wrong } });
  R.check('INT-32', 'Member enters a wrong code', '400 INVALID_CHECKIN_CODE', r, (x) => x.status === 400 && x.data.error.code === 'INVALID_CHECKIN_CODE');
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/check-in`, { token: hana, body: { code } });
  R.check('INT-33', 'Member checks in with the right code', '201 PRESENT', r, (x) => x.status === 201 && x.data.attendance.status === 'PRESENT');
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/check-in`, { token: ali, body: { code } });
  R.check('INT-34', 'Member without a booking (cancelled) uses the code', '403 NOT_BOOKED', r, (x) => x.status === 403 && x.data.error.code === 'NOT_BOOKED');
  r = await call('attendance', 'PUT', `/api/attendance/${C1.classId}`, { token: sara, body: { records: [{ memberId: SEED.ali.id, status: 'PRESENT' }] } });
  R.check('INT-35', 'Trainer marks a member who is not on the roster', '400 NOT_BOOKED', r, (x) => x.status === 400 && x.data.error.code === 'NOT_BOOKED');
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/close`, { token: sara });
  R.check('INT-36', 'Close the session before it ends', '409 SESSION_NOT_ENDED', r, (x) => x.status === 409);
  r = await call('attendance', 'GET', `/api/attendance/${C1.classId}`, { token: sara });
  R.check('INT-37', 'Attendance sheet merges the Booking roster with records', '200, hana PRESENT, tester UNMARKED', r, (x) => x.status === 200 && x.data.rows.find((w) => w.memberId === SEED.hana.id).status === 'PRESENT' && x.data.rows.find((w) => w.memberId === testerId).status === 'UNMARKED');

  setClock(plus(C1.startTime, 65));
  await sleep(300);
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/close`, { token: sara });
  R.check('INT-38', 'Close the session after it ends -> unmarked member becomes NO_SHOW', '200 present 1, noShow 1', r, (x) => x.status === 200 && x.data.summary.present === 1 && x.data.summary.noShow === 1);
  r = await call('attendance', 'POST', `/api/attendance/${C1.classId}/close`, { token: sara });
  R.check('INT-39', 'Close the same session twice', '409 SESSION_ALREADY_CLOSED', r, (x) => x.status === 409);
  const completed = await eventually(async () => {
    const c = await call('classes', 'GET', `/api/classes/${C1.classId}`, { token: sara });
    return c.data.class && c.data.class.status === 'COMPLETED' ? c : null;
  });
  R.check('INT-40', 'Class service marks the class COMPLETED (SessionClosed event)', 'status COMPLETED', completed || { status: 'not completed' }, (x) => x && x.status === 200);
  r = await call('attendance', 'GET', '/api/reliability/me', { token: tester });
  R.check('INT-41', 'No-show member sees the strike on their reliability page', '1 NO_SHOW strike', r, (x) => x.status === 200 && x.data.strikeCount === 1 && x.data.strikes[0].type === 'NO_SHOW');

  // ---------------- Strikes -> suspension -> Booking refuses ----------------
  const D2 = time.addDays(D, 1);
  const mk = async (token, title, studioId, hhmm) => (await call('classes', 'POST', '/api/classes', { token, body: { title, category: 'strength', studioId, startTime: at(D2, hhmm), durationMin: 30, capacity: 10, publish: true } })).data.class;
  resetClock();
  const C3 = await mk(sara, 'Strength A', STUDIO_A, '10:00');
  const C4 = await mk(omar, 'Strength B', STUDIO_B, '10:00');
  const C5 = await mk(sara, 'Strength C', STUDIO_A, '12:00');
  setClock(minus(C3.startTime, 30));
  await sleep(300);
  for (const c of [C3, C4]) {
    const b = await call('bookings', 'POST', '/api/bookings', { token: tester, body: { classId: c.classId } });
    await call('bookings', 'DELETE', `/api/bookings/${encodeURIComponent(b.data.booking.bookingId)}`, { token: tester });
  }
  const suspended = await eventually(async () => {
    const s = await call('attendance', 'GET', '/api/reliability/me', { token: tester });
    return s.data.suspended ? s : null;
  });
  R.check('INT-42', 'Third strike (1 no-show + 2 late cancels) suspends the member', 'suspended true, 3 strikes', suspended || { status: 'not suspended' }, (x) => x && x.data.strikeCount === 3);
  r = await call('bookings', 'POST', '/api/bookings', { token: tester, body: { classId: C5.classId } });
  R.check('INT-43', 'Suspended member tries to book (Booking asks Attendance)', '403 MEMBER_SUSPENDED', r, (x) => x.status === 403 && x.data.error.code === 'MEMBER_SUSPENDED');
  const suspNotif = await eventually(async () => {
    const n = await call('bookings', 'GET', '/api/notifications/mine', { token: tester });
    return n.data.notifications.find((x) => x.kind === 'MEMBER_SUSPENDED') ? n : null;
  });
  R.check('INT-44', 'Suspension notification delivered (Attendance -> EventBridge -> Booking notifier)', 'MEMBER_SUSPENDED notification', suspNotif || { status: 'none' }, (x) => x && x.status === 200);
  setClock(plus(C1.startTime, 120));
  await sleep(300);
  r = await call('attendance', 'PATCH', `/api/attendance/${C1.classId}/${testerId}`, { token: sara, body: { status: 'EXCUSED', reason: 'Medical note provided' } });
  R.check('INT-45', 'Trainer tries an admin-only correction', '403 ROLE_NOT_ALLOWED', r, (x) => x.status === 403);
  r = await call('attendance', 'PATCH', `/api/attendance/${C1.classId}/${testerId}`, { token: admin, body: { status: 'EXCUSED', reason: 'Medical note provided' } });
  R.check('INT-46', 'Admin corrects NO_SHOW -> EXCUSED within 48 h', '200 previousStatus NO_SHOW', r, (x) => x.status === 200 && x.data.attendance.previousStatus === 'NO_SHOW');
  setClock(minus(C5.startTime, 30));
  await sleep(300);
  r = await call('attendance', 'GET', '/api/reliability/me', { token: tester });
  R.check('INT-47', 'Correction removes the strike and lifts the automatic suspension', '2 strikes, suspended false', r, (x) => x.status === 200 && x.data.strikeCount === 2 && x.data.suspended === false);
  r = await call('bookings', 'POST', '/api/bookings', { token: tester, body: { classId: C5.classId } });
  R.check('INT-48', 'Member can book again after the suspension is lifted', '201', r, (x) => x.status === 201);
  resetClock();

  // ---------------- Reports ----------------
  const from = encodeURIComponent(at(time.addDays(D, -1), '00:00'));
  const to = encodeURIComponent(at(time.addDays(D, 3), '00:00'));
  r = await call('attendance', 'GET', `/api/reports/classes?from=${from}&to=${to}`, { token: sara });
  const row = r.data && r.data.sessions && r.data.sessions.find((s) => s.classId === C1.classId);
  R.check('INT-49', "Trainer report (own classes only) with fill / attendance / no-show rates", '200, C1 attendanceRate 50%, only Sara\'s classes', r, (x) => x.status === 200 && row && row.attendanceRate === 50 && x.data.sessions.every((s) => s.trainerName === 'Sara Trainer'));
  r = await call('attendance', 'GET', `/api/reports/classes?from=${from}&to=${to}&trainerId=${SEED.omar.id}`, { token: sara });
  R.check('INT-50', "Trainer requests another trainer's report", '403 TRAINER_OWN_REPORTS_ONLY', r, (x) => x.status === 403);
  r = await call('attendance', 'POST', '/api/reports/export', { token: admin, body: { from: decodeURIComponent(from), to: decodeURIComponent(to) } });
  R.check('INT-51', 'Admin exports CSV (S3 SSE-KMS + 5-minute pre-signed URL)', '201 + url', r, (x) => x.status === 201 && x.data.url.includes('X-Amz-Signature'));
  if (r.status === 201) {
    const csv = await (await fetch(r.data.url)).text();
    R.check('INT-52', 'Download the exported CSV through the pre-signed URL', 'CSV with header row', { status: csv.startsWith('startTime,title') ? 'CSV ok' : 'bad', data: csv.slice(0, 120) }, () => csv.startsWith('startTime,title'));
  }

  // ---------------- Cascades from Class service ----------------
  r = await call('classes', 'PATCH', `/api/classes/${C5.classId}`, { token: sara, body: { startTime: at(D2, '14:00'), version: C5.version } });
  R.check('INT-53', 'Trainer reschedules a booked class', '200 new startTime', r, (x) => x.status === 200);
  const resched = await eventually(async () => {
    const n = await call('bookings', 'GET', '/api/notifications/mine', { token: tester });
    return n.data.notifications.find((x) => x.kind === 'CLASS_RESCHEDULED') ? n : null;
  });
  R.check('INT-54', 'Booked member notified of the new time (ClassRescheduled event)', 'CLASS_RESCHEDULED', resched || { status: 'none' }, (x) => x && x.status === 200);
  r = await call('classes', 'POST', `/api/classes/${C5.classId}/cancel`, { token: sara, body: { reason: 'Trainer unwell' } });
  R.check('INT-55', 'Trainer cancels the class', '200 CANCELLED', r, (x) => x.status === 200 && x.data.class.status === 'CANCELLED');
  const cascade = await eventually(async () => {
    const m = await call('bookings', 'GET', '/api/bookings/mine', { token: tester });
    return m.data.bookings.find((b) => b.classId === C5.classId && b.status === 'CANCELLED_BY_GYM') ? m : null;
  });
  R.check('INT-56', 'Bookings are cancelled by the gym (ClassCancelled event)', 'CANCELLED_BY_GYM', cascade || { status: 'none' }, (x) => x && x.status === 200);
  r = await call('bookings', 'POST', '/api/bookings', { token: ali, body: { classId: C5.classId } });
  R.check('INT-57', 'Booking a cancelled class', '409 CLASS_NOT_BOOKABLE', r, (x) => x.status === 409 && x.data.error.code === 'CLASS_NOT_BOOKABLE');

  // ---------------- Audit ----------------
  r = await call('attendance', 'GET', `/api/audit?day=${new Date().toISOString().slice(0, 10)}`, { token: admin });
  const actions = new Set((r.data.entries || []).map((e) => e.action));
  R.check('INT-58', 'Admin audit log shows actions from all services', 'CLASS_CREATED, BOOKING_CREATED, MEMBER_CHECKED_IN ...', r, (x) => x.status === 200 && ['CLASS_CREATED', 'BOOKING_CREATED', 'USER_REGISTERED'].every((a) => actions.has(a)), [...actions].join(', '));

  if (fs.existsSync('/tmp/gym-brevo-calls.json')) {
    const calls = JSON.parse(fs.readFileSync('/tmp/gym-brevo-calls.json', 'utf8'));
    R.check('INT-59', 'Emails sent through Brevo API with the key from Secrets Manager', '>= 1 call with api-key header', { status: `${calls.length} calls`, data: calls.slice(0, 3) }, () => calls.length >= 1 && calls.every((c) => c.keyPresent));
  }
  resetClock();
  const ok = R.write('integration-results');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  resetClock();
  console.error(err);
  process.exit(1);
});

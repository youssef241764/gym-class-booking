// Controlled security tests against OUR OWN deployment (no third-party targets).
// Works against the Floci deployment or local mode; no test clock needed.
//
//   node tests/security.mjs            (GYM_TARGET=floci to test the Lambda deployment)

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  call, login, SEED, CREDS, Recorder, ROOT, API,
} from './lib.mjs';

const require = createRequire(import.meta.url);
const time = require('../shared/src/time.js');
const R = new Recorder('Security test table - Gym Class Booking System');
const ON_FLOCI = process.env.GYM_TARGET === 'floci';

// SEC-26 on Floci: read the last hour of every gym log group from CloudWatch Logs.
async function cloudWatchLogText() {
  const { CloudWatchLogsClient, DescribeLogGroupsCommand, FilterLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');
  const cwl = new CloudWatchLogsClient({ region: 'us-east-1', endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  const groups = (await cwl.send(new DescribeLogGroupsCommand({}))).logGroups.map((g) => g.logGroupName).filter((n) => n.includes('gym'));
  let text = '';
  for (const logGroupName of groups) {
    let nextToken;
    do {
      const page = await cwl.send(new FilterLogEventsCommand({ logGroupName, startTime: Date.now() - 3600000, nextToken }));
      text += page.events.map((e) => e.message).join('\n');
      nextToken = page.nextToken;
    } while (nextToken);
  }
  return text;
}
const STUDIO_A = '5e2a7c1e-0000-4000-8000-000000000001';
const SPIN = '5e2a7c1e-0000-4000-8000-000000000003';

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }

async function main() {
  const [admin, sara, omar, ali, nour] = await Promise.all(['admin', 'sara', 'omar', 'ali', 'nour'].map(login));
  const day = time.addDays(time.parts(new Date()).date, 6);
  const slot = `${String(6 + Math.floor(Math.random() * 10)).padStart(2, '0')}:${['00', '15', '30', '45'][Math.floor(Math.random() * 4)]}`;
  const created = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'Security Test Class', category: 'other', studioId: SPIN, startTime: time.localToUtc(day, slot).toISOString(), durationMin: 30, capacity: 5, publish: true } });
  const cls = created.data.class;
  if (!cls) throw new Error(`could not create test class: ${JSON.stringify(created.data)}`);
  const bk = await call('bookings', 'POST', '/api/bookings', { token: ali, body: { classId: cls.classId } });
  const aliBooking = bk.data.booking;

  // ---- 1. Unauthenticated access ----
  let r = await call('bookings', 'GET', '/api/bookings/mine');
  R.check('SEC-01', 'Unauthenticated request to a protected endpoint (my bookings)', '401 UNAUTHENTICATED', r, (x) => x.status === 401);
  r = await call('attendance', 'GET', '/api/reports/classes?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z');
  R.check('SEC-02', 'Unauthenticated request to reports', '401', r, (x) => x.status === 401);

  // ---- 2. Token tampering ----
  const [h, p, s] = ali.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  const forged = `${h}.${b64url({ ...payload, 'cognito:groups': ['admin'] })}.${s}`;
  r = await call('identity', 'GET', '/api/users', { token: forged });
  R.check('SEC-03', "Member edits their JWT to add the 'admin' group (signature no longer valid)", '401 invalid token', r, (x) => x.status === 401);
  const none = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ ...payload, 'cognito:groups': ['admin'] })}.x`;
  r = await call('identity', 'GET', '/api/users', { token: none });
  R.check('SEC-04', "Unsigned token with alg 'none'", '401', r, (x) => x.status === 401);

  // ---- 3. Unauthorized role ----
  r = await call('classes', 'POST', '/api/classes', { token: ali, body: { title: 'Hack', category: 'other', studioId: STUDIO_A, startTime: cls.startTime, durationMin: 30, capacity: 5 } });
  R.check('SEC-05', 'Member tries to create a class (trainer/admin only)', '403 ROLE_NOT_ALLOWED', r, (x) => x.status === 403);
  r = await call('identity', 'PATCH', `/api/users/${SEED.ali.id}/role`, { token: sara, body: { role: 'admin' } });
  R.check('SEC-06', 'Trainer tries to make a member an admin', '403 ROLE_NOT_ALLOWED', r, (x) => x.status === 403);
  r = await call('attendance', 'GET', '/api/audit?day=2026-01-01', { token: sara });
  R.check('SEC-07', 'Trainer tries to read the audit log (admin only)', '403', r, (x) => x.status === 403);

  // ---- 4. Ownership / object-level access ----
  r = await call('bookings', 'DELETE', `/api/bookings/${encodeURIComponent(aliBooking.bookingId)}`, { token: nour });
  R.check('SEC-08', "Member cancels another member's booking by changing the ID (IDOR)", '403 NOT_BOOKING_OWNER', r, (x) => x.status === 403);
  r = await call('classes', 'PATCH', `/api/classes/${cls.classId}`, { token: omar, body: { title: 'Taken over', version: cls.version } });
  R.check('SEC-09', "Trainer edits another trainer's class", '403 NOT_ASSIGNED_TRAINER', r, (x) => x.status === 403);
  r = await call('bookings', 'GET', `/api/bookings?classId=${cls.classId}`, { token: omar });
  R.check('SEC-10', "Trainer reads the roster of another trainer's class", '403', r, (x) => x.status === 403);
  r = await call('classes', 'POST', '/api/classes', { token: omar, body: { title: 'Impersonate', category: 'other', trainerId: SEED.sara.id, studioId: STUDIO_A, startTime: cls.startTime, durationMin: 30, capacity: 5 } });
  R.check('SEC-11', 'Trainer schedules a class in another trainer\'s name', '403 TRAINER_CAN_ONLY_SCHEDULE_SELF', r, (x) => x.status === 403);

  // ---- 5. Invalid input ----
  r = await call('classes', 'POST', '/api/classes', { token: sara, body: { title: 'X', category: 'yoga', studioId: STUDIO_A, startTime: 'tomorrow', durationMin: -5, capacity: 0 } });
  R.check('SEC-12', 'Invalid class fields (short title, bad date, negative duration, zero capacity)', '400 VALIDATION_FAILED', r, (x) => x.status === 400 && x.data.error.details.length >= 4);
  r = await call('identity', 'POST', '/api/auth/register', { body: { name: 'Eve', email: `eve.${Date.now()}@gym.local`, password: 'Password123x', role: 'admin' } });
  R.check('SEC-13', "Self-registration with an extra field role='admin' (mass assignment)", '400 (unknown field rejected)', r, (x) => x.status === 400);
  r = await call('bookings', 'POST', '/api/bookings', { token: ali, raw: '{"classId": ', headers: { 'content-type': 'application/json' } });
  R.check('SEC-14', 'Malformed JSON body', '400 MALFORMED_JSON', r, (x) => x.status === 400 && x.data.error.code === 'MALFORMED_JSON');
  r = await call('bookings', 'POST', '/api/bookings', { token: ali, raw: 'classId=1', headers: { 'content-type': 'text/plain' } });
  R.check('SEC-15', 'Unsupported content type (text/plain)', '415', r, (x) => x.status === 415);
  r = await call('classes', 'GET', `/api/classes/${encodeURIComponent("' OR 1=1 --")}`);
  R.check('SEC-16', 'Injection-style value in a path parameter', '400 VALIDATION_FAILED', r, (x) => x.status === 400);
  r = await call('identity', 'POST', '/api/auth/register', { body: { name: 'Weak', email: `weak.${Date.now()}@gym.local`, password: 'password' } });
  R.check('SEC-17', 'Weak password at registration', '400', r, (x) => x.status === 400);

  // ---- 6. Internal endpoints ----
  r = await fetch(`${API.attendance}/internal/members/${SEED.ali.id}/eligibility`).then(async (x) => ({ status: x.status, data: await x.json() }));
  R.check('SEC-18', 'Browser/attacker calls an internal endpoint without the service key', '403 INTERNAL_ONLY (PC) / 404 no route (API Gateway)', r, (x) => x.status === 403 || (ON_FLOCI && x.status === 404));
  r = await fetch(`${API.bookings}/internal/booking-counts`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': 'guess' }, body: JSON.stringify({ classIds: [cls.classId] }) }).then(async (x) => ({ status: x.status, data: await x.json() }));
  R.check('SEC-19', 'Internal endpoint with a guessed service key', '403 (PC) / 404 no route (API Gateway)', r, (x) => x.status === 403 || (ON_FLOCI && x.status === 404));

  // ---- 7. Brute force ----
  const victim = `victim.${Date.now()}@gym.local`;
  await call('identity', 'POST', '/api/auth/register', { body: { name: 'Victim', email: victim, password: 'Victim-Pass-2026' } });
  const attempts = [];
  for (let i = 0; i < 6; i += 1) attempts.push((await call('identity', 'POST', '/api/auth/login', { body: { email: victim, password: `wrong-${i}` } })).status);
  R.check('SEC-20', 'Six wrong passwords for one account', 'five 401 then 429 (temporary cool-down)', { status: attempts.join(','), data: attempts }, () => attempts.slice(0, 5).every((x) => x === 401) && attempts[5] === 429);
  r = await call('identity', 'POST', '/api/auth/login', { body: { email: `nobody.${Date.now()}@gym.local`, password: 'whatever' } });
  R.check('SEC-21', 'Login error does not reveal whether the email exists', '401 same generic message', r, (x) => x.status === 401 && x.data.error.message === 'Invalid email or password');

  // ---- 8. CORS ----
  const cors = await fetch(`${API.classes}/api/classes`, { headers: { origin: 'https://evil.example' } });
  R.check('SEC-22', 'Cross-origin request from an unknown site', 'no Access-Control-Allow-Origin header', { status: cors.headers.get('access-control-allow-origin') || 'header absent' }, () => !cors.headers.get('access-control-allow-origin'));

  // ---- 9. Data exposure ----
  r = await call('classes', 'GET', `/api/classes/${cls.classId}`);
  R.check('SEC-23', 'Anonymous class view hides internal fields', 'no trainerId / createdBy / version', r, (x) => x.status === 200 && !('trainerId' in x.data.class) && !('createdBy' in x.data.class));
  r = await call('identity', 'GET', '/api/users', { token: admin });
  const leak = JSON.stringify(r.data).match(/password|hash|token/i);
  R.check('SEC-24', 'Admin user list contains no password/hash/token fields', 'no sensitive fields', { status: leak ? `leak: ${leak[0]}` : 'clean' }, () => r.status === 200 && !leak);

  // ---- 10. Secret exposure review ----
  const findings = secretScan();
  R.check('SEC-25', 'Secret exposure review: scan repository files for keys, passwords, tokens', '0 findings; .env files git-ignored', { status: `${findings.length} findings`, data: findings }, () => findings.length === 0);
  const logs = ON_FLOCI ? await cloudWatchLogText() : (fs.existsSync(process.env.LOG_FILE || '/tmp/local.log') ? fs.readFileSync(process.env.LOG_FILE || '/tmp/local.log', 'utf8') : null);
  if (logs !== null) {
    const tokenInLogs = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(logs);
    const pwInLogs = Object.values(CREDS).some((pw) => logs.includes(pw));
    R.check('SEC-26', `Application logs contain no JWTs or passwords (${ON_FLOCI ? 'CloudWatch Logs' : 'local log'}, ${logs.length} chars scanned)`, 'none found', { status: tokenInLogs || pwInLogs ? 'FOUND' : 'clean' }, () => !tokenInLogs && !pwInLogs);
  }
  // ---- 11. Rate limiter (Lab 8): last on purpose, it blocks this IP for a minute ----
  const max = Number(process.env.RATE_LIMIT_MAX || 300);
  const codes = [];
  if (ON_FLOCI) {
    // One request at a time so a single warm Lambda container counts them (Floci starts a new container per concurrent call).
    for (let i = 0; i < max + 10; i += 1) {
      const x = await fetch(`${API.attendance}/api/health`, { headers: { 'x-forwarded-for': `9.9.9.${i % 250}` } });
      codes.push({ status: x.status, retry: x.headers.get('retry-after') });
    }
  } else {
    for (let i = 0; i < max + 10; i += 50) {
      const batch = await Promise.all(Array.from({ length: Math.min(50, max + 10 - i) }, () => fetch(`${API.attendance}/api/health`, { headers: { 'x-forwarded-for': `9.9.9.${i % 250}` } }).then((x) => ({ status: x.status, retry: x.headers.get('retry-after') }))));
      codes.push(...batch);
    }
  }
  const limited = codes.filter((c) => c.status === 429);
  R.check('SEC-27', `${max + 10} quick requests from one IP (limit ${max}/min), faking X-Forwarded-For`, 'some 429 RATE_LIMITED with Retry-After', { status: `${codes.length - limited.length}x200, ${limited.length}x429` }, () => limited.length >= 10 && limited.every((c) => c.retry));
  const ok = R.write('security-results');
  process.exit(ok ? 0 : 1);
}

// Lightweight secret scanner (same idea as gitleaks) over files that would be committed.
function secretScan() {
  let files;
  try {
    files = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    files = [];
    // Not a git clone (e.g. a downloaded copy): walk the folder, skipping what .gitignore keeps out of the repository.
    const ignoredPaths = ['infra/floci/data', 'infra/local/.venv'];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      if (['node_modules', '.git', '.generated', 'results', 'dist', '.DS_Store'].includes(e.name) || e.name === '.env' || /\.log$|^lambda\.zip$/.test(e.name)) return;
      const p = path.join(d, e.name);
      if (ignoredPaths.includes(path.relative(ROOT, p))) return;
      if (e.isDirectory()) walk(p); else files.push(path.relative(ROOT, p));
    });
    walk(ROOT);
  }
  const patterns = [
    ['AWS access key', /AKIA[0-9A-Z]{16}/],
    ['Brevo key', /xkeysib-[a-f0-9]{20,}/],
    ['Private key', /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
    ['JWT', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
    ['Hard-coded password', /password\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
    ['Connection string', /postgres(ql)?:\/\/[^\s:]+:[^\s@]+@/],
  ];
  const allow = ['tests/', 'README.md', 'docs/'];
  const out = [];
  for (const f of files) {
    if (allow.some((a) => f.startsWith(a)) || /\.(png|jpg|ico|zip)$/.test(f) || f.endsWith('package-lock.json')) continue;
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [name, re] of patterns) if (re.test(text)) out.push(`${f}: ${name}`);
  }
  if (files.some((f) => /(^|\/)\.env$/.test(f))) out.push('.env file would be committed');
  if (files.some((f) => f.includes('.generated/'))) out.push('infra/.generated would be committed');
  return out;
}

main().catch((err) => { console.error(err); process.exit(1); });

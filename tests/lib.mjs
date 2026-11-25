// Test helpers shared by the integration and security test suites.
// Targets the services on your PC (ports 3001-3004) or, with GYM_TARGET=floci,
// the Lambda + API Gateway deployment (URLs from infra/.generated/outputs.env).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Written by infra/setup-all.sh and infra/deploy-backend.sh (git-ignored).
const GEN = path.join(ROOT, 'infra', '.generated');
const readLines = (f) => (fs.existsSync(path.join(GEN, f)) ? fs.readFileSync(path.join(GEN, f), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : []);
const outputs = Object.fromEntries(readLines('outputs.env').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
export const CREDS = Object.fromEntries(readLines('seed-credentials.txt').map((l) => l.split(' ')));
export const SEED = Object.fromEntries(readLines('seed-users.txt').map((l) => {
  const [email, role, id] = l.split(' ');
  return [email.split('.')[0].split('@')[0], { email, role, id }];
}));

const local = { identity: 'http://localhost:3001', classes: 'http://localhost:3002', bookings: 'http://localhost:3003', attendance: 'http://localhost:3004' };
const floci = { identity: outputs.IDENTITY_API_URL, classes: outputs.CLASSES_API_URL, bookings: outputs.BOOKINGS_API_URL, attendance: outputs.ATTENDANCE_API_URL };
export const API = process.env.GYM_TARGET === 'floci' && floci.identity ? floci : local;
export const TARGET = process.env.GYM_TARGET_LABEL || (API === local ? 'PC (services on ports 3001-3004 + AWS emulator)' : 'Lambda + API Gateway on Floci');

export async function call(base, method, p, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(API[base] + p, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

const tokens = {};
export async function login(key) {
  if (tokens[key]) return tokens[key];
  const email = SEED[key] ? SEED[key].email : key;
  const r = await call('identity', 'POST', '/api/auth/login', { body: { email, password: CREDS[email] } });
  if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.data)}`);
  tokens[key] = r.data.accessToken;
  return tokens[key];
}

// Test clock (local mode only): services read the offset from this file when
// started with ALLOW_TEST_CLOCK=true. Lets us "move" to class time without waiting.
export const CLOCK_FILE = process.env.TEST_CLOCK_FILE || '/tmp/gym-test-clock';
export function setClock(targetIso) {
  const offset = new Date(targetIso).getTime() - Date.now();
  fs.writeFileSync(CLOCK_FILE, String(offset));
}
export function resetClock() {
  fs.writeFileSync(CLOCK_FILE, '0');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function eventually(fn, { timeoutMs = 20000, everyMs = 1000 } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

export class Recorder {
  constructor(title) {
    this.title = title;
    this.rows = [];
  }

  check(id, scenario, expected, res, passFn, note = '') {
    const pass = Boolean(passFn(res));
    const actual = typeof res === 'object' && res && 'status' in res
      ? `${res.status}${res.data && res.data.error ? ` ${res.data.error.code}` : ''}`
      : String(res);
    this.rows.push({ id, scenario, expected, actual, pass, note, evidence: res && res.data ? JSON.stringify(res.data).slice(0, 400) : '' });
    process.stdout.write(`${pass ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m'} ${id} ${scenario} -> ${actual}\n`);
    return pass;
  }

  write(name) {
    const dir = path.join(ROOT, 'tests', 'results', process.env.GYM_RESULTS_DIR || '');
    fs.mkdirSync(dir, { recursive: true });
    const passed = this.rows.filter((r) => r.pass).length;
    const md = [`# ${this.title}`, '', `Target: ${TARGET}  `, `Run at: ${new Date().toISOString()}  `, `Result: ${passed}/${this.rows.length} passed`, '',
      '| ID | Scenario | Expected | Actual | Result |', '|---|---|---|---|---|',
      ...this.rows.map((r) => `| ${r.id} | ${r.scenario.replace(/\|/g, '/')} | ${r.expected} | ${r.actual} | ${r.pass ? 'PASS' : 'FAIL'} |`), ''].join('\n');
    fs.writeFileSync(path.join(dir, `${name}.md`), md);
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ target: TARGET, rows: this.rows }, null, 2));
    console.log(`\n${passed}/${this.rows.length} passed -> tests/results/${process.env.GYM_RESULTS_DIR ? `${process.env.GYM_RESULTS_DIR}/` : ''}${name}.md`);
    return passed === this.rows.length;
  }
}

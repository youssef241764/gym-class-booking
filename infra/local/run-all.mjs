// Starts everything on your PC in ONE terminal (shortcut for the Lab 4/5 way of
// "npm run dev" in each services/<name> folder + "npm start" in frontend/):
//   node infra/local/run-all.mjs        (or: npm run local)
//   identity :3001  class-service :3002  booking-service :3003  attendance-service :3004
//   website  http://localhost:8080
// Stop with Ctrl+C.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICES = ['identity', 'class-service', 'booking-service', 'attendance-service'];
const children = [];

function run(name, cwd, cmd, args) {
  const child = spawn(cmd, args, { cwd, env: process.env, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}]`.padEnd(21);
  const pipe = (stream, out) => stream.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((l) => out.write(`${tag} ${l}\n`)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`${tag} stopped (${code})`));
  children.push(child);
}

for (const s of SERVICES) {
  const dir = path.join(ROOT, 'services', s);
  if (!fs.existsSync(path.join(dir, '.env'))) {
    console.error(`services/${s}/.env is missing - run "bash infra/setup-all.sh" first.`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    console.error(`services/${s}/node_modules is missing - run "npm run install-all" first.`);
    process.exit(1);
  }
  run(s, dir, process.execPath, ['server.js']);
}
run('frontend', path.join(ROOT, 'frontend'), process.execPath, [path.join(ROOT, 'frontend', 'node_modules', 'http-server', 'bin', 'http-server'), '.', '-p', '8080', '-c-1', '-s']);
setTimeout(() => console.log('\nWebsite: http://localhost:8080   (Ctrl+C stops everything)\n'), 1500);

process.on('SIGINT', () => { children.forEach((c) => c.kill()); process.exit(0); });

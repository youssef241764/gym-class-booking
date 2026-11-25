// Runs the saved Lambda test events of one service ON YOUR PC, through the real
// Lambda handler (lambda.js), without Docker. Same events as infra/invoke-events.sh.
//   cd services/booking-service && npm run events
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const dir = process.cwd();
const require = createRequire(path.join(dir, 'package.json'));
require('dotenv').config({ path: path.join(dir, '.env'), quiet: true });
process.env.DISABLE_WORKERS = 'true';
const { handler } = require(path.join(dir, 'lambda.js'));
const files = fs.readdirSync(path.join(dir, 'events')).filter((f) => f.endsWith('.json')).sort();
for (const f of files) {
  const event = JSON.parse(fs.readFileSync(path.join(dir, 'events', f), 'utf8'));
  const res = await handler(event, { awsRequestId: 'local' });
  const body = String(res.body || '').slice(0, 110);
  console.log(`${f.padEnd(38)} ${event.requestContext.http.method.padEnd(6)} ${event.rawPath.padEnd(44)} -> ${res.statusCode}  ${body}`);
}
process.exit(0);

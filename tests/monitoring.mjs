// Collects log + monitoring evidence from CloudWatch (Floci) for the report:
//  - log query: security events (403 / auth failures / invalid check-in codes) per service
//  - custom metrics (GymBooking namespace) and alarm states
// Run after the security/integration tests.   node tests/monitoring.mjs

import fs from 'node:fs';
import path from 'node:path';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchClient, DescribeAlarmsCommand, GetMetricStatisticsCommand, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { ROOT } from './lib.mjs';

// Floci (or the preview emulator) on localhost:4566; dummy keys, not secrets.
const clientConfig = () => ({ region: 'us-east-1', endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
const cwl = new CloudWatchLogsClient(clientConfig());
const cw = new CloudWatchClient(clientConfig());
const SERVICES = ['identity', 'class-service', 'booking-service', 'attendance-service'];
const EVENTS = ['HTTP_403', 'AUTH_FAILED', 'AUTH_MISSING', 'LOGIN_FAILED', 'LOGIN_THROTTLED', 'VALIDATION_FAILED', 'INTERNAL_ACCESS_DENIED', 'CHECKIN_CODE_INVALID', 'ACCESS_DENIED'];

async function events(group, term) {
  const all = [];
  let nextToken;
  do {
    const res = await cwl.send(new FilterLogEventsCommand({ logGroupName: group, filterPattern: `"${term}"`, startTime: Date.now() - 6 * 3600000, nextToken }));
    all.push(...(res.events || []));
    nextToken = res.nextToken;
  } while (nextToken && all.length < 2000);
  return all.map((e) => { try { return JSON.parse(e.message); } catch { return null; } }).filter((e) => e && e.event === term);
}

async function main() {
  const lines = ['# Log and monitoring evidence', '', `Collected: ${new Date().toISOString()} from CloudWatch Logs/Metrics (endpoint ${clientConfig().endpoint || 'AWS'})`, ''];
  lines.push('## 1. Log query: security-relevant events in the last 6 hours', '', 'Query (per log group `/gym/<service>`): filter pattern `"<EVENT>"`, parsed as JSON, counted by `event`.', '');
  lines.push(`| Service | ${EVENTS.join(' | ')} |`, `|---|${EVENTS.map(() => '---').join('|')}|`);
  const samples = [];
  const deniedByUser = new Map();
  for (const s of SERVICES) {
    const counts = [];
    for (const ev of EVENTS) {
      const list = await events(`/gym/${s}`, ev);
      counts.push(list.length);
      if (list.length && samples.length < 8 && ['HTTP_403', 'LOGIN_FAILED', 'LOGIN_THROTTLED', 'CHECKIN_CODE_INVALID', 'INTERNAL_ACCESS_DENIED'].includes(ev)) samples.push(list[list.length - 1]);
      if (ev === 'ACCESS_DENIED') for (const e of list) deniedByUser.set(e.userId || 'anonymous', (deniedByUser.get(e.userId || 'anonymous') || 0) + 1);
    }
    lines.push(`| ${s} | ${counts.join(' | ')} |`);
  }
  lines.push('', '## 2. Sample log lines (sensitive values already redacted by the logger)', '', '```json', ...samples.map((x) => JSON.stringify(x)), '```', '');
  lines.push('## 3. Suspicious pattern: users with repeated access-denied decisions', '', '| User (Cognito sub) | ACCESS_DENIED count |', '|---|---|',
    ...[...deniedByUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, n]) => `| ${u} | ${n} |`), '');

  lines.push('## 4. Custom metrics (namespace GymBooking, last 6 hours, Sum)', '', '| Metric | Dimensions | Sum |', '|---|---|---|');
  const metrics = await cw.send(new ListMetricsCommand({ Namespace: 'GymBooking' }));
  for (const m of metrics.Metrics || []) {
    const st = await cw.send(new GetMetricStatisticsCommand({ Namespace: 'GymBooking', MetricName: m.MetricName, Dimensions: m.Dimensions, StartTime: new Date(Date.now() - 6 * 3600000), EndTime: new Date(Date.now() + 60000), Period: 21600, Statistics: ['Sum'] }));
    const sum = (st.Datapoints || []).reduce((a, d) => a + (d.Sum || 0), 0);
    lines.push(`| ${m.MetricName} | ${(m.Dimensions || []).map((d) => `${d.Name}=${d.Value}`).join(', ')} | ${sum} |`);
  }
  lines.push('', '## 5. Alarms', '', '| Alarm | Metric | Threshold (5 min) | State |', '|---|---|---|---|');
  const alarms = await cw.send(new DescribeAlarmsCommand({ AlarmNamePrefix: 'gym-' }));
  for (const a of alarms.MetricAlarms || []) lines.push(`| ${a.AlarmName} | ${a.Namespace}/${a.MetricName} | >= ${a.Threshold} | ${a.StateValue} |`);
  const dir = path.join(ROOT, 'tests', 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'monitoring-evidence.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });

// Test harness: plays API Gateway (HTTP API, payload 2.0) in front of ONE service's
// real Lambda handler (services/<svc>/lambda.js), so the full test suites can run
// through the exact code path Lambda uses, without Docker.
//   node tests/lambda-gateway.mjs booking-service      (listens on the service's PC port)
// Only the routes in services/<svc>/infra/api-routes.txt are open (others: 404 like API Gateway).
// /internal/* is passed through because in the cloud it is reached by a direct Lambda invoke.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svc = process.argv[2];
const dir = path.join(ROOT, 'services', svc);
const require = createRequire(path.join(dir, 'package.json'));
require('dotenv').config({ path: path.join(dir, '.env'), quiet: true });
const { handler } = require(path.join(dir, 'lambda.js'));
const workers = require(path.join(dir, 'workers.js'));
const routes = fs.readFileSync(path.join(ROOT, 'services', svc, 'infra', 'api-routes.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [m, p] = l.split(' '); return { m, re: new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`) }; });

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const [rawPath, rawQueryString = ''] = req.url.split('?');
    const allowed = rawPath.startsWith('/internal/') || routes.some((r) => r.m === req.method && r.re.test(rawPath));
    if (!allowed) { res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}'); return; }
    const body = Buffer.concat(chunks);
    const event = {
      version: '2.0', routeKey: `${req.method} ${rawPath}`, rawPath, rawQueryString,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])),
      requestContext: { http: { method: req.method, path: rawPath, sourceIp: '127.0.0.1' }, requestId: `gw-${Date.now()}` },
      body: body.length ? body.toString('base64') : undefined, isBase64Encoded: body.length > 0,
    };
    try {
      const out = await handler(event, { awsRequestId: event.requestContext.requestId });
      const headers = { ...(out.headers || {}) };
      if (out.cookies) headers['set-cookie'] = out.cookies;
      res.writeHead(out.statusCode, headers).end(out.isBase64Encoded ? Buffer.from(out.body || '', 'base64') : (out.body || ''));
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' }).end('{"message":"Internal Server Error"}');
      console.error(err);
    }
  });
}).listen(Number(process.env.PORT), () => {
  console.log(`[gateway] ${svc} lambda.handler on :${process.env.PORT}`);
  workers.startLocal();
});

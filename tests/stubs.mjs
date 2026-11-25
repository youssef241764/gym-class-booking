// Local stand-ins for the two external APIs, used ONLY by automated tests when
// the test machine has no internet access. In the Floci deployment the services
// call the real https://date.nager.at and https://api.brevo.com.
//   :4590  Nager.Date  GET /PublicHolidays/{year}/{country}
//   :4591  Brevo       POST /v3/smtp/email   (records calls to /tmp/gym-brevo-calls.json)
import http from 'node:http';
import fs from 'node:fs';

const HOLIDAY = process.env.STUB_HOLIDAY_DATE; // a YYYY-MM-DD the tests treat as a holiday
const calls = [];

http.createServer((req, res) => {
  const m = /^\/PublicHolidays\/(\d{4})\/([A-Z]{2})$/.exec(req.url);
  if (!m) { res.writeHead(404).end(); return; }
  const list = [{ date: `${m[1]}-01-07`, localName: 'Coptic Christmas', name: 'Coptic Christmas Day', countryCode: m[2] }];
  if (HOLIDAY && HOLIDAY.startsWith(m[1])) list.push({ date: HOLIDAY, localName: 'Test Holiday', name: 'Test Holiday', countryCode: m[2] });
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
}).listen(4590);

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v3/smtp/email') { res.writeHead(404).end(); return; }
    if (!req.headers['api-key']) { res.writeHead(401).end('{"message":"Key not found"}'); return; }
    const parsed = JSON.parse(body);
    calls.push({ to: parsed.to.map((t) => t.email), subject: parsed.subject, keyPresent: true, at: new Date().toISOString() });
    fs.writeFileSync('/tmp/gym-brevo-calls.json', JSON.stringify(calls, null, 2));
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ messageId: `<stub-${calls.length}@brevo>` }));
  });
}).listen(4591);

console.log('stubs listening: holidays :4590, brevo :4591');

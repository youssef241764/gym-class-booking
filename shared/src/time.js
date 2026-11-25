'use strict';
// Gym-local time helpers. All timestamps are stored in UTC (ISO 8601); business
// rules such as opening hours and public holidays are evaluated in the gym's
// time zone (Africa/Cairo, which observes daylight saving time).

const TZ = process.env.GYM_TIMEZONE || 'Africa/Cairo';

function parts(date, tz = TZ) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday };
}

// Offset (minutes) of the zone from UTC at a given instant.
function offsetMinutes(date, tz = TZ) {
  const p = parts(date, tz);
  const asUtc = Date.UTC(...p.date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// Convert a local date ("2026-11-24") + time ("18:30") in the gym zone to a UTC Date.
function localToUtc(dateStr, timeStr, tz = TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off1 = offsetMinutes(guess, tz);
  let result = new Date(guess.getTime() - off1 * 60000);
  const off2 = offsetMinutes(result, tz);
  if (off2 !== off1) result = new Date(guess.getTime() - off2 * 60000);
  return result;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

module.exports = { TZ, parts, localToUtc, addDays, offsetMinutes };

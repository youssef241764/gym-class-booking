'use strict';
// External API integration: Nager.Date public holidays API (https://date.nager.at).
// Used by the scheduling rules to block class sessions on Egyptian public
// holidays when the gym is closed. No API key is needed.
// Results are cached per year for 12 hours. If the API is unreachable the
// check returns { checked: false } and the caller decides (fail-open with a
// warning, recorded on the class as holidayCheck = "UNAVAILABLE").

const { log } = require('gym-shared');

const BASE = process.env.HOLIDAY_API_URL || 'https://date.nager.at/api/v3';
const cache = new Map();
const TTL = 12 * 60 * 60 * 1000;

async function holidaysFor(year, country) {
  const key = `${year}-${country}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.map;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${BASE}/PublicHolidays/${year}/${encodeURIComponent(country)}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const list = await res.json();
    const map = new Map(list.map((h) => [h.date, h.localName && h.name ? `${h.name}` : h.name]));
    cache.set(key, { map, expires: Date.now() + TTL });
    log.info('HOLIDAY_API_FETCHED', { year, country, count: map.size });
    return map;
  } finally {
    clearTimeout(t);
  }
}

// dateStr is a gym-local date "YYYY-MM-DD".
async function checkHoliday(dateStr, country) {
  try {
    const map = await holidaysFor(dateStr.slice(0, 4), country);
    return { checked: true, isHoliday: map.has(dateStr), name: map.get(dateStr) || null };
  } catch (err) {
    log.warn('HOLIDAY_API_UNAVAILABLE', { reason: err.name === 'AbortError' ? 'timeout' : err.message });
    return { checked: false, isHoliday: false, name: null };
  }
}

module.exports = { checkHoliday };

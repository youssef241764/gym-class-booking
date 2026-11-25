'use strict';
// Small DOM helpers. Everything is built with textContent / createElement, never
// innerHTML with user data, so names or class titles cannot inject script (XSS).

(function () {
  // Let views pass optional children (cond ? node : null) to append/replaceChildren
  // without the DOM turning null into the text "null".
  for (const method of ['append', 'prepend', 'replaceChildren']) {
    const original = Element.prototype[method];
    Element.prototype[method] = function patched(...nodes) {
      return original.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
    };
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const TZ = 'Africa/Cairo';
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

  function toast(message, kind) {
    const t = h('div', { class: `toast ${kind || ''}` }, message);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), 4500);
  }

  // Turn an ApiError into a readable notice (shows validation/rule details).
  function errorNotice(err) {
    const details = Array.isArray(err.details) ? err.details : [];
    return h('div', { class: 'notice error', role: 'alert' },
      h('strong', {}, err.message),
      details.length ? h('ul', {}, details.slice(0, 8).map((d) => h('li', {}, d.field ? `${d.field}: ${d.message}` : (d.message || d.rule || JSON.stringify(d))))) : null);
  }

  async function guard(fn, { button, okMessage } = {}) {
    if (button) button.disabled = true;
    try {
      const r = await fn();
      if (okMessage) toast(okMessage);
      return r;
    } catch (err) {
      toast(err.message, 'error');
      throw err;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function statusBadge(status) {
    const map = {
      PUBLISHED: 'ok', CONFIRMED: 'ok', PRESENT: 'ok', COMPLETED: 'brand', DRAFT: '', LATE: 'warn', EXCUSED: 'brand',
      CANCELLED: 'danger', LATE_CANCELLED: 'danger', CANCELLED_BY_GYM: 'danger', NO_SHOW: 'danger', UNMARKED: '', SENT: 'ok', SKIPPED: '', FAILED: 'danger',
    };
    return h('span', { class: `badge ${map[status] || ''}` }, String(status).replace(/_/g, ' ').toLowerCase());
  }

  function table(columns, rows, empty = 'Nothing to show yet.') {
    if (!rows.length) return h('div', { class: 'empty' }, empty);
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', {}, c.render ? c.render(r) : r[c.key])))))));
  }

  function field(labelText, input) {
    const id = `f-${Math.random().toString(36).slice(2, 8)}`;
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, labelText), input);
  }

  // datetime-local input value (gym time) <-> ISO
  function toLocalInput(iso) {
    const d = new Date(iso);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  function fromLocalInput(value) {
    // Interpret the value in Africa/Cairo by finding the zone offset at that time.
    const [date, time] = value.split('T');
    const guess = new Date(`${date}T${time}:00Z`);
    const offset = (dt) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt).map((x) => [x.type, x.value]));
      return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(dt.getTime() / 60000) * 60000) / 60000;
    };
    let res = new Date(guess.getTime() - offset(guess) * 60000);
    res = new Date(guess.getTime() - offset(res) * 60000);
    return res.toISOString();
  }

  window.UI = { h, toast, errorNotice, guard, statusBadge, table, field, fmtDateTime, fmtTime, toLocalInput, fromLocalInput, TZ };
}());

'use strict';
// Attendance & Reliability screens — owner: Youssef Khaled Mokhtar (245609)
//  #/attendance/:classId  trainer/admin attendance sheet: mark, issue check-in code, close session, corrections
//  #/check-in/:classId    member self check-in with the trainer's 6-digit code
//  #/reliability          member strikes, suspension status, attendance history
//  #/reports              trainer/admin reports + encrypted CSV export
//  #/admin/members        admin: member standing, lift suspension
//  #/admin/audit          admin: audit log viewer
(function () {
  const { h, field, toast, guard, statusBadge, table, fmtDateTime, fmtTime, errorNotice } = UI;
  window.Views = window.Views || {};
  const STATUSES = ['PRESENT', 'LATE', 'EXCUSED', 'NO_SHOW'];

  // ------------------------------------------------------------------ attendance sheet
  Views.attendance = {
    title: 'Attendance', roles: ['trainer', 'admin'],
    async render(root, [classId]) {
      const user = Api.session().user;
      const head = h('div');
      const codeArea = h('div');
      const sheetArea = h('div', { class: 'card' });
      const msg = h('div');
      const load = async () => {
        msg.replaceChildren();
        let data;
        try {
          data = await Api.get('attendance', `/api/attendance/${classId}`);
        } catch (err) {
          head.replaceChildren(errorNotice(err));
          sheetArea.replaceChildren();
          return;
        }
        const closed = Boolean(data.session.closedAt);
        head.replaceChildren(h('h1', {}, data.class.title),
          h('p', { class: 'lead' }, `${fmtDateTime(data.class.startTime)} – ${fmtTime(data.class.endTime)} · ${data.rows.length} booked · `, closed ? statusBadge('COMPLETED') : statusBadge(data.class.status)),
          closed && data.session.summary ? h('div', { class: 'stats' }, ['present', 'late', 'excused', 'noShow'].map((k) => h('div', { class: 'stat' }, h('div', { class: 'value' }, data.session.summary[k]), h('div', { class: 'label' }, k === 'noShow' ? 'no-shows' : k)))) : null);
        const selects = new Map();
        const rows = data.rows.map((r) => ({ ...r }));
        sheetArea.replaceChildren(
          h('h3', {}, closed ? 'Final attendance' : 'Attendance sheet'),
          h('p', { class: 'meta' }, closed
            ? (user.role === 'admin' ? 'Session closed. Corrections need a reason and are allowed for 48 hours.' : 'Session closed. Ask an administrator for corrections.')
            : 'Mark members, or let them check in with a code. Opens 15 minutes before the start; unmarked members become no-shows when you close the session.'),
          table([
            { label: 'Member', key: 'memberName' },
            { label: 'Status', render: (r) => statusBadge(r.status) },
            { label: 'Method', render: (r) => (r.method ? r.method.replace(/_/g, ' ').toLowerCase() : '—') },
            {
              label: closed ? (user.role === 'admin' ? 'Correct' : '') : 'Set',
              render: (r) => {
                if (closed && user.role !== 'admin') return '';
                const s = h('select', {}, h('option', { value: '' }, '—'), STATUSES.map((x) => h('option', { value: x }, x.replace('_', ' ').toLowerCase())));
                selects.set(r.memberId, s);
                if (!closed) return s;
                return h('div', { class: 'actions' }, s, h('button', { class: 'small secondary', onclick: (e) => correct(r, s.value, e.currentTarget) }, 'Apply'));
              },
            },
          ], rows, 'Nobody has booked this class.'),
          !closed && rows.length ? h('div', { class: 'actions' }, h('button', { onclick: (e) => saveMarks(selects, e.currentTarget) }, 'Save marks')) : null);
        codeArea.replaceChildren(closed ? h('span') : h('div', { class: 'card' }, h('div', { class: 'row' },
          h('div', {}, h('h3', {}, 'Self check-in'), h('p', { class: 'meta' }, data.session.codeActive ? `A code is active until ${fmtTime(data.session.codeExpiresAt)}.` : 'Show a one-time code on the studio screen. It is valid for 10 minutes.')),
          h('div', { class: 'actions' },
            h('button', { class: 'secondary', onclick: (e) => issueCode(e.currentTarget) }, data.session.codeActive ? 'New code' : 'Show check-in code'),
            h('button', { class: 'danger', onclick: (e) => closeSession(e.currentTarget) }, 'Close session')))));
      };
      async function saveMarks(selects, button) {
        const records = [...selects.entries()].filter(([, s]) => s.value).map(([memberId, s]) => ({ memberId, status: s.value }));
        if (!records.length) { toast('Choose a status for at least one member'); return; }
        try {
          await guard(() => Api.put('attendance', `/api/attendance/${classId}`, { records }), { button, okMessage: `Saved ${records.length} record(s)` });
          load();
        } catch (err) { msg.replaceChildren(errorNotice(err)); }
      }
      async function issueCode(button) {
        try {
          const res = await guard(() => Api.post('attendance', `/api/attendance/${classId}/code`), { button });
          codeArea.prepend(h('div', { class: 'card' }, h('p', { class: 'meta' }, `Check-in code (valid until ${fmtTime(res.expiresAt)})`), h('div', { class: 'code-display', 'aria-live': 'polite' }, res.code)));
        } catch (err) { msg.replaceChildren(errorNotice(err)); }
      }
      async function closeSession(button) {
        if (!confirm('Close the session? Unmarked members will be recorded as no-shows and receive a strike.')) return;
        try {
          const res = await guard(() => Api.post('attendance', `/api/attendance/${classId}/close`), { button });
          toast(`Closed: ${res.summary.present + res.summary.late} attended, ${res.summary.noShow} no-shows`);
          load();
        } catch (err) { msg.replaceChildren(errorNotice(err)); }
      }
      async function correct(r, status, button) {
        if (!status) return;
        const reason = prompt(`Reason for changing ${r.memberName} to ${status}:`);
        if (!reason) return;
        try {
          await guard(() => Api.patch('attendance', `/api/attendance/${classId}/${r.memberId}`, { status, reason }), { button, okMessage: 'Record corrected' });
          load();
        } catch (err) { msg.replaceChildren(errorNotice(err)); }
      }
      root.append(head, msg, codeArea, sheetArea);
      await load();
    },
  };

  // ------------------------------------------------------------------ member check-in
  Views.checkIn = {
    title: 'Check in', roles: ['member'],
    async render(root, [classIdParam]) {
      const mine = await Api.get('bookings', '/api/bookings/mine');
      const soon = mine.bookings.filter((b) => b.status === 'CONFIRMED' && new Date(b.classEnd || b.classStart) > Date.now() - 3600000).sort((a, b) => a.classStart.localeCompare(b.classStart));
      const cls = h('select', {}, soon.map((b) => h('option', { value: b.classId, selected: b.classId === classIdParam }, `${b.classTitle} · ${fmtDateTime(b.classStart)}`)));
      const code = h('input', { inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: 6, autocomplete: 'one-time-code', placeholder: '6-digit code' });
      const msg = h('div');
      const submit = h('button', { type: 'submit' }, 'Check in');
      const form = h('form', { class: 'card narrow' }, h('h1', {}, 'Check in'), h('p', { class: 'lead' }, 'Enter the code shown by your trainer in the studio.'), msg,
        soon.length ? [field('Class', cls), field('Code', code), submit] : h('div', { class: 'empty' }, 'You have no class to check in to right now.'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.replaceChildren();
        submit.disabled = true;
        try {
          const res = await Api.post('attendance', `/api/attendance/${cls.value}/check-in`, { code: code.value.trim() });
          msg.replaceChildren(h('div', { class: 'notice ok' }, res.attendance.status === 'LATE' ? 'Checked in (late). Enjoy the class!' : 'You are checked in. Enjoy the class!'));
          code.value = '';
        } catch (err) { msg.replaceChildren(errorNotice(err)); } finally { submit.disabled = false; }
      });
      root.append(form);
    },
  };

  // ------------------------------------------------------------------ member reliability
  Views.reliability = {
    title: 'My attendance', roles: ['member'],
    async render(root) {
      const r = await Api.get('attendance', '/api/reliability/me');
      root.append(h('h1', {}, 'My attendance'), h('p', { class: 'lead' }, `No-shows and late cancellations are strikes. ${r.strikeLimit} strikes within 30 days pause new bookings for 7 days.`),
        r.suspended ? h('div', { class: 'notice error' }, `New bookings are paused until ${fmtDateTime(r.suspendedUntil)}.`) : null,
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('div', { class: 'value' }, `${r.strikeCount} / ${r.strikeLimit}`), h('div', { class: 'label' }, 'active strikes')),
          h('div', { class: 'stat' }, h('div', { class: 'value' }, r.attendanceRate === null ? '—' : `${r.attendanceRate}%`), h('div', { class: 'label' }, 'attendance rate')),
          h('div', { class: 'stat' }, h('div', { class: 'value' }, r.suspended ? 'Paused' : 'Active'), h('div', { class: 'label' }, 'booking status'))),
        h('h2', {}, 'Active strikes'),
        h('div', { class: 'card' }, table([{ label: 'Type', render: (s) => statusBadge(s.type) }, { label: 'Class time', render: (s) => fmtDateTime(s.at) }, { label: 'Expires', render: (s) => fmtDateTime(s.expiresOn) }], r.strikes, 'No strikes — great job!')),
        h('h2', {}, 'Attendance history'),
        h('div', { class: 'card' }, table([{ label: 'Class time', render: (x) => fmtDateTime(x.classStart) }, { label: 'Category', key: 'category' }, { label: 'Status', render: (x) => statusBadge(x.status) }, { label: 'Recorded by', render: (x) => (x.method || '').replace(/_/g, ' ').toLowerCase() }], r.history, 'No attendance records yet.')));
    },
  };

  // ------------------------------------------------------------------ reports
  Views.reports = {
    title: 'Reports', roles: ['trainer', 'admin'],
    async render(root) {
      const user = Api.session().user;
      const today = new Date();
      const from = h('input', { type: 'date', value: new Date(today.getTime() - 14 * 86400000).toISOString().slice(0, 10) });
      const to = h('input', { type: 'date', value: new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10) });
      const out = h('div');
      const range = () => ({ from: new Date(`${from.value}T00:00:00`).toISOString(), to: new Date(`${to.value}T23:59:59`).toISOString() });
      const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
      const load = async () => {
        out.replaceChildren(h('div', { class: 'empty' }, 'Calculating…'));
        try {
          const r = await Api.get('attendance', `/api/reports/classes${Api.qs(range())}`);
          const t = r.totals;
          out.replaceChildren(
            h('div', { class: 'stats' }, [['Sessions', t.sessions], ['Bookings', t.booked], ['Avg fill rate', pct(t.avgFillRate)], ['Attendance rate', pct(t.attendanceRate)], ['No-show rate', pct(t.noShowRate)]]
              .map(([l, v]) => h('div', { class: 'stat' }, h('div', { class: 'value' }, v), h('div', { class: 'label' }, l)))),
            h('h2', {}, 'Most popular categories'),
            h('div', { class: 'card' }, table([{ label: 'Category', key: 'key' }, { label: 'Sessions', key: 'sessions' }, { label: 'Bookings', key: 'booked' }, { label: 'Avg fill', render: (g) => pct(g.avgFillRate) }, { label: 'Attendance', render: (g) => pct(g.attendanceRate) }, { label: 'No-shows', render: (g) => pct(g.noShowRate) }], r.byCategory)),
            h('h2', {}, 'Busiest time slots'),
            h('div', { class: 'card' }, table([{ label: 'Slot', key: 'key' }, { label: 'Sessions', key: 'sessions' }, { label: 'Bookings', key: 'booked' }, { label: 'Avg fill', render: (g) => pct(g.avgFillRate) }], r.bySlot)),
            h('h2', {}, 'Sessions'),
            h('div', { class: 'card' }, table([
              { label: 'When', render: (s) => fmtDateTime(s.startTime) }, { label: 'Class', key: 'title' }, ...(user.role === 'admin' ? [{ label: 'Trainer', key: 'trainerName' }] : []),
              { label: 'Booked', render: (s) => `${s.booked}/${s.capacity}` }, { label: 'Fill', render: (s) => pct(s.fillRate) },
              { label: 'Attended', render: (s) => (s.closed ? s.present + s.late : '—') }, { label: 'No-shows', render: (s) => (s.closed ? s.noShow : '—') }, { label: 'Attendance', render: (s) => pct(s.attendanceRate) },
            ], r.sessions, 'No sessions in this range.')));
        } catch (err) { out.replaceChildren(errorNotice(err)); }
      };
      const exportBtn = h('button', { class: 'secondary', onclick: async (e) => {
        try {
          const res = await guard(() => Api.post('attendance', '/api/reports/export', range()), { button: e.currentTarget });
          toast(`Export ready (${res.sessions} sessions). Link valid for 5 minutes.`);
          window.open(res.url, '_blank', 'noopener');
        } catch { /* toast shown */ }
      } }, 'Export CSV');
      [from, to].forEach((el) => el.addEventListener('change', load));
      root.append(h('h1', {}, 'Reports'), h('p', { class: 'lead' }, user.role === 'trainer' ? 'Your classes only.' : 'All classes.'),
        h('div', { class: 'card' }, h('div', { class: 'row' }, field('From', from), field('To', to), h('div', { class: 'field' }, exportBtn))), out);
      await load();
    },
  };

  // ------------------------------------------------------------------ admin: member standing
  Views.members = {
    title: 'Member standing', roles: ['admin'],
    async render(root) {
      const users = (await Api.get('identity', '/api/users?role=member')).users;
      const pick = h('select', {}, users.map((u) => h('option', { value: u.id }, `${u.name} (${u.email})`)));
      const out = h('div');
      const load = async () => {
        out.replaceChildren();
        if (!pick.value) return;
        try {
          const r = await Api.get('attendance', `/api/reliability/${pick.value}`);
          out.replaceChildren(h('div', { class: 'card' },
            h('p', {}, h('strong', {}, `${r.strikeCount} / ${r.strikeLimit} strikes`), ' · ', r.suspended ? statusBadge('SUSPENDED') : statusBadge('ACTIVE')),
            r.suspended ? h('p', { class: 'meta' }, `Suspended until ${fmtDateTime(r.suspendedUntil)}`) : null,
            table([{ label: 'Type', render: (s) => statusBadge(s.type) }, { label: 'Class time', render: (s) => fmtDateTime(s.at) }, { label: 'Expires', render: (s) => fmtDateTime(s.expiresOn) }], r.strikes, 'No active strikes.'),
            r.suspended ? h('button', { onclick: async (e) => {
              const reason = prompt('Reason for lifting the suspension:');
              if (reason) await guard(() => Api.post('attendance', `/api/reliability/${pick.value}/lift`, { reason }), { button: e.currentTarget, okMessage: 'Suspension lifted' }).then(load).catch(() => {});
            } }, 'Lift suspension') : null));
        } catch (err) { out.replaceChildren(errorNotice(err)); }
      };
      pick.addEventListener('change', load);
      root.append(h('h1', {}, 'Member standing'), h('div', { class: 'card' }, field('Member', pick)), out);
      await load();
    },
  };

  // ------------------------------------------------------------------ admin: audit log
  Views.audit = {
    title: 'Audit log', roles: ['admin'],
    async render(root) {
      const day = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
      const action = h('input', { placeholder: 'e.g. BOOKING_CANCELLED', maxlength: 40 });
      const out = h('div', { class: 'card' });
      const load = async () => {
        try {
          const r = await Api.get('attendance', `/api/audit${Api.qs({ day: day.value, action: action.value.trim().toUpperCase() })}`);
          out.replaceChildren(table([
            { label: 'Time', render: (e) => fmtTime(e.at) }, { label: 'Service', key: 'service' }, { label: 'Action', render: (e) => h('code', {}, e.action) },
            { label: 'Actor', render: (e) => `${e.actorRole} ${String(e.actorId).slice(0, 8)}` }, { label: 'Target', render: (e) => `${e.targetType || ''} ${String(e.targetId || '').slice(0, 13)}` },
            { label: 'Details', render: (e) => (e.details ? JSON.stringify(e.details).slice(0, 80) : '') },
          ], r.entries, 'No audit entries for this day.'));
        } catch (err) { out.replaceChildren(errorNotice(err)); }
      };
      day.addEventListener('change', load);
      action.addEventListener('change', load);
      root.append(h('h1', {}, 'Audit log'), h('p', { class: 'lead' }, 'Append-only record of security and business actions from every service (UTC day).'),
        h('div', { class: 'card' }, h('div', { class: 'row' }, field('Day', day), field('Action', action))), out);
      await load();
    },
  };
}());

'use strict';
// Class & Schedule screens — owner: Youssef Ahmed Ibrahim (241764)
//  #/timetable          public timetable with live availability (+ book / waitlist buttons)
//  #/trainer/classes    staff list of sessions with publish / edit / cancel / delete
//  #/trainer/new        create a session or a weekly series (rules are enforced by the API)
//  #/admin/studios      studios (admin)
(function () {
  const { h, field, errorNotice, toast, guard, statusBadge, table, fmtDateTime, fmtTime, toLocalInput, fromLocalInput } = UI;
  const CATEGORIES = ['yoga', 'pilates', 'hiit', 'spinning', 'strength', 'boxing', 'zumba', 'crossfit', 'stretching', 'other'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  window.Views = window.Views || {};

  const todayLocal = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's zone

  function availabilityBar(c) {
    const a = c.availability;
    if (!a) return h('p', { class: 'meta' }, 'Availability unavailable right now');
    const pct = Math.min(100, Math.round((a.booked / c.capacity) * 100));
    const span = h('span');
    span.style.width = `${pct}%`;
    const full = a.booked >= c.capacity;
    return h('div', {}, h('div', { class: `bar ${full ? 'full' : ''}` }, span),
      h('p', { class: 'meta' }, full ? `Full · ${a.waitlist} on waitlist` : `${c.capacity - a.booked} of ${c.capacity} places left`));
  }

  Views.timetable = {
    title: 'Timetable', public: true,
    async render(root) {
      const user = (Api.session() || {}).user;
      const from = h('input', { type: 'date', value: todayLocal() });
      const days = h('select', {}, [7, 14].map((d) => h('option', { value: d }, `${d} days`)));
      const cat = h('select', {}, h('option', { value: '' }, 'All categories'), CATEGORIES.map((c) => h('option', { value: c }, c)));
      const list = h('div', { class: 'grid' });
      const msg = h('div');
      const load = async () => {
        msg.replaceChildren();
        list.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
        const start = new Date(`${from.value}T00:00:00`);
        const end = new Date(start.getTime() + Number(days.value) * 86400000);
        try {
          const res = await Api.get('classes', `/api/classes${Api.qs({ from: start.toISOString(), to: end.toISOString(), category: cat.value })}`);
          const mine = user && user.role === 'member' ? await BookingActions.myClassIds() : { booked: new Set(), waiting: new Set() };
          list.replaceChildren(...(res.classes.length ? res.classes.map((c) => classCard(c, user, mine, load)) : [h('div', { class: 'empty' }, 'No published classes in this period.')]));
        } catch (err) {
          list.replaceChildren();
          msg.replaceChildren(errorNotice(err));
        }
      };
      [from, days, cat].forEach((el) => el.addEventListener('change', load));
      root.append(h('h1', {}, 'Class timetable'), h('p', { class: 'lead' }, 'Times are shown in gym time (Cairo). Places update live from the booking service.'),
        h('div', { class: 'card' }, h('div', { class: 'row' }, field('From', from), field('Period', days), field('Category', cat))), msg, h('h2', {}, 'Classes'), list);
      await load();
    },
  };

  function classCard(c, user, mine, reload) {
    const a = c.availability || { booked: 0, waitlist: 0 };
    const full = a.booked >= c.capacity;
    let action = null;
    if (!user) action = h('a', { class: 'btn', href: '#/login' }, 'Sign in to book');
    else if (user.role === 'member') {
      if (mine.booked.has(c.classId)) action = h('span', { class: 'badge ok' }, 'Booked');
      else if (mine.waiting.has(c.classId)) action = h('span', { class: 'badge warn' }, 'On waitlist');
      else if (full) action = h('button', { class: 'secondary', onclick: (e) => BookingActions.joinWaitlist(c.classId, e.currentTarget).then(reload).catch(() => {}) }, 'Join waitlist');
      else action = h('button', { onclick: (e) => BookingActions.book(c.classId, e.currentTarget).then(reload).catch(() => {}) }, 'Book');
    }
    return h('article', { class: 'card class-card' },
      h('div', { class: 'row' }, h('div', {}, h('h3', {}, c.title), h('span', { class: 'badge brand' }, c.category))),
      h('p', { class: 'meta' }, `${fmtDateTime(c.startTime)} – ${fmtTime(c.endTime)} (${c.durationMin} min)`),
      h('p', { class: 'meta' }, `${c.trainerName} · ${c.studioName}`),
      c.description ? h('p', { class: 'meta' }, c.description) : null,
      availabilityBar(c),
      h('div', { class: 'foot' }, h('span'), action));
  }

  // ------------------------------------------------------------------ staff list
  Views.trainerClasses = {
    title: 'My classes', roles: ['trainer', 'admin'],
    async render(root) {
      const user = Api.session().user;
      let status = 'PUBLISHED';
      const tabs = h('div', { class: 'tabs' });
      const area = h('div');
      const editor = h('div');
      const load = async () => {
        tabs.replaceChildren(...['PUBLISHED', 'DRAFT', 'COMPLETED', 'CANCELLED'].map((s) => h('button', { class: s === status ? 'active' : '', onclick: () => { status = s; load(); } }, s.toLowerCase())));
        area.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
        const from = new Date(Date.now() - 14 * 86400000).toISOString();
        const to = new Date(Date.now() + 45 * 86400000).toISOString();
        try {
          const res = await Api.get('classes', `/api/classes${Api.qs({ from, to, ...(user.role === 'trainer' ? { scope: 'mine' } : { status }) })}`);
          const rows = res.classes.filter((c) => c.status === status);
          area.replaceChildren(table([
            { label: 'When', render: (c) => fmtDateTime(c.startTime) },
            { label: 'Class', render: (c) => h('div', {}, h('strong', {}, c.title), h('div', { class: 'meta' }, `${c.category} · ${c.studioName}${user.role === 'admin' ? ` · ${c.trainerName}` : ''}`)) },
            { label: 'Booked', render: (c) => (c.availability ? `${c.availability.booked}/${c.capacity}${c.availability.waitlist ? ` (+${c.availability.waitlist})` : ''}` : `—/${c.capacity}`) },
            { label: 'Status', render: (c) => statusBadge(c.status) },
            { label: '', render: (c) => actions(c, load, editor) },
          ], rows, `No ${status.toLowerCase()} classes.`));
        } catch (err) {
          area.replaceChildren(errorNotice(err));
        }
      };
      root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, user.role === 'admin' ? 'All classes' : 'My classes'), h('p', { class: 'lead' }, 'Last 2 weeks and next 45 days.')),
        h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/trainer/new' }, 'New class'))), editor, tabs, h('div', { class: 'card' }, area));
      await load();
    },
  };

  function actions(c, reload, editor) {
    const future = new Date(c.startTime) > new Date();
    const btns = [];
    if (c.status === 'DRAFT') btns.push(h('button', { class: 'small', onclick: (e) => guard(() => Api.post('classes', `/api/classes/${c.classId}/publish`), { button: e.currentTarget, okMessage: 'Published' }).then(reload).catch(() => {}) }, 'Publish'));
    if (['DRAFT', 'PUBLISHED'].includes(c.status) && future) {
      btns.push(h('button', { class: 'small secondary', onclick: () => openEditor(c, editor, reload) }, 'Edit'));
      btns.push(h('button', { class: 'small danger', onclick: async (e) => {
        const reason = prompt('Reason for cancelling (members are notified):');
        if (!reason) return;
        await guard(() => Api.post('classes', `/api/classes/${c.classId}/cancel`, { reason }), { button: e.currentTarget, okMessage: 'Class cancelled; members will be notified' }).then(reload).catch(() => {});
      } }, 'Cancel'));
    }
    if (c.status === 'DRAFT') btns.push(h('button', { class: 'small secondary', onclick: async (e) => { if (confirm('Delete this draft?')) await guard(() => Api.del('classes', `/api/classes/${c.classId}`), { button: e.currentTarget, okMessage: 'Draft deleted' }).then(reload).catch(() => {}); } }, 'Delete'));
    if (['PUBLISHED', 'COMPLETED'].includes(c.status)) btns.push(h('a', { class: 'btn small secondary', href: `#/attendance/${c.classId}` }, 'Attendance'));
    return h('div', { class: 'actions' }, btns);
  }

  function openEditor(c, editor, reload) {
    const title = h('input', { value: c.title, maxlength: 80 });
    const start = h('input', { type: 'datetime-local', value: toLocalInput(c.startTime) });
    const duration = h('input', { type: 'number', min: 5, max: 240, value: c.durationMin });
    const capacity = h('input', { type: 'number', min: 1, max: 100, value: c.capacity });
    const msg = h('div');
    const save = h('button', { type: 'submit' }, 'Save changes');
    const form = h('form', { class: 'card' }, h('h3', {}, `Edit: ${c.title}`),
      h('p', { class: 'meta' }, 'Rescheduling or changing capacity re-checks trainer/studio clashes and the confirmed bookings, and notifies booked members.'),
      msg, h('div', { class: 'row' }, field('Title', title), field('Start (gym time)', start), field('Duration (min)', duration), field('Capacity', capacity)),
      h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'secondary', onclick: () => editor.replaceChildren() }, 'Close')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { version: c.version };
      if (title.value.trim() !== c.title) body.title = title.value.trim();
      const iso = fromLocalInput(start.value);
      if (iso !== c.startTime) body.startTime = iso;
      if (Number(duration.value) !== c.durationMin) body.durationMin = Number(duration.value);
      if (Number(capacity.value) !== c.capacity) body.capacity = Number(capacity.value);
      msg.replaceChildren();
      save.disabled = true;
      try {
        const res = await Api.patch('classes', `/api/classes/${c.classId}`, body);
        toast('Class updated');
        if (res.warnings && res.warnings.length) toast(res.warnings[0].message);
        editor.replaceChildren();
        reload();
      } catch (err) { msg.replaceChildren(errorNotice(err)); } finally { save.disabled = false; }
    });
    editor.replaceChildren(form);
    form.scrollIntoView({ behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ create
  Views.newClass = {
    title: 'New class', roles: ['trainer', 'admin'],
    async render(root) {
      const user = Api.session().user;
      let mode = 'single';
      const [studios, trainers] = await Promise.all([Api.get('classes', '/api/studios'), user.role === 'admin' ? Api.get('identity', '/api/trainers') : Promise.resolve({ trainers: [] })]);
      const title = h('input', { maxlength: 80, required: true });
      const category = h('select', {}, CATEGORIES.map((c) => h('option', { value: c }, c)));
      const description = h('textarea', { rows: 2, maxlength: 500 });
      const trainer = h('select', {}, trainers.trainers.map((t) => h('option', { value: t.id }, t.name)));
      const studio = h('select', {}, studios.studios.map((s) => h('option', { value: s.studioId }, `${s.name} (max ${s.capacity})`)));
      const start = h('input', { type: 'datetime-local' });
      const startDate = h('input', { type: 'date' });
      const timeOfDay = h('input', { type: 'time', value: '18:00' });
      const weeks = h('input', { type: 'number', min: 1, max: 12, value: 4 });
      const dayBoxes = WEEKDAYS.map((d, i) => h('input', { type: 'checkbox', value: i }));
      const duration = h('input', { type: 'number', min: 5, max: 240, value: 60 });
      const capacity = h('input', { type: 'number', min: 1, max: 100, value: 15 });
      const publish = h('input', { type: 'checkbox' });
      const allowHoliday = h('input', { type: 'checkbox' });
      const msg = h('div');
      const result = h('div');
      const single = h('div', { class: 'row' }, field('Start (gym time)', start));
      const series = h('div', {}, h('div', { class: 'row' }, field('First date', startDate), field('Time (gym time)', timeOfDay), field('Weeks', weeks)),
        h('div', { class: 'field' }, h('label', {}, 'Days of the week'), h('div', { class: 'checks' }, dayBoxes.map((b, i) => h('label', {}, b, WEEKDAYS[i])))));
      series.hidden = true;
      const tabs = h('div', { class: 'tabs' });
      const renderTabs = () => {
        tabs.replaceChildren(h('button', { type: 'button', class: mode === 'single' ? 'active' : '', onclick: () => { mode = 'single'; single.hidden = false; series.hidden = true; renderTabs(); } }, 'Single session'),
          h('button', { type: 'button', class: mode === 'series' ? 'active' : '', onclick: () => { mode = 'series'; single.hidden = true; series.hidden = false; renderTabs(); } }, 'Weekly series'));
      };
      renderTabs();
      const submit = h('button', { type: 'submit' }, 'Create');
      const form = h('form', { class: 'card', novalidate: true }, tabs, msg,
        h('div', { class: 'row' }, field('Title', title), field('Category', category)),
        field('Description (optional)', description),
        h('div', { class: 'row' }, user.role === 'admin' ? field('Trainer', trainer) : null, field('Studio', studio), field('Duration (min)', duration), field('Capacity', capacity)),
        single, series,
        h('div', { class: 'checks field' }, h('label', {}, publish, 'Publish immediately'), user.role === 'admin' ? h('label', {}, allowHoliday, 'Allow on a public holiday') : null),
        submit);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.replaceChildren();
        result.replaceChildren();
        const body = {
          title: title.value.trim(), category: category.value, studioId: studio.value, durationMin: Number(duration.value), capacity: Number(capacity.value),
          publish: publish.checked, ...(description.value.trim() ? { description: description.value.trim() } : {}),
          ...(user.role === 'admin' ? { trainerId: trainer.value, allowHoliday: allowHoliday.checked } : {}),
        };
        submit.disabled = true;
        try {
          if (mode === 'single') {
            if (!start.value) throw new Api.ApiError(400, { error: { message: 'Choose a start date and time' } });
            const res = await Api.post('classes', '/api/classes', { ...body, startTime: fromLocalInput(start.value) });
            toast(`Created ${res.class.title} (${res.class.status.toLowerCase()})`);
            if (res.warnings.length) result.replaceChildren(h('div', { class: 'notice warn' }, res.warnings.map((w) => w.message).join(' ')));
            else location.hash = '#/trainer/classes';
          } else {
            const weekdays = dayBoxes.filter((b) => b.checked).map((b) => Number(b.value));
            const res = await Api.post('classes', '/api/classes/series', { ...body, startDate: startDate.value, time: timeOfDay.value, weeks: Number(weeks.value), weekdays });
            result.replaceChildren(h('div', { class: 'notice ok' }, `Created ${res.created.length} sessions.`),
              res.skipped.length ? h('div', { class: 'notice warn' }, h('strong', {}, `${res.skipped.length} dates skipped:`), h('ul', {}, res.skipped.map((s) => h('li', {}, `${s.date}: ${s.reasons.join(', ')}`)))) : null);
          }
        } catch (err) {
          msg.replaceChildren(errorNotice(err));
          if (err.code === 'NOTHING_CREATED' && Array.isArray(err.details)) msg.append(h('ul', {}, err.details.map((s) => h('li', {}, `${s.date}: ${s.reasons.join(', ')}`))));
        } finally { submit.disabled = false; }
      });
      root.append(h('h1', {}, 'New class'), h('p', { class: 'lead' }, 'The server checks opening hours, studio capacity, trainer and studio clashes (10-minute changeover) and Egyptian public holidays.'), form, result);
    },
  };

  // ------------------------------------------------------------------ studios
  Views.studios = {
    title: 'Studios', roles: ['admin'],
    async render(root) {
      const area = h('div');
      const load = async () => {
        const res = await Api.get('classes', '/api/studios');
        area.replaceChildren(table([{ label: 'Studio', key: 'name' }, { label: 'Capacity', key: 'capacity' }, { label: 'Location', render: (s) => s.location || '—' }], res.studios));
      };
      const name = h('input', { maxlength: 60 });
      const cap = h('input', { type: 'number', min: 1, max: 100, value: 20 });
      const loc = h('input', { maxlength: 80 });
      const msg = h('div');
      const form = h('form', { class: 'card' }, h('h3', {}, 'Add studio'), msg, h('div', { class: 'row' }, field('Name', name), field('Capacity', cap), field('Location', loc), h('div', { class: 'field' }, h('button', { type: 'submit' }, 'Add'))));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.replaceChildren();
        try {
          await Api.post('classes', '/api/studios', { name: name.value.trim(), capacity: Number(cap.value), ...(loc.value.trim() ? { location: loc.value.trim() } : {}) });
          toast('Studio added');
          name.value = ''; loc.value = '';
          load();
        } catch (err) { msg.replaceChildren(errorNotice(err)); }
      });
      root.append(h('h1', {}, 'Studios'), h('div', { class: 'card' }, area), form);
      await load();
    },
  };
}());

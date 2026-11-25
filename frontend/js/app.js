'use strict';
// Router + shared navigation. Navigation only HIDES links a role cannot use;
// the real authorization decision is always made by the backend.
(function () {
  const { h, errorNotice } = UI;

  const ROUTES = [
    ['login', Views.login], ['register', Views.register], ['timetable', Views.timetable],
    ['my-bookings', Views.myBookings], ['check-in', Views.checkIn], ['reliability', Views.reliability],
    ['trainer/classes', Views.trainerClasses], ['trainer/new', Views.newClass], ['attendance', Views.attendance], ['reports', Views.reports],
    ['admin/users', Views.users], ['admin/studios', Views.studios], ['admin/members', Views.members], ['admin/audit', Views.audit],
  ];
  const NAV = {
    anonymous: [['timetable', 'Timetable'], ['login', 'Sign in']],
    member: [['timetable', 'Timetable'], ['my-bookings', 'My bookings'], ['check-in', 'Check in'], ['reliability', 'My attendance']],
    trainer: [['timetable', 'Timetable'], ['trainer/classes', 'My classes'], ['trainer/new', 'New class'], ['reports', 'Reports']],
    admin: [['trainer/classes', 'Classes'], ['trainer/new', 'New class'], ['reports', 'Reports'], ['admin/users', 'Users'], ['admin/members', 'Members'], ['admin/studios', 'Studios'], ['admin/audit', 'Audit']],
  };

  function parse() {
    const path = (location.hash || '#/timetable').replace(/^#\//, '');
    for (const [prefix, view] of ROUTES.slice().sort((a, b) => b[0].length - a[0].length)) {
      if (path === prefix || path.startsWith(`${prefix}/`)) return { prefix, view, params: path.slice(prefix.length + 1).split('/').filter(Boolean) };
    }
    return { prefix: 'timetable', view: Views.timetable, params: [] };
  }

  function refreshChrome() {
    const s = Api.session();
    const user = s && s.expiresAt > Date.now() ? s.user : null;
    if (s && !user) Api.setSession(null);
    const current = parse().prefix;
    document.getElementById('nav').replaceChildren(...NAV[user ? user.role : 'anonymous'].map(([p, label]) => h('a', { href: `#/${p}`, class: current === p ? 'active' : '' }, label)));
    document.getElementById('session').replaceChildren(...(user ? [h('span', {}, user.name), h('span', { class: 'role-pill' }, user.role), h('button', { class: 'small secondary', onclick: () => window.signOut() }, 'Sign out')] : []));
  }

  async function render() {
    const { view, params } = parse();
    const root = document.getElementById('view');
    const s = Api.session();
    const user = s && s.expiresAt > Date.now() ? s.user : null;
    refreshChrome();
    root.replaceChildren();
    if (!view.public && !user) { location.hash = '#/login'; return; }
    if (view.roles && !view.roles.includes(user.role)) {
      root.append(h('div', { class: 'notice error' }, 'This page is not available for your role.'));
      return;
    }
    document.title = `${view.title} · Gym Class Booking`;
    try {
      await view.render(root, params);
    } catch (err) {
      root.append(errorNotice(err));
    }
    root.focus();
  }

  window.App = { refreshChrome, render };
  window.addEventListener('hashchange', render);
  window.addEventListener('gym:signed-out', () => { location.hash = '#/login'; refreshChrome(); });
  if (!window.GYM_CONFIG) document.getElementById('view').append(h('div', { class: 'notice error' }, 'js/config.js is missing.'));
  render();

  // Footer: "API online: lambda (production)" on Floci, "API online: pc (development)" on your PC (Lab 7).
  // Plain GET without the token: a bearer header would need a CORS pre-flight that /api/health has no route for.
  fetch(`${window.GYM_CONFIG.api.identity}/api/health`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((x) => { document.getElementById('api-status').textContent = `API online: ${x.runtime} (${x.environment})`; })
    .catch(() => { document.getElementById('api-status').textContent = 'API offline'; });
}());

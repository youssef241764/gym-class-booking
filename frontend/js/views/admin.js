'use strict';
// Admin user management (shared identity component).
(function () {
  const { h, field, guard, statusBadge, table, errorNotice } = UI;
  window.Views = window.Views || {};

  Views.users = {
    title: 'Users', roles: ['admin'],
    async render(root) {
      const me = Api.session().user;
      const q = h('input', { placeholder: 'Search name or email', maxlength: 60 });
      const role = h('select', {}, h('option', { value: '' }, 'All roles'), ['member', 'trainer', 'admin'].map((r) => h('option', { value: r }, r)));
      const out = h('div', { class: 'card' });
      const load = async () => {
        try {
          const r = await Api.get('identity', `/api/users${Api.qs({ q: q.value.trim(), role: role.value })}`);
          out.replaceChildren(table([
            { label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Role', render: (u) => h('span', { class: 'badge brand' }, u.role) },
            { label: 'Status', render: (u) => statusBadge(u.status === 'active' ? 'ACTIVE' : 'DISABLED') },
            {
              label: '', render: (u) => (u.id === me.id ? h('span', { class: 'meta' }, 'you') : h('div', { class: 'actions' },
                (() => {
                  const sel = h('select', {}, ['member', 'trainer', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, r)));
                  return [sel, h('button', { class: 'small secondary', onclick: (e) => guard(() => Api.patch('identity', `/api/users/${u.id}/role`, { role: sel.value }), { button: e.currentTarget, okMessage: 'Role updated; the user must sign in again' }).then(load).catch(() => {}) }, 'Set role')];
                })(),
                h('button', { class: `small ${u.status === 'active' ? 'danger' : ''}`, onclick: (e) => guard(() => Api.patch('identity', `/api/users/${u.id}/status`, { status: u.status === 'active' ? 'disabled' : 'active' }), { button: e.currentTarget, okMessage: 'Status updated' }).then(load).catch(() => {}) }, u.status === 'active' ? 'Disable' : 'Enable'))),
            },
          ], r.users));
        } catch (err) { out.replaceChildren(errorNotice(err)); }
      };
      q.addEventListener('change', load);
      role.addEventListener('change', load);
      root.append(h('h1', {}, 'Users and roles'), h('p', { class: 'lead' }, 'Role changes update Cognito groups and sign the user out everywhere.'),
        h('div', { class: 'card' }, h('div', { class: 'row' }, field('Search', q), field('Role', role))), out);
      await load();
    },
  };
}());

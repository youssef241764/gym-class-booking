'use strict';
// Shared identity screens (team-owned): sign in, register, sign out.
(function () {
  const { h, field, errorNotice, toast } = UI;
  window.Views = window.Views || {};

  Views.login = {
    title: 'Sign in', public: true,
    render(root) {
      const email = h('input', { type: 'email', autocomplete: 'username', required: true, maxlength: 254 });
      const password = h('input', { type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
      const msg = h('div');
      const submit = h('button', { type: 'submit' }, 'Sign in');
      const form = h('form', { class: 'card', novalidate: true }, h('h1', {}, 'Sign in'), h('p', { class: 'lead' }, 'Book classes, manage your sessions and see your attendance.'),
        msg, field('Email', email), field('Password', password), submit,
        h('p', { class: 'meta' }, 'New member? ', h('a', { href: '#/register' }, 'Create an account')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.replaceChildren();
        submit.disabled = true;
        try {
          const res = await Api.post('identity', '/api/auth/login', { email: email.value.trim(), password: password.value });
          Api.setSession({ token: res.accessToken, user: res.user, expiresAt: Date.now() + (res.expiresIn || 3600) * 1000 });
          password.value = '';
          toast(`Welcome, ${res.user.name}`);
          location.hash = res.user.role === 'member' ? '#/timetable' : res.user.role === 'trainer' ? '#/trainer/classes' : '#/admin/users';
          App.refreshChrome();
        } catch (err) {
          msg.replaceChildren(errorNotice(err));
        } finally {
          submit.disabled = false;
        }
      });
      root.append(h('div', { class: 'narrow' }, form));
    },
  };

  Views.register = {
    title: 'Create account', public: true,
    render(root) {
      const name = h('input', { autocomplete: 'name', required: true, maxlength: 80 });
      const email = h('input', { type: 'email', autocomplete: 'email', required: true });
      const password = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
      const msg = h('div');
      const submit = h('button', { type: 'submit' }, 'Create account');
      const form = h('form', { class: 'card', novalidate: true }, h('h1', {}, 'Create a member account'),
        h('p', { class: 'lead' }, 'Accounts are created as members. Staff roles are granted by an administrator.'),
        msg, field('Full name', name), field('Email', email), field('Password (10+ characters, upper & lower case, a number)', password), submit,
        h('p', { class: 'meta' }, 'Already registered? ', h('a', { href: '#/login' }, 'Sign in')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.replaceChildren();
        submit.disabled = true;
        try {
          await Api.post('identity', '/api/auth/register', { name: name.value.trim(), email: email.value.trim(), password: password.value });
          toast('Account created. Please sign in.');
          location.hash = '#/login';
        } catch (err) {
          msg.replaceChildren(errorNotice(err));
        } finally {
          submit.disabled = false;
        }
      });
      root.append(h('div', { class: 'narrow' }, form));
    },
  };

  window.signOut = async function signOut() {
    try { await Api.post('identity', '/api/auth/logout'); } catch { /* token may already be invalid */ }
    Api.setSession(null);
    location.hash = '#/login';
    App.refreshChrome();
  };
}());

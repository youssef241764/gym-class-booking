'use strict';
// Identity service (shared team component, lead: Youssef Khaled, supported by all).
// Wraps Amazon Cognito so the browser never needs Cognito admin rights:
//   POST  /api/auth/register      create member account (always role "member")
//   POST  /api/auth/login         Cognito USER_PASSWORD_AUTH -> access token
//   POST  /api/auth/logout        Cognito GlobalSignOut (revokes refresh tokens)
//   GET   /api/users/me           own profile
//   GET   /api/users              admin: search users by role / text
//   GET   /api/trainers           any signed-in user: trainer list (id + name only)
//   PATCH /api/users/:id/role     admin: change role (Cognito groups), forces sign-out
//   PATCH /api/users/:id/status   admin: disable / enable an account
//
// Routes: match an HTTP method and path, check who may call it (auth middleware),
// then hand the request to a controller function. No business logic here.

const { auth } = require('gym-shared');
const controller = require('../controllers/users');

function mount(app) {
  app.post('/api/auth/register', controller.register);
  app.post('/api/auth/login', controller.login);
  app.post('/api/auth/logout', auth.authenticate, controller.logout);
  app.get('/api/users/me', auth.authenticate, controller.getMe);
  app.get('/api/trainers', auth.authenticate, controller.listTrainers);
  app.get('/api/users', auth.authenticate, auth.requireRole('admin'), controller.searchUsers);
  app.patch('/api/users/:id/role', auth.authenticate, auth.requireRole('admin'), controller.changeRole);
  app.patch('/api/users/:id/status', auth.authenticate, auth.requireRole('admin'), controller.changeStatus);
}

module.exports = { mount };

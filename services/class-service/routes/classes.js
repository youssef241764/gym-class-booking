'use strict';
// Class & Schedule service — owner: Youssef Ahmed Ibrahim (241764)
//
// Functions
//  F1 Create a session with scheduling rules      POST  /api/classes
//  F2 Generate a recurring weekly series          POST  /api/classes/series
//  F3 Update / reschedule with cross-service guard PATCH /api/classes/:id
//     + publish workflow                           POST  /api/classes/:id/publish
//  F4 Cancel a session (event cascade to Booking)  POST  /api/classes/:id/cancel
//  F5 Timetable with live availability             GET   /api/classes, GET /api/classes/:id
//  +  Studios (admin)                              GET/POST /api/studios
//  +  Delete a draft                               DELETE /api/classes/:id
// Internal (x-internal-key): GET /internal/classes/:id, POST /internal/classes/batch,
//                            GET /internal/classes
//
// Routes: match an HTTP method and path, check who may call it (auth middleware),
// then hand the request to a controller function. No business logic here.

const { auth, internal } = require('gym-shared');
const controller = require('../controllers/classes');

function mount(app) {
  // ---------- F5: timetable ----------
  app.get('/api/classes', auth.authenticateOptional, controller.listClasses);
  app.get('/api/classes/:id', auth.authenticateOptional, controller.getClass);
  // ---------- F1: create with scheduling rules ----------
  app.post('/api/classes', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.createClass);
  // ---------- F2: recurring series ----------
  app.post('/api/classes/series', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.createSeries);
  // ---------- F3: update / reschedule ----------
  app.patch('/api/classes/:id', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.updateClass);
  app.post('/api/classes/:id/publish', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.publishClass);
  // ---------- F4: cancel with cascade ----------
  app.post('/api/classes/:id/cancel', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.cancelClass);
  app.delete('/api/classes/:id', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.deleteDraft);
  // ---------- Studios ----------
  app.get('/api/studios', auth.authenticate, controller.listStudios);
  app.post('/api/studios', auth.authenticate, auth.requireRole('admin'), controller.createStudio);
  // ---------- Internal API ----------
  app.get('/internal/classes/:id', internal.requireInternalKey, controller.internalGetClass);
  app.post('/internal/classes/batch', internal.requireInternalKey, controller.internalBatch);
  app.get('/internal/classes', internal.requireInternalKey, controller.listInternal);
}

module.exports = { mount };

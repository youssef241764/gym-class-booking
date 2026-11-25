'use strict';
// Attendance & Reliability service — owner: Youssef Khaled Mokhtar (245609)
//
// Functions
//  F1 Attendance sheet + trainer marking           GET /api/attendance/:classId, PUT /api/attendance/:classId
//  F2 One-time self check-in code                  POST /api/attendance/:classId/code, POST /api/attendance/:classId/check-in
//  F3 Close session -> no-shows -> strikes         POST /api/attendance/:classId/close  (+ scheduled auto-close)
//     Admin correction after close                 PATCH /api/attendance/:classId/:memberId
//  F4 Reliability & suspension policy              GET /api/reliability/me, GET /api/reliability/:memberId,
//                                                  POST /api/reliability/:memberId/lift
//  F5 Reports + encrypted CSV export               GET /api/reports/classes, POST /api/reports/export
//  +  Audit log viewer (admin, shared audit table) GET /api/audit
// Internal (x-internal-key): GET /internal/members/:memberId/eligibility
//
// Routes: match an HTTP method and path, check who may call it (auth middleware),
// then hand the request to a controller function. No business logic here.

const { auth, internal } = require('gym-shared');
const controller = require('../controllers/attendance');

function mount(app) {
  // ---------- F1 ----------
  app.get('/api/attendance/:classId', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.getSheet);
  app.put('/api/attendance/:classId', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.markAttendance);
  // ---------- F2 ----------
  app.post('/api/attendance/:classId/code', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.createCheckInCode);
  app.post('/api/attendance/:classId/check-in', auth.authenticate, auth.requireRole('member'), controller.checkIn);
  // ---------- F3 ----------
  app.post('/api/attendance/:classId/close', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.closeSession);
  app.patch('/api/attendance/:classId/:memberId', auth.authenticate, auth.requireRole('admin'), controller.correctRecord);
  // ---------- F4 ----------
  app.get('/api/reliability/me', auth.authenticate, auth.requireRole('member'), controller.myReliability);
  app.get('/api/reliability/:memberId', auth.authenticate, auth.requireRole('admin'), controller.memberReliability);
  app.post('/api/reliability/:memberId/lift', auth.authenticate, auth.requireRole('admin'), controller.liftSuspension);
  // ---------- F5 ----------
  app.get('/api/reports/classes', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.classReport);
  app.post('/api/reports/export', auth.authenticate, auth.requireRole('trainer', 'admin'), controller.exportReport);
  // ---------- Audit viewer ----------
  app.get('/api/audit', auth.authenticate, auth.requireRole('admin'), controller.listAudit);
  // ---------- Internal ----------
  app.get('/internal/members/:memberId/eligibility', internal.requireInternalKey, controller.internalEligibility);
}

module.exports = { mount };

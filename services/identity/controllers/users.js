'use strict';
// Controller: reads the request, validates it, calls the services and chooses the HTTP response.
// Identity service (shared team component, lead: Youssef Khaled, supported by all).

const {
  AdminCreateUserCommand, AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand, InitiateAuthCommand,
  AdminUserGlobalSignOutCommand, GlobalSignOutCommand, AdminDisableUserCommand, AdminEnableUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const {
  config, log, errors, auth, audit, validate, clock, sdk,
} = require('gym-shared');

const { z } = sdk.zod;
const { GetCommand, PutCommand, UpdateCommand, ScanCommand } = sdk.ddb;
const ddb = require('gym-shared').aws.ddbDoc;

const cognito = require('../services/cognito');
const throttle = require('../services/loginThrottle');

const POOL = cognito.poolId;
const CLIENT = cognito.clientId;
const USERS = config.tables.users;

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10).max(128)
  .regex(/[a-z]/, 'must contain a lowercase letter')
  .regex(/[A-Z]/, 'must contain an uppercase letter')
  .regex(/[0-9]/, 'must contain a digit');
const registerSchema = z.object({ name: z.string().trim().min(2).max(80).regex(/^[\p{L} .'-]+$/u, 'letters only'), email, password }).strict();
const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
const roleSchema = z.object({ role: z.enum(['member', 'trainer', 'admin']) }).strict();
const statusSchema = z.object({ status: z.enum(['active', 'disabled']) }).strict();
const idParam = z.object({ id: z.string().uuid() });

// POST /api/auth/register
const register = [validate.validate(registerSchema), async (req, res) => {
  const { name, email: mail, password: pw } = req.body;
  let sub;
  try {
    const created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: POOL(), Username: mail, MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'email', Value: mail }, { Name: 'name', Value: name }, { Name: 'email_verified', Value: 'true' }],
    }));
    sub = (created.User.Attributes || []).find((a) => a.Name === 'sub')?.Value;
    await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: POOL(), Username: mail, Password: pw, Permanent: true }));
    // Self-registration ALWAYS creates a member. Only an admin can grant trainer/admin.
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: POOL(), Username: mail, GroupName: 'member' }));
  } catch (err) {
    if (err.name === 'UsernameExistsException' || err.name === 'AliasExistsException') throw errors.conflict('EMAIL_IN_USE', 'An account with this email already exists');
    if (err.name === 'InvalidPasswordException') throw errors.badRequest('WEAK_PASSWORD', 'Password does not meet the policy');
    throw err;
  }
  const user = { userId: sub, email: mail, name, role: 'member', status: 'active', createdAt: clock.now().toISOString() };
  await ddb().send(new PutCommand({ TableName: USERS, Item: user }));
  await audit.audit({ id: req.id, user: { id: sub, role: 'member' } }, 'USER_REGISTERED', { targetType: 'user', targetId: sub });
  res.status(201).json({ user: { id: sub, name, email: mail, role: 'member' } });
}];

// POST /api/auth/login
const login = [validate.validate(loginSchema), async (req, res) => {
  const { email: mail, password: pw } = req.body;
  const state = await throttle.state(mail);
  if (state.failures >= throttle.MAX_FAILURES) {
    // Temporary cool-down (not a permanent lockout) so an attacker cannot
    // permanently lock a victim out just by knowing their email.
    log.security('LOGIN_THROTTLED', { requestId: req.id, emailHash: throttle.emailKey(mail).slice(0, 12) });
    res.setHeader('Retry-After', String(throttle.WINDOW_SEC));
    throw new errors.HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Try again later.');
  }
  let result;
  try {
    result = await cognito.send(new InitiateAuthCommand({
      ClientId: CLIENT(), AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: mail, PASSWORD: pw },
    }));
  } catch (err) {
    if (['NotAuthorizedException', 'UserNotFoundException', 'UserNotConfirmedException'].includes(err.name)) {
      const failures = await throttle.recordFailure(mail);
      log.security('LOGIN_FAILED', { requestId: req.id, emailHash: throttle.emailKey(mail).slice(0, 12), failures });
      // Generic message: does not reveal whether the email exists.
      throw errors.unauthorized('Invalid email or password');
    }
    throw err;
  }
  await throttle.reset(mail);
  const tokens = result.AuthenticationResult;
  const identity = await auth.verifyAccessToken(tokens.AccessToken);
  const profile = (await ddb().send(new GetCommand({ TableName: USERS, Key: { userId: identity.id } }))).Item;
  if (profile && profile.status === 'disabled') throw errors.forbidden('ACCOUNT_DISABLED', 'This account is disabled');
  log.info('LOGIN_SUCCEEDED', { requestId: req.id, userId: identity.id, role: identity.role });
  res.json({
    accessToken: tokens.AccessToken,
    expiresIn: tokens.ExpiresIn,
    user: { id: identity.id, name: profile ? profile.name : mail, email: mail, role: identity.role },
  });
}];

// POST /api/auth/logout
const logout = async (req, res) => {
  const token = req.headers.authorization.slice(7);
  try {
    await cognito.send(new GlobalSignOutCommand({ AccessToken: token }));
  } catch (err) {
    log.warn('LOGOUT_PROVIDER_ERROR', { requestId: req.id, reason: err.name });
  }
  res.status(204).end();
};

// GET /api/users/me
const getMe = async (req, res) => {
  const item = (await ddb().send(new GetCommand({ TableName: USERS, Key: { userId: req.user.id } }))).Item;
  if (!item) throw errors.notFound('User');
  res.json({ user: { id: item.userId, name: item.name, email: item.email, role: req.user.role, status: item.status } });
};

// GET /api/trainers
const listTrainers = async (_req, res) => {
  const out = await ddb().send(new ScanCommand({
    TableName: USERS, FilterExpression: '#r = :t AND #s = :a',
    ExpressionAttributeNames: { '#r': 'role', '#s': 'status', '#n': 'name' },
    ExpressionAttributeValues: { ':t': 'trainer', ':a': 'active' },
    ProjectionExpression: 'userId, #n',
  }));
  res.json({ trainers: (out.Items || []).map((u) => ({ id: u.userId, name: u.name })).sort((a, b) => a.name.localeCompare(b.name)) });
};

const searchSchema = z.object({ role: z.enum(['member', 'trainer', 'admin']).optional(), q: z.string().trim().max(60).optional() }).strict();

// GET /api/users
const searchUsers = [validate.validate(searchSchema, 'query'), async (req, res) => {
  const { role, q } = req.validQuery;
  const out = await ddb().send(new ScanCommand({ TableName: USERS }));
  let users = (out.Items || []).map((u) => ({ id: u.userId, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt }));
  if (role) users = users.filter((u) => u.role === role);
  if (q) users = users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  res.json({ users: users.sort((a, b) => a.name.localeCompare(b.name)) });
}];

async function loadTarget(req) {
    const item = (await ddb().send(new GetCommand({ TableName: USERS, Key: { userId: req.params.id } }))).Item;
    if (!item) throw errors.notFound('User');
    return item;
  }

// PATCH /api/users/:id/role
const changeRole = [validate.validate(idParam, 'params'), validate.validate(roleSchema), async (req, res) => {
  if (req.params.id === req.user.id) throw errors.conflict('CANNOT_CHANGE_OWN_ROLE', 'Administrators cannot change their own role');
  const target = await loadTarget(req);
  const { role } = req.body;
  for (const g of ['member', 'trainer', 'admin']) {
    if (g !== role) {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: POOL(), Username: target.email, GroupName: g })).catch(() => {});
    }
  }
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: POOL(), Username: target.email, GroupName: role }));
  // Old tokens still carry the old group; force re-authentication.
  await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: POOL(), Username: target.email })).catch(() => {});
  await ddb().send(new UpdateCommand({
    TableName: USERS, Key: { userId: target.userId }, UpdateExpression: 'SET #r = :r, updatedAt = :u',
    ExpressionAttributeNames: { '#r': 'role' }, ExpressionAttributeValues: { ':r': role, ':u': clock.now().toISOString() },
  }));
  await audit.audit(req, 'ROLE_CHANGED', { targetType: 'user', targetId: target.userId, details: { from: target.role, to: role } });
  res.json({ user: { id: target.userId, name: target.name, email: target.email, role } });
}];

// PATCH /api/users/:id/status
const changeStatus = [validate.validate(idParam, 'params'), validate.validate(statusSchema), async (req, res) => {
  if (req.params.id === req.user.id) throw errors.conflict('CANNOT_DISABLE_SELF', 'Administrators cannot disable themselves');
  const target = await loadTarget(req);
  const { status } = req.body;
  if (status === 'disabled') {
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: POOL(), Username: target.email }));
    await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: POOL(), Username: target.email })).catch(() => {});
  } else {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: POOL(), Username: target.email }));
  }
  await ddb().send(new UpdateCommand({
    TableName: USERS, Key: { userId: target.userId }, UpdateExpression: 'SET #s = :s, updatedAt = :u',
    ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':s': status, ':u': clock.now().toISOString() },
  }));
  await audit.audit(req, status === 'disabled' ? 'USER_DISABLED' : 'USER_ENABLED', { targetType: 'user', targetId: target.userId });
  res.json({ user: { id: target.userId, status } });
}];

module.exports = {
  register,
  login,
  logout,
  getMe,
  listTrainers,
  searchUsers,
  changeRole,
  changeStatus,
};

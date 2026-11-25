'use strict';
// API client shared by every view. All data comes from the real backends.
// The Cognito access token is kept in sessionStorage (cleared when the tab
// closes) and sent as "Authorization: Bearer <token>". The browser never
// decides permissions: the backend re-checks every request.

(function () {
  const cfg = (window.GYM_CONFIG && window.GYM_CONFIG.api) || {};
  const KEY = 'gym.session';

  function session() {
    try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
  }
  function setSession(s) {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY);
  }

  class ApiError extends Error {
    constructor(status, body) {
      const err = (body && body.error) || {};
      super(err.message || `Request failed (${status})`);
      this.status = status;
      this.code = err.code;
      this.details = err.details;
    }
  }

  async function request(service, method, path, body) {
    const base = cfg[service];
    if (!base) throw new ApiError(0, { error: { message: `API URL for "${service}" is not configured (config.js)` } });
    const s = session();
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (s && s.token) headers.authorization = `Bearer ${s.token}`;
    let res;
    try {
      res = await fetch(base.replace(/\/$/, '') + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new ApiError(0, { error: { message: 'Cannot reach the server. Check that the services are running.' } });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (res.status === 401 && s) {
      setSession(null);
      window.dispatchEvent(new Event('gym:signed-out'));
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  window.Api = {
    session,
    setSession,
    ApiError,
    get: (svc, path) => request(svc, 'GET', path),
    post: (svc, path, body) => request(svc, 'POST', path, body === undefined ? {} : body),
    put: (svc, path, body) => request(svc, 'PUT', path, body),
    patch: (svc, path, body) => request(svc, 'PATCH', path, body),
    del: (svc, path) => request(svc, 'DELETE', path),
    qs: (obj) => {
      const p = new URLSearchParams();
      Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
      const s = p.toString();
      return s ? `?${s}` : '';
    },
  };
}());

// The names of audit events. They are stored in the audit log and shown on the console's activity page, so the VALUES must never
// change; the object only keeps a typo from silently writing (or filtering for) an event that does not exist.
export const EVENTS = Object.freeze({
  // the owner, in the console or its command line
  adminLogin: 'admin-login',
  adminLoginFailed: 'admin-login-failed',
  adminLogout: 'admin-logout',
  adminActionRefused: 'admin-action-refused',
  adminPasswordSet: 'admin-password-set',
  adminPasswordRemoved: 'admin-password-removed',
  adminTotpEnabled: 'admin-totp-enabled',
  adminTotpDisabled: 'admin-totp-disabled',
  adminSessionsCleared: 'admin-sessions-cleared',
  adminApp: (action) => 'admin-app-' + action, // start / stop / restart of an app from the console
  // customer links
  grantCreated: 'grant-created',
  grantRevoked: 'grant-revoked',
  grantForgotten: 'grant-forgotten',
  // demos
  demoResetRequested: 'demo-reset-requested',
  demoReset: 'demo-reset',
  instanceStart: 'instance-start',
  instanceStop: 'instance-stop',
  instanceReady: 'instance-ready',
  instanceFailed: 'instance-failed',
  // what customers did
  enter: 'enter',
  denied: 'denied',
  wsOpen: 'ws-open',
  wsClosed: 'ws-closed',
});

// Which events are the owner's own doing (sign-ins, start/stop, creating and revoking links), as opposed to what customers did.
export const isAdminEvent = (ev) => ev.startsWith('admin-') || ev === EVENTS.grantCreated || ev === EVENTS.grantRevoked;
// The filters offered on the console's activity page and by the MCP server's recent_events tool.
export const EVENT_FILTERS = Object.freeze({
  all: () => true,
  admin: (e) => isAdminEvent(e.ev),
  demos: (e) => !isAdminEvent(e.ev),
  problems: (e) => e.ev === EVENTS.adminLoginFailed || e.ev === EVENTS.denied || e.ev === EVENTS.adminActionRefused,
});

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
  // customer links
  grantCreated: 'grant-created',
  grantRevoked: 'grant-revoked',
  grantForgotten: 'grant-forgotten',
  // demos
  demoResetRequested: 'demo-reset-requested',
  demoReset: 'demo-reset',
  instanceStart: 'instance-start',
  instanceStop: 'instance-stop',
  // what customers did
  enter: 'enter',
  denied: 'denied',
  wsOpen: 'ws-open',
  wsClosed: 'ws-closed',
});

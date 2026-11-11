import test from 'node:test';
import assert from 'node:assert/strict';
import { GRANT_EXTRA_COLUMNS, toGrant, auditValues, auditFromRow, liveUntil } from '../../lib/store/shared.mjs';

test('toGrant maps a row, coerces driver strings, and passes null through', () => {
  assert.equal(toGrant(undefined), undefined);
  const g = toGrant({ id: 'a', token_hash: 'h', customer: 'C', app: 'x', created_at: 't1', expires_at: 't2', revoked: 1, uses: '3', max_uses: '5', device_lock: 0, last_used_at: null });
  assert.deepEqual(g, { id: 'a', tokenHash: 'h', customer: 'C', app: 'x', createdAt: 't1', expiresAt: 't2', revoked: true, uses: 3, maxUses: 5, deviceLock: false, lastUsedAt: null, displayName: null, welcome: null, guideMessages: 0 });
  const bare = toGrant({ id: 'a', token_hash: 'h', customer: 'C', app: 'x', created_at: 't1', expires_at: 't2', revoked: 0 });
  assert.equal(bare.uses, 0); assert.equal(bare.maxUses, null);
  const branded = toGrant({ id: 'a', token_hash: 'h', customer: 'C', app: 'x', created_at: 't1', expires_at: 't2', revoked: 0, display_name: 'Dana', welcome: 'Hi' });
  assert.deepEqual([branded.displayName, branded.welcome], ['Dana', 'Hi']);
});

test('auditValues and auditFromRow round-trip, extra fields go into data', () => {
  const v = auditValues({ t: 'T', ev: 'enter', grant: 'g1', app: 'crm', ip: '1.2.3.4', ua: 'UA', why: 'x' });
  assert.deepEqual(v, ['T', 'enter', 'g1', 'crm', '1.2.3.4', JSON.stringify({ ua: 'UA', why: 'x' })]);
  assert.deepEqual(auditFromRow({ t: v[0], ev: v[1], grant_id: v[2], app: v[3], ip: v[4], data: v[5] }), { t: 'T', ev: 'enter', grant: 'g1', app: 'crm', ip: '1.2.3.4', ua: 'UA', why: 'x' });
  const plain = auditValues({ ev: 'e' });
  assert.deepEqual(plain.slice(2), [null, null, null, null]);
  assert.match(plain[0], /^\d{4}-\d\d-\d\dT/);
});

test('liveUntil returns the picked value only before expiry', () => {
  const future = new Date(Date.now() + 60000).toISOString(), past = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual(liveUntil({ expires_at: future }, (r) => ({ e: r.expires_at })), { e: future });
  assert.equal(liveUntil({ expires_at: past }, () => 1), null);
  assert.equal(liveUntil(undefined, () => 1), null);
});

test('GRANT_EXTRA_COLUMNS names the eight upgrade columns', () => {
  assert.deepEqual(GRANT_EXTRA_COLUMNS.map(([n]) => n), ['uses', 'max_uses', 'device_lock', 'device_hash', 'last_used_at', 'guide_messages', 'display_name', 'welcome']);
});

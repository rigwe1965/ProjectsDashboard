// The four engagement words for a demo link, and the merged page list (analytics plan step 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityView, mergeTopPages } from '../../lib/engagement.mjs';

const sum = (o) => ({ grantId: 'g', days: 1, requests: 5, activeSeconds: 0, wsSeconds: 0, firstAt: '2026-03-05T10:00:00.000Z', lastAt: '2026-03-05T10:03:00.000Z', ...o });

test('engagement: none, opened, engaged, returned', () => {
  assert.equal(activityView({ uses: 0 }, undefined).engagement, 'none');
  assert.equal(activityView({ uses: 1 }, undefined).engagement, 'opened', 'opened before activity was counted');
  assert.equal(activityView({ uses: 1 }, sum({ activeSeconds: 59 })).engagement, 'opened');
  assert.equal(activityView({ uses: 1 }, sum({ activeSeconds: 60 })).engagement, 'engaged');
  assert.equal(activityView({ uses: 1 }, sum({ days: 2, activeSeconds: 5 })).engagement, 'returned');
});

test('engagement: a WebSocket-only app counts by its open time; the figures are plain numbers for the console', () => {
  const v = activityView({ uses: 1 }, sum({ activeSeconds: 10, wsSeconds: 600, requests: 2 }));
  assert.deepEqual(v, { engagement: 'engaged', requests: 2, activeMinutes: 10, activeDays: 1, lastActiveAt: '2026-03-05T10:03:00.000Z' });
  assert.deepEqual(activityView({ uses: 0 }, undefined), { engagement: 'none', requests: 0, activeMinutes: 0, activeDays: 0, lastActiveAt: null });
});

test('mergeTopPages adds the same page across days, busiest first, at most the limit', () => {
  const rows = [{ topPaths: [{ path: '/a', count: 2 }, { path: '/b', count: 1 }] }, { topPaths: [{ path: '/b', count: 4 }, { path: '/c', count: 1 }] }];
  assert.deepEqual(mergeTopPages(rows), [{ path: '/b', count: 5 }, { path: '/a', count: 2 }, { path: '/c', count: 1 }]);
  assert.equal(mergeTopPages(rows, 2).length, 2);
  assert.deepEqual(mergeTopPages([]), []);
});

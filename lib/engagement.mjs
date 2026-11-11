// How much a customer used a demo link, in four words the owner can act on (analytics plan step 3).
//   none      the link was never opened
//   opened    opened, but under a minute of activity (or activity from before it was counted)
//   engaged   a minute or more of activity
//   returned  active on two or more different days
// `sum` is store.activity.summary()'s row for the link (or undefined when nothing was counted).
export const ENGAGED_SECONDS = 60;

export function activityView(grant, sum) {
  // A WebSocket's open time is the better figure for apps that make few HTTP requests, so the larger of the two is used.
  const seconds = Math.max(sum?.activeSeconds ?? 0, sum?.wsSeconds ?? 0);
  const days = sum?.days ?? 0;
  const engagement = !(grant.uses > 0) && !sum ? 'none' : days >= 2 ? 'returned' : seconds >= ENGAGED_SECONDS ? 'engaged' : 'opened';
  return { engagement, requests: sum?.requests ?? 0, activeMinutes: Math.round(seconds / 60), activeDays: days, lastActiveAt: sum?.lastAt ?? null };
}

// A link's AI guide use, for the owner: the allowance, what was used, and the estimated cost in dollars. `totals` is store.guideUsage's row (or undefined).
export const guideView = (grant, totals) => ({ allowed: grant.guideMessages ?? 0, used: totals?.messages ?? 0, left: Math.max(0, (grant.guideMessages ?? 0) - (totals?.messages ?? 0)),
  estimatedCostUsd: Math.round((totals?.costMicro ?? 0) / 100) / 10000 });

// The days of one link merged into a single list of its busiest pages.
export function mergeTopPages(rows, limit = 10) {
  const counts = new Map();
  for (const r of rows) for (const { path, count } of r.topPaths) counts.set(path, (counts.get(path) ?? 0) + count);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([path, count]) => ({ path, count }));
}

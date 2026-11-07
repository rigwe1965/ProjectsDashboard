// Postgres store: placeholder for Stage 4 (hosting). It must implement exactly the interface documented in
// lib/store/sqlite.mjs, with every method returning a Promise. Selected with DASHBOARD_DB=postgres.
export function openPostgres() {
  throw new Error('The Postgres store is not implemented yet (planned for Stage 4). Use DASHBOARD_DB=sqlite.');
}

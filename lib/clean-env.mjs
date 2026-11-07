// Isolation: an app must never inherit ANOTHER project's virtual environment from whatever shell started the
// dashboard. Strip VIRTUAL_ENV and venv "Scripts" folders from PATH, so a bare `python` means the machine's own
// Python. Apps that need their own venv call it by explicit path in the registry, which is unaffected.
export function cleanEnv(env) {
  for (const k of Object.keys(env)) {
    if (/^(VIRTUAL_ENV|VIRTUAL_ENV_PROMPT|PYTHONHOME|PYTHONPATH|CONDA_PREFIX)$/i.test(k)) delete env[k];
    if (/^path$/i.test(k)) env[k] = String(env[k]).split(';').filter((p) => !/[\\/]\.?venv[\\/]Scripts[\\/]?$/i.test(p.trim())).join(';');
  }
  return env;
}

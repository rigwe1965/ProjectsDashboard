// Isolation: an app must never inherit ANOTHER project's virtual environment from whatever shell started the
// dashboard. Strip VIRTUAL_ENV and venv "Scripts" folders from PATH, so a bare `python` means the machine's own
// Python. Apps that need their own venv call it by explicit path in the registry, which is unaffected.
// `delimiter` is the PATH separator of the OS the env belongs to (';' on Windows, ':' elsewhere).
import path from 'node:path';

// Least privilege: a managed app gets the variables an OS toolchain needs (PATH, temp and profile folders, locale, ...),
// NOT the supervisor's whole environment. The console's database URL, tokens, and whatever API keys the owner's shell
// holds stay out of customer-facing demo processes. App-specific values come from the registry (env / envFile).
const KEEP = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|HOMEDRIVE|HOMEPATH|USERPROFILE|USERNAME|USER|LOGNAME|USERDOMAIN|COMPUTERNAME|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES|COMMONPROGRAMFILES\(X86\)|COMMONPROGRAMW6432|ALLUSERSPROFILE|PUBLIC|DRIVERDATA|OS|NUMBER_OF_PROCESSORS|PROCESSOR_.*|LANG|LANGUAGE|LC_.*|TZ|SHELL|TERM|PNPM_HOME|NVM_.*|FNM_.*|VOLTA_HOME|CONDA_EXE)$/i;
export function minimalEnv(env, extra = process.env.PD_APP_ENV_PASSTHROUGH) {
  const more = new Set(String(extra || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)); // escape hatch: names an app really needs
  return Object.fromEntries(Object.entries(env).filter(([k]) => KEEP.test(k) || more.has(k.toUpperCase())));
}

export function cleanEnv(env, delimiter = path.delimiter) {
  for (const k of Object.keys(env)) {
    if (/^(VIRTUAL_ENV|VIRTUAL_ENV_PROMPT|PYTHONHOME|PYTHONPATH|CONDA_PREFIX)$/i.test(k)) delete env[k];
    if (/^path$/i.test(k)) env[k] = String(env[k]).split(delimiter).filter((p) => !/[\\/]\.?venv[\\/](Scripts|bin)[\\/]?$/i.test(p.trim())).join(delimiter);
  }
  return env;
}

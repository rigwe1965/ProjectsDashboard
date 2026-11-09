// Single place for paths and ports. Everything can be overridden with an environment variable.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { num } from './util.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = process.env.DASHBOARD_DATA || join(root, 'data');
export const registryPath = process.env.DASHBOARD_REGISTRY || join(root, 'registry', 'apps.json');
// Where the apps live. Default: the folder that holds this dashboard (the Desktop on the owner's PC).
export const appsRoot = process.env.APPS_ROOT || join(root, '..');
export const ports = {
  console: num(process.env.CONSOLE_PORT, 4100),
  showcase: num(process.env.SHOWCASE_PORT, 4200),
  gateway: num(process.env.GATEWAY_PORT, 4300),
};

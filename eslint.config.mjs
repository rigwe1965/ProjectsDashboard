import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'data/**', 'showcase/dist/**', 'Airfinder/**', 'ClaudeOS/**', 'ClaudeWorkspace/**', 'CRM/**', 'ImageApp/**', 'RemoteManagementSystem/**'] },
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } } },
  { rules: { 'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }] } },
  // ui-check runs callbacks inside the browser page (page.evaluate), so browser globals are valid there
  { files: ['tests/ui-check.mjs', 'tests/journeys.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];

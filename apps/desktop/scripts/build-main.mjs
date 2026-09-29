import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
await mkdir(resolve(workspace, 'dist-electron'), { recursive: true });
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'better-sqlite3-multiple-ciphers', '@azure/msal-node', 'playwright', 'playwright-core', 'chromium-bidi'],
};

await build({
  ...shared,
  entryPoints: [resolve(workspace, 'src/main/index.ts')],
  outfile: resolve(workspace, 'dist-electron/main.cjs'),
});

await build({
  ...shared,
  entryPoints: [resolve(workspace, 'src/preload/index.ts')],
  outfile: resolve(workspace, 'dist-electron/preload.cjs'),
});

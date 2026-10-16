/** Isolated bundle/child process: never import a verification CLI into another test. */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../build.mjs', import.meta.url));
globalThis.require = require;
const { build } = require('esbuild');
const { default: pinoPlugin } = await import(
  pathToFileURL(require.resolve('esbuild-plugin-pino')).href
);
const outdir = path.join(root, 'artifacts/api-server/node_modules/.cache/phase7c');
await build({
  entryPoints: [path.join(root, 'artifacts/api-server/scripts/verify-phase7c.js')],
  platform: 'node',
  bundle: true,
  format: 'esm',
  outdir,
  outExtension: { '.js': '.mjs' },
  loader: { '.md': 'text' },
  external: ['argon2', 'pg-native'],
  plugins: [pinoPlugin({ transports: ['pino-pretty'] })],
  banner: {
    js: "import {createRequire as __testRequire} from 'node:module';globalThis.require=__testRequire(import.meta.url);",
  },
});
const run = spawnSync(
  process.execPath,
  ['--enable-source-maps', path.join(outdir, 'verify-phase7c.mjs'), ...process.argv.slice(2)],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
  },
);
process.exitCode = run.status ?? 1;

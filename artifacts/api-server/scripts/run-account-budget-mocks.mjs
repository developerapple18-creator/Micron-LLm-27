import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../build.mjs', import.meta.url));
globalThis.require = require;
const { build } = require('esbuild');
const { default: pinoPlugin } = await import(
  pathToFileURL(require.resolve('esbuild-plugin-pino')).href
);
const outdir = path.join(root, 'artifacts/api-server/node_modules/.cache/account-budget');
await build({
  entryPoints: [path.join(root, 'artifacts/api-server/scripts/verify-account-budget.js')],
  platform: 'node',
  bundle: true,
  format: 'esm',
  outdir,
  outExtension: { '.js': '.mjs' },
  loader: { '.md': 'text' },
  external: ['argon2', 'pg-native', '@google-cloud/storage'],
  plugins: [pinoPlugin({ transports: ['pino-pretty'] })],
  banner: {
    js: "import {createRequire as __r} from 'node:module';globalThis.require=__r(import.meta.url);",
  },
});
const result = spawnSync(process.execPath, [path.join(outdir, 'verify-account-budget.mjs')], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'development', NODE_OPTIONS: '', LOG_LEVEL: 'silent' },
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;

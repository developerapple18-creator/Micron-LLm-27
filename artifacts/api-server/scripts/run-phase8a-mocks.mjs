/** Isolated, unpaid verification entrypoint. No inherited test CLI imports. */
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
const outdir = path.join(root, 'artifacts/api-server/node_modules/.cache/phase8a');
await build({
  entryPoints: [path.join(root, 'artifacts/api-server/scripts/verify-phase8a.js')],
  platform: 'node',
  bundle: true,
  format: 'esm',
  outdir,
  outExtension: { '.js': '.mjs' },
  loader: { '.md': 'text' },
  external: ['argon2', 'pg-native', '@google-cloud/storage'],
  plugins: [pinoPlugin({ transports: ['pino-pretty'] })],
  banner: {
    js: "import {createRequire as __testRequire} from 'node:module';globalThis.require=__testRequire(import.meta.url);",
  },
});
const result = spawnSync(
  process.execPath,
  [path.join(outdir, 'verify-phase8a.mjs'), ...process.argv.slice(2)],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', NODE_OPTIONS: '' },
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;

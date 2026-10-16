/** Independent entrypoint; never imports another executable verification script. */
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
const outdir = path.join(root, 'artifacts/api-server/node_modules/.cache/phase7d');
const entry = process.argv.includes('--safeguards-only')
  ? 'verify-phase7d-safeguards'
  : 'verify-phase7d';
await build({
  entryPoints: [path.join(root, `artifacts/api-server/scripts/${entry}.js`)],
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
  [
    path.join(outdir, `${entry}.mjs`),
    ...process.argv.slice(2).filter((a) => a !== '--safeguards-only'),
  ],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
  },
);
process.exitCode = run.status ?? 1;

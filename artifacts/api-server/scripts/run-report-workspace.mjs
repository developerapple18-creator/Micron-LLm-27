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
const entry =
  process.argv[2] === 'lawyer-runtime'
    ? 'verify-lawyer-runtime'
    : process.argv[2] === 'multi-pdf'
      ? 'verify-multi-pdf'
      : process.argv[2] === 'migrate'
        ? 'apply-report-workspace'
        : process.argv[2] === 'fixture'
          ? 'report-polish-fixture'
          : process.argv[2] === 'status'
            ? 'verify-report-status'
            : 'verify-report-workspace';
const outdir = path.join(root, 'artifacts/api-server/node_modules/.cache/report-workspace');
await build({
  entryPoints: [path.join(root, `artifacts/api-server/scripts/${entry}.js`)],
  platform: 'node',
  bundle: true,
  format: 'esm',
  outdir,
  outExtension: { '.js': '.mjs' },
  loader: { '.md': 'text' },
  external: ['argon2', 'pg-native', '@google-cloud/storage', 'puppeteer-core', 'docx'],
  plugins: [pinoPlugin({ transports: ['pino-pretty'] })],
  banner: {
    js: "import {createRequire as __r} from 'node:module';globalThis.require=__r(import.meta.url);",
  },
});
const r = spawnSync(
  process.execPath,
  [path.join(outdir, `${entry}.mjs`), ...process.argv.slice(3)],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', NODE_OPTIONS: '', LOG_LEVEL: 'silent' },
    stdio: 'inherit',
  },
);
process.exitCode = r.status ?? 1;

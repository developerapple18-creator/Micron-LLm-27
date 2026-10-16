import path from 'node:path';
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

const root = import.meta.dirname;
const outdir = path.join(root, 'dist');

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: [path.join(root, 'src/index.js')],
  outdir,
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  packages: 'external',
  loader: { '.md': 'text' },
  sourcemap: 'linked',
  logLevel: 'info',
});

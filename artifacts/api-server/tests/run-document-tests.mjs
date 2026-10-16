import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { isolatedDependencies } from './test-isolation.mjs';
const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'node_modules/.cache/document-tests.mjs');
await build({
  entryPoints: [path.join(root, 'tests/document-processing.test.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  loader: { '.md': 'text' },
  alias: { '@workspace/db': path.join(root, 'tests/document-test-db.js') },
  plugins: [isolatedDependencies(root)],
});
await (await import(pathToFileURL(outfile).href)).run();

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { isolatedDependencies } from './test-isolation.mjs';
const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'node_modules/.cache/document-resource-tests.mjs');
await build({
  entryPoints: [path.join(root, 'tests/document-resources.test.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  loader: { '.md': 'text' },
  alias: { '@workspace/db': path.join(root, 'tests/document-resource-db.js') },
  plugins: [isolatedDependencies(root)],
});
const deadline = setTimeout(() => {
  throw new Error('Resource tests exceeded 60 seconds');
}, 60_000);
try {
  await (await import(pathToFileURL(outfile).href)).run();
} finally {
  clearTimeout(deadline);
}

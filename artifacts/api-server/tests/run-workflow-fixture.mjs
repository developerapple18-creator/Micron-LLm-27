import { build } from 'esbuild';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const auth = process.argv.includes('--auth');
const out = path.join(root, `node_modules/.cache/${auth ? 'auth' : 'workflow'}-fixture.mjs`);
await build({
  entryPoints: [path.join(root, `tests/${auth ? 'auth' : 'workflow'}-fixture.js`)],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  loader: { '.md': 'text' },
  alias: {
    '@workspace/db': path.join(root, 'tests/workflow-fixture-db.js'),
    '@workspace/api-zod': path.resolve(root, '../../lib/api-zod/src/index.js'),
  },
  plugins: [
    {
      name: 'synthetic-transports',
      setup(b) {
        // Bundling across pnpm workspaces must preserve each package's own module
        // resolution; never install DB-only packages into the API to run tests.
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@workspace/') || args.path.startsWith('node:')
            ? null
            : {
                path: createRequire(path.join(args.resolveDir || root, 'package.json')).resolve(
                  args.path,
                ),
                external: true,
              },
        );
        b.onResolve({ filter: /\/private-files\.js$/ }, () => ({
          path: path.join(root, 'tests/workflow-fixture-storage.js'),
        }));
        b.onResolve({ filter: /\/security\.js$/ }, (args) =>
          auth || args.importer.includes('/lib/db/')
            ? null
            : { path: path.join(root, 'tests/workflow-fixture-security.js') },
        );
      },
    },
  ],
});
const child = spawn(process.execPath, [out], {
  stdio: 'inherit',
  env: auth
    ? {
        ...process.env,
        NODE_ENV: 'production',
        SMS_AUTH_ENABLED: 'true',
        ENABLE_DEVELOPMENT_OTP: 'false',
        SESSION_SECRET: 'synthetic-auth-fixture-key-not-a-real-credential',
        TAQNYAT_BEARER_TOKEN: 'synthetic-provider-token',
        TAQNYAT_SENDER: 'SyntheticSender',
      }
    : process.env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));

import path from 'node:path';

// Processor tests do not initialize sessions, database clients or cloud credentials.
export function isolatedDependencies(root) {
  return {
    name: 'isolated-processor-dependencies',
    setup(build) {
      build.onResolve({ filter: /\/security\.js$/ }, () => ({
        path: path.join(root, 'tests/workflow-fixture-security.js'),
      }));
      build.onResolve({ filter: /\/private-files\.js$/ }, () => ({
        path: path.join(root, 'tests/workflow-fixture-storage.js'),
      }));
    },
  };
}

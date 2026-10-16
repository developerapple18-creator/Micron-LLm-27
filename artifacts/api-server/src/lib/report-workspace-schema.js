import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// Compatibility loader for existing development verification scripts.
const require = createRequire(import.meta.url);
export const reportWorkspaceDDL = readFileSync(
  require.resolve('@workspace/db/sql/report-workspace.sql'),
  'utf8',
);

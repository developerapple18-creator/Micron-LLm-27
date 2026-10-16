import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const ignored = new Set([
  'node_modules',
  '.git',
  'tmp',
  '.pnpm-store',
  '.conversation',
  'dist',
  'generated-artifacts',
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((entry) => !ignored.has(entry.name))
        .map((entry) => {
          const file = path.join(directory, entry.name);
          return entry.isDirectory() ? walk(file) : [file];
        }),
    )
  ).flat();
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

const files = await walk(root);
const errors = [];
let checked = 0;
for (const file of files) {
  if (/\.tsx?$/.test(file))
    errors.push(`${path.relative(root, file)}: unexpected TypeScript source`);
  if (!/\.(?:[cm]?js|jsx)$/.test(file)) continue;
  checked++;
  const source = await readFile(file, 'utf8');
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS,
  );
  for (const diagnostic of parsed.parseDiagnostics)
    errors.push(
      `${path.relative(root, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
  const imports = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const specifier of imports.filter((name) => name.startsWith('.'))) {
    const target = path.resolve(path.dirname(file), specifier);
    const candidates = [target, `${target}.js`, `${target}.jsx`, path.join(target, 'index.js')];
    if (!(await Promise.all(candidates.map(exists))).some(Boolean))
      errors.push(`${path.relative(root, file)}: missing import ${specifier}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Checked syntax and local module references in ${checked} JavaScript files.`);

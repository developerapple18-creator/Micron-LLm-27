import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { format, resolveConfig } from 'prettier';

const root = path.resolve(import.meta.dirname, '..');
const formatOptions = (await resolveConfig(path.join(root, 'package.json'))) ?? {};
async function collect(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? collect(file) : [file];
      }),
    )
  ).flat();
}
let converted = 0;
let removed = 0;
for (const name of ['api-client-react', 'api-zod']) {
  const directory = path.join(root, 'lib', name, 'src/generated');
  const files = (await collect(directory)).filter((file) => file.endsWith('.ts'));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const result = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        removeComments: false,
      },
    });
    const parsed = ts.createSourceFile(file, result.outputText, ts.ScriptTarget.Latest, true);
    const edits = [];
    for (const statement of parsed.statements) {
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
      let value = specifier.text.replace(/\.ts$/, '.js');
      if (!path.extname(value)) value += '.js';
      edits.push({
        start: specifier.getStart(parsed),
        end: specifier.end,
        value: JSON.stringify(value),
      });
    }
    let output = result.outputText;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
    await writeFile(file.replace(/\.ts$/, '.js'), output);
    await unlink(file);
    converted++;
  }
  // Interface-only modules have no runtime exports after conversion.
  const javascript = (await collect(directory)).filter((file) => file.endsWith('.js'));
  const empty = new Set();
  for (const file of javascript) {
    const source = await readFile(file, 'utf8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    if (
      parsed.statements.every(
        (statement) =>
          ts.isExportDeclaration(statement) &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length === 0,
      )
    )
      empty.add(file);
  }
  for (const file of javascript.filter((file) => !empty.has(file))) {
    let source = await readFile(file, 'utf8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of [...parsed.statements].reverse()) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
      const target = path.resolve(path.dirname(file), statement.moduleSpecifier.text);
      if (empty.has(target))
        source = source.slice(0, statement.getFullStart()) + source.slice(statement.end);
    }
    await writeFile(file, await format(source, { ...formatOptions, filepath: file }));
  }
  for (const file of empty) {
    await unlink(file);
    removed++;
  }
  // Orval also writes a root barrel. The public JavaScript barrel is maintained separately.
  await unlink(path.join(root, 'lib', name, 'src/index.ts')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
console.log(
  `Converted ${converted} generated API modules; removed ${removed} modules without runtime exports.`,
);

import assert from 'node:assert/strict';
import test from 'node:test';
import { migrate, readMigrations } from './migrate.mjs';

function fakeClient({ applied = [], existingTables = [], failSQL } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('to_regclass'))
        return { rows: [{ name: applied.length ? 'schema_migrations' : null }] };
      if (sql.startsWith('SELECT name, checksum')) return { rows: applied };
      if (sql.includes('FROM pg_tables'))
        return { rows: existingTables.map((tablename) => ({ tablename })) };
      if (sql === failSQL) throw new Error('Simulated SQL failure');
      return { rows: [] };
    },
  };
}

test('SQL inventory has stable checksums and preserves all tables and composite ownership', async () => {
  const files = await readMigrations();
  assert.equal(files.length, 3);
  assert(files.every((file) => /^[a-f0-9]{64}$/.test(file.checksum)));
  assert.equal((files[0].sql.match(/CREATE TABLE /g) || []).length, 18);
  assert.match(
    files[0].sql,
    /analysis_owned_message FOREIGN KEY \(message_id, case_id, owner_id\)/,
  );
  assert(
    files[0].sql.indexOf('CREATE UNIQUE INDEX message_identity_case_owner') <
      files[0].sql.indexOf('ADD CONSTRAINT analysis_owned_message'),
  );
});

test('records each migration in the same transaction and skips an already applied batch', async () => {
  const files = await readMigrations();
  const client = fakeClient();
  const result = await migrate(client, files);
  assert.equal(result.pending.length, 3);
  assert.equal(
    client.calls.filter((call) => call.sql.startsWith('INSERT INTO public.schema_migrations'))
      .length,
    3,
  );
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
  const repeat = fakeClient({ applied: files });
  assert.deepEqual((await migrate(repeat, files)).pending, []);
  assert(!repeat.calls.some((call) => files.some((file) => file.sql === call.sql)));
});

test('rolls back the entire batch on SQL failure without recording the failed migration', async () => {
  const files = await readMigrations();
  const client = fakeClient({ failSQL: files[1].sql });
  await assert.rejects(migrate(client, files), /Simulated SQL failure/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(
    client.calls.filter((call) => call.sql.startsWith('INSERT INTO public.schema_migrations'))
      .length,
    1,
  );
});

test('rejects modified migration checksums before applying SQL', async () => {
  const files = await readMigrations();
  const client = fakeClient({ applied: [{ name: files[0].name, checksum: 'changed' }] });
  await assert.rejects(migrate(client, files), /Applied migration changed/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('refuses initial schema creation over existing data', async () => {
  const client = fakeClient({ existingTables: ['accounts'] });
  await assert.rejects(migrate(client, await readMigrations()), /Existing database detected/);
  assert(!client.calls.some((call) => call.sql.startsWith('CREATE TABLE')));
});

test('status does not create migration metadata or apply DDL', async () => {
  const client = fakeClient({ existingTables: ['accounts'] });
  const result = await migrate(client, await readMigrations(), { statusOnly: true });
  assert.equal(result.pending.length, 3);
  assert(!client.calls.some((call) => /^(CREATE|ALTER|INSERT|DROP)/.test(call.sql)));
});

test('refuses gaps in migration history', async () => {
  const files = await readMigrations();
  const client = fakeClient({ applied: [files[1]] });
  await assert.rejects(migrate(client, files), /not a prefix/);
});

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function readMigrations(directory = new URL('../migrations/', import.meta.url)) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!names.length) throw new Error('No SQL migrations found');
  if (new Set(names.map((name) => name.slice(0, 4))).size !== names.length)
    throw new Error('Duplicate migration number');
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, directory), 'utf8');
      return {
        name,
        sql,
        checksum: createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex'),
      };
    }),
  );
}

// One explicit transaction for the complete batch. Never called by application startup.
export async function migrate(client, migrations, { statusOnly = false } = {}) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL search_path TO public');
    await client.query('SELECT pg_advisory_xact_lock(740219661)');
    const exists = await client.query("SELECT to_regclass('public.schema_migrations') AS name");
    let applied = [];
    if (exists.rows[0].name)
      applied = (
        await client.query('SELECT name, checksum FROM public.schema_migrations ORDER BY name')
      ).rows;
    const files = new Map(migrations.map((m) => [m.name, m]));
    for (const row of applied) {
      if (!files.has(row.name) || files.get(row.name).checksum !== row.checksum)
        throw new Error(`Applied migration changed or missing: ${row.name}`);
    }
    const done = new Set(applied.map((row) => row.name));
    if (applied.some((row, i) => row.name !== migrations[i]?.name))
      throw new Error('Migration history is not a prefix of the SQL files');
    const pending = migrations.filter((m) => !done.has(m.name));
    if (!statusOnly) {
      if (!applied.length) {
        const existing = await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
        );
        if (existing.rows.length)
          throw new Error(
            'Existing database detected. Initial SQL is for an empty database; do not reset or overwrite existing data. Review schema adoption separately.',
          );
      }
      await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
        name text PRIMARY KEY, checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      for (const migration of pending) {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
      }
    }
    await client.query('COMMIT');
    return {
      applied: applied.map((row) => row.name),
      pending: pending.map((m) => m.name),
      statusOnly,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--status'))
    throw new Error('Usage: migrate.mjs [--status]');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await migrate(client, await readMigrations(), {
      statusOnly: process.argv.includes('--status'),
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

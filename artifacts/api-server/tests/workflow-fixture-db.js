// TEMP tables on one held connection; production rows and sequences are read-only.
import { pool as realPool } from '../../../lib/db/src/index.js';
const tables = [
  'lawyer_clients',
  'cases',
  'case_attachments',
  'case_messages',
  'case_analysis_operations',
  'case_organization',
  'report_versions',
  'report_interactions',
  'case_folders',
  'case_fee_agreements',
  'case_fee_receipts',
];
const client = await realPool.connect();
let tail = Promise.resolve();
async function acquire() {
  let release;
  const next = new Promise((r) => {
    release = r;
  });
  const old = tail;
  tail = tail.then(() => next);
  await old;
  return release;
}
async function fingerprints() {
  const out = {};
  for (const t of tables) {
    const r = await client.query(
      `SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) AS hash FROM public.${t} t`,
    );
    out[t] = r.rows[0];
  }
  const seq = await client.query(
    'SELECT last_value,is_called FROM public.case_messages_sequence_seq',
  );
  out.sequence = seq.rows[0];
  return out;
}
export const before = await fingerprints();
for (const t of tables)
  await client.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING ALL)`);
// LIKE does not copy foreign keys. Mirror the new cross-owner constraints in isolation.
await client.query(`ALTER TABLE pg_temp.cases ADD FOREIGN KEY(client_id,owner_id) REFERENCES pg_temp.lawyer_clients(id,owner_id);
  ALTER TABLE pg_temp.case_fee_agreements ADD FOREIGN KEY(case_id,owner_id) REFERENCES pg_temp.cases(id,owner_id);
  ALTER TABLE pg_temp.case_fee_receipts ADD FOREIGN KEY(case_id,owner_id) REFERENCES pg_temp.cases(id,owner_id)`);
await client.query('CREATE TEMP SEQUENCE workflow_message_sequence');
await client.query(
  "ALTER TABLE pg_temp.case_messages ALTER COLUMN sequence SET DEFAULT nextval('pg_temp.workflow_message_sequence')",
);
export const pool = {
  async query(sql, v) {
    const release = await acquire();
    try {
      return await client.query(sql, v);
    } finally {
      release();
    }
  },
  async connect() {
    const release = await acquire();
    return { query: (sql, v) => client.query(sql, v), release };
  },
};
export async function publicFingerprints() {
  const release = await acquire();
  try {
    return { before, after: await fingerprints() };
  } finally {
    release();
  }
}

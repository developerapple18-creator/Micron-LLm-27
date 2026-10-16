// Strict, memory-only SQL adapter for the REAL lifecycle/execution modules.
// It models the scoped predicates; it does not claim to test PostgreSQL locking.
import assert from 'node:assert/strict';
export { documents } from './document-test-db.js';
import { documents } from './document-test-db.js';
export const operations = new Map();
export const cases = new Map();
export const messages = new Map();
let transaction = Promise.resolve();
async function query(sql, v = []) {
  const result = (rows) => ({ rows: structuredClone(rows), rowCount: rows.length });
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return result([]);
  if (sql.startsWith('SELECT * FROM cases'))
    return result(cases.get(v[0]) === v[1] ? [{ id: v[0] }] : []);
  if (sql.startsWith('SELECT * FROM case_attachments')) {
    const d = documents.get(v[0]);
    return result(d?.row.owner_id === v[1] && d.row.case_id === v[2] ? [d.row] : []);
  }
  if (sql.startsWith('SELECT id FROM case_attachments')) {
    const d = documents.get(v[2])?.row;
    return result(
      d?.case_id === v[0] &&
        d.owner_id === v[1] &&
        d.message_id === v[3] &&
        d.generation === v[4] &&
        d.status === 'ready'
        ? [{ id: d.id }]
        : [],
    );
  }
  if (sql.startsWith('SELECT id FROM case_messages'))
    return result(
      v[2]
        .filter((id) => messages.get(id)?.owner === v[1] && messages.get(id)?.caseId === v[0])
        .map((id) => ({ id })),
    );
  if (sql.startsWith('SELECT * FROM case_analysis_operations WHERE id=')) {
    const row = operations.get(v[0]);
    return result(row?.owner_id === v[1] && row.case_id === v[2] ? [row] : []);
  }
  if (sql.startsWith('SELECT id,run_token,input_snapshot')) {
    return result(
      [...operations.values()].filter(
        (r) =>
          r.owner_id === v[0] &&
          r.case_id === v[1] &&
          r.status === 'running' &&
          r.input_snapshot.processingVersion === 1 &&
          r.lease_expires_at <= new Date(),
      ),
    );
  }
  if (sql.includes("coalesce(input_snapshot->>'processingVersion'")) {
    assert(sql.includes("status='running'") && sql.includes('owner_id=$1 AND case_id=$2'));
    return result([]); // All simulated operations are document version 1.
  }
  if (sql.includes('UPDATE case_analysis_operations o')) return result([]); // No added messages in fixtures.
  if (!sql.startsWith('UPDATE case_analysis_operations'))
    throw new Error(`Unmocked SQL forbidden: ${sql}`);
  assert(
    sql.includes('id=$1 AND owner_id=$2 AND case_id=$3'),
    'Writes must be ID/owner/case scoped',
  );
  const row = operations.get(v[0]);
  if (!row || row.owner_id !== v[1] || row.case_id !== v[2]) return result([]);
  if (sql.includes("status='pending'")) {
    if (row.status !== 'pending') return result([]);
    row.status = 'running';
    row.run_token = v[3];
    row.started_at = new Date();
    row.lease_expires_at = new Date(Date.now() + 300_000);
  } else if (sql.includes("status='running'")) {
    const tokenIndex = sql.includes('run_token=$5') ? 4 : 3;
    if (row.status !== 'running' || row.run_token !== v[tokenIndex]) return result([]);
    if (sql.includes('lease_expires_at>clock_timestamp()') && row.lease_expires_at <= new Date())
      return result([]);
    if (sql.includes('SET\n      input_snapshot=')) {
      row.input_snapshot = JSON.parse(v[3]);
      row.source_registry = JSON.parse(v[5]);
    } else if (sql.includes("SET status='completed'")) {
      row.status = 'completed';
      row.result = JSON.parse(v[4]);
      row.source_registry = JSON.parse(v[5]);
      row.run_token = null;
      row.lease_expires_at = null;
      row.finished_at = new Date();
    } else if (sql.includes("SET status='failed'")) {
      row.status = 'failed';
      row.result = null;
      row.failure_code = v[4];
      row.run_token = null;
      row.lease_expires_at = null;
      row.finished_at = new Date();
    } else if (sql.includes('SET lease_expires_at=')) {
      row.lease_expires_at = new Date(Date.now() + 300_000);
    } else throw new Error('Unmodeled running update');
  } else if (sql.includes("status='completed'")) {
    if (row.status !== 'completed') return result([]);
    row.input_snapshot.pdfEvidence = JSON.parse(v[3]);
  } else if (sql.includes("status='failed'")) {
    if (row.status !== 'failed') return result([]);
    row.input_snapshot.preparationError = JSON.parse(v[3]);
    row.input_snapshot.providerDiagnostics = JSON.parse(v[4]);
  } else throw new Error('Unmodeled terminal update');
  return result([row]);
}
export const pool = {
  query,
  async connect() {
    // Serial test transactions model the existing row lock, not a replacement for it.
    const previous = transaction;
    let release;
    transaction = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    return { query, release };
  },
};

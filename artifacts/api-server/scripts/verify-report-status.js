/** Focused unpaid status/export checks. No fixture inserts or paid executions. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pool } from '@workspace/db';
import { interactionView } from '../src/lib/report-interactions.js';
import { exportDocx, exportPdf, exportLines } from '../src/lib/report-export.js';
import {
  interactionElapsed,
  interactionPollDelay,
} from '../../micron-law/src/lib/report-interaction-status.js';
let checks = 0,
  external = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  external++;
  throw new Error('EXTERNAL HTTP BLOCKED');
};
const pass = (name) => {
  checks++;
  console.log(`PASS ${name}`);
};
const tables = [
  'cases',
  'case_messages',
  'case_attachments',
  'case_analysis_operations',
  'report_versions',
  'report_interactions',
];
async function snapshot() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = [];
    for (const table of tables) {
      result.push(
        (
          await client.query(
            `SELECT count(*)::int n, md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) h FROM public.${table} t`,
          )
        ).rows[0],
      );
    }
    await client.query('COMMIT');
    return result;
  } finally {
    client.release();
  }
}
async function legalHashes() {
  return Promise.all(
    ['shared-legal-core.md', 'case-analysis-prompt.md', 'case-analysis.schema.json'].map(
      async (path) =>
        createHash('sha256')
          .update(await readFile(`lib/legal-contracts/${path}`))
          .digest('hex'),
    ),
  );
}
try {
  const before = await snapshot(),
    hashes = await legalHashes();
  const start = '2026-10-14T10:00:00.000Z',
    ms = Date.parse(start);
  assert.equal(interactionElapsed(start, ms), '00:00');
  assert.equal(interactionElapsed(start, ms + 71_900), '01:11');
  assert.equal(interactionElapsed(start, ms + 3_661_000), '61:01');
  assert.equal(interactionElapsed(start, ms - 1000), '00:00');
  assert.equal(interactionElapsed(null, ms), null);
  assert.equal(interactionElapsed('invalid', ms), null);
  pass('MM:SS uses persisted start, survives reload, handles missing time/clock skew');
  const running = [{ status: 'running' }];
  assert.equal(interactionPollDelay(running), 3000);
  assert.equal(interactionPollDelay([{ status: 'prepared', executionSync: 'submitting' }]), 3000);
  assert.equal(interactionPollDelay([{ status: 'prepared', executionSync: 'uncertain' }]), 3000);
  pass('running/submitting/uncertain requests select read-only 3-second monitoring');
  for (const status of ['prepared', 'completed', 'failed', 'accepted', 'rejected']) {
    assert.equal(interactionPollDelay([{ status }]), false);
  }
  assert.equal(interactionPollDelay([]), false);
  assert.equal(interactionPollDelay(undefined), false);
  pass('no idle polling; all confirmed terminal states stop monitoring');
  for (const error of [new Error('network'), { status: 503 }, { status: 408 }, { status: 429 }]) {
    assert.equal(interactionPollDelay(running, error), 5000);
  }
  assert.equal(interactionPollDelay(undefined, new Error('network')), 5000);
  assert.equal(interactionPollDelay([{ status: 'completed' }], new Error('network')), false);
  for (const status of [400, 401, 403, 404])
    assert.equal(interactionPollDelay(running, { status }), false);
  pass('transient read failures back off without treating AI as failed; auth failures stop');
  const synthetic = {
    id: randomUUID(),
    version_id: randomUUID(),
    section_id: 'summary',
    block_index: 0,
    kind: 'discuss',
    instruction: 'بيانات اصطناعية فقط',
    status: 'running',
    answer: null,
    proposed_text: null,
    source_refs: [],
    created_at: new Date(ms - 60000),
    started_at: new Date(ms),
    finished_at: null,
  };
  const view = interactionView(synthetic);
  assert.equal(view.startedAt, start);
  assert.equal(view.finishedAt, null);
  assert.equal(view.status, 'running');
  assert.equal(view.executionApproved, false);
  const completed = interactionView({
    ...synthetic,
    status: 'completed',
    finished_at: new Date(ms + 71900),
    answer: 'رد محاكاة',
  });
  assert.equal(completed.finishedAt, '2026-10-14T10:01:11.900Z');
  assert.equal(completed.answer, 'رد محاكاة');
  pass('existing status serializer exposes exact start/finish/answer without executing anything');
  const version = {
    id: randomUUID(),
    operationId: randomUUID(),
    number: 0,
    kind: 'original',
    parentId: null,
    createdAt: start,
    report: {
      title: 'تقرير اصطناعي للتحقق غير المدفوع',
      change_summary: null,
      alerts: [
        {
          severity: 'high',
          message: 'يجب التحقق من دليل الإثبات؛ لا توجد صفحات موثقة.',
          attachment_id: null,
        },
      ],
      sections: [
        'summary',
        'facts',
        'characterization',
        'evidence',
        'position',
        'legal_basis',
        'risks',
        'conclusions',
      ].map((section_id) => ({
        section_id,
        blocks: [
          {
            text: 'نص اصطناعي ثابت غير معدل.',
            basis: 'unverified',
            source_refs: ['unknown-ref-exact'],
          },
        ],
      })),
    },
  };
  const frozen = JSON.stringify(version),
    lines = exportLines(version);
  assert.equal(lines.filter((line) => line.heading === 2).length, 8);
  assert(lines.some((line) => line.text.includes('unknown-ref-exact')));
  assert(lines.some((line) => line.text.includes('غير متحقق')));
  const docx = await exportDocx(version),
    pdf = await exportPdf(version);
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.equal(JSON.stringify(version), frozen);
  await mkdir('generated-artifacts/report-stabilization', { recursive: true });
  await writeFile('generated-artifacts/report-stabilization/synthetic-report.docx', docx);
  await writeFile('generated-artifacts/report-stabilization/synthetic-report.pdf', pdf);
  pass('actual Word/PDF exporters produce files for unchanged synthetic eight-section report');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await legalHashes(), hashes);
  assert.equal(external, 0);
  pass(
    'real cases/messages/attachments/operations/versions/interactions and legal hashes unchanged',
  );
  console.log(
    JSON.stringify({ checks, externalRequests: external, realProviderCalls: 0, databaseWrites: 0 }),
  );
} finally {
  globalThis.fetch = originalFetch;
  await pool.end();
}

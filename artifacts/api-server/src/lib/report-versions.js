import { createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { z } from 'zod';
import { ownedCase, validated } from './case-access.js';
import { HttpError } from './security.js';
export const hashInput = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function reportOperation(owner, caseId, operationId, c = pool) {
  await ownedCase(caseId, owner, c);
  const { rows } = await c.query(
    'SELECT * FROM case_analysis_operations WHERE id=$1 AND case_id=$2 AND owner_id=$3',
    [operationId, caseId, owner],
  );
  const op = rows[0];
  if (!op || op.status !== 'completed' || op.result?.kind !== 'report' || !op.result.report)
    throw new HttpError(404, 'لا يوجد تقرير محفوظ لهذه العملية.');
  return op;
}
const view = (r) => ({
  id: r.id,
  operationId: r.operation_id,
  number: r.version_number,
  kind: r.kind,
  parentId: r.parent_id,
  createdAt: r.created_at.toISOString(),
  report: r.report,
});
export async function listVersions(owner, caseId, operationId, c = pool) {
  const op = await reportOperation(owner, caseId, operationId, c);
  const original = {
    id: op.id,
    operationId: op.id,
    number: 0,
    kind: 'original',
    parentId: null,
    createdAt: (op.finished_at ?? op.updated_at).toISOString(),
    report: op.result.report,
  };
  const { rows } = await c.query(
    'SELECT * FROM report_versions WHERE owner_id=$1 AND operation_id=$2 ORDER BY version_number',
    [owner, operationId],
  );
  return [original, ...rows.map(view)];
}
export async function selectedVersion(owner, caseId, operationId, id, c = pool) {
  const v = (await listVersions(owner, caseId, operationId, c)).find((v) => v.id === id);
  if (!v) throw new HttpError(404, 'نسخة التقرير غير موجودة.');
  return v;
}
export const versionInput = z
  .object({
    requestId: z.string().uuid(),
    baseVersionId: z.string().uuid(),
    edits: z
      .array(
        z
          .object({
            sectionId: z.string(),
            blockIndex: z.number().int().nonnegative(),
            text: z
              .string()
              .min(1)
              .max(20000)
              .refine((t) => !!t.trim()),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
    restoreVersionId: z.string().uuid().optional(),
    proposalId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => [v.edits, v.restoreVersionId, v.proposalId].filter(Boolean).length === 1);
export function replaceBlock(report, sectionId, index, text, origin, refs = []) {
  const block = report.sections.find((s) => s.section_id === sectionId)?.blocks[index];
  if (!block) throw new HttpError(400, 'الفقرة المختارة غير موجودة.');
  if (block.text === text) return;
  block.original_source_refs = block.original_source_refs ?? [...block.source_refs];
  block.text = text;
  block.origin = origin;
  block.basis = 'unverified';
  block.source_refs = [];
  if (origin === 'ai_accepted') block.proposed_source_refs = refs;
}
/** Append-only snapshots; original provider result is never updated, even on restore. */
export async function saveVersion(owner, caseId, operationId, raw) {
  const input = validated(versionInput, raw),
    hash = hashInput(input),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await reportOperation(owner, caseId, operationId, c);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,18224))', [operationId]);
    const prior = await c.query(
      'SELECT * FROM report_versions WHERE owner_id=$1 AND operation_id=$2 AND request_id=$3',
      [owner, operationId, input.requestId],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== hash)
        throw new HttpError(409, 'معرّف الحفظ مستخدم لمحتوى مختلف.');
      await c.query('COMMIT');
      return view(prior.rows[0]);
    }
    const versions = await listVersions(owner, caseId, operationId, c),
      latest = versions.at(-1);
    if (latest.id !== input.baseVersionId)
      throw new HttpError(409, 'تغيّرت النسخة الحالية. احتفظ بمسودتك وحدّث التقرير قبل الحفظ.');
    let report = structuredClone(latest.report),
      kind = 'manual';
    if (input.restoreVersionId) {
      report = structuredClone(
        (await selectedVersion(owner, caseId, operationId, input.restoreVersionId, c)).report,
      );
      kind = 'restore';
    } else if (input.proposalId) {
      const { rows } = await c.query(
        'SELECT * FROM report_interactions WHERE id=$1 AND operation_id=$2 AND owner_id=$3 FOR UPDATE',
        [input.proposalId, operationId, owner],
      );
      const p = rows[0];
      if (
        !p ||
        p.kind !== 'revise' ||
        p.status !== 'completed' ||
        p.version_id !== latest.id ||
        !p.proposed_text
      )
        throw new HttpError(409, 'المقترح غير متاح للقبول على النسخة الحالية.');
      replaceBlock(
        report,
        p.section_id,
        p.block_index,
        p.proposed_text,
        'ai_accepted',
        p.source_refs,
      );
      await c.query("UPDATE report_interactions SET status='accepted' WHERE id=$1", [p.id]);
      kind = 'ai_accepted';
    } else {
      const seen = new Set();
      for (const e of input.edits) {
        const key = `${e.sectionId}:${e.blockIndex}`;
        if (seen.has(key)) throw new HttpError(400, 'تكررت الفقرة في طلب الحفظ.');
        seen.add(key);
        replaceBlock(report, e.sectionId, e.blockIndex, e.text, 'manual');
      }
    }
    if (Buffer.byteLength(JSON.stringify(report)) > 300000)
      throw new HttpError(400, 'حجم نسخة التقرير يتجاوز الحد المسموح.');
    const { rows } = await c.query(
      `INSERT INTO report_versions
      (owner_id,case_id,operation_id,request_id,request_hash,version_number,parent_id,kind,report)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        owner,
        caseId,
        operationId,
        input.requestId,
        hash,
        latest.number + 1,
        latest.id,
        kind,
        report,
      ],
    );
    await c.query('COMMIT');
    return view(rows[0]);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

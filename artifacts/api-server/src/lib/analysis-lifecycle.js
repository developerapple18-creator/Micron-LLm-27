import { maxPdfAnalysisAttachments } from './attachment-policy.js';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { ownedCase } from './case-access.js';
import { HttpError } from './security.js';
import { analysisContractErrors } from './analysis-contract.js';
import { continuationSnapshot } from './analysis-continuation.js';
import { pdfSnapshot, pdfSources } from './analysis-pdf.js';
export const analysisView = (row) => ({
  id: row.id,
  caseId: row.case_id,
  messageId: row.message_id,
  status: row.status,
  parentOperationId: row.parent_operation_id ?? null,
  followupRound: row.input_snapshot?.round ?? 0,
  result: row.status === 'completed' ? row.result : null,
  failureCode: row.failure_code,
  preparationError: row.input_snapshot?.preparationError ?? null,
  processingMessage: row.input_snapshot?.documentProcessing?.message ?? null,
  sourceRegistry: row.source_registry,
  pdfEvidence: row.input_snapshot?.pdfEvidence ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  startedAt: row.started_at?.toISOString() ?? null,
  finishedAt: row.finished_at?.toISOString() ?? null,
});
const staleSql = `UPDATE case_analysis_operations SET status='failed',failure_code='interrupted',
  result=NULL,run_token=NULL,lease_expires_at=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE owner_id=$1 AND case_id=$2 AND status='running' AND lease_expires_at<=clock_timestamp()
    AND coalesce(input_snapshot->>'processingVersion','') <> '1'`;
const changedContextSql = `UPDATE case_analysis_operations o SET status='failed',failure_code='context_changed',
  finished_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE o.owner_id=$1 AND o.case_id=$2 AND o.status='pending'
    AND o.input_snapshot->'messages' IS NOT NULL
    AND EXISTS (SELECT 1 FROM case_messages m WHERE m.case_id=o.case_id AND m.owner_id=o.owner_id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o.input_snapshot->'messages') s WHERE s->>'id'=m.id::text))`;
/** One originating message, one immutable operation. Creation never executes AI. */
export async function createAnalysis(
  owner,
  caseId,
  messageId,
  parentOperationId,
  attachmentId,
  pdfReader,
  attachmentIds,
) {
  if (attachmentId && attachmentIds)
    throw new HttpError(400, 'حدد المرفقات بطريقة واحدة فقط؛ لم يبدأ التحليل.');
  const ids = attachmentIds ?? (attachmentId ? [attachmentId] : undefined);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Short creation transaction only; no external wait or fixture work within it.
    await ownedCase(caseId, owner, client, true);
    const message = await client.query(
      'SELECT id FROM case_messages WHERE id=$1 AND case_id=$2 AND owner_id=$3',
      [messageId, caseId, owner],
    );
    if (!message.rowCount) throw new HttpError(404, 'الرسالة غير موجودة في هذه القضية.');
    await client.query(staleSql, [owner, caseId]);
    await client.query(changedContextSql, [owner, caseId]);
    const existing = await client.query(
      'SELECT * FROM case_analysis_operations WHERE message_id=$1 AND case_id=$2 AND owner_id=$3',
      [messageId, caseId, owner],
    );
    if (existing.rowCount) {
      if ((existing.rows[0].parent_operation_id ?? null) !== (parentOperationId ?? null))
        throw new HttpError(409, 'الرسالة مرتبطة بعملية مختلفة.');
      const previous = existing.rows[0].input_snapshot;
      const previousIds =
        previous?.pdfs?.map((p) => p.id) ?? (previous?.pdf ? [previous.pdf.id] : []);
      if (JSON.stringify(previousIds) !== JSON.stringify(ids ?? []))
        throw new HttpError(
          409,
          'الرسالة مرتبطة باختيار مرفقات مختلف؛ لم تُغيّر العملية المحفوظة.',
        );
      await client.query('COMMIT');
      return analysisView(existing.rows[0]);
    }
    // One successor per clarification, including duplicate explicit submissions.
    if (parentOperationId) {
      const child = await client.query(
        "SELECT * FROM case_analysis_operations WHERE parent_operation_id=$1 AND case_id=$2 AND owner_id=$3 AND failure_code IS DISTINCT FROM 'context_changed'",
        [parentOperationId, caseId, owner],
      );
      if (child.rowCount) {
        await client.query('COMMIT');
        return analysisView(child.rows[0]);
      }
    }
    const active = await client.query(
      "SELECT id FROM case_analysis_operations WHERE case_id=$1 AND owner_id=$2 AND status IN ('pending','running')",
      [caseId, owner],
    );
    if (active.rowCount) throw new HttpError(409, 'توجد عملية تحليل معلقة أو جارية لهذه القضية.');
    const snapshot = ids
      ? await pdfSnapshot(client, owner, caseId, ids, pdfReader)
      : parentOperationId
        ? await continuationSnapshot(client, owner, caseId, messageId, parentOperationId)
        : {
            round: 0,
            clarifications: [],
            messages: (
              await client.query(
                'SELECT id,content,clarification FROM case_messages WHERE case_id=$1 AND owner_id=$2 ORDER BY sequence',
                [caseId, owner],
              )
            ).rows.map((m) => ({
              id: m.id,
              content: m.content,
              ...(m.clarification ? { clarification: m.clarification } : {}),
            })),
          };
    if (parentOperationId && ids) {
      const continued = await continuationSnapshot(
        client,
        owner,
        caseId,
        messageId,
        parentOperationId,
      );
      snapshot.round = continued.round;
      snapshot.clarifications = continued.clarifications;
    }
    const sources = snapshot?.pdf
      ? pdfSources(snapshot)
      : snapshot
        ? snapshot.messages.map((m) => ({ id: m.id, messageId: m.id, basis: 'lawyer_statement' }))
        : [{ id: messageId, messageId, basis: 'lawyer_statement' }];
    const { rows } = await client.query(
      'INSERT INTO case_analysis_operations(owner_id,case_id,message_id,source_registry,parent_operation_id,input_snapshot) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb) RETURNING *',
      [
        owner,
        caseId,
        messageId,
        JSON.stringify(sources),
        parentOperationId ?? null,
        snapshot ? JSON.stringify(snapshot) : null,
      ],
    );
    await client.query('COMMIT');
    return analysisView(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function listAnalysis(owner, caseId) {
  await ownedCase(caseId, owner);
  await (await import('./document-execution.js')).recoverDocumentExecutions(owner, caseId);
  // Lazy durable recovery, scoped to this owner/case; no background worker.
  await pool.query(staleSql, [owner, caseId]);
  await pool.query(changedContextSql, [owner, caseId]);
  const { rows } = await pool.query(
    'SELECT * FROM case_analysis_operations WHERE owner_id=$1 AND case_id=$2 ORDER BY created_at,id',
    [owner, caseId],
  );
  return rows.map(analysisView);
}
export async function getAnalysis(owner, caseId, id) {
  await ownedCase(caseId, owner);
  await (await import('./document-execution.js')).recoverDocumentExecutions(owner, caseId);
  await pool.query(staleSql, [owner, caseId]);
  await pool.query(changedContextSql, [owner, caseId]);
  const { rows } = await pool.query(
    'SELECT * FROM case_analysis_operations WHERE id=$1 AND owner_id=$2 AND case_id=$3',
    [id, owner, caseId],
  );
  if (!rows.length) throw new HttpError(404, 'عملية التحليل غير موجودة في هذه القضية.');
  return analysisView(rows[0]);
}
/** Atomic claim is the durable fence: no retry or reclaim of a terminal operation. */
export async function claimAnalysis(owner, caseId, id) {
  const token = randomUUID();
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    // Same lock as message saving: no correction can land between the final fence and claim.
    await ownedCase(caseId, owner, client, true);
    await client.query(changedContextSql, [owner, caseId]);
    const current = await client.query(
      'SELECT * FROM case_analysis_operations WHERE id=$1 AND owner_id=$2 AND case_id=$3',
      [id, owner, caseId],
    );
    const row = current.rows[0];
    if (row?.status !== 'pending') {
      await client.query('COMMIT');
      committed = true;
      throw new HttpError(409, 'تغيّر السياق أو حالة العملية؛ لم يبدأ تنفيذ آخر.');
    }
    await client.query(
      `UPDATE case_analysis_operations
      SET status='running',run_token=$4,started_at=clock_timestamp(),updated_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+interval '5 minutes'
      WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='pending'`,
      [id, owner, caseId, token],
    );
    await client.query('COMMIT');
    committed = true;
    return token;
  } catch (e) {
    if (!committed) await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
export async function failAnalysis(owner, caseId, id, token, code) {
  const { rowCount } = await pool.query(
    `UPDATE case_analysis_operations SET status='failed',failure_code=$5,
    result=NULL,run_token=NULL,lease_expires_at=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='running' AND run_token=$4`,
    [id, owner, caseId, token, code],
  );
  if (!rowCount) throw new HttpError(409, 'تعذر إنهاء العملية بهذا التنفيذ.');
}
export async function completeAnalysis(owner, caseId, id, token, result, sources, telemetry) {
  const checkStart = performance.now();
  const op = await getAnalysis(owner, caseId, id);
  if (telemetry) telemetry.completionEligibilityMs = performance.now() - checkStart;
  const validationStart = performance.now();
  const documents = sources.filter((s) => s.basis === 'documented');
  const statements = sources.filter((s) => s.basis === 'lawyer_statement');
  const errors = analysisContractErrors(
    result,
    sources.map((s) => s.id),
    documents.map((s) => s.id),
  );
  if (
    !sources.length ||
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    statements.some((s) => s.id !== s.messageId || !s.id.trim()) ||
    documents.length > maxPdfAnalysisAttachments ||
    new Set(documents.map((s) => s.id)).size !== documents.length ||
    documents.some((s) => s.attachmentId !== s.id || !s.generation || !s.sha256) ||
    sources.length !== op.sourceRegistry.length ||
    sources.some(
      (s, i) =>
        JSON.stringify(s, Object.keys(s).sort()) !==
        JSON.stringify(op.sourceRegistry[i], Object.keys(op.sourceRegistry[i] ?? {}).sort()),
    )
  )
    errors.push('invalid_source_registry');
  const authorized = await pool.query(
    'SELECT id FROM case_messages WHERE case_id=$1 AND owner_id=$2 AND id=ANY($3::uuid[])',
    [caseId, owner, statements.map((s) => s.messageId)],
  );
  if (authorized.rows.length !== statements.length) errors.push('unauthorized_source_registry');
  for (const d of documents) {
    const files = await pool.query(
      "SELECT id FROM case_attachments WHERE case_id=$1 AND owner_id=$2 AND id=$3 AND message_id=$4 AND status='ready' AND generation=$5",
      [caseId, owner, d.id, d.messageId, d.generation],
    );
    if (files.rows.length !== 1) errors.push('unauthorized_document_source');
  }
  if (telemetry) {
    telemetry.validationMs = performance.now() - validationStart;
    telemetry.validationSucceeded = errors.length === 0;
  }
  if (errors.length) {
    await failAnalysis(owner, caseId, id, token, 'invalid_result');
    throw new HttpError(422, 'النتيجة غير مطابقة للعقد؛ حُفظت العملية كفشل دون تقرير.');
  }
  const persistStart = performance.now();
  let rowCount;
  try {
    ({ rowCount } = await pool.query(
      `UPDATE case_analysis_operations SET status='completed',result=$5::jsonb,source_registry=$6::jsonb,
    failure_code=NULL,run_token=NULL,lease_expires_at=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='running' AND run_token=$4
      AND lease_expires_at>clock_timestamp()`,
      [id, owner, caseId, token, JSON.stringify(result), JSON.stringify(sources)],
    ));
    if (telemetry) {
      telemetry.persistenceSucceeded = !!rowCount;
      if (rowCount) telemetry.savedAt = new Date().toISOString();
    }
  } finally {
    if (telemetry) telemetry.persistenceMs = performance.now() - persistStart;
  }
  if (!rowCount)
    throw new HttpError(409, 'انتهت صلاحية التنفيذ أو تغيرت حالة العملية؛ لم تُحفظ نتيجة متأخرة.');
}

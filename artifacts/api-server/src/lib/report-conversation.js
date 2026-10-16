import { pool } from '@workspace/db';
import { HttpError } from './security.js';
import { ownedCase } from './case-access.js';
import { selectedVersion } from './report-versions.js';
import { prepareInteraction, beginInteraction, REPORT_SCOPE } from './report-interactions.js';
/** Validate intent before saving. Old operation replays are never reclassified. */
export async function validateReportIntent(owner, caseId, input) {
  const prior = await pool.query(
    `SELECT operation_id,version_id FROM report_interactions
    WHERE owner_id=$1 AND case_id=$2 AND request_id=$3 AND section_id=$4`,
    [owner, caseId, input.requestId, REPORT_SCOPE],
  );
  if (
    prior.rows.some(
      (q) =>
        !input.reportQuestion ||
        q.operation_id !== input.reportQuestion.operationId ||
        q.version_id !== input.reportQuestion.versionId,
    )
  )
    throw new HttpError(
      409,
      'معرّف الإرسال مرتبط بمناقشة نسخة أخرى؛ لا يمكن تحويله أو تشغيل طلب آخر به.',
    );
  if (input.reportQuestion) {
    if (
      input.startAnalysis ||
      input.newAnalysis ||
      input.clarification ||
      input.attachmentIds.length ||
      !input.content.trim() ||
      input.content.trim().length > 4000
    )
      throw new HttpError(
        400,
        'سؤال التقرير نص حتى 4000 حرف، دون مرفقات أو بدء تحليل. احفظ الأدلة الجديدة ثم اختر تحليلًا جديدًا.',
      );
    const old = await pool.query(
      `SELECT o.id FROM case_analysis_operations o JOIN case_messages m ON m.id=o.message_id
      WHERE o.owner_id=$1 AND o.case_id=$2 AND m.request_id=$3`,
      [owner, caseId, input.requestId],
    );
    if (old.rowCount)
      throw new HttpError(409, 'هذه الرسالة مرتبطة بتحليل سابق؛ لا يمكن تحويلها إلى مناقشة جديدة.');
    await selectedVersion(
      owner,
      caseId,
      input.reportQuestion.operationId,
      input.reportQuestion.versionId,
    );
    return;
  }
  if (!input.startAnalysis || input.clarification || input.newAnalysis) return;
  const existing = await pool.query(
    `SELECT o.id FROM case_analysis_operations o JOIN case_messages m ON m.id=o.message_id
    WHERE o.owner_id=$1 AND o.case_id=$2 AND m.request_id=$3`,
    [owner, caseId, input.requestId],
  );
  if (existing.rowCount) return;
  const report = await pool.query(
    `SELECT id FROM case_analysis_operations WHERE owner_id=$1 AND case_id=$2
    AND status='completed' AND result->>'kind'='report' LIMIT 1`,
    [owner, caseId],
  );
  if (report.rowCount)
    throw new HttpError(
      409,
      'يوجد تقرير محفوظ. اسأل عنه في وضع سؤال التقرير، أو اختر تحليلًا جديدًا صراحةً.',
    );
}
export async function submitReportQuestion(owner, caseId, input, mock) {
  const link = input.reportQuestion;
  const client = await pool.connect();
  let question;
  try {
    await client.query('BEGIN');
    await ownedCase(caseId, owner, client, true);
    // One message cannot fork into two discussions of different report versions,
    // including competing submissions before the first interaction is persisted.
    const prior = await client.query(
      `SELECT operation_id,version_id FROM report_interactions
      WHERE owner_id=$1 AND case_id=$2 AND request_id=$3 AND section_id=$4`,
      [owner, caseId, input.requestId, REPORT_SCOPE],
    );
    if (
      prior.rows.some((q) => q.operation_id !== link.operationId || q.version_id !== link.versionId)
    )
      throw new HttpError(409, 'معرّف السؤال مرتبط بنسخة أخرى؛ لم يُنشأ طلب مكرر.');
    question = await prepareInteraction(
      owner,
      caseId,
      link.operationId,
      {
        requestId: input.requestId,
        versionId: link.versionId,
        sectionId: REPORT_SCOPE,
        blockIndex: 0,
        kind: 'discuss',
        instruction: input.content,
      },
      client,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return beginInteraction(owner, caseId, link.operationId, question.id, mock);
}

import { pool } from '@workspace/db';
import { saveCaseMessage } from './case-message.js';
import { createAnalysis, analysisView } from './analysis-lifecycle.js';
import { beginExecution } from './analysis-execution.js';
import { ownedCase } from './case-access.js';
import { HttpError, throttle } from './security.js';
import { logger } from './logger.js';
import { pdfSelectionIssue } from './attachment-policy.js';
import { validateReportIntent, submitReportQuestion } from './report-conversation.js';
/** The existing message id is the durable submission key; no provider retry or worker. */
export async function submitCaseMessage(owner, caseId, input, test) {
  await validateReportIntent(owner, caseId, input);
  const message = await saveCaseMessage(owner, caseId, input);
  if (input.reportQuestion) {
    const { completion } = await submitReportQuestion(owner, caseId, input, test?.discussion);
    return { message, completion };
  }
  if (!input.startAnalysis) return { message, completion: Promise.resolve() };
  try {
    const { rows } = await pool.query(
      'SELECT * FROM case_analysis_operations WHERE owner_id=$1 AND case_id=$2 AND message_id=$3',
      [owner, caseId, message.id],
    );
    let operation;
    if (rows.length) {
      // Replay the exact saved operation, never infer another parent/file from current state.
      operation = analysisView(rows[0]);
    } else {
      const issue = pdfSelectionIssue(message.attachments);
      if (issue) throw new HttpError(400, issue);
      // The ordinary single-submit journey includes eligible evidence saved in prior
      // messages of this owned case, not just the latest upload batch.
      const evidence = await pool.query(
        `SELECT id,filename,content_type,size FROM case_attachments
        WHERE owner_id=$1 AND case_id=$2 AND status='ready' AND message_id IS NOT NULL
        AND content_type IN ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')
        ORDER BY created_at,id`,
        [owner, caseId],
      );
      const evidenceIssue = pdfSelectionIssue(
        evidence.rows.map((r) => ({
          id: r.id,
          filename: r.filename,
          contentType: r.content_type,
          size: Number(r.size),
        })),
      );
      if (evidenceIssue) throw new HttpError(400, evidenceIssue);
      await throttle(`analysis-create:${owner}`, 100);
      operation = await createAnalysis(
        owner,
        caseId,
        message.id,
        input.clarification?.operationId,
        undefined,
        test?.pdfReader,
        evidence.rows.length ? evidence.rows.map((f) => f.id) : undefined,
      );
    }
    if (operation.status === 'pending') await throttle(`analysis-execute:${owner}`, 20);
    return { message, ...(await beginExecution(owner, caseId, operation.id, test?.execution)) };
  } catch (error) {
    const explanation =
      error instanceof HttpError && error.message === 'unsupported_input'
        ? 'المرفقات محفوظة، لكن مجموعة المستندات غير مؤهلة؛ راجع النوع وعدد المرفقات وحجمها. لم يُرسل أي ملف إلى المزود.'
        : error instanceof HttpError
          ? error.message
          : 'تعذر تجهيز جميع المستندات؛ لم يبدأ طلب التحليل. تحقق من المرفقات وحاول التهيئة بطلب جديد.';
    // A lost response / competing submit may already have claimed the same immutable operation.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ownedCase(caseId, owner, client, true);
      const { rows } = await client.query(
        'SELECT * FROM case_analysis_operations WHERE owner_id=$1 AND case_id=$2 AND message_id=$3',
        [owner, caseId, message.id],
      );
      if (rows.length) {
        if (
          rows[0].status === 'pending' &&
          !(error instanceof HttpError && (error.status === 403 || error.status === 429))
        ) {
          const failed = await client.query(
            `UPDATE case_analysis_operations SET status='failed',
            failure_code='preparation_failed',finished_at=clock_timestamp(),updated_at=clock_timestamp()
            ,input_snapshot=jsonb_set(coalesce(input_snapshot,'{}'::jsonb),'{preparationError}',$4::jsonb)
            WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='pending' RETURNING *`,
            [rows[0].id, owner, caseId, JSON.stringify(explanation)],
          );
          if (failed.rows.length) rows[0] = failed.rows[0];
        }
        // Authorization/rate denial remains pending. Recovery is read-only; an explicit
        // re-submission of this same message may start it later, never a mount effect.
        await client.query('COMMIT');
        return { message, operation: analysisView(rows[0]), completion: Promise.resolve() };
      }
      const code =
        error instanceof HttpError && error.message === 'unsupported_input'
          ? 'unsupported_input'
          : error instanceof HttpError && error.message.includes('معلقة أو جارية')
            ? 'case_busy'
            : 'preparation_failed';
      const failed = await client.query(
        `INSERT INTO case_analysis_operations
        (owner_id,case_id,message_id,status,source_registry,failure_code,finished_at,input_snapshot)
        VALUES($1,$2,$3,'failed',$4::jsonb,$5,clock_timestamp(),$6::jsonb) RETURNING *`,
        [
          owner,
          caseId,
          message.id,
          JSON.stringify([{ id: message.id, messageId: message.id, basis: 'lawyer_statement' }]),
          code,
          JSON.stringify({ preparationError: explanation }),
        ],
      );
      await client.query('COMMIT');
      logger.warn(
        { operationId: failed.rows[0].id, failureCode: code },
        'Analysis submission stopped before provider execution',
      );
      return { message, operation: analysisView(failed.rows[0]), completion: Promise.resolve() };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

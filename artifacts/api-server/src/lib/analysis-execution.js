import { pool } from '@workspace/db';
import {
  claimAnalysis,
  completeAnalysis,
  failAnalysis,
  getAnalysis,
} from './analysis-lifecycle.js';
import { ownedCase } from './case-access.js';
import { HttpError } from './security.js';
import {
  buildAnalysisRequest,
  buildAnswerRequest,
  openAIProvider,
  ProviderFailure,
  ANALYSIS_TIMEOUT_MS as TIMEOUT_MS,
  MODEL,
} from './analysis-provider.js';
import { verifiedAnswerSnapshot } from './analysis-continuation.js';
import { logger } from './logger.js';
import { buildPdfRequest, verifiedPdf } from './analysis-pdf.js';
import { beginDocumentExecution } from './document-execution.js';
export async function textInput(owner, caseId, messageId) {
  await ownedCase(caseId, owner);
  const messages = await pool.query(
    'SELECT id,content FROM case_messages WHERE case_id=$1 AND owner_id=$2 ORDER BY created_at,id',
    [caseId, owner],
  );
  const message = messageId ? messages.rows.find((m) => m.id === messageId) : messages.rows.at(-1);
  if (!message?.content?.trim())
    throw new HttpError(409, 'يلزم طلب نصي محفوظ؛ لتحليل المستندات اختر ملفات PDF المؤهلة صراحةً.');
  return message;
}
export async function analysisCapability(owner, caseId) {
  await ownedCase(caseId, owner);
  let eligible = true,
    reason = 'تحليل الوقائع النصية المحفوظة؛ لا بحث قانوني أو قراءة مرفقات ضمن المسار النصي.';
  try {
    await textInput(owner, caseId);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 409) throw e;
    eligible = false;
    reason = e.message;
  }
  const pdf = await pool.query(
    "SELECT id FROM case_attachments WHERE owner_id=$1 AND case_id=$2 AND status='ready' AND message_id IS NOT NULL AND content_type='application/pdf' AND size<50000000 LIMIT 1",
    [owner, caseId],
  );
  if (pdf.rowCount) {
    eligible = true;
    reason =
      'معالجة المستندات الأصلية المحفوظة؛ ينظم الخادم جميع الأدلة ضمن سعة المزود الفعلية. التخزين وحده لا يعني قراءة المستندات.';
  }
  const latest = await pool.query(
    'SELECT * FROM case_analysis_operations WHERE case_id=$1 AND owner_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
    [caseId, owner],
  );
  const last = latest.rows[0];
  if (last?.result?.kind === 'clarification' || last?.parent_operation_id) {
    eligible = true;
    reason = 'احفظ إجاباتك أو وقائعك الإضافية، ثم تابع التحليل مع المستندات الأصلية.';
  }
  // Availability is technical and tenant-scoped; only an explicit POST starts work.
  const executableOperationId = eligible && last?.status === 'pending' ? last.id : null;
  return { eligible, executionEnabled: !!executableOperationId, executableOperationId, reason };
}
/** A claim is committed before work; browser disconnects cannot cancel it. */
export async function beginExecution(owner, caseId, id, options = { provider: openAIProvider }) {
  const requestStart = performance.now();
  const receivedAt = new Date().toISOString();
  const op = await getAnalysis(owner, caseId, id);
  // Terminal/running replay never calls a provider, even after approval is removed.
  if (op.status !== 'pending') return { operation: op, completion: Promise.resolve() };
  const stored = await pool.query(
    'SELECT input_snapshot FROM case_analysis_operations WHERE id=$1 AND owner_id=$2 AND case_id=$3',
    [id, owner, caseId],
  );
  const savedSnapshot = stored.rows[0]?.input_snapshot;
  if (
    savedSnapshot?.processingVersion === 1 &&
    (options.provider === openAIProvider || options.documents)
  )
    return beginDocumentExecution(owner, caseId, id, savedSnapshot, options.documents);
  const pdfSnapshot = savedSnapshot?.pdf ? savedSnapshot : undefined;
  const loadedPdf = pdfSnapshot
    ? await verifiedPdf(
        owner,
        caseId,
        pdfSnapshot,
        options.provider === openAIProvider ? undefined : options.pdfReader,
      )
    : null;
  const snapshot =
    pdfSnapshot ??
    (op.parentOperationId || savedSnapshot?.messages
      ? await verifiedAnswerSnapshot(owner, caseId, id)
      : null);
  const input = snapshot ? snapshot.messages.at(-1) : await textInput(owner, caseId, op.messageId);
  const eligibilityMs = performance.now() - requestStart;
  const sources = snapshot
    ? op.sourceRegistry
    : [{ id: input.id, messageId: input.id, basis: 'lawyer_statement' }];
  const preparationStart = performance.now();
  const built =
    loadedPdf && pdfSnapshot
      ? buildPdfRequest(pdfSnapshot, loadedPdf.bytes)
      : snapshot
        ? buildAnswerRequest(snapshot)
        : buildAnalysisRequest(input.content, input.id);
  const requestPreparationMs = performance.now() - preparationStart;
  const claimStart = performance.now();
  let token;
  try {
    token = await claimAnalysis(owner, caseId, id);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 409) throw e;
    return { operation: await getAnalysis(owner, caseId, id), completion: Promise.resolve() };
  }
  const operation = await getAnalysis(owner, caseId, id);
  const claimAndReadMs = performance.now() - claimStart;
  const telemetry = {};
  const pdfEvidence = pdfSnapshot
    ? {
        ...pdfSnapshot.pdfEvidence,
        providerMode: options.provider === openAIProvider ? 'openai' : 'mock',
        timings: {
          storageRetrievalMs: loadedPdf.storageRetrievalMs,
          providerFilePreparationMs:
            'providerFilePreparationMs' in built
              ? built.providerFilePreparationMs
              : requestPreparationMs,
        },
      }
    : null;
  async function savePdfEvidence() {
    if (pdfEvidence)
      await pool.query(
        "UPDATE case_analysis_operations SET input_snapshot=jsonb_set(input_snapshot,'{pdfEvidence}',$4::jsonb) WHERE id=$1 AND owner_id=$2 AND case_id=$3",
        [id, owner, caseId, JSON.stringify(pdfEvidence)],
      );
  }
  const completion = run();
  return { operation, completion };
  async function run() {
    const started = performance.now();
    const controller = new AbortController();
    let timer;
    let code = null;
    let usage;
    let actualModel;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderFailure('timeout'));
        }, options.timeoutMs ?? TIMEOUT_MS);
      });
      if (pdfEvidence) {
        pdfEvidence.status = 'submission_uncertain';
        await savePdfEvidence();
      }
      const providerStart = performance.now();
      const response = await Promise.race([
        options.provider(built.request, controller.signal, telemetry),
        deadline,
      ]);
      if (pdfEvidence) {
        pdfEvidence.submitted = true;
        pdfEvidence.status = 'provider_completed';
        pdfEvidence.timings.providerExecutionMs = performance.now() - providerStart;
        await savePdfEvidence();
      }
      usage = response.usage;
      actualModel = response.model;
      try {
        await completeAnalysis(owner, caseId, id, token, response.result, sources, telemetry);
      } catch (e) {
        const current = await getAnalysis(owner, caseId, id);
        if (current.status === 'completed') return;
        if (current.status === 'failed') {
          code = current.failureCode;
          return;
        }
        throw e instanceof HttpError
          ? new ProviderFailure('invalid_result')
          : new ProviderFailure('save_failed');
      }
      if (pdfEvidence) pdfEvidence.status = 'result_saved_validated';
    } catch (e) {
      code = e instanceof ProviderFailure ? e.code : 'provider_error';
      try {
        await failAnalysis(owner, caseId, id, token, code);
      } catch {
        // Never reissue a provider request: recovery marks an expired lease interrupted.
        logger.error(
          { operationId: id, failureCode: code },
          'Analysis failure could not be persisted; lease recovery required',
        );
      }
    } finally {
      clearTimeout(timer);
      if (
        telemetry.httpStatus ||
        telemetry.completionStatus ||
        telemetry.usage ||
        telemetry.providerIssue
      ) {
        try {
          await pool.query(
            `UPDATE case_analysis_operations
            SET input_snapshot=jsonb_set(coalesce(input_snapshot,'{}'::jsonb),'{providerDiagnostics}',$4::jsonb)
            WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status IN ('completed','failed')`,
            [id, owner, caseId, JSON.stringify(telemetry)],
          );
          if (telemetry.providerIssue) {
            const issue =
              telemetry.providerIssue === 'context_length_exceeded'
                ? 'رفض المزود الطلب لأنه تجاوز سعة سياق النموذج بعد معالجة نصوص PDF وصور صفحاته. حجم الملفات بالبايت لا يحدد عدد التوكنات؛ لم يُعتمد تقرير ولم تُعد المحاولة.'
                : telemetry.providerIssue === 'invalid_file'
                  ? 'رفض المزود أحد ملفات PDF لعدم صلاحية محتواه؛ لم يُعتمد تقرير ولم تُعد المحاولة.'
                  : 'رفض المزود حجم الطلب أو أحد الملفات؛ لم يُعتمد تقرير ولم تُعد المحاولة.';
            await pool.query(
              `UPDATE case_analysis_operations
              SET input_snapshot=jsonb_set(input_snapshot,'{preparationError}',$4::jsonb)
              WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='failed'`,
              [id, owner, caseId, JSON.stringify(issue)],
            );
          }
        } catch {
          logger.error(
            { operationId: id },
            'Provider diagnostics could not be persisted; no retry',
          );
        }
      }
      if (pdfEvidence) {
        if (code && pdfEvidence.status !== 'provider_completed')
          pdfEvidence.status =
            code === 'timeout' || !telemetry.httpStatus ? 'submission_uncertain' : 'request_failed';
        // Dispatch timestamp alone proves an attempt, not delivery. An HTTP
        // acknowledgement or an explicitly mocked response is stronger evidence.
        if (telemetry.httpStatus) pdfEvidence.submitted = true;
        if (telemetry.httpStatus) pdfEvidence.httpStatus = telemetry.httpStatus;
        pdfEvidence.timings = {
          ...pdfEvidence.timings,
          validationMs: telemetry.validationMs,
          persistenceMs: telemetry.persistenceMs,
        };
        try {
          await savePdfEvidence();
        } catch {
          logger.error(
            { operationId: id },
            'PDF evidence persistence requires read-only recovery; no retry',
          );
        }
      }
      logger.info(
        {
          operationId: id,
          task: 'case_analysis',
          coreVersion: '0.2',
          promptVersion: '0.1',
          providerMode: options.provider === openAIProvider ? 'openai' : 'test',
          model: actualModel ?? MODEL,
          durationMs: Math.round(performance.now() - started),
          requests: 1,
          tools: [],
          failureCode: code,
          usage: usage ?? telemetry.usage,
          telemetry: {
            receivedAt,
            eligibilityMs,
            requestPreparationMs,
            claimAndReadMs,
            ...telemetry,
            totalServerMs: performance.now() - requestStart,
          },
        },
        'Analysis execution finished',
      );
    }
  }
}

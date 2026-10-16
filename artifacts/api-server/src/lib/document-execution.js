import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import {
  claimAnalysis,
  completeAnalysis,
  failAnalysis,
  getAnalysis,
} from './analysis-lifecycle.js';
import { processDocuments, initialProcessingState } from './document-processing.js';
import { ProviderFailure } from './analysis-provider.js';
import { pdfSources } from './analysis-pdf.js';
import { logger } from './logger.js';
import { HttpError } from './security.js';
import { analysisContractErrors } from './analysis-contract.js';
const active = new Map();
function launch(owner, caseId, id, token, snapshot, recovery, options) {
  if (active.has(id)) return active.get(id);
  const state = snapshot.documentProcessing ?? initialProcessingState();
  state.recoveryOnly = recovery;
  const telemetry = { ...state.diagnostics };
  const controller = new AbortController();
  const started = performance.now();
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      const { rowCount } = await pool.query(
        `UPDATE case_analysis_operations SET lease_expires_at=clock_timestamp()+interval '5 minutes'
        WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='running' AND run_token=$4 AND lease_expires_at>clock_timestamp()`,
        [id, owner, caseId, token],
      );
      if (!rowCount) controller.abort();
    } catch {
      controller.abort();
    } finally {
      renewing = false;
    }
  }, 20_000);
  heartbeat.unref();
  async function checkpoint(s) {
    const { rowCount } = await pool.query(
      `UPDATE case_analysis_operations SET
      input_snapshot=$4::jsonb, source_registry=$6::jsonb,updated_at=clock_timestamp()
      WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='running' AND run_token=$5 AND lease_expires_at>clock_timestamp()`,
      [
        id,
        owner,
        caseId,
        JSON.stringify({
          ...snapshot,
          documentProcessing: s,
          pdfEvidence: {
            ...snapshot.pdfEvidence,
            identity: snapshot.pdf,
            documents: snapshot.pdfs,
          },
        }),
        token,
        JSON.stringify(pdfSources(snapshot)),
      ],
    );
    if (!rowCount) {
      controller.abort();
      throw new ProviderFailure('interrupted');
    }
  }
  const work = (async () => {
    try {
      await checkpoint(state);
      const response = await processDocuments(
        owner,
        caseId,
        snapshot,
        state,
        checkpoint,
        telemetry,
        { ...options, signal: controller.signal },
      );
      const registry = pdfSources(snapshot);
      if (
        analysisContractErrors(
          response.result,
          registry.map((s) => s.id),
          registry.filter((s) => s.basis === 'documented').map((s) => s.id),
        ).length
      )
        throw new ProviderFailure('invalid_result');
      await completeAnalysis(owner, caseId, id, token, response.result, registry);
      const evidence = {
        ...snapshot.pdfEvidence,
        method: 'native_file_ids',
        providerCopy: 'temporary_files_api',
        status: 'result_saved_validated',
        submitted: true,
        providerMode: options.transport ? 'mock' : 'openai',
        pageCoverage: 'not_verified',
        pageProvenance: 'unavailable',
        identity: snapshot.pdf,
        documents: snapshot.pdfs,
        units: state.units.map(({ fileId: _fileId, ...unit }) => unit),
        staged: state.batches.length > 1,
        wordCoverage: 'text_only_embedded_images_not_read',
      };
      await pool.query(
        `UPDATE case_analysis_operations SET input_snapshot=jsonb_set(input_snapshot,'{pdfEvidence}',$4::jsonb)
        WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='completed'`,
        [id, owner, caseId, JSON.stringify(evidence)],
      );
    } catch (e) {
      const code =
        e instanceof ProviderFailure
          ? e.code
          : controller.signal.aborted
            ? 'interrupted'
            : e instanceof HttpError
              ? 'invalid_result'
              : 'save_failed';
      const uncertain =
        state.posting && !state.responseId && (code === 'interrupted' || !telemetry.httpStatus);
      snapshot.pdfEvidence = {
        ...snapshot.pdfEvidence,
        status: uncertain ? 'submission_uncertain' : 'request_failed',
        submitted: !!state.responseId || !!(state.phase && telemetry.httpStatus),
        httpStatus: telemetry.httpStatus,
      };
      const explanation =
        e instanceof HttpError
          ? e.message
          : uncertain
            ? 'انقطع الاتصال قبل تأكيد معرّف استجابة المزود؛ قد يكون الطلب بدأ لديه. لم نكرر طلب التوليد، ولم نعتمد تقريرًا؛ الأصول والتقارير السابقة محفوظة.'
            : code === 'interrupted'
              ? 'تعذرت استعادة استجابة المزود ضمن نافذته المؤقتة، أو انقطع التنفيذ قبل حفظ معرّف الاستجابة. لم يُعد طلب التحليل تلقائيًا؛ الأصول والتقارير السابقة محفوظة.'
              : code === 'incomplete_response'
                ? 'لم تكتمل قراءة الأدلة أو استجابة المزود، أو تجاوز سجل الأدلة سعة المدخلات الفعلية. لم يُعتمد تقرير جزئي ولم تُستبعد ملفات أو تُعد المحاولة.'
                : code === 'invalid_result'
                  ? 'تعذر التحقق من أحد المستندات أو سجل الأدلة أو التقرير؛ لم تُعتمد نتيجة غير موثقة. بقيت الأصول محفوظة.'
                  : telemetry.httpStatus && telemetry.httpStatus >= 400
                    ? `تعذر إكمال معالجة المستندات؛ عاد المزود بخطأ HTTP ${telemetry.httpStatus}. لم تُعد المحاولة تلقائيًا، وبقيت الأصول والتقارير السابقة محفوظة.`
                    : 'تعذر إكمال معالجة المستندات أو حفظ نتيجتها؛ لم يُعد طلب مدفوع، وبقيت الأصول والتقارير السابقة محفوظة.';
      try {
        await checkpoint(state);
        await failAnalysis(owner, caseId, id, token, code);
        await pool.query(
          `UPDATE case_analysis_operations SET
          input_snapshot=jsonb_set(jsonb_set(input_snapshot,'{preparationError}',$4::jsonb),'{providerDiagnostics}',$5::jsonb)
          WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='failed'`,
          [id, owner, caseId, JSON.stringify(explanation), JSON.stringify(telemetry)],
        );
      } catch {
        logger.error({ operationId: id }, 'Document execution fence lost; no generation replay');
      }
    } finally {
      clearInterval(heartbeat);
      active.delete(id);
      logger.info(
        {
          operationId: id,
          stage: state.stage,
          durationMs: Math.round(performance.now() - started),
          generationRequests: state.generationRequests,
          documents: snapshot.pdfs?.length,
          diagnostics: telemetry,
        },
        'Native document execution finished',
      );
    }
  })();
  active.set(id, work);
  return work;
}
export async function beginDocumentExecution(owner, caseId, id, snapshot, options = {}) {
  let token;
  try {
    token = await claimAnalysis(owner, caseId, id);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 409) throw e;
    return {
      operation: await getAnalysis(owner, caseId, id),
      completion: active.get(id) ?? Promise.resolve(),
    };
  }
  const completion = launch(owner, caseId, id, token, snapshot, false, options);
  return { operation: await getAnalysis(owner, caseId, id), completion };
}
/** Read-triggered recovery of a KNOWN prior response only, protected by a new lease token.
 * Unknown response IDs are failed, never retransmitted. This does not start pending jobs. */
export async function recoverDocumentExecutions(owner, caseId) {
  const { rows } = await pool.query(
    `SELECT id,run_token,input_snapshot FROM case_analysis_operations
    WHERE owner_id=$1 AND case_id=$2 AND status='running' AND input_snapshot->>'processingVersion'='1'
      AND lease_expires_at<=clock_timestamp()`,
    [owner, caseId],
  );
  for (const row of rows) {
    if (active.has(row.id)) continue;
    const token = randomUUID();
    const claimed = await pool.query(
      `UPDATE case_analysis_operations SET run_token=$4,lease_expires_at=clock_timestamp()+interval '5 minutes'
      WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='running' AND run_token=$5 AND lease_expires_at<=clock_timestamp()`,
      [row.id, owner, caseId, token, row.run_token],
    );
    if (claimed.rowCount) void launch(owner, caseId, row.id, token, row.input_snapshot, true, {});
  }
}

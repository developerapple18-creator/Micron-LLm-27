/**
 * Saved analysis REPORT VIEWER. The conversation is the workspace: one manual
 * Send saves the message and (server-side, under existing gates) prepares and
 * executes the analysis. This module never issues mutations; it only reads
 * saved operations via GET, polls active ones and recovers on refresh.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, ChevronDown, Clock, FileText, Info, RefreshCw } from 'lucide-react';
import {
  useGetCaseAnalysisCapability,
  useListCaseAnalysisOperations,
} from '@workspace/api-client-react';
import { ErrorNote, Skeleton } from '@/components/kit';
import { InteractiveReport } from '@/components/interactive-report';
import { pendingClarificationOperation } from '@/lib/clarification-draft';
/** Lawyer-facing failure text: truthful, no technical detail. Backend codes may extend the generated enum. */
const FAILURE = {
  timeout: 'استغرق التحليل وقتًا أطول من المسموح فلم يكتمل.',
  interrupted: 'توقف التحليل قبل اكتماله.',
  context_changed: 'حُفظت رسائل جديدة قبل بدء هذه العملية، فلم تُنفّذ بالسياق القديم.',
  preparation_failed: 'تعذّر تجهيز الرسالة للتحليل.',
  case_busy: 'توجد عملية أخرى معلّقة أو جارية في القضية. لم يبدأ تحليل جديد لهذه الرسالة.',
  unsupported_input:
    'المرفقات محفوظة، لكن تعذّرت معالجة أحد أنواعها أو أحجامها. يدعم المسار PDF ونص Word وTXT؛ لا يثبت التخزين اكتمال القراءة.',
  execution_unavailable: 'التحليل غير متاح لحسابك حاليًا.',
};
const FAILURE_TAIL = 'لم يُعتمد تقرير لهذه العملية، ولن يُعاد التشغيل تلقائيًا.';
function useElapsed(startedAt, active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!active || !startedAt) return null;
  const sec = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (!Number.isFinite(sec)) return null;
  const m = Math.floor(sec / 60),
    r = sec % 60;
  return `${m.toLocaleString('ar-SA')}:${r.toLocaleString('ar-SA', { minimumIntegerDigits: 2 })}`;
}
export const resultOf = (op) => (op?.status === 'completed' ? op.result : null);
const fmt = (s) =>
  s ? new Date(s).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const failureText = (op) => {
  if (op.preparationError) return op.preparationError;
  const code = op.failureCode ?? '';
  return `${FAILURE[code] ?? 'تعذّر إكمال التحليل حاليًا.'} ${FAILURE_TAIL}`;
};
const canFollowUp = (_op) => true;
/** Single read-only query source for conversation cards and the report viewer. */
export function useCaseAnalysis({ caseId, userId, enabled }) {
  const id = caseId ?? '';
  const capKey = ['case-analysis-capability', userId, id];
  const opsKey = ['case-analysis-operations', userId, id];
  const capability = useGetCaseAnalysisCapability(id, {
    query: {
      queryKey: capKey,
      enabled: enabled && !!caseId,
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const ops = useListCaseAnalysisOperations(id, {
    query: {
      queryKey: opsKey,
      enabled: enabled && !!caseId,
      staleTime: 0,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: (q) =>
        q.state.data?.some((o) => o.status === 'pending' || o.status === 'running') ? 2000 : false,
    },
  });
  const operations = [...(ops.data ?? [])].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const latest = operations.at(-1);
  const result = resultOf(latest);
  /** GET-only recovery; never re-POSTs. */
  const refresh = () => {
    void ops.refetch();
    void capability.refetch();
  };
  const active = operations.some((o) => o.status === 'pending' || o.status === 'running');
  const followupAvailable = !!latest && result?.kind === 'clarification' && canFollowUp(latest);
  return {
    capability,
    ops,
    operations,
    latest,
    result,
    refresh,
    active,
    followupAvailable,
    cap: capability.data,
  };
}
const BTN =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-[14px] font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} border-foreground bg-foreground text-background hover:bg-foreground/90`;
function Blocked({ b, onBack }) {
  return (
    <div data-testid="blocked-result" className="rounded-lg border bg-card p-4">
      <p className="text-[14px] font-semibold">تعذّر إعداد التقرير بالمعطيات الحالية</p>
      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-7">{b.message}</p>
      <p className="mt-3 text-[12.5px] font-medium text-muted-foreground">
        المطلوب لاستكمال التحليل
      </p>
      <ul className="mt-1 list-disc space-y-1 pr-5 text-[14px] leading-7">
        {b.needed.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      {onBack && (
        <button
          type="button"
          className={`${BTN} mt-3`}
          onClick={onBack}
          data-testid="button-blocked-back"
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
          العودة إلى المحادثة لإضافة المعلومات
        </button>
      )}
    </div>
  );
}
/** Compact history entry; actual answer editing lives beside the composer. */
export function ClarificationCard({ c, onPick, op, afterReport = false, active = true }) {
  const first = c.questions[0];
  return (
    <div data-testid="clarification-result" className="rounded-lg border bg-card p-3">
      <p className="text-[13px] font-medium">
        {active ? 'استيضاحات لإكمال التحليل' : 'استيضاحات سابقة'} ·{' '}
        {c.questions.length === 1 ? 'سؤال واحد' : `${c.questions.length} أسئلة`}
      </p>
      {afterReport && (
        <p className="text-[12px] text-muted-foreground">التقرير المكتمل محفوظ دون تغيير.</p>
      )}
      {active && first && (
        <button
          type="button"
          className={`${BTN} mt-1`}
          data-testid="open-guided-clarification"
          onClick={() => onPick(first.question, null, first.id)}
        >
          الإجابة عن الاستيضاح
        </button>
      )}
      <details className="mt-1 text-[12px] leading-6">
        <summary className="min-h-11 cursor-pointer py-2">تفاصيل طلب الاستيضاح</summary>
        <div className="max-h-48 overflow-y-auto whitespace-pre-wrap">
          <p>{c.context}</p>
          <ol className="list-inside list-decimal">
            {c.questions.map((q) => (
              <li key={q.id}>{q.question}</li>
            ))}
          </ol>
        </div>
      </details>
    </div>
  );
}
/** One chronological conversation card per saved operation. */
export function AnalysisOperationCard({ a, op, onOpen, onPick, onResubmit }) {
  const r = resultOf(op);
  const elapsed = useElapsed(op.startedAt, op.status === 'running');
  const isLatest = a.latest?.id === op.id;
  const stale = a.ops.isError;
  const shell = 'rounded-lg border bg-card p-4';
  const refreshBtn = (
    <button
      type="button"
      className={BTN}
      onClick={a.refresh}
      disabled={a.ops.isFetching}
      data-testid={`button-refresh-analysis-${op.id}`}
    >
      <RefreshCw className={`h-4 w-4 ${a.ops.isFetching ? 'animate-spin' : ''}`} aria-hidden />
      تحديث الحالة
    </button>
  );
  const head = (label) => (
    <>
      <p className="text-[12px] text-muted-foreground">تحليل القضية · {fmt(op.createdAt)}</p>
      <p
        className="mt-0.5 flex items-center gap-2 text-[14.5px] font-semibold"
        data-testid={`text-analysis-status-${op.id}`}
        aria-live={isLatest ? 'polite' : undefined}
      >
        {op.status === 'running' && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-foreground/60" aria-hidden />
        )}
        {label}
      </p>
    </>
  );
  if (op.status === 'running')
    return (
      <div className={shell} data-testid={`card-analysis-${op.id}`}>
        {head('جارٍ تحليل القضية')}
        {op.processingMessage && (
          <p
            role="status"
            className="mt-2 text-[13px] leading-7"
            data-testid="document-processing-progress"
          >
            {op.processingMessage}
          </p>
        )}
        <p className="mt-1 text-[13px] leading-7 text-muted-foreground">
          {stale
            ? 'تعذّر تحديث الحالة حاليًا؛ تُعرض آخر حالة محفوظة.'
            : 'يمكنك مغادرة الصفحة والعودة لاحقًا؛ تُعرض الحالة المحفوظة عند عودتك وتُحدَّث تلقائيًا. يمكنك كتابة مسودة، وإرسالها بعد انتهاء التحليل.'}
        </p>
        {elapsed && (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            منذ البدء:{' '}
            <span dir="ltr" className="tabular-nums">
              {elapsed}
            </span>
          </p>
        )}
        {stale && <div className="mt-3">{refreshBtn}</div>}
      </div>
    );
  if (op.status === 'pending')
    return (
      <div className={shell} data-testid={`card-analysis-${op.id}`}>
        {head('لم يبدأ التحليل بعد')}
        <p className="mt-1 text-[13px] leading-7 text-muted-foreground">
          رسالتك محفوظة في القضية، لكن التحليل لم يبدأ.{' '}
          {a.cap && !a.cap.executionEnabled
            ? 'تحقق من أهلية الطلب والمرفقات؛ لن يبدأ تلقائيًا.'
            : 'نتحقق من الحالة؛ لا يُعاد الإرسال تلقائيًا.'}
          {onResubmit
            ? ' يمكنك إعادة إرسال الرسالة الأصلية نفسها، ولن يتكرر تنفيذ طلب بدأ بالفعل.'
            : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {onResubmit && (
            <button
              type="button"
              className={BTN}
              onClick={() => onResubmit(op)}
              data-testid={`button-resubmit-analysis-${op.id}`}
            >
              إعادة إرسال الرسالة
            </button>
          )}
          {refreshBtn}
        </div>
      </div>
    );
  if (op.status === 'failed')
    return (
      <div className={shell} data-testid={`card-analysis-${op.id}`}>
        {head('تعذّر إكمال التحليل')}
        <p role={isLatest ? 'alert' : undefined} className="mt-1 text-[13px] leading-7">
          {failureText(op)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {refreshBtn}
          <Link href="/" className={BTN}>
            طلب تحليل جديد
          </Link>
        </div>
      </div>
    );
  if (r?.kind === 'clarification' && r.clarification)
    return (
      <div data-testid={`card-analysis-${op.id}`}>
        <ClarificationCard
          c={r.clarification}
          op={op}
          onPick={(q, ans, qid) => onPick(q, ans, qid, op.id)}
        />
      </div>
    );
  if (r?.kind === 'report' && r.report)
    return (
      <div className={`${shell} border-foreground/30`} data-testid={`card-analysis-${op.id}`}>
        {head('اكتمل التحليل')}
        <p className="mt-1 text-[14px] leading-7">{r.report.title}</p>
        <button
          type="button"
          className={`${PRIMARY} mt-3 w-full sm:w-auto`}
          onClick={() => onOpen(op.id)}
          data-testid={`button-open-report-${op.id}`}
        >
          <FileText className="h-4 w-4" aria-hidden />
          مراجعة التحليل
        </button>
      </div>
    );
  return (
    <div className={shell} data-testid={`card-analysis-${op.id}`}>
      {head(r?.kind === 'blocked' ? 'التحليل يحتاج معلومات إضافية' : 'تعذّر عرض النتيجة المحفوظة')}
      {r?.kind === 'blocked' && r.blocked && (
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-7">{r.blocked.message}</p>
      )}
      <button
        type="button"
        className={`${BTN} mt-3`}
        onClick={() => onOpen(op.id)}
        data-testid={`button-open-analysis-${op.id}`}
      >
        عرض التفاصيل
      </button>
    </div>
  );
}
/** Compatibility: latest operation only. */
export function AnalysisResultCard({ a, onOpen, onPick }) {
  if (!a.latest) return null;
  return (
    <AnalysisOperationCard
      a={a}
      op={a.latest}
      onOpen={() => onOpen()}
      onPick={(q, ans, qid) => onPick(q, ans, qid)}
    />
  );
}
function TechnicalDetails({ a, op }) {
  const pdf = op?.pdfEvidence;
  if (!pdf && !op) return null;
  return (
    <details className="group rounded-lg border bg-card" data-testid="details-technical">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[13.5px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        تفاصيل التنفيذ
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t px-4 pb-4 pt-3 text-[13px] leading-7">
        {op && (
          <p>
            هُيّئ {fmt(op.createdAt)}
            {op.finishedAt ? ` · انتهى ${fmt(op.finishedAt)}` : ''}
            {op.parentOperationId ? ' · متابعة لتحليل سابق' : ''}
          </p>
        )}
        {pdf && (
          <div data-testid="pdf-reading-status">
            <p>
              أصل المستند محفوظ.{' '}
              {pdf.providerMode === 'mock' ? 'تنفيذ محاكى، وليس قراءة فعلية من المزود. ' : ''}
              {pdf.status === 'prepared_not_submitted'
                ? 'لم يُرسل إلى المزود.'
                : pdf.status === 'result_saved_validated'
                  ? 'اكتمل الطلب وحُفظت نتيجة مطابقة للعقد.'
                  : pdf.status === 'request_failed'
                    ? 'فشل الطلب أو التحقق من نتيجته.'
                    : pdf.status === 'provider_completed'
                      ? 'عاد المزود بنتيجة؛ تحقق من حالة حفظها.'
                      : 'حالة الإرسال أو الاكتمال غير مؤكدة؛ لن يُعاد التشغيل تلقائيًا.'}
            </p>
            <p className="text-muted-foreground">
              الإحالة على مستوى المستند فقط؛ لا تتوفر إحالات موثقة للصفحات أو إثبات تغطيتها جميعًا.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
/** Report viewer: shows the chosen saved operation (or the latest). No execution controls. */
export function RealAnalysisPanel({ a, onPick, onBack, selectedOperationId }) {
  const { ops, operations } = a;
  const reports = operations.filter((o) => resultOf(o)?.kind === 'report');
  const op =
    (selectedOperationId && operations.find((o) => o.id === selectedOperationId)) ||
    reports.at(-1) ||
    a.latest;
  const result = resultOf(op);
  const loading = ops.isLoading && !ops.data;
  const visiblePanel = useRef(null);
  const observed = useRef(new Set());
  useEffect(() => {
    if (!op || op.status !== 'completed' || observed.current.has(op.id)) return;
    const frame = requestAnimationFrame(() => {
      if (!visiblePanel.current?.getClientRects().length || document.visibilityState !== 'visible')
        return;
      observed.current.add(op.id);
      console.info('[micron-performance]', {
        stage: 'client_visible_completion',
        operationId: op.id,
        savedToVisibleMsApprox: op.finishedAt
          ? Math.max(0, Date.now() - Date.parse(op.finishedAt))
          : null,
        scope: 'first_visible_this_mount_includes_navigation_and_clock_skew',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [a, op?.id, op?.status]);
  return (
    <div ref={visiblePanel} className="h-full overflow-y-auto" data-testid="analysis-scroller">
      <div
        dir="rtl"
        className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 sm:px-6"
        data-testid="real-analysis-panel"
      >
        <header>
          <h2 className="text-[19px] font-semibold leading-8 tracking-tight sm:text-[21px]">
            تقرير التحليل
          </h2>
        </header>
        {!!op?.sourceRegistry.some((s) => s.attachmentId) && (
          <div
            className="rounded-lg border p-3 text-[13px] leading-6"
            data-testid="analysis-supplied-documents"
          >
            <p className="font-medium">المستندات المقدمة لهذا التحليل</p>
            <ul className="list-inside list-disc break-words">
              {op.sourceRegistry
                .filter((s) => s.attachmentId)
                .map((s) => (
                  <li key={s.id}>{s.filename ?? 'مستند محفوظ'}</li>
                ))}
            </ul>
            <p className="text-muted-foreground">
              هذه قائمة الملفات المقدمة، وليست إثباتًا لتغطية كل صفحة أو صحة إحالة إلى صفحة بعينها.
            </p>
          </div>
        )}
        <details className="group rounded-lg bg-muted/50" data-testid="details-report-about">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-[12.5px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="flex-1">حدود القراءة والتحقق من المصادر</span>
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <p className="px-3 pb-3 text-[12.5px] leading-6 text-muted-foreground">
            يستند إلى السياق المحفوظ في القضية. لا تتضمن الإحالات استشهادات نظامية متحققًا منها، ولا
            تثبت فهم كل صفحة من PDF. يبدأ التحليل من المحادثة بالإرسال.
          </p>
        </details>

        {ops.isError && (
          <div>
            <ErrorNote>
              تعذّر تحديث حالة التحليل حاليًا.{ops.data ? ' تُعرض آخر حالة محفوظة.' : ''}
            </ErrorNote>
            <button
              type="button"
              className={`${BTN} mt-2`}
              onClick={a.refresh}
              disabled={ops.isFetching}
              data-testid="button-refresh-status"
            >
              <RefreshCw
                className={`h-4 w-4 ${ops.isFetching ? 'animate-spin' : ''}`}
                aria-hidden
              />
              تحديث الحالة
            </button>
          </div>
        )}

        {reports.length > 1 && (
          <p className="text-[12.5px] text-muted-foreground" data-testid="text-report-count">
            {reports.length.toLocaleString('ar-SA')} تقارير محفوظة. اختر «مراجعة التحليل» من بطاقة
            أي تقرير في المحادثة لعرضه.
          </p>
        )}

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !op ? (
          <div
            className="rounded-lg border border-dashed p-6 text-center"
            data-testid="empty-analysis"
          >
            <FileText className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-[14px] font-semibold">لا يوجد تحليل محفوظ بعد</p>
            <p className="mt-1 text-[13px] leading-7 text-muted-foreground">
              اكتب وقائع القضية في المحادثة واضغط إرسال؛ يظهر التقرير هنا عند اكتماله.
            </p>
            {onBack && (
              <button
                type="button"
                className={`${BTN} mt-3`}
                onClick={onBack}
                data-testid="button-empty-back"
              >
                <ArrowRight className="h-4 w-4" aria-hidden />
                الانتقال إلى المحادثة
              </button>
            )}
          </div>
        ) : (
          <>
            {op.pdfEvidence && (
              <p
                className="mb-3 rounded-lg border border-border p-3 text-[12px] leading-6 text-muted-foreground"
                data-testid="document-coverage-note"
              >
                أُرسلت المستندات المسجلة في مصادر هذه العملية للمعالجة؛ هذا ليس إثباتًا مستقلًا
                لقراءة كل صفحة أو صحة كل استنتاج. ملفات Word تُقرأ كنص دون صورها المضمّنة؛ استخدم
                PDF إذا كانت الصور أو الأختام جزءًا من الدليل. في القراءة المرحلية يعتمد التقرير
                النهائي على سجلات أدلة أنشأها المزود.
              </p>
            )}
            {result?.kind === 'report' && result.report && (
              <InteractiveReport
                key={op.id}
                caseId={op.caseId}
                operationId={op.id}
                originalSavedReport={result.report}
                op={op}
              />
            )}
            {result?.kind === 'blocked' && result.blocked && (
              <Blocked b={result.blocked} onBack={onBack} />
            )}
            {result?.kind === 'clarification' && result.clarification && (
              <ClarificationCard
                c={result.clarification}
                op={op}
                onPick={onPick}
                active={pendingClarificationOperation(a.operations)?.id === op.id}
              />
            )}
            {!result && (
              <div
                className="rounded-lg border bg-card p-4"
                data-testid="analysis-status"
                aria-live="polite"
              >
                <p className="text-[14.5px] font-semibold">
                  {op.status === 'running'
                    ? 'جارٍ تحليل القضية'
                    : op.status === 'pending'
                      ? 'لم يبدأ التحليل بعد'
                      : op.status === 'failed'
                        ? 'تعذّر إكمال التحليل'
                        : 'تعذّر عرض النتيجة المحفوظة'}
                </p>
                <p className="mt-1 text-[13px] leading-7 text-muted-foreground">
                  {op.status === 'failed'
                    ? failureText(op)
                    : op.status === 'running'
                      ? op.processingMessage ||
                        'يمكنك متابعة العمل في المحادثة والعودة لاحقًا؛ تُحدَّث الحالة تلقائيًا.'
                      : op.status === 'pending'
                        ? 'الرسالة محفوظة ولم يبدأ التحليل؛ تابع حالتها من المحادثة.'
                        : ''}
                </p>
                {onBack && (
                  <button
                    type="button"
                    className={`${BTN} mt-3`}
                    onClick={onBack}
                    data-testid="button-running-back"
                  >
                    العودة إلى المحادثة
                  </button>
                )}
              </div>
            )}
            <TechnicalDetails a={a} op={op} />
          </>
        )}
      </div>
    </div>
  );
}

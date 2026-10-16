import { pdfSelectionIssue } from '@/lib/pdf-selection';
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetAttachmentPolicyQueryKey,
  useGetAttachmentPolicy,
  useGetCaseConversation,
} from '@workspace/api-client-react';
import { ChatComposer } from '@/components/chat-composer';
import { ErrorNote, Skeleton } from '@/components/kit';
import {
  IncompleteRow,
  PendingMessage,
  ReadyChip,
  SavedMessage,
  UploadRow,
} from '@/components/case-conversation';
import { MAX_ATTACHMENTS, MAX_CONTENT, NEW_KEY, convKey } from '@/hooks/use-case-workspace';
import { errorStatus } from '@/lib/session';
import {
  AnalysisOperationCard,
  ClarificationCard,
  RealAnalysisPanel,
  useCaseAnalysis,
  resultOf,
} from '@/components/real-analysis';
import { ReportQuestionAnswer } from '@/components/report-question-answer';
import { apiJson, versionsKey } from '@/lib/report-api';
import { ComposerActions } from '@/components/composer-actions';
import {
  readComposerIntent,
  saveComposerIntent,
  UPDATED_ANALYSIS_REQUEST,
} from '@/lib/composer-action';
import { GuidedClarification } from '@/components/guided-clarification';
import { useClarificationDraft } from '@/hooks/use-clarification-draft';
import { clarificationSubmission, pendingClarificationOperation } from '@/lib/clarification-draft';
// Keep the existing prototype available to explicit development review only,
// never as a technical control in the normal lawyer-facing workspace.
const previewRequested =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('analysis-preview') === '1';
const ProtoPanel = previewRequested
  ? lazy(() => import('./analysis-prototype.jsx').then((m) => ({ default: m.AnalysisPanel })))
  : null;
const ProtoCard = previewRequested
  ? lazy(() => import('./analysis-prototype.jsx').then((m) => ({ default: m.MockReportCard })))
  : null;
function restoredTab(userId, caseId) {
  if (!caseId) return 'conversation';
  try {
    return sessionStorage.getItem(`micron-case-tab:${userId}:${caseId}`) === 'analysis'
      ? 'analysis'
      : 'conversation';
  } catch {
    return 'conversation';
  } // A reading preference must never block case access.
}
export function CaseView({ ws, userId, caseId, viewportHeight }) {
  const conv = useGetCaseConversation(caseId ?? '', {
    query: {
      queryKey: convKey(caseId ?? '', userId),
      enabled: !!caseId,
      staleTime: 15_000,
      refetchOnMount: true,
      retry: 1,
      // Recover a lost finalize acknowledgement using reads only, never replay a send.
      refetchInterval: (query) =>
        query.state.data?.reportQuestions?.some((q) => q.status === 'running') ||
        ws.uploads.some(
          (u) =>
            u.caseId === caseId &&
            !query.state.data?.attachments.some(
              (a) => a.id === u.attachment?.id && ['ready', 'rejected'].includes(a.status),
            ) &&
            (['preparing', 'uploading', 'finalizing', 'checking'].includes(u.stage) ||
              (u.stage === 'error' && u.failedAt === 'complete')),
        )
          ? 2_000
          : false,
    },
  });
  const policy = useGetAttachmentPolicy({
    query: {
      queryKey: [...getGetAttachmentPolicyQueryKey(), userId],
      staleTime: 0,
      refetchOnMount: 'always',
      retry: 1,
    },
  });
  const key = caseId ?? NEW_KEY;
  const draft = ws.drafts[key] ?? '';
  const data = caseId ? conv.data : undefined;
  const notFound =
    caseId &&
    conv.isError &&
    (errorStatus(conv.error) === 404 ||
      errorStatus(conv.error) === 403 ||
      errorStatus(conv.error) === 400);
  const showTabs = !!(caseId && data && !conv.isError);
  const analysis = useCaseAnalysis({ caseId, userId, conversation: data, enabled: showTabs });
  const [reportSelection, setReportSelection] = useState(null);
  const selectedOperationId =
    reportSelection?.caseId === caseId ? reportSelection.operationId : undefined;
  const latestReport = [...analysis.operations]
    .reverse()
    .find((o) => resultOf(o)?.kind === 'report');
  const completedReport =
    analysis.operations.find(
      (o) => o.id === selectedOperationId && resultOf(o)?.kind === 'report',
    ) ?? latestReport;
  const [intentState, setIntentState] = useState(() => ({
    caseId,
    value: readComposerIntent(userId, caseId),
  }));
  const intent =
    intentState.caseId === caseId ? intentState.value : readComposerIntent(userId, caseId);
  const setIntent = (value) => {
    saveComposerIntent(userId, caseId, value);
    setIntentState({ caseId, value });
  };
  const reportVersions = useQuery({
    queryKey: versionsKey(caseId ?? '', completedReport?.id ?? '', userId),
    enabled: !!caseId && !!completedReport,
    queryFn: ({ signal }) =>
      apiJson(`/api/cases/${caseId}/reports/${completedReport.id}/versions`, { signal }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    retry: 1,
  });
  const questionVersion = reportVersions.data?.at(-1);
  const questionMode = !!completedReport && intent === 'question';
  const savedUpdate = caseId
    ? data?.messages.find((m) => m.requestId === ws.savedUpdates[caseId])
    : undefined;
  const offerUpdatedAnalysis =
    !!savedUpdate &&
    !!latestReport &&
    new Date(savedUpdate.createdAt) > new Date(latestReport.createdAt);
  const selectAction = (value) => {
    setIntent(value);
  };
  const focusAction = (value) => {
    selectAction(value);
    requestAnimationFrame(() =>
      document.querySelector('[data-testid="input-composer"]')?.focus({ preventScroll: true }),
    );
  };
  const savedRequestIds = useMemo(
    () => new Set((data?.messages ?? []).map((m) => m.requestId)),
    [data],
  );
  const confirmedRequestIds = useMemo(
    () =>
      new Set(
        (data?.messages ?? [])
          .filter((m) => {
            const queued = ws.sends.find((s) => s.requestId === m.requestId);
            if (queued?.reportQuestion)
              return data?.reportQuestions?.some((q) => q.requestId === m.requestId);
            return !queued?.startAnalysis || analysis.operations.some((o) => o.messageId === m.id);
          })
          .map((m) => m.requestId),
      ),
    [data, ws.sends, analysis.operations],
  );
  const reconcileRef = useRef(ws.reconcile);
  reconcileRef.current = ws.reconcile;
  useEffect(() => {
    if (confirmedRequestIds.size) reconcileRef.current(confirmedRequestIds);
  }, [confirmedRequestIds]);
  // Hide a queued row as soon as its saved twin is in the cache (no double row while state catches up).
  const sends = ws.sends.filter(
    (s) => s.caseId === caseId && !confirmedRequestIds.has(s.requestId),
  );
  const uploads = ws.uploads.filter((u) => u.caseId === caseId);
  const sending = sends.some((s) => s.status === 'sending');
  const { ready, incomplete } = useMemo(() => {
    const inSend = new Set(ws.sends.flatMap((s) => s.attachments.map((a) => a.id)));
    for (const m of data?.messages ?? []) for (const a of m.attachments) inSend.add(a.id);
    const localIds = new Set(uploads.flatMap((u) => (u.attachment ? [u.attachment.id] : [])));
    const map = new Map();
    for (const a of data?.attachments ?? [])
      if (
        a.messageId === null &&
        (a.status === 'ready' || a.status === 'removing') &&
        !inSend.has(a.id) &&
        !ws.removedIds.has(a.id)
      )
        map.set(a.id, a);
    for (const u of uploads)
      if (
        u.stage === 'ready' &&
        u.attachment &&
        !map.has(u.attachment.id) &&
        !inSend.has(u.attachment.id) &&
        !ws.removedIds.has(u.attachment.id)
      )
        map.set(u.attachment.id, u.attachment);
    const inc = (data?.attachments ?? []).filter(
      (a) =>
        a.messageId === null &&
        !['ready', 'removing', 'removed'].includes(a.status) &&
        !ws.removedIds.has(a.id) &&
        !localIds.has(a.id),
    );
    return { ready: [...map.values()], incomplete: inc };
  }, [data, uploads, ws.sends, ws.removedIds]);
  // A completion response may be lost even though the next authorized GET
  // confirms storage. Do not retain a contradictory local failure/progress row.
  const confirmedFiles = new Set(
    (data?.attachments ?? []).filter((a) => a.status === 'ready').map((a) => a.id),
  );
  const activeUploads = uploads
    .filter((u) => u.stage !== 'ready' && !confirmedFiles.has(u.attachment?.id ?? ''))
    .map((u) =>
      data?.attachments.some((a) => a.id === u.attachment?.id && a.status === 'rejected')
        ? {
            ...u,
            stage: 'error',
            error: 'رفض الخادم الملف بعد التحقق؛ لم يُحفظ.',
            retryable: false,
          }
        : u,
    );
  const tooLong = draft.length > MAX_CONTENT;
  const tooMany = ready.length > MAX_ATTACHMENTS;
  // A large ready-file queue must not permanently block this case's composer.
  const nextAttachments = ready.filter((a) => a.status === 'ready');
  const removing = Object.values(ws.removals).some((r) => r.caseId === caseId && r.busy);
  const selectionIssue = pdfSelectionIssue(nextAttachments, policy.data);
  const unsupportedFiles = !!selectionIssue;
  const waitingFiles = activeUploads.length > 0 || incomplete.length > 0;
  const [protoState, setProtoState] = useState(null);
  const proto = !!ProtoPanel && showTabs && protoState === caseId;
  const clarificationParent = pendingClarificationOperation(analysis.operations);
  const activeClarification = clarificationParent
    ? resultOf(clarificationParent)?.clarification
    : null;
  const answers = useClarificationDraft(userId, caseId, clarificationParent?.id);
  const clarificationQuestions = activeClarification?.questions ?? [];
  const guided =
    !!activeClarification &&
    (!completedReport || intent === 'continue') &&
    intent !== 'update' &&
    intent !== 'analysis';
  const collected = clarificationSubmission(clarificationQuestions, answers.value, draft);
  const outgoingContent = guided ? collected.content : draft;
  const updateAnswers = (next) => {
    answers.change(next);
    if (clarificationParent)
      ws.setDraftLink(key, {
        operationId: clarificationParent.id,
        questionIds: clarificationSubmission(clarificationQuestions, next, '').questionIds,
      });
  };
  const unsupportedFollowup = false;
  const statusUnavailable = !!caseId && (!analysis.ops.data || analysis.ops.isError);
  const policyPending =
    nextAttachments.length > 0 && (!policy.data || policy.isError || policy.isFetching);
  const canSend =
    (outgoingContent.trim().length > 0 ||
      nextAttachments.length > 0 ||
      (!!completedReport && intent === 'analysis')) &&
    outgoingContent.length <= MAX_CONTENT &&
    !(guided && collected.emptyCustom) &&
    !tooLong &&
    !removing &&
    !policyPending &&
    !unsupportedFiles &&
    !waitingFiles &&
    !analysis.active &&
    !unsupportedFollowup &&
    !statusUnavailable &&
    !(caseId && conv.isLoading);
  const currentLink =
    guided && clarificationParent
      ? {
          operationId: clarificationParent.id,
          questionIds: collected.questionIds.length
            ? collected.questionIds
            : ws.draftLinks[key]?.operationId === clarificationParent.id
              ? ws.draftLinks[key].questionIds.filter((id) =>
                  clarificationQuestions.some((q) => q.id === id),
                )
              : [],
        }
      : undefined;
  const pickAnswer = (question, answer, questionId, operationId = clarificationParent?.id) => {
    if (!clarificationParent || operationId !== clarificationParent.id || unsupportedFollowup)
      return;
    setIntent('continue');
    updateAnswers({
      ...answers.value,
      current: questionId,
      answers:
        answer === null
          ? answers.value.answers
          : { ...answers.value.answers, [questionId]: { kind: 'option', value: answer } },
    });
    setTabState({ caseId, tab: 'conversation' });
    requestAnimationFrame(() => {
      // Opening the guided choices must not summon the phone keyboard.
      document
        .querySelector('[data-testid="guided-clarification"]')
        ?.focus({ preventScroll: true });
    });
  };
  const [tabState, setTabState] = useState(() => ({ caseId, tab: restoredTab(userId, caseId) }));
  const tab = showTabs
    ? tabState.caseId === caseId
      ? tabState.tab
      : restoredTab(userId, caseId)
    : 'conversation';
  useEffect(() => {
    if (!showTabs || !caseId) return;
    try {
      sessionStorage.setItem(`micron-case-tab:${userId}:${caseId}`, tab);
    } catch {
      /* Preference-only, no legal data. */
    }
  }, [caseId, userId, tab, showTabs]);
  const panelRef = useRef(null);
  const savedScroll = useRef({ caseId, conversation: null, analysis: null });
  if (savedScroll.current.caseId !== caseId)
    savedScroll.current = { caseId, conversation: null, analysis: null };
  const analysisScroller = () =>
    panelRef.current?.querySelector('[data-testid="analysis-scroller"]') ?? null;
  const setTab = (t) => {
    if (t === tab) return;
    // Only record the visible pane: hidden panes may have been clamped by
    // the composer's height change and must not overwrite their saved position.
    savedScroll.current[tab] =
      tab === 'conversation'
        ? (scroller.current?.scrollTop ?? null)
        : (analysisScroller()?.scrollTop ?? null);
    setTabState({ caseId, tab: t });
  };
  const [discuss, setDiscuss] = useState(null);
  const discussCtx = proto && discuss?.caseId === caseId ? discuss.ctx : null;
  const scroller = useRef(null);
  const nearConversationBottom = useRef(true);
  const replyMark = data?.reportQuestions
    ?.map((q) => `${q.id}:${q.status}:${q.answer?.length ?? 0}`)
    .join('|');
  const count = (data?.messages.length ?? 0) + sends.length;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useLayoutEffect(() => {
    // Show a finished answer when already at the bottom, but never pull a
    // lawyer away from earlier messages they deliberately scrolled to read.
    if (tabRef.current === 'conversation' && nearConversationBottom.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [replyMark, caseId]);
  const prevTab = useRef(tab);
  useLayoutEffect(() => {
    if (prevTab.current === tab) return;
    prevTab.current = tab;
    const restore = () => {
      const position = savedScroll.current[tab];
      const pane = tab === 'conversation' ? scroller.current : analysisScroller();
      if (pane && position !== null) pane.scrollTop = position;
    };
    restore();
    const id = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(id);
  }, [tab]);
  useEffect(() => {
    const el = scroller.current;
    // Do not move the conversation reading position while the analysis tab is shown.
    if (el && tabRef.current === 'conversation') el.scrollTop = el.scrollHeight;
  }, [count, caseId]);
  const note =
    tooLong || outgoingContent.length > MAX_CONTENT
      ? `النص والإجابات أطول من الحد المسموح (${MAX_CONTENT.toLocaleString('ar-SA')} حرف).`
      : guided && collected.emptyCustom
        ? 'أكمل الإجابة الأخرى التي اخترتها، أو امسح اختيارها قبل الإرسال.'
        : questionMode && draft.trim().length > 4000
          ? 'سؤال التقرير أطول من 4000 حرف؛ اختصر السؤال قبل إرساله.'
          : waitingFiles
            ? activeUploads.some((u) => u.stage === 'error') ||
              incomplete.some((a) => a.status === 'rejected')
              ? 'تعذّر رفع أحد الملفات؛ راجع حالة الملف وأعد المحاولة أو أزله.'
              : 'جارٍ رفع الملفات والتحقق من تخزينها. يمكنك كتابة المسودة؛ الإرسال يتاح بعد اكتمال التحقق.'
            : policyPending
              ? 'جارٍ تحديث شروط تحليل المرفقات من الخادم؛ لم يُرسل أي طلب.'
              : unsupportedFiles
                ? (selectionIssue ?? '')
                : unsupportedFollowup
                  ? clarificationParent?.pdfEvidence
                    ? 'متابعة الاستيضاح مع PDF غير مدعومة حاليًا؛ لم يبدأ طلب جديد.'
                    : 'وصل التحليل إلى حد المتابعة المسموح؛ لم يبدأ طلب جديد.'
                  : statusUnavailable
                    ? 'ننتظر التحقق من حالة القضية قبل الإرسال. إذا تعذر الاتصال، اضغط تحديث الحالة.'
                    : analysis.active
                      ? 'يمكنك كتابة مسودة أثناء الانتظار. أرسلها بعد انتهاء التحليل الحالي أو معالجة الطلب الذي لم يبدأ.'
                      : questionMode
                        ? 'من التقرير المحفوظ، دون إعادة قراءة الملفات. حد السؤال 4000 حرف.'
                        : completedReport && intent === 'update'
                          ? 'حفظ فقط؛ التقرير لا يتغير. بعد الحفظ يمكنك إصدار تحليل محدّث.'
                          : completedReport && intent === 'analysis'
                            ? 'تقرير جديد بجميع الأدلة المؤهلة والوقائع المحفوظة؛ يبقى السابق محفوظًا.'
                            : completedReport && intent === 'continue' && !activeClarification
                              ? 'الاستيضاح المختار لم يعد متاحًا؛ ارجع إلى سؤال التقرير.'
                              : intent === 'update' && activeClarification
                                ? 'حفظ الإضافات فقط؛ تظل الإجابات المختارة محفوظة حتى تطلب متابعة التحليل.'
                                : currentLink
                                  ? 'راجع الإجابات ثم اضغط إرسال لمتابعة التحليل. OpenAI يقرر كفاية المعلومات.'
                                  : tooMany
                                    ? `الرسالة تستوعب حتى ${MAX_ATTACHMENTS.toLocaleString('ar-SA')} مرفقات؛ أزل الزائد. لا يُستبعد أي ملف تلقائيًا.`
                                    : policy.isError
                                      ? 'تعذّر تحميل سياسة المرفقات؛ الإرفاق غير متاح مؤقتًا.'
                                      : policy.data
                                        ? 'حتى 50 م.ب في أسرع تحميل تفاعلي نقوم بخدمتكم'
                                        : 'تُحفظ القضية تلقائيًا عند أول إرسال أو رفع.';
  const tabBtn = (t, label) => (
    <button
      type="button"
      role="tab"
      id={`tab-${t}`}
      aria-selected={tab === t}
      aria-controls={`panel-${t}`}
      tabIndex={tab === t ? 0 : -1}
      onClick={() => setTab(t)}
      data-testid={`tab-${t}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const n = t === 'conversation' ? 'analysis' : 'conversation';
          setTab(n);
          document.getElementById(`tab-${n}`)?.focus();
        }
      }}
      className={`relative h-11 flex-1 text-[14px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-none sm:px-6 ${tab === t ? 'text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {label}
    </button>
  );
  return (
    <>
      {showTabs && (
        <div className="shrink-0 border-b" dir="rtl">
          <div
            role="tablist"
            aria-label="أقسام القضية"
            className="mx-auto flex w-full max-w-2xl px-3 sm:px-5 xl:max-w-5xl xl:px-8"
            data-testid="case-tabs"
          >
            {tabBtn('conversation', 'المحادثة')}
            {tabBtn('analysis', 'التحليل')}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {/* Both panes stay mounted; the hidden one is only made invisible so each keeps its own scroll position. */}
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearConversationBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
          className={`absolute inset-0 overflow-y-auto ${tab === 'conversation' ? '' : 'invisible'}`}
          data-testid="conversation"
          {...(showTabs
            ? { role: 'tabpanel', id: 'panel-conversation', 'aria-labelledby': 'tab-conversation' }
            : {})}
          aria-hidden={tab !== 'conversation' || undefined}
          inert={tab !== 'conversation' || undefined}
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-8">
            {caseId && conv.isLoading ? (
              <div className="space-y-4" aria-busy="true">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-3/4" />
                <Skeleton className="h-10 w-1/2" />
              </div>
            ) : notFound ? (
              <div data-testid="text-case-not-found">
                <h2 className="text-[18px] font-semibold">القضية غير متاحة</h2>
                <p className="mt-2 text-[14px] leading-7 text-muted-foreground">
                  لم نعثر على هذه القضية في حسابك.
                </p>
                <Link
                  href="/"
                  className="mt-4 inline-flex h-10 items-center rounded-md border px-4 text-[14px] hover:bg-accent"
                  data-testid="link-back-home"
                >
                  العودة إلى مساحة العمل
                </Link>
              </div>
            ) : caseId && conv.isError ? (
              <div>
                <ErrorNote>تعذّر تحميل المحادثة.</ErrorNote>
                <button
                  onClick={() => conv.refetch()}
                  data-testid="button-retry-conversation"
                  className="mt-3 h-10 rounded-md border px-4 text-[14px] hover:bg-accent"
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : (
              <>
                {count === 0 && (
                  <div>
                    <p className="text-[12px] font-medium text-muted-foreground">
                      {caseId ? 'قضية محفوظة' : 'قضية جديدة'}
                    </p>
                    <h2 className="mt-1 text-[20px] font-semibold tracking-tight">
                      {data?.caseInfo.title || 'تحليل القضية'}
                    </h2>
                    <p className="mt-3 text-[14.5px] leading-7 text-muted-foreground">
                      اكتب طلبك وأرفق PDF أو Word أو TXT. يبدأ التحليل بإرسال واحد ويشمل المستندات
                      المؤهلة المحفوظة في هذه القضية، حتى من رسائل سابقة. تُعرض الحالة تلقائيًا
                      ويمكنك العودة لاحقًا.
                    </p>
                  </div>
                )}
                {data?.messages.map((m) => (
                  <div key={m.id} className="space-y-4">
                    <SavedMessage m={m} />
                    {offerUpdatedAnalysis && savedUpdate?.id === m.id && (
                      <div
                        role="status"
                        className="rounded-lg border bg-card p-3 text-[13px] leading-6"
                        data-testid="saved-evidence-next-action"
                      >
                        <p>حُفظت الإضافات؛ التقرير السابق لم يتغير.</p>
                        <button
                          type="button"
                          disabled={analysis.active || sending}
                          onClick={() => focusAction('analysis')}
                          className="mt-2 min-h-11 rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-50"
                          data-testid="button-issue-updated-analysis"
                        >
                          إصدار تحليل محدّث
                        </button>
                      </div>
                    )}
                    {data.reportQuestions
                      ?.filter((q) => q.requestId === m.requestId)
                      .map((q) => (
                        <ReportQuestionAnswer
                          key={q.id}
                          q={q}
                          caseId={caseId}
                          onOpen={(operationId) => {
                            setReportSelection({ caseId, operationId });
                            savedScroll.current.analysis = 0;
                            setTab('analysis');
                          }}
                          onEvidence={() => focusAction('update')}
                        />
                      ))}
                    {!proto &&
                      analysis.operations
                        .filter(
                          (op) => op.messageId === m.id && resultOf(op)?.kind === 'clarification',
                        )
                        .map((op) => (
                          <ClarificationCard
                            key={op.id}
                            c={resultOf(op).clarification}
                            op={op}
                            afterReport={!!completedReport}
                            active={op.id === clarificationParent?.id}
                            onPick={(q, ans, qid) => pickAnswer(q, ans, qid, op.id)}
                          />
                        ))}
                    {!proto &&
                      analysis.operations
                        .filter(
                          (op) => op.messageId === m.id && resultOf(op)?.kind !== 'clarification',
                        )
                        .map((op) => (
                          <AnalysisOperationCard
                            key={op.id}
                            a={analysis}
                            op={op}
                            onOpen={(operationId) => {
                              setReportSelection({ caseId, operationId });
                              savedScroll.current.analysis = 0;
                              setTab('analysis');
                            }}
                            onPick={pickAnswer}
                            onResubmit={op.status === 'pending' ? () => ws.resubmit(m) : undefined}
                          />
                        ))}
                  </div>
                ))}
                {proto && ProtoCard ? (
                  <Suspense fallback={<Skeleton className="h-28 w-full" />}>
                    <ProtoCard onOpen={() => setTab('analysis')} />
                  </Suspense>
                ) : null}
                {showTabs && analysis.ops.isError && (
                  <div role="alert" className="rounded-lg border p-3 text-[13px] leading-7">
                    تعذّر تحديث حالة التحليل. لن نعيد إرسال طلب تلقائيًا.
                    <button
                      type="button"
                      className="mr-2 min-h-11 underline"
                      onClick={analysis.refresh}
                    >
                      تحديث الحالة
                    </button>
                  </div>
                )}
                {sends.map((s) => (
                  <PendingMessage
                    key={s.requestId}
                    s={s}
                    saved={savedRequestIds.has(s.requestId)}
                    retryDisabled={sending}
                    onRetry={() => ws.retrySend(s.requestId)}
                  />
                ))}
              </>
            )}
          </div>
        </div>
        {showTabs && (
          <div
            ref={panelRef}
            className={`absolute inset-0 flex flex-col ${tab === 'analysis' ? '' : 'invisible'}`}
            role="tabpanel"
            id="panel-analysis"
            aria-labelledby="tab-analysis"
            aria-hidden={tab !== 'analysis' || undefined}
            inert={tab !== 'analysis' || undefined}
          >
            {ProtoPanel && (
              <div className="shrink-0 border-b border-dashed px-4 py-1.5 text-center" dir="rtl">
                <button
                  type="button"
                  onClick={() => {
                    setProtoState(proto ? null : caseId);
                    setDiscuss(null);
                  }}
                  aria-pressed={proto}
                  data-testid="button-prototype-preview"
                  className="min-h-9 rounded-md px-3 text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {proto
                    ? 'العودة إلى التحليل الحقيقي'
                    : 'معاينة النموذج التجريبي (تطوير فقط — بيانات خيالية)'}
                </button>
              </div>
            )}
            <div className="relative min-h-0 flex-1">
              {!proto ? (
                <RealAnalysisPanel
                  key={caseId ?? ''}
                  a={analysis}
                  selectedOperationId={selectedOperationId}
                  onPick={(q, answer, qid) =>
                    pickAnswer(q, answer, qid, selectedOperationId ?? analysis.latest?.id)
                  }
                  onBack={() => {
                    setTab('conversation');
                    requestAnimationFrame(() =>
                      document.getElementById('tab-conversation')?.focus({ preventScroll: true }),
                    );
                  }}
                />
              ) : (
                ProtoPanel && (
                  <Suspense
                    fallback={
                      <div className="mx-auto max-w-2xl space-y-3 px-5 py-6">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-24 w-full" />
                      </div>
                    }
                  >
                    <ProtoPanel
                      key={caseId ?? ''}
                      onDiscuss={(ctx) => {
                        setDiscuss({ caseId, ctx });
                        setTab('conversation');
                        requestAnimationFrame(() =>
                          document
                            .getElementById('tab-conversation')
                            ?.focus({ preventScroll: true }),
                        );
                      }}
                    />
                  </Suspense>
                )
              )}
            </div>
          </div>
        )}
      </div>
      {discussCtx && tab === 'conversation' && (
        <div className="shrink-0 px-3 pt-2 sm:px-5" dir="rtl">
          <div
            role="status"
            className="mx-auto flex w-full max-w-2xl items-start gap-2 rounded-lg border border-dashed bg-card p-3"
            data-testid="banner-discuss-preview"
          >
            <div className="min-w-0 flex-1 text-[13px] leading-6">
              <p className="font-medium" data-testid="text-discuss-ref">
                مناقشة تجريبية: {discussCtx.sectionTitle} · {discussCtx.paragraphLabel} ·{' '}
                <span data-testid="text-discuss-version">{discussCtx.versionLabel}</span>
              </p>
              <p
                className="line-clamp-2 text-muted-foreground"
                data-testid="text-discuss-paragraph"
              >
                {discussCtx.text}
              </p>
              <p className="text-[11.5px] text-muted-foreground">
                معاينة فقط: لن يُرسل شيء ولن يُعدّل التقرير. الرسائل العادية تعمل كالمعتاد.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDiscuss(null)}
              aria-label="إغلاق المعاينة"
              data-testid="button-dismiss-discuss"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {!notFound && (
        <div className={tab === 'conversation' ? 'contents' : 'hidden'} data-testid="composer-wrap">
          <ChatComposer
            actions={
              completedReport || activeClarification ? (
                <ComposerActions onSelect={selectAction} allowUpdatedAnalysis={!!completedReport} />
              ) : undefined
            }
            placeholder={
              guided
                ? 'أضف سياقًا آخر للإجابات (اختياري)…'
                : intent === 'update' && activeClarification
                  ? 'أضف الوقائع أو أرفق مستندًا…'
                  : !completedReport
                    ? undefined
                    : questionMode
                      ? 'اسأل عن التقرير المحفوظ…'
                      : intent === 'update'
                        ? 'أضف الوقائع أو أرفق مستندًا…'
                        : intent === 'continue'
                          ? 'اكتب إجابتك على الاستيضاح…'
                          : 'أضف توجيهك للتحليل المحدّث (اختياري)…'
            }
            inputLabel={
              guided
                ? 'سياق إضافي للاستيضاح'
                : !completedReport
                  ? undefined
                  : questionMode
                    ? 'سؤال عن التقرير المحفوظ'
                    : intent === 'update'
                      ? 'المستندات والوقائع الجديدة'
                      : intent === 'continue'
                        ? 'إجابة الاستيضاح'
                        : 'توجيه التحليل المحدّث'
            }
            sendLabel={
              guided
                ? 'متابعة التحليل'
                : intent === 'update' && activeClarification
                  ? 'حفظ الإضافات'
                  : !completedReport
                    ? undefined
                    : questionMode
                      ? 'إرسال السؤال'
                      : intent === 'update'
                        ? 'حفظ الإضافات'
                        : intent === 'continue'
                          ? 'متابعة الاستيضاح'
                          : 'إصدار تحليل محدّث'
            }
            context={
              <>
                {activeClarification && (
                  <GuidedClarification
                    questions={clarificationQuestions}
                    value={answers.value}
                    onChange={updateAnswers}
                    paused={!guided}
                    onResume={() => setIntent('continue')}
                    disabled={sending}
                    persistent={answers.persistent}
                    viewportHeight={viewportHeight}
                  />
                )}
                {completedReport && (
                  <div className="px-1 text-[12px] leading-5" dir="rtl">
                    {intent !== 'question' && (
                      <div
                        className="mb-1 flex items-center justify-between gap-1 rounded-md bg-muted/60 pl-1 pr-2"
                        role="status"
                        data-testid="selected-composer-action"
                      >
                        <span className="font-medium">
                          {intent === 'update'
                            ? 'إضافة مستندات أو وقائع'
                            : intent === 'analysis'
                              ? 'إصدار تحليل محدّث'
                              : 'متابعة الاستيضاح المختار'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIntent('question')}
                          aria-label="العودة إلى سؤال التقرير"
                          title="العودة إلى سؤال التقرير"
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent"
                          data-testid="button-return-report-question"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {questionMode && (
                      <p className="pb-1 text-muted-foreground" data-testid="question-version">
                        {questionVersion
                          ? `من ${questionVersion.number === 0 ? 'التقرير الأصلي' : `الإصدار ${questionVersion.number}`}`
                          : 'جارٍ التحقق من نسخة التقرير…'}
                        {nextAttachments.length > 0 && ' — احفظ المرفقات أولًا من إجراءات القضية.'}
                      </p>
                    )}
                    {questionMode && reportVersions.isError && (
                      <p role="alert" className="text-destructive">
                        تعذّر التحقق من النسخة؛ لم يبدأ طلب.
                        <button
                          type="button"
                          className="min-h-11 px-2 underline"
                          onClick={() => {
                            void reportVersions.refetch();
                          }}
                        >
                          تحديث الإصدارات
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </>
            }
            draft={draft}
            setDraft={(v) => {
              ws.setDraft(key, v);
              if (currentLink && !ws.draftLinks[key]) ws.setDraftLink(key, currentLink);
            }}
            viewportHeight={viewportHeight}
            onSend={() => {
              const accepted = ws.send(
                caseId,
                completedReport && intent === 'analysis' && !draft.trim()
                  ? UPDATED_ANALYSIS_REQUEST
                  : outgoingContent,
                nextAttachments,
                currentLink,
                completedReport
                  ? questionMode && questionVersion
                    ? {
                        startAnalysis: false,
                        reportQuestion: {
                          operationId: completedReport.id,
                          versionId: questionVersion.id,
                        },
                      }
                    : { startAnalysis: intent !== 'update', newAnalysis: intent === 'analysis' }
                  : intent === 'update' && activeClarification
                    ? { startAnalysis: false }
                    : undefined,
              );
              if (accepted && guided) answers.clear();
              if (accepted)
                setIntent(activeClarification && intent === 'update' ? 'continue' : 'question');
            }}
            sendDisabled={
              !canSend ||
              (completedReport && intent === 'continue' && !activeClarification) ||
              (questionMode &&
                (!questionVersion ||
                  reportVersions.isError ||
                  draft.trim().length > 4000 ||
                  nextAttachments.length > 0))
            }
            sending={sending}
            onFiles={
              policy.data
                ? (files) => {
                    if ((completedReport || activeClarification) && intent !== 'analysis')
                      setIntent('update');
                    ws.addFiles(caseId, files, policy.data);
                  }
                : undefined
            }
            attachDisabled={!policy.data}
            attachTitle={policy.data ? 'إرفاق ملف' : 'جارٍ تحميل سياسة المرفقات'}
            accept={policy.data?.formats
              .flatMap((f) => [`.${f.extension.replace(/^\./, '')}`, ...f.contentTypes])
              .join(',')}
            top={
              ready.length || activeUploads.length || incomplete.length ? (
                <div
                  className="space-y-1.5 overflow-y-auto"
                  style={{
                    maxHeight: viewportHeight
                      ? Math.min(168, Math.round(viewportHeight * 0.22))
                      : 168,
                  }}
                  data-testid="composer-attachments"
                >
                  {(selectionIssue || waitingFiles || policyPending) && (
                    <p
                      role={
                        selectionIssue ||
                        activeUploads.some((u) => u.stage === 'error') ||
                        incomplete.some((a) => a.status === 'rejected')
                          ? 'alert'
                          : 'status'
                      }
                      className={`rounded-md border p-2 text-[13px] leading-6 ${selectionIssue || activeUploads.some((u) => u.stage === 'error') || incomplete.some((a) => a.status === 'rejected') ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'text-muted-foreground'}`}
                      data-testid="attachment-send-blocker"
                    >
                      {selectionIssue ?? note}
                    </p>
                  )}
                  {activeUploads.map((u) => (
                    <UploadRow
                      key={u.localId}
                      u={u}
                      onRetry={() => ws.retryUpload(u.localId)}
                      onRemove={() => ws.removeUpload(u.localId)}
                    />
                  ))}
                  {incomplete.map((a) => (
                    <div key={a.id}>
                      <IncompleteRow a={a} />
                      <button
                        type="button"
                        className="min-h-11 px-2 text-[12px] underline"
                        disabled={ws.removals[a.id]?.busy}
                        onClick={() => {
                          if (caseId) void ws.removeAttachment(caseId, a);
                        }}
                      >
                        إزالة الرفع غير المكتمل وتحرير سعته
                      </button>
                      {ws.removals[a.id]?.error && (
                        <p role="alert" className="text-[12px] text-destructive">
                          {ws.removals[a.id].error}
                        </p>
                      )}
                    </div>
                  ))}
                  {ready.length > 0 && (
                    <div>
                      <p
                        className="pb-1 text-[11px] text-muted-foreground"
                        data-testid="attachment-analysis-eligibility"
                      >
                        {unsupportedFiles
                          ? selectionIssue
                          : `محفوظة ومؤهلة مبدئيًا للمعالجة: ${ready.length} مستند؛ التخزين لا يثبت اكتمال القراءة. Word يُقرأ كنص دون الصور المضمّنة.`}{' '}
                        كل الملفات المعروضة تُرسل مع الطلب؛ اضغط الملف لتنزيل أصله.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {ready.map((a) => (
                          <ReadyChip
                            key={a.id}
                            a={a}
                            removing={ws.removals[a.id]?.busy}
                            error={ws.removals[a.id]?.error}
                            disabled={sending}
                            onRemove={() => caseId && void ws.removeAttachment(caseId, a)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : undefined
            }
            note={note}
          />
        </div>
      )}
    </>
  );
}

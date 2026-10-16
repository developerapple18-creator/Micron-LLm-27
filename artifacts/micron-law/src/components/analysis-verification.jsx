import { useListCaseAnalysisOperations } from '@workspace/api-client-react';
import { ErrorNote } from './kit.jsx';
const headings = {
  summary: 'الملخص',
  facts: 'الوقائع',
  characterization: 'التكييف القانوني',
  evidence: 'الأدلة وعبء الإثبات',
  position: 'مركز الموكل',
  legal_basis: 'الأساس النظامي',
  risks: 'المخاطر',
  conclusions: 'النتائج والتوصيات',
};
const statusLabels = {
  pending: 'معلقة — لم يبدأ التنفيذ',
  running: 'جارٍ التنفيذ',
  completed: 'مكتملة — نتيجة محفوظة',
  failed: 'فشلت — لا يوجد تقرير مكتمل',
};
function SavedOperation({ operation }) {
  // Backend validates the full approved schema before allowing completed storage.
  const result = operation.status === 'completed' ? operation.result : null;
  return (
    <article className="space-y-3 border-t pt-3" data-testid={`analysis-operation-${operation.id}`}>
      <p data-testid="analysis-status">{statusLabels[operation.status]}</p>
      <p className="break-all text-xs text-muted-foreground">معرّف العملية: {operation.id}</p>
      {operation.status === 'failed' && (
        <p role="alert" data-testid="analysis-failure">
          {operation.failureCode === 'interrupted'
            ? 'انقطع التنفيذ أو انتهت صلاحيته. حُفظت حالة الفشل، ولا توجد إعادة تشغيل تلقائية.'
            : 'فشلت العملية ولم تُعتمد نتيجة. لا توجد إعادة تشغيل تلقائية.'}
        </p>
      )}
      {result?.kind === 'report' && result.report && (
        <div data-testid="analysis-saved-report" className="space-y-5">
          <h3 className="font-semibold">{result.report.title}</h3>
          {result.report.sections.map((section) => (
            <section
              key={section.section_id}
              data-testid={`analysis-section-${section.section_id}`}
            >
              <h4 className="font-semibold">{headings[section.section_id]}</h4>
              {section.blocks.map((block, i) => (
                <div key={i} className="mt-2">
                  <p className="whitespace-pre-wrap break-words text-sm leading-7">{block.text}</p>
                  <p className="break-all text-xs leading-6 text-muted-foreground">
                    التصنيف: {block.basis} · مراجع المصدر:{' '}
                    {block.source_refs.join('، ') || 'لا يوجد مصدر موثق'}
                  </p>
                </div>
              ))}
            </section>
          ))}
          {result.report.alerts.map((alert, i) => (
            <p key={i} className="text-sm leading-7">
              {alert.message}
            </p>
          ))}
        </div>
      )}
      {result && result.kind !== 'report' && (
        <p>{result.blocked?.message || result.clarification?.context}</p>
      )}
    </article>
  );
}
/** Temporary read-only verification surface; no execution or regeneration controls. */
export function AnalysisVerification({ caseId, userId }) {
  const query = useListCaseAnalysisOperations(caseId, {
    query: {
      queryKey: ['analysis-verification', userId, caseId],
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: (q) =>
        q.state.data?.some((op) => op.status === 'pending' || op.status === 'running')
          ? 2000
          : false,
      retry: 1,
    },
  });
  if (query.isError) return <ErrorNote>تعذّر استرجاع حالة التحليل المحفوظة.</ErrorNote>;
  if (!query.data?.length) return null;
  return (
    <aside
      className="min-w-0 space-y-3 rounded border p-4"
      data-testid="analysis-verification"
      aria-label="تحقق دورة التحليل"
    >
      <h2 className="font-semibold">تحقق مؤقت لدورة التحليل — للقراءة فقط</h2>
      <p className="text-xs leading-6 text-muted-foreground">
        هذه ليست واجهة التحليل النهائية. نتيجة الاختبار تخص قضية وحسابًا خياليين؛ لا يُشغّل هذا
        العرض ذكاءً اصطناعيًا.
      </p>
      {query.data.map((operation) => (
        <SavedOperation key={operation.id} operation={operation} />
      ))}
    </aside>
  );
}

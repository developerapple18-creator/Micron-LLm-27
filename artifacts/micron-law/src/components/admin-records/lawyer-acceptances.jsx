import { useState } from 'react';
import {
  useGetAdminLawyerAcceptances,
  getGetAdminLawyerAcceptancesQueryKey,
} from '@workspace/api-client-react';
import { FileText } from 'lucide-react';
import {
  Evidence,
  PAGE_SIZE,
  Pager,
  QueryState,
  Raw,
  ReloadButton,
  STALE_MS,
  actionLabel,
  formatDateTime,
} from './shared.jsx';
import { HistoricalDoc } from './historical-doc.jsx';
export function LawyerAcceptances({ lawyer, userId }) {
  const [offset, setOffset] = useState(0);
  const [docId, setDocId] = useState(null);
  const params = { lawyerId: lawyer.id, offset, limit: PAGE_SIZE };
  const q = useGetAdminLawyerAcceptances(params, {
    query: {
      enabled: !!userId && !!lawyer.id,
      staleTime: STALE_MS,
      queryKey: [...getGetAdminLawyerAcceptancesQueryKey(params), userId],
    },
  });
  const items = q.data?.items ?? [];
  return (
    <section className="mt-4 border-t pt-4" data-testid={`section-acceptances-${lawyer.id}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-foreground/80">سجل القبول التاريخي</h3>
        <ReloadButton name="acceptances" onClick={() => q.refetch()} busy={q.isFetching} />
      </div>
      <QueryState
        name="acceptances"
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={!!q.data && items.length === 0}
        emptyText="لا توجد سجلات قبول لهذا المحامي."
        fallback="تعذّر تحميل سجل القبول."
      />
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border bg-background px-4 py-3"
              data-testid={`row-acceptance-${a.id}`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{a.documentTitle}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    الإصدار {a.documentVersion} · {actionLabel(a.action)}
                  </span>
                </span>
                <button
                  onClick={() => setDocId(a.documentId)}
                  data-testid={`button-view-accepted-${a.id}`}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12.5px] hover:bg-accent"
                >
                  <FileText className="h-4 w-4" /> النص المقبول
                </button>
              </div>
              <Evidence
                rows={[
                  ['التاريخ والوقت', formatDateTime(a.createdAt)],
                  ['الوقت المخزّن', <Raw>{a.createdAt}</Raw>],
                  ['الجوال المسجّل', <Raw>{a.mobile}</Raw>],
                  ['رمز الإجراء', <Raw>{a.action}</Raw>],
                  ['عنوان IP', <Raw>{a.ip}</Raw>],
                  ['وكيل المستخدم', <Raw>{a.userAgent}</Raw>],
                  ['بصمة المحتوى', <Raw>{a.contentHash}</Raw>],
                  ['معرّف التدقيق', <Raw>{a.auditId}</Raw>],
                  ['معرّف الوثيقة', <Raw>{a.documentId}</Raw>],
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {q.data && (
        <Pager
          name="acceptances"
          offset={q.data.offset}
          limit={q.data.limit}
          total={q.data.total}
          onChange={setOffset}
        />
      )}
      <HistoricalDoc id={docId} userId={userId} onClose={() => setDocId(null)} />
    </section>
  );
}

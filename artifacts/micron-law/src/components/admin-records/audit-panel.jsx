import { useState } from 'react';
import {
  useGetAdminAuditEvents,
  getGetAdminAuditEventsQueryKey,
} from '@workspace/api-client-react';
import { roleLabel } from '@/lib/session';
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
export function AuditPanel({ userId }) {
  const [offset, setOffset] = useState(0);
  const params = { offset, limit: PAGE_SIZE };
  const q = useGetAdminAuditEvents(params, {
    query: {
      enabled: !!userId,
      staleTime: STALE_MS,
      queryKey: [...getGetAdminAuditEventsQueryKey(params), userId],
    },
  });
  const items = q.data?.items ?? [];
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground" data-testid="text-audit-total">
          {q.data ? `${q.data.total.toLocaleString('ar-SA')} سجل` : ' '}
        </p>
        <ReloadButton name="audit" onClick={() => q.refetch()} busy={q.isFetching} />
      </div>
      <QueryState
        name="audit"
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={!!q.data && items.length === 0}
        emptyText="لا توجد سجلات تدقيق."
        fallback="تعذّر تحميل سجل التدقيق."
      />
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border bg-card px-4 py-3"
              data-testid={`row-audit-${e.id}`}
            >
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium">{actionLabel(e.action)}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {formatDateTime(e.createdAt)}
                </span>
              </div>
              <Evidence
                rows={[
                  [
                    'المنفّذ',
                    e.actor
                      ? `${e.actor.name} · ${roleLabel[e.actor.role] ?? e.actor.role}`
                      : 'غير معروف / بلا حساب',
                  ],
                  ['اسم المستخدم', <Raw>{e.actor?.username ?? ''}</Raw>],
                  ['معرّف المنفّذ', <Raw>{e.actorId ?? ''}</Raw>],
                  ['رمز الإجراء', <Raw>{e.action}</Raw>],
                  ['الوقت المخزّن', <Raw>{e.createdAt}</Raw>],
                  ['عنوان IP', <Raw>{e.ip}</Raw>],
                  ['وكيل المستخدم', <Raw>{e.userAgent}</Raw>],
                  ['معرّف التدقيق', <Raw>{e.id}</Raw>],
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {q.data && (
        <Pager
          name="audit"
          offset={q.data.offset}
          limit={q.data.limit}
          total={q.data.total}
          onChange={setOffset}
        />
      )}
    </div>
  );
}

import { useState } from 'react';
import { useGetAdminLawyers, getGetAdminLawyersQueryKey } from '@workspace/api-client-react';
import { ChevronDown } from 'lucide-react';
import {
  PAGE_SIZE,
  Pager,
  QueryState,
  Raw,
  ReloadButton,
  STALE_MS,
  formatDateTime,
} from './shared.jsx';
import { LawyerAcceptances } from './lawyer-acceptances.jsx';
export function LawyersPanel({ userId }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const params = { offset, limit: PAGE_SIZE };
  const q = useGetAdminLawyers(params, {
    query: {
      enabled: !!userId,
      staleTime: STALE_MS,
      queryKey: [...getGetAdminLawyersQueryKey(params), userId],
    },
  });
  const items = q.data?.items ?? [];
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground" data-testid="text-lawyers-total">
          {q.data ? `${q.data.total.toLocaleString('ar-SA')} محامٍ مسجّل` : ' '}
        </p>
        <ReloadButton name="lawyers" onClick={() => q.refetch()} busy={q.isFetching} />
      </div>
      <QueryState
        name="lawyers"
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={!!q.data && items.length === 0}
        emptyText="لا يوجد محامون مسجّلون بعد."
        fallback="تعذّر تحميل قائمة المحامين."
      />
      {items.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((l) => {
            const open = selected === l.id;
            return (
              <li key={l.id} data-testid={`row-lawyer-${l.id}`}>
                <button
                  onClick={() => setSelected(open ? null : l.id)}
                  aria-expanded={open}
                  data-testid={`button-lawyer-${l.id}`}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-right hover:bg-accent/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{l.name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      <Raw>{l.username}</Raw> · {formatDateTime(l.createdAt)}
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>
                {open && (
                  <div className="px-4 pb-4">
                    <LawyerAcceptances lawyer={l} userId={userId} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {q.data && (
        <Pager
          name="lawyers"
          offset={q.data.offset}
          limit={q.data.limit}
          total={q.data.total}
          onChange={(o) => {
            setSelected(null);
            setOffset(o);
          }}
        />
      )}
    </div>
  );
}

import {
  useGetAdminHistoricalDocument,
  getGetAdminHistoricalDocumentQueryKey,
} from '@workspace/api-client-react';
import { DocReader } from '@/components/doc-reader';
import { ErrorNote } from '@/components/kit';
import { errorText } from '@/lib/session';
import { STALE_MS } from './shared.jsx';
export function HistoricalDoc({ id, userId, onClose }) {
  const q = useGetAdminHistoricalDocument(id ?? '', {
    query: {
      enabled: !!id && !!userId,
      staleTime: STALE_MS,
      queryKey: [...getGetAdminHistoricalDocumentQueryKey(id ?? ''), userId],
    },
  });
  return (
    <>
      {id && q.isLoading && (
        <p
          className="mt-2 text-[12.5px] text-muted-foreground"
          role="status"
          data-testid="text-doc-loading"
        >
          جارٍ تحميل الوثيقة...
        </p>
      )}
      {id && q.isError && (
        <div className="mt-2 space-y-2">
          <ErrorNote>{errorText(q.error, 'تعذّر تحميل نص الوثيقة التاريخي.')}</ErrorNote>
          <div className="flex gap-2">
            <button
              onClick={() => q.refetch()}
              data-testid="button-retry-doc"
              className="h-10 rounded-md border px-4 text-[13px] hover:bg-accent"
            >
              إعادة المحاولة
            </button>
            <button
              onClick={onClose}
              data-testid="button-close-doc"
              className="h-10 rounded-md px-4 text-[13px] text-muted-foreground hover:bg-accent"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
      <DocReader doc={id && q.data ? q.data : null} onClose={onClose} />
    </>
  );
}

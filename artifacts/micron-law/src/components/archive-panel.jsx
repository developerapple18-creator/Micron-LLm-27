/** Searchable archived cases, separate from active counts, pins and folders. */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Archive, ArchiveRestore, Search } from 'lucide-react';
import { Skeleton } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { mutationErrorText, useUpdateCase } from '@/lib/report-api';
import { guardReportNavigation } from '@/lib/report-draft-guard';
import { formatShortDate } from '@/lib/case-drafts';
export function ArchivePanel({ cases, loading, error, onRetry }) {
  const [q, setQ] = useState('');
  const [, navigate] = useLocation();
  const updateCase = useUpdateCase();
  const { toast } = useToast();
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return cases
      .filter(
        (c) =>
          !t ||
          (c.title || '').toLowerCase().includes(t) ||
          (c.clientName ?? '').toLowerCase().includes(t),
      )
      .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  }, [cases, q]);
  const restore = (c) =>
    updateCase.mutate(
      { caseId: c.id, archived: false },
      {
        onSuccess: () =>
          toast({ title: 'استُعيدت القضية', description: 'عادت إلى القضايا النشطة.' }),
        onError: (e) =>
          toast({
            title: 'تعذّرت الاستعادة',
            description: mutationErrorText(e, 'حاول مرة أخرى.'),
            variant: 'destructive',
          }),
      },
    );
  return (
    <div className="flex-1 overflow-y-auto" data-testid="panel-archive">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Archive className="h-5 w-5 text-muted-foreground" />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">الأرشيف</h1>
            <p className="text-[12.5px] text-muted-foreground">
              قضايا محفوظة بالكامل خارج القائمة النشطة. لا يُحذف شيء.
            </p>
          </div>
        </div>
        <div className="relative mt-5">
          <Search
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالعنوان أو اسم الموكل"
            aria-label="بحث في الأرشيف"
            className="min-h-11 w-full rounded-lg border bg-background pr-9 pl-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="input-search-archive"
          />
        </div>
        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-[13px] text-muted-foreground">
              تعذّر تحميل القضايا.{' '}
              <button
                className="font-medium text-foreground underline"
                onClick={onRetry}
                data-testid="button-retry-archive"
              >
                إعادة المحاولة
              </button>
            </p>
          ) : list.length === 0 ? (
            <div
              className="rounded-xl border border-dashed px-6 py-12 text-center"
              data-testid="text-archive-empty"
            >
              <p className="text-[14px] font-medium">{q ? 'لا نتائج مطابقة' : 'الأرشيف فارغ'}</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {q ? 'جرّب كلمة أخرى.' : 'أرشف القضايا المنتهية من قائمة خيارات القضية.'}
              </p>
            </div>
          ) : (
            <ul
              className="divide-y overflow-hidden rounded-xl border bg-card"
              data-testid="list-archive"
            >
              {list.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
                  <button
                    type="button"
                    onClick={() => guardReportNavigation(() => navigate(`/cases/${c.id}`))}
                    className="min-w-0 flex-1 py-1 text-right"
                    data-testid={`button-open-archived-${c.id}`}
                  >
                    <span className="block truncate text-[14px] font-medium">
                      {c.title || 'قضية بدون عنوان'}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {c.clientName ? `${c.clientName} · ` : ''}أُرشفت{' '}
                      {c.archivedAt ? formatShortDate(c.archivedAt) : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`استعادة القضية ${c.title}`}
                    disabled={updateCase.isPending && updateCase.variables?.caseId === c.id}
                    onClick={() => restore(c)}
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium hover:bg-accent disabled:opacity-60"
                    data-testid={`button-restore-${c.id}`}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    <span className="hidden min-[380px]:inline">استعادة</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

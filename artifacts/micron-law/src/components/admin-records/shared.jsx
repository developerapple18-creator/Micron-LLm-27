import { ErrorNote, Skeleton } from '@/components/kit';
import { errorText } from '@/lib/session';
export const PAGE_SIZE = 20;
export const STALE_MS = 60_000;
export function formatDateTime(s) {
  try {
    return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'medium' }).format(
      new Date(s),
    );
  } catch {
    return s;
  }
}
const KNOWN = {
  document_accepted: 'قبول وثيقة',
  privacy_acknowledged: 'الإقرار بسياسة الخصوصية',
  login_success: 'تسجيل دخول ناجح',
  login_failed: 'محاولة دخول فاشلة',
  logout: 'تسجيل الخروج',
};
export function actionLabel(code) {
  if (KNOWN[code]) return KNOWN[code];
  if (code.startsWith('document_draft_saved:')) return 'حفظ مسودة وثيقة';
  if (code.startsWith('document_published:')) return 'نشر إصدار وثيقة';
  return 'إجراء غير معروف';
}
export function Evidence({ rows, testId }) {
  return (
    <dl
      className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[9rem_1fr]"
      data-testid={testId}
    >
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Raw({ children }) {
  return (
    <bdi dir="ltr" className="font-mono text-[12px] text-foreground/90">
      {children || '—'}
    </bdi>
  );
}
export function Pager({ offset, limit, total, onChange, name }) {
  if (total <= limit) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
      <span data-testid={`text-range-${name}`}>
        {from.toLocaleString('ar-SA')}–{to.toLocaleString('ar-SA')} من{' '}
        {total.toLocaleString('ar-SA')}
      </span>
      <div className="flex gap-1">
        <button
          disabled={offset <= 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          data-testid={`button-prev-${name}`}
          className="h-10 rounded-md border px-3 text-[13px] hover:bg-accent disabled:opacity-40"
        >
          السابق
        </button>
        <button
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
          data-testid={`button-next-${name}`}
          className="h-10 rounded-md border px-3 text-[13px] hover:bg-accent disabled:opacity-40"
        >
          التالي
        </button>
      </div>
    </div>
  );
}
export function QueryState({
  isLoading,
  isError,
  error,
  onRetry,
  empty,
  emptyText,
  fallback,
  name,
}) {
  if (isLoading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  if (isError)
    return (
      <div className="space-y-3">
        <ErrorNote>{errorText(error, fallback)}</ErrorNote>
        <button
          onClick={onRetry}
          data-testid={`button-retry-${name}`}
          className="h-10 rounded-md border px-4 text-[14px] hover:bg-accent"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  if (empty)
    return (
      <p
        className="rounded-lg border px-4 py-5 text-[13.5px] text-muted-foreground"
        data-testid={`text-empty-${name}`}
      >
        {emptyText}
      </p>
    );
  return null;
}
export function ReloadButton({ onClick, busy, name }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-testid={`button-reload-${name}`}
      className="h-9 rounded-md border px-3 text-[13px] hover:bg-accent disabled:opacity-40"
    >
      {busy ? 'جارٍ التحديث...' : 'تحديث'}
    </button>
  );
}

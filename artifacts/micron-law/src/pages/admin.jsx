import { useEffect, useMemo, useState } from 'react';
import { Link, Redirect } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAdminDocuments,
  getGetAdminDocumentsQueryKey,
  getGetLegalDocumentsQueryKey,
  useSaveDocumentDraft,
  usePublishDocument,
} from '@workspace/api-client-react';
import { Eye, UserRound } from 'lucide-react';
import { Brand, ErrorNote, Skeleton } from '@/components/kit';
import { ThemeToggle } from '@/components/theme';
import { DocReader, formatDate } from '@/components/doc-reader';
import { AccountDialog } from '@/pages/workspace';
import { LawyersPanel } from '@/components/admin-records/lawyers-panel';
import { AuditPanel } from '@/components/admin-records/audit-panel';
import { errorText, useCsrfRequest, useSession } from '@/lib/session';
const KINDS = [
  { id: 'terms', label: 'الشروط والأحكام' },
  { id: 'usage', label: 'سياسة الاستخدام' },
  { id: 'privacy', label: 'سياسة الخصوصية' },
];
const SECTIONS = [
  { id: 'documents', label: 'الوثائق' },
  { id: 'lawyers', label: 'المحامون' },
  { id: 'audit', label: 'سجل التدقيق' },
];
export default function Admin() {
  const session = useSession();
  const [account, setAccount] = useState(false);
  const [section, setSection] = useState('documents');
  if (session.isLoading)
    return (
      <div className="p-6">
        <Skeleton className="h-10 w-48" />
      </div>
    );
  if (session.isError)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorNote>تعذّر التحقق من الجلسة.</ErrorNote>
      </div>
    );
  if (session.data?.user?.role !== 'admin') return <Redirect to="/admin/login" />;
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background px-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/admin" data-testid="link-admin-home">
            <Brand />
          </Link>
          <span className="text-[13px] text-muted-foreground">الإدارة</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={() => setAccount(true)}
            data-testid="button-account"
            aria-label="الحساب"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <UserRound className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>
      <nav
        className="mx-auto flex w-full max-w-4xl gap-1 overflow-x-auto px-4 pt-4 sm:px-6"
        aria-label="أقسام الإدارة"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            aria-current={section === s.id ? 'page' : undefined}
            data-testid={`nav-${s.id}`}
            className={`h-9 shrink-0 rounded-md px-3 text-[13.5px] ${section === s.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {section === 'documents' && <Documents />}
      {section === 'lawyers' && (
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <h1 className="text-[22px] font-semibold tracking-tight">المحامون المسجّلون</h1>
          <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
            عرض للقراءة فقط. اختر محاميًا لعرض سجل قبوله للوثائق بإصداراتها الدقيقة.
          </p>
          <LawyersPanel userId={session.data.user.id} />
        </main>
      )}
      {section === 'audit' && (
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <h1 className="text-[22px] font-semibold tracking-tight">سجل التدقيق</h1>
          <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
            عرض للقراءة فقط للأدلة التقنية كما خُزّنت.
          </p>
          <AuditPanel userId={session.data.user.id} />
        </main>
      )}
      <AccountDialog open={account} onOpenChange={setAccount} />
    </div>
  );
}
function Documents() {
  const [kind, setKind] = useState('terms');
  const q = useGetAdminDocuments({ query: { queryKey: getGetAdminDocumentsQueryKey() } });
  const list = useMemo(() => q.data ?? [], [q.data]);
  const status = (k) => {
    const pub = list
      .filter((d) => d.kind === k && d.published)
      .sort((a, b) => b.version - a.version)[0];
    return pub ? `منشور · الإصدار ${pub.version}` : 'غير منشور';
  };
  const allPublished = KINDS.every((k) => list.some((d) => d.kind === k.id && d.published));
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-[22px] font-semibold tracking-tight">الوثائق القانونية</h1>
      <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
        يتطلب التسجيل نشر الوثائق الثلاث. الإصدارات المنشورة لا تُعدّل؛ كل نشر جديد ينشئ إصدارًا
        جديدًا.
      </p>
      {!q.isLoading && !q.isError && (
        <p className="mt-4 text-[13px]" data-testid="status-registration">
          حالة التسجيل:{' '}
          <span className="font-medium">
            {allPublished ? 'متاح' : 'متوقف حتى نشر جميع الوثائق'}
          </span>
        </p>
      )}
      <div className="mt-6 flex gap-1 overflow-x-auto border-b" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.id}
            role="tab"
            aria-selected={kind === k.id}
            onClick={() => setKind(k.id)}
            data-testid={`tab-${k.id}`}
            className={`-mb-px shrink-0 border-b-2 px-3 py-3 text-right ${kind === k.id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <span className="block text-[14px] font-medium">{k.label}</span>
            {!q.isLoading && (
              <span className="block text-[11.5px] text-muted-foreground">{status(k.id)}</span>
            )}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-12" />
        </div>
      ) : q.isError ? (
        <div className="mt-6 space-y-3">
          <ErrorNote>{errorText(q.error, 'تعذّر تحميل الوثائق.')}</ErrorNote>
          <button
            onClick={() => q.refetch()}
            data-testid="button-retry"
            className="h-10 rounded-md border px-4 text-[14px] hover:bg-accent"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <KindEditor key={kind} kind={kind} docs={list.filter((d) => d.kind === kind)} />
      )}
    </main>
  );
}
function KindEditor({ kind, docs }) {
  const qc = useQueryClient();
  const request = useCsrfRequest();
  const sorted = useMemo(() => [...docs].sort((a, b) => b.version - a.version), [docs]);
  const draft = sorted.find((d) => !d.published);
  const [content, setContent] = useState(draft?.content ?? '');
  const [testing, setTesting] = useState(draft?.testing ?? false);
  const [reading, setReading] = useState(null);
  const [savedMsg, setSavedMsg] = useState('');
  const draftId = draft?.id;
  useEffect(() => {
    setSavedMsg('');
  }, [content, testing]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetAdminDocumentsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetLegalDocumentsQueryKey() });
  };
  const save = useSaveDocumentDraft({
    request,
    mutation: {
      onSuccess: () => {
        refresh();
        setSavedMsg('تم حفظ المسودة.');
      },
    },
  });
  const publish = usePublishDocument({
    request,
    mutation: {
      onSuccess: () => {
        refresh();
        setSavedMsg('تم نشر الإصدار.');
      },
    },
  });
  const dirty = content !== (draft?.content ?? '') || testing !== (draft?.testing ?? false);
  return (
    <div className="mt-6 space-y-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="doc-content" className="text-[13px] font-medium text-foreground/80">
            {draft ? `مسودة الإصدار ${draft.version}` : 'مسودة جديدة'}
          </label>
          <span className="text-[11.5px] text-muted-foreground">
            {content.length.toLocaleString('ar-SA')} حرف
          </span>
        </div>
        <textarea
          id="doc-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={16}
          maxLength={100000}
          placeholder="اكتب نص الوثيقة كما سيظهر للمستخدمين."
          data-testid="input-doc-content"
          className="block w-full resize-y rounded-lg border border-input bg-card px-4 py-3 text-[14.5px] leading-8 outline-none focus:border-foreground/40"
        />
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 text-[13.5px]">
          <input
            type="checkbox"
            checked={testing}
            onChange={(e) => setTesting(e.target.checked)}
            data-testid="checkbox-testing"
            className="h-[18px] w-[18px] accent-current"
          />
          نسخة تجريبية (للاختبار)
        </label>
        {(save.isError || publish.isError) && (
          <div className="mt-3">
            <ErrorNote>{errorText(save.error ?? publish.error)}</ErrorNote>
          </div>
        )}
        {savedMsg && (
          <p
            className="mt-3 text-[13px] text-muted-foreground"
            data-testid="text-saved"
            role="status"
          >
            {savedMsg}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => save.mutate({ data: { kind, content, testing } })}
            disabled={!content.trim() || !dirty || save.isPending}
            data-testid="button-save-draft"
            className="h-11 rounded-lg border px-5 text-[14px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? 'جارٍ الحفظ...' : 'حفظ المسودة'}
          </button>
          <button
            onClick={() => draftId && publish.mutate({ id: draftId })}
            disabled={!draftId || dirty || publish.isPending}
            data-testid="button-publish"
            className="h-11 rounded-lg bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {publish.isPending ? 'جارٍ النشر...' : 'نشر المسودة'}
          </button>
        </div>
        {dirty && draftId && (
          <p className="mt-2 text-[12px] text-muted-foreground">احفظ التعديلات قبل النشر.</p>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-foreground/80">السجل</h2>
        {sorted.length === 0 ? (
          <p
            className="rounded-lg border px-4 py-5 text-[13.5px] text-muted-foreground"
            data-testid="text-history-empty"
          >
            لا توجد إصدارات بعد.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {sorted.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 px-4 py-3"
                data-testid={`row-doc-${d.id}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">الإصدار {d.version}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {formatDate(d.createdAt)}
                    {d.testing ? ' · تجريبية' : ''}
                  </span>
                </span>
                <span
                  className={`rounded border px-2 text-[11.5px] leading-6 ${d.published ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {d.published ? 'منشور' : 'مسودة'}
                </span>
                <button
                  onClick={() => setReading(d)}
                  aria-label="عرض"
                  data-testid={`button-view-${d.id}`}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <DocReader doc={reading} onClose={() => setReading(null)} />
    </div>
  );
}

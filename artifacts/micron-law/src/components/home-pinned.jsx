/** Home "saved work": pinned cases, folders and clients with real unpin, collapse and inline folder contents. */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  ChevronDown,
  ChevronLeft,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Pin,
  PinOff,
  UserRound,
  Users,
} from 'lucide-react';
import { Skeleton } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { formatShortDate } from '@/lib/case-drafts';
import { guardReportNavigation } from '@/lib/report-draft-guard';
import { mutationErrorText, useFolders, useRenameFolder, useUpdateCase } from '@/lib/report-api';
import { useClients, usePinClient } from '@/lib/workspace-api';
const LIMIT = 6;
const ICON = { case: FileText, folder: Folder, client: UserRound };
const KIND_LABEL = { case: 'قضية', folder: 'مجلد', client: 'موكل' };
export function HomePinned({
  cases,
  casesLoading,
  casesError,
  onRetryCases,
  onOpenClient,
  onClients,
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const folders = useFolders(true);
  const clients = useClients(true);
  const updateCase = useUpdateCase();
  const renameFolder = useRenameFolder();
  const pinClient = usePinClient();
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(new Set());
  const items = useMemo(() => {
    const out = [];
    for (const c of cases)
      if (c.pinned)
        out.push({
          kind: 'case',
          id: c.id,
          title: c.title || 'قضية بدون عنوان',
          meta: c.clientName || 'دون موكل',
          updatedAt: c.updatedAt,
        });
    for (const f of folders.data ?? [])
      if (f.pinned) {
        const n = cases.filter((c) => c.folderId === f.id).length;
        out.push({
          kind: 'folder',
          id: f.id,
          title: f.name,
          meta: `${n.toLocaleString('ar-SA')} قضية`,
          updatedAt: f.updatedAt,
        });
      }
    for (const c of clients.data ?? [])
      if (c.pinned)
        out.push({
          kind: 'client',
          id: c.id,
          title: c.name,
          meta: c.reference || (c.type === 'organization' ? 'جهة' : 'موكل'),
          updatedAt: c.updatedAt,
        });
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [cases, folders.data, clients.data]);
  const counts = { case: 0, folder: 0, client: 0 };
  items.forEach((i) => {
    counts[i.kind] += 1;
  });
  const visible = all ? items : items.slice(0, LIMIT);
  const loading = casesLoading || folders.isLoading || clients.isLoading;
  const release = (key) =>
    setBusy((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
  const unpin = (it) => {
    const key = `${it.kind}:${it.id}`;
    if (busy.has(key)) return;
    setBusy((s) => new Set(s).add(key));
    const opts = {
      onSuccess: () => toast({ title: `أُلغي تثبيت ${KIND_LABEL[it.kind]}` }),
      onError: (e) =>
        toast({
          title: 'تعذّر إلغاء التثبيت',
          description: mutationErrorText(e, 'حاول مرة أخرى.'),
          variant: 'destructive',
        }),
      onSettled: () => release(key),
    };
    if (it.kind === 'case') updateCase.mutate({ caseId: it.id, pinned: false }, opts);
    else if (it.kind === 'folder') renameFolder.mutate({ id: it.id, pinned: false }, opts);
    else pinClient.mutate({ clientId: it.id, data: { pinned: false } }, opts);
  };
  const openCase = (id) => guardReportNavigation(() => navigate(`/cases/${id}`));
  const activate = (it) => {
    if (it.kind === 'case') openCase(it.id);
    else if (it.kind === 'client') onOpenClient(it.id);
    else setExpanded((e) => (e === it.id ? null : it.id));
  };
  return (
    <section className="mt-7" data-testid="section-home-pinned">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="home-pinned-body"
          data-testid="button-toggle-home-pinned"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-[14px] font-semibold">المثبتة</span>
          {items.length > 0 && (
            <span
              className="rounded-full bg-muted px-2 text-[11.5px] leading-5 tabular-nums text-muted-foreground"
              data-testid="text-home-pinned-count"
            >
              {items.length.toLocaleString('ar-SA')}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? '' : 'rotate-90'}`}
            aria-hidden
          />
        </button>
        <button
          type="button"
          onClick={onClients}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid="button-home-clients"
        >
          <Users className="h-4 w-4" />
          الموكلون
        </button>
      </div>
      {open && (
        <div id="home-pinned-body" className="mt-2">
          {items.length > 0 && (
            <p className="mb-2 text-[12px] text-muted-foreground">
              {['case', 'folder', 'client']
                .filter((k) => counts[k])
                .map((k) => `${counts[k].toLocaleString('ar-SA')} ${KIND_LABEL[k]}`)
                .join(' · ')}
            </p>
          )}
          {loading && items.length === 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-[60px] w-full rounded-lg" />
              ))}
            </div>
          ) : casesError ? (
            <div
              className="rounded-lg border p-3 text-[13px] text-muted-foreground"
              data-testid="text-home-pinned-error"
            >
              تعذّر تحميل القضايا.{' '}
              <button
                onClick={onRetryCases}
                className="font-medium text-foreground underline"
                data-testid="button-retry-home-pinned"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : items.length === 0 ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-[13px] leading-6 text-muted-foreground"
              data-testid="text-home-pinned-empty"
            >
              <PinOff className="mt-1 h-4 w-4 shrink-0" aria-hidden />
              <span>
                لا يوجد شيء مثبت. ثبّت قضية أو مجلدًا من قائمة الخيارات في الشريط الجانبي، أو موكلًا
                من صفحة الموكلين.
              </span>
            </div>
          ) : (
            <>
              <ul className="grid gap-2 sm:grid-cols-2" data-testid="list-home-pinned">
                {visible.map((it) => {
                  const key = `${it.kind}:${it.id}`;
                  const isOpen = it.kind === 'folder' && expanded === it.id;
                  const Icon = isOpen ? FolderOpen : ICON[it.kind];
                  const inFolder = isOpen ? cases.filter((c) => c.folderId === it.id) : [];
                  return (
                    <li
                      key={key}
                      className={`min-w-0 rounded-lg border bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] transition-shadow duration-200 hover:shadow-[0_4px_14px_-8px_hsl(var(--foreground)/0.25)] motion-reduce:transition-none ${isOpen ? 'sm:col-span-2' : ''}`}
                    >
                      <div className="flex items-center">
                        <button
                          type="button"
                          onClick={() => activate(it)}
                          data-testid={`button-open-pinned-${it.kind}-${it.id}`}
                          aria-expanded={it.kind === 'folder' ? isOpen : undefined}
                          className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 rounded-lg py-2 ps-3 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/80">
                            <Icon className="h-[18px] w-[18px]" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium leading-6">
                              {it.title}
                            </span>
                            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                              <span className="shrink-0">{KIND_LABEL[it.kind]}</span>
                              <span aria-hidden>·</span>
                              <span className="min-w-0 truncate">{it.meta}</span>
                              {it.kind === 'case' && (
                                <span className="shrink-0">· {formatShortDate(it.updatedAt)}</span>
                              )}
                            </span>
                          </span>
                          {it.kind === 'folder' ? (
                            <ChevronDown
                              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${isOpen ? '' : 'rotate-90'}`}
                              aria-hidden
                            />
                          ) : (
                            <ChevronLeft
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => unpin(it)}
                          disabled={busy.has(key)}
                          aria-label={`إلغاء تثبيت ${it.title}`}
                          data-testid={`button-unpin-${it.kind}-${it.id}`}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                        >
                          {busy.has(key) ? (
                            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                          ) : (
                            <PinOff className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {isOpen && (
                        <div
                          className="border-t px-2 py-1.5"
                          data-testid={`list-folder-cases-${it.id}`}
                        >
                          {inFolder.length === 0 ? (
                            <p className="px-2 py-2 text-[12.5px] text-muted-foreground">
                              لا توجد قضايا نشطة في هذا المجلد.
                            </p>
                          ) : (
                            <ul className="space-y-0.5">
                              {inFolder.map((c) => (
                                <li key={c.id}>
                                  <button
                                    type="button"
                                    onClick={() => openCase(c.id)}
                                    data-testid={`button-folder-case-${c.id}`}
                                    className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-right text-[13.5px] hover:bg-accent"
                                  >
                                    <FileText
                                      className="h-4 w-4 shrink-0 text-muted-foreground"
                                      aria-hidden
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                      {c.title || 'قضية بدون عنوان'}
                                    </span>
                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                      {formatShortDate(c.updatedAt)}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {items.length > LIMIT && (
                <button
                  type="button"
                  onClick={() => setAll((a) => !a)}
                  aria-expanded={all}
                  data-testid="button-more-home-pinned"
                  className="mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {all
                    ? 'عرض أقل'
                    : `عرض المزيد (${(items.length - LIMIT).toLocaleString('ar-SA')})`}
                </button>
              )}
              {(folders.isError || clients.isError) && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  تعذّر تحميل بعض العناصر المثبتة.{' '}
                  <button
                    className="underline"
                    onClick={() => {
                      void folders.refetch();
                      void clients.refetch();
                    }}
                    data-testid="button-retry-pinned-extra"
                  >
                    إعادة
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

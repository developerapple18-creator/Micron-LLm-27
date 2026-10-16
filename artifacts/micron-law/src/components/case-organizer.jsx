/**
 * Saved-case organization: title search, flat folders (create/rename, no
 * delete or nesting), sort, case rename and move. Mobile-safe controls.
 */
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { guardReportNavigation, hasReportDraft } from '@/lib/report-draft-guard';
import {
  Archive,
  ChevronDown,
  Clock3,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Skeleton } from '@/components/kit';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { formatShortDate } from '@/lib/case-drafts';
import {
  mutationErrorText,
  useCreateFolder,
  useFolders,
  useRenameFolder,
  useUpdateCase,
} from '@/lib/report-api';
const CTRL =
  'min-h-10 w-full rounded-md border bg-background px-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const BTN =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-[13.5px] font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const PAGE = 6;
const ROW = 'group flex items-center rounded-md';
const MENU_BTN =
  'inline-flex h-10 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent';
function Section({ id, title, icon: Icon, count, open, onToggle, action, children }) {
  return (
    <section className="pt-2" data-testid={`section-${id}`}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`sec-${id}`}
          data-testid={`button-toggle-${id}`}
          className="flex min-h-9 flex-1 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{title}</span>
          <span className="tabular-nums opacity-70">{count.toLocaleString('ar-SA')}</span>
          <ChevronDown
            className={`ms-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? '' : 'rotate-90'}`}
            aria-hidden
          />
        </button>
        {action}
      </div>
      {open && <div id={`sec-${id}`}>{children}</div>}
    </section>
  );
}
function More({ total, shown, onMore, id }) {
  if (total <= shown) return null;
  return (
    <button
      type="button"
      onClick={onMore}
      data-testid={`button-more-${id}`}
      className="mt-0.5 flex min-h-9 w-full items-center rounded-md px-2 text-[12.5px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
    >
      عرض المزيد ({(total - shown).toLocaleString('ar-SA')})
    </button>
  );
}
export function CaseOrganizer({ cases, activeCaseId, onOpenCase }) {
  const [, navigate] = useLocation();
  const folders = useFolders(true);
  const updateCase = useUpdateCase();
  const renameFolder = useRenameFolder();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('all');
  const [sort, setSort] = useState('recent');
  const [edit, setEdit] = useState(null);
  const [openSec, setOpenSec] = useState({ pinned: true, folders: true, recent: true });
  const [limit, setLimit] = useState({ pinned: PAGE, folders: PAGE, recent: PAGE });
  const toggleSec = (k) => setOpenSec((p) => ({ ...p, [k]: !p[k] }));
  const more = (k) => setLimit((p) => ({ ...p, [k]: p[k] + PAGE * 2 }));
  const byTitle = (a, b) => (a.title ?? a.name ?? '').localeCompare(b.title ?? b.name ?? '', 'ar');
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return cases
      .filter((c) => !term || (c.title || '').toLowerCase().includes(term))
      .filter((c) => folder === 'all' || (folder === 'none' ? !c.folderId : c.folderId === folder))
      .sort((a, b) => (sort === 'title' ? byTitle(a, b) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [cases, q, folder, sort]);
  const folderList = useMemo(
    () =>
      [...(folders.data ?? [])].sort(
        sort === 'title' ? byTitle : (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      ),
    [folders.data, sort],
  );
  const pinnedFolders = folderList.filter((f) => f.pinned);
  const pinnedCases = shown.filter((c) => c.pinned);
  const pinnedCount = pinnedFolders.length + pinnedCases.length;
  const filtered = q.trim() !== '' || folder !== 'all';
  const current = folders.data?.find((f) => f.id === folder);
  const pinCase = (c) =>
    updateCase.mutate(
      { caseId: c.id, pinned: !c.pinned },
      {
        onSuccess: () => toast({ title: c.pinned ? 'أُلغي تثبيت القضية' : 'ثُبّتت القضية' }),
        onError: (e) =>
          toast({
            title: 'تعذّر الحفظ',
            description: mutationErrorText(e, 'حاول مرة أخرى.'),
            variant: 'destructive',
          }),
      },
    );
  const archiveCase = (c) =>
    updateCase.mutate(
      { caseId: c.id, archived: true },
      {
        onSuccess: () =>
          toast({
            title: 'أُرشفت القضية',
            description: 'محفوظة بالكامل؛ استعدها من الأرشيف أسفل القائمة.',
          }),
        onError: (e) =>
          toast({
            title: 'تعذّرت الأرشفة',
            description: mutationErrorText(e, 'حاول مرة أخرى.'),
            variant: 'destructive',
          }),
      },
    );
  const pinFolder = (f) =>
    renameFolder.mutate(
      { id: f.id, pinned: !f.pinned },
      {
        onSuccess: () => toast({ title: f.pinned ? 'أُلغي تثبيت المجلد' : 'ثُبّت المجلد' }),
        onError: (e) =>
          toast({
            title: 'تعذّر الحفظ',
            description: mutationErrorText(e, 'حاول مرة أخرى.'),
            variant: 'destructive',
          }),
      },
    );
  const caseRow = (c, scope) => (
    <li
      key={`${scope}-${c.id}`}
      className={`${ROW} ${activeCaseId === c.id ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent'}`}
    >
      <Link
        href={`/cases/${c.id}`}
        onClick={(e) => {
          if (
            c.id !== activeCaseId &&
            hasReportDraft() &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey &&
            !e.altKey
          ) {
            e.preventDefault();
            guardReportNavigation(() => {
              navigate(`/cases/${c.id}`);
              onOpenCase();
            });
            return;
          }
          onOpenCase();
        }}
        data-testid={`link-case-${scope}-${c.id}`}
        aria-current={activeCaseId === c.id ? 'page' : undefined}
        className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 py-2 ps-2 text-[13.5px] ${activeCaseId === c.id ? 'font-medium text-foreground' : 'text-sidebar-foreground'}`}
      >
        {c.pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="مثبتة" />}
        <span className="min-w-0 flex-1 truncate">{c.title || 'قضية بدون عنوان'}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatShortDate(c.updatedAt)}
        </span>
      </Link>
      <DropdownMenu dir="rtl" modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`خيارات ${c.title || 'القضية'}`}
            data-testid={`button-case-menu-${scope}-${c.id}`}
            className={MENU_BTN}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={12} className="w-48">
          <DropdownMenuItem
            className="min-h-10 gap-2 text-[13.5px]"
            onSelect={() => setEdit({ type: 'rename-case', c })}
            data-testid={`menuitem-rename-case-${c.id}`}
          >
            <PencilLine className="h-4 w-4" />
            إعادة تسمية
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-10 gap-2 text-[13.5px]"
            onSelect={() => pinCase(c)}
            data-testid={`menuitem-pin-case-${c.id}`}
          >
            {c.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {c.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-10 gap-2 text-[13.5px]"
            onSelect={() => setEdit({ type: 'move-case', c })}
            data-testid={`menuitem-move-case-${c.id}`}
          >
            <FolderInput className="h-4 w-4" />
            نقل إلى مجلد
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-10 gap-2 text-[13.5px]"
            onSelect={() => archiveCase(c)}
            data-testid={`menuitem-archive-case-${c.id}`}
          >
            <Archive className="h-4 w-4" />
            أرشفة
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
  const folderRow = (f, scope) => {
    const n = cases.filter((c) => c.folderId === f.id).length;
    const on = folder === f.id;
    return (
      <li
        key={`${scope}-${f.id}`}
        className={`${ROW} ${on ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent'}`}
      >
        <button
          type="button"
          onClick={() => setFolder(on ? 'all' : f.id)}
          aria-pressed={on}
          data-testid={`button-folder-${scope}-${f.id}`}
          className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 py-2 ps-2 text-right text-[13.5px] ${on ? 'font-medium text-foreground' : 'text-sidebar-foreground'}`}
        >
          {on ? (
            <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {f.pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="مثبت" />}
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {n.toLocaleString('ar-SA')}
          </span>
        </button>
        <DropdownMenu dir="rtl" modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`خيارات مجلد ${f.name}`}
              data-testid={`button-folder-menu-${scope}-${f.id}`}
              className={MENU_BTN}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={12} className="w-48">
            <DropdownMenuItem
              className="min-h-10 gap-2 text-[13.5px]"
              onSelect={() => setFolder(f.id)}
              data-testid={`menuitem-open-folder-${f.id}`}
            >
              <FolderOpen className="h-4 w-4" />
              عرض قضاياه
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-10 gap-2 text-[13.5px]"
              onSelect={() => setEdit({ type: 'rename-folder', id: f.id, name: f.name })}
              data-testid={`menuitem-rename-folder-${f.id}`}
            >
              <PencilLine className="h-4 w-4" />
              إعادة تسمية
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-10 gap-2 text-[13.5px]"
              onSelect={() => pinFolder(f)}
              data-testid={`menuitem-pin-folder-${f.id}`}
            >
              {f.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              {f.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };
  const recentTitle =
    folder === 'all'
      ? 'القضايا الأخيرة'
      : folder === 'none'
        ? 'قضايا دون مجلد'
        : `قضايا: ${current?.name ?? 'المجلد'}`;
  return (
    <div data-testid="case-organizer">
      <div className="flex items-center gap-1 px-1 pb-1">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث في العناوين"
            aria-label="بحث في عناوين القضايا"
            data-testid="input-search-cases"
            className={`${CTRL} pr-8`}
          />
        </div>
        <DropdownMenu dir="rtl" modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="تصفية وترتيب"
              data-testid="button-filter-menu"
              className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${folder !== 'all' || sort !== 'recent' ? 'text-foreground' : ''}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {(folder !== 'all' || sort !== 'recent') && (
                <span
                  className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground"
                  aria-hidden
                />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            collisionPadding={12}
            className="max-h-[60dvh] w-56 overflow-y-auto"
          >
            <DropdownMenuLabel className="text-[11.5px] text-muted-foreground">
              الترتيب
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v)}>
              <DropdownMenuRadioItem
                value="recent"
                className="min-h-9 text-[13.5px]"
                data-testid="radio-sort-recent"
              >
                الأحدث
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="title"
                className="min-h-9 text-[13.5px]"
                data-testid="radio-sort-title"
              >
                العنوان
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11.5px] text-muted-foreground">
              عرض
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={folder} onValueChange={setFolder}>
              <DropdownMenuRadioItem
                value="all"
                className="min-h-9 text-[13.5px]"
                data-testid="radio-folder-all"
              >
                كل القضايا
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="none"
                className="min-h-9 text-[13.5px]"
                data-testid="radio-folder-none"
              >
                دون مجلد
              </DropdownMenuRadioItem>
              {folderList.map((f) => (
                <DropdownMenuRadioItem key={f.id} value={f.id} className="min-h-9 text-[13.5px]">
                  <span className="truncate">{f.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {folder !== 'all' && (
        <div className="mx-1 mb-1 flex items-center gap-1 rounded-md bg-sidebar-accent/70 ps-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate">
            {folder === 'none' ? 'دون مجلد' : (current?.name ?? 'مجلد')}
          </span>
          <button
            type="button"
            onClick={() => setFolder('all')}
            aria-label="إزالة التصفية"
            data-testid="button-clear-filter"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {pinnedCount > 0 && (
        <Section
          id="pinned"
          icon={Pin}
          title="المثبتة"
          count={pinnedCount}
          open={openSec.pinned}
          onToggle={() => toggleSec('pinned')}
        >
          <ul className="space-y-0.5" data-testid="list-pinned">
            {[
              ...pinnedFolders.map((f) => folderRow(f, 'pin')),
              ...pinnedCases.map((c) => caseRow(c, 'pin')),
            ].slice(0, limit.pinned)}
          </ul>
          <More
            id="pinned"
            total={pinnedCount}
            shown={limit.pinned}
            onMore={() => more('pinned')}
          />
        </Section>
      )}

      <Section
        id="folders"
        icon={Folder}
        title="المجلدات"
        count={folderList.length}
        open={openSec.folders}
        onToggle={() => toggleSec('folders')}
        action={
          <button
            type="button"
            onClick={() => setEdit({ type: 'new-folder' })}
            aria-label="مجلد جديد"
            data-testid="button-new-folder"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        }
      >
        {folders.isLoading ? (
          <div className="px-2 py-1">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : folders.isError ? (
          <p className="px-2 text-[11.5px] text-muted-foreground">
            تعذّر تحميل المجلدات.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => void folders.refetch()}
              data-testid="button-retry-folders"
            >
              إعادة
            </button>
          </p>
        ) : folderList.length === 0 ? (
          <p className="px-2 py-1 text-[12px] leading-6 text-muted-foreground">
            لا مجلدات بعد. أنشئ مجلدًا لتنظيم القضايا.
          </p>
        ) : (
          <>
            <ul className="space-y-0.5" data-testid="list-folders">
              {folderList.slice(0, limit.folders).map((f) => folderRow(f, 'all'))}
            </ul>
            <More
              id="folders"
              total={folderList.length}
              shown={limit.folders}
              onMore={() => more('folders')}
            />
          </>
        )}
      </Section>

      <Section
        id="recent"
        icon={Clock3}
        title={recentTitle}
        count={shown.length}
        open={openSec.recent}
        onToggle={() => toggleSec('recent')}
      >
        {shown.length === 0 ? (
          <p
            className="px-2 py-2 text-[12.5px] leading-6 text-muted-foreground"
            data-testid="text-no-matches"
          >
            {filtered ? 'لا توجد قضايا مطابقة.' : 'لا توجد قضايا.'}
          </p>
        ) : (
          <>
            <ul className="space-y-0.5" data-testid="list-cases">
              {shown.slice(0, limit.recent).map((c) => caseRow(c, 'list'))}
            </ul>
            <More
              id="recent"
              total={shown.length}
              shown={limit.recent}
              onMore={() => more('recent')}
            />
          </>
        )}
      </Section>
      {edit && <EditDialog edit={edit} folders={folderList} onClose={() => setEdit(null)} />}
    </div>
  );
}
function EditDialog({ edit, folders, onClose }) {
  const createFolder = useCreateFolder();
  const renameFolder = useRenameFolder();
  const updateCase = useUpdateCase();
  const { toast } = useToast();
  const initial =
    edit.type === 'rename-folder'
      ? edit.name
      : edit.type === 'rename-case'
        ? edit.c.title
        : edit.type === 'move-case'
          ? (edit.c.folderId ?? '')
          : '';
  const [value, setValue] = useState(initial);
  const pending = createFolder.isPending || renameFolder.isPending || updateCase.isPending;
  const error = createFolder.error ?? renameFolder.error ?? updateCase.error;
  const title = {
    'new-folder': 'مجلد جديد',
    'rename-folder': 'إعادة تسمية المجلد',
    'rename-case': 'إعادة تسمية القضية',
    'move-case': 'نقل القضية إلى مجلد',
  }[edit.type];
  const done = (msg) => {
    toast({ title: msg });
    onClose();
  };
  const submit = () => {
    const v = value.trim();
    if (pending) return;
    if (edit.type === 'move-case')
      return updateCase.mutate(
        { caseId: edit.c.id, folderId: v || null },
        { onSuccess: () => done('نُقلت القضية') },
      );
    if (!v) return;
    if (edit.type === 'new-folder')
      createFolder.mutate(v, { onSuccess: () => done('أُنشئ المجلد') });
    else if (edit.type === 'rename-folder')
      renameFolder.mutate(
        { id: edit.id, name: v },
        { onSuccess: () => done('أُعيدت تسمية المجلد') },
      );
    else
      updateCase.mutate(
        { caseId: edit.c.id, title: v },
        { onSuccess: () => done('أُعيدت تسمية القضية') },
      );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="w-[calc(100%_-_1.5rem)] max-w-sm rounded-xl p-5 text-right"
      >
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="pl-8 text-[16px]">{title}</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {edit.type === 'move-case' ? 'المجلدات مسطحة؛ لا يُحذف شيء.' : 'الحد الأقصى 120 حرفًا.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          {edit.type === 'move-case' ? (
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="المجلد"
              data-testid="select-move-folder"
              className={CTRL}
            >
              <option value="">دون مجلد</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={120}
              aria-label={title}
              data-testid="input-organizer-name"
              className={CTRL}
            />
          )}
          {error && (
            <p role="alert" className="text-[12.5px] text-destructive">
              {mutationErrorText(error, 'تعذّر الحفظ. حاول مرة أخرى.')}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || (edit.type !== 'move-case' && !value.trim())}
              data-testid="button-organizer-save"
              className={`${BTN} border-foreground bg-foreground text-background hover:bg-foreground/90`}
            >
              {pending ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button
              type="button"
              className={BTN}
              onClick={onClose}
              data-testid="button-organizer-cancel"
            >
              إلغاء
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

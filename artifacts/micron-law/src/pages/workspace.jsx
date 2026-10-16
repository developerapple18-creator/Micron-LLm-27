import { useMemo, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { guardReportNavigation } from '@/lib/report-draft-guard';
import { ReportDraftGuard } from '@/components/report-draft-guard';
import { useQueryClient } from '@tanstack/react-query';
import {
  useLogout,
  getSession,
  getGetSessionQueryKey,
  useListCases,
} from '@workspace/api-client-react';
import {
  Archive,
  ArrowLeft,
  Briefcase,
  FileSearch,
  FileText,
  FolderOpen,
  ShieldCheck,
  Gavel,
  LogIn,
  LogOut,
  Menu,
  ChevronDown,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Scale,
  ScrollText,
  Landmark,
  UserRound,
  Users,
} from 'lucide-react';
import { ClientsPanel } from '@/components/clients-panel';
import { ArchivePanel } from '@/components/archive-panel';
import { CaseManageDialog } from '@/components/case-manage-dialog';
import { HomePinned } from '@/components/home-pinned';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Brand, ErrorNote, PrimaryButton, Skeleton } from '@/components/kit';
import { ThemeToggle } from '@/components/theme';
import { CaseView } from '@/components/case-view';
import { CaseOrganizer } from '@/components/case-organizer';
import { listKey, useCaseWorkspace } from '@/hooks/use-case-workspace';
import { UUID_RE } from '@/lib/case-drafts';
import { useVisualViewport } from '@/lib/use-visual-viewport';
import { errorText, roleLabel, useCsrfRequest, useSession } from '@/lib/session';
const TASKS = [
  {
    id: 'analysis',
    label: 'تحليل القضية',
    icon: FileSearch,
    enabled: true,
    desc: 'قضايا ومحادثات ومرفقات محفوظة، وتحليل قانوني منظم لوقائعك ومستنداتك.',
  },
  {
    id: 'pleadings',
    label: 'صياغة الصحف والمذكرات القضائية',
    icon: FileText,
    enabled: false,
    desc: 'صحف الدعوى والمذكرات الجوابية.',
  },
  {
    id: 'appeal',
    label: 'الاستئناف',
    icon: Scale,
    enabled: false,
    desc: 'لوائح الاعتراض بطلب الاستئناف.',
  },
  {
    id: 'cassation',
    label: 'النقض',
    icon: Gavel,
    enabled: false,
    desc: 'طلبات النقض أمام المحكمة العليا.',
  },
  {
    id: 'expert',
    label: 'تقارير الخبرة القضائية',
    icon: Landmark,
    enabled: false,
    desc: 'مراجعة تقارير الخبراء والرد عليها.',
  },
  {
    id: 'contracts',
    label: 'العقود',
    icon: ScrollText,
    enabled: false,
    desc: 'صياغة العقود ومراجعتها.',
  },
];
// `/` and `/cases/:caseId` both render this component. All per-user state
// (drafts, uploads, pending sends) is remounted when the signed-in user changes.
export default function Workspace() {
  const session = useSession();
  return <WorkspaceInner key={session.data?.user?.id ?? 'anonymous'} />;
}
function WorkspaceInner() {
  const viewport = useVisualViewport();
  const session = useSession();
  const user = session.data?.user ?? null;
  const isLawyer = user?.role === 'lawyer';
  const [, navigate] = useLocation();
  const [onCase, params] = useRoute('/cases/:caseId');
  const routeCaseId = onCase ? params.caseId : null;
  const caseId = routeCaseId && UUID_RE.test(routeCaseId) ? routeCaseId.toLowerCase() : null;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const active = routeCaseId ? 'analysis' : picked;
  const [signInPrompt, setSignInPrompt] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [panel, setPanel] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [focusClient, setFocusClient] = useState(null);
  const userId = user?.id ?? '';
  const cases = useListCases({
    query: {
      queryKey: listKey(userId),
      enabled: isLawyer,
      staleTime: 15_000,
      refetchOnMount: true,
      retry: 1,
    },
  });
  const ws = useCaseWorkspace({
    userId,
    viewCaseId: caseId,
    onCreated: (id, wasViewingNew) => {
      if (wasViewingNew) navigate(`/cases/${id}`, { replace: true });
    },
  });
  const guard = (fn) => {
    if (!user) {
      setSignInPrompt(true);
      return;
    }
    guardReportNavigation(fn);
  };
  const selectTask = (id) =>
    guard(() => {
      setPanel(null);
      setPicked(id);
      setMobileOpen(false);
      if (routeCaseId) navigate('/');
    });
  const newTask = () =>
    guard(() => {
      setPanel(null);
      setPicked(null);
      setMobileOpen(false);
      if (routeCaseId) navigate('/');
    });
  const openPanel = (p) =>
    guard(() => {
      setFocusClient(null);
      setPanel(p);
      setPicked(null);
      setMobileOpen(false);
      if (routeCaseId) navigate('/');
    });
  const openClient = (id) =>
    guard(() => {
      setFocusClient((f) => ({ id, n: (f?.n ?? 0) + 1 }));
      setPanel('clients');
      setPicked(null);
      setMobileOpen(false);
      if (routeCaseId) navigate('/');
    });
  const activeCase = caseId ? cases.data?.find((c) => c.id === caseId) : undefined;
  const activeCases = useMemo(() => (cases.data ?? []).filter((c) => !c.archivedAt), [cases.data]);
  const archivedCases = useMemo(
    () => (cases.data ?? []).filter((c) => !!c.archivedAt),
    [cases.data],
  );
  const showPanel = !routeCaseId && isLawyer ? panel : null;
  const nav = (
    <SidebarBody
      user={user}
      loading={session.isLoading}
      active={routeCaseId ? null : active}
      onSelect={selectTask}
      onNew={newTask}
      isLawyer={isLawyer}
      cases={activeCases}
      archivedCount={archivedCases.length}
      panel={showPanel}
      onPanel={openPanel}
      casesLoading={cases.isLoading}
      casesError={cases.isError}
      onRetryCases={() => void cases.refetch()}
      activeCaseId={caseId}
      onOpenCase={() => setMobileOpen(false)}
      onAccount={() => {
        setMobileOpen(false);
        setAccountOpen(true);
      }}
      onSignIn={() => setMobileOpen(false)}
    />
  );
  return (
    <div
      className="fixed inset-x-0 top-0 flex h-[100dvh] overflow-hidden bg-background pt-[env(safe-area-inset-top)] ps-[env(safe-area-inset-right)] pe-[env(safe-area-inset-left)] text-foreground"
      style={viewport ? { height: viewport.height, top: viewport.top } : undefined}
    >
      {/* Desktop sidebar: first child in RTL sits on the right */}
      {!collapsed && (
        <aside
          id="desktop-sidebar"
          className="hidden w-[272px] shrink-0 flex-col border-l bg-sidebar md:flex"
          data-testid="sidebar"
        >
          <div className="flex h-14 items-center justify-between px-3">
            <span className="ps-1">
              <Brand />
            </span>
            <button
              onClick={() => setCollapsed(true)}
              data-testid="button-collapse-sidebar"
              aria-label="طي الشريط الجانبي"
              aria-expanded="true"
              aria-controls="desktop-sidebar"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PanelRightClose className="h-[18px] w-[18px]" />
            </button>
          </div>
          {nav}
        </aside>
      )}

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="right"
          dir="rtl"
          className="flex w-[86vw] max-w-[320px] flex-col gap-0 bg-sidebar p-0 data-[state=open]:animate-none data-[state=closed]:animate-none [&>button]:left-4 [&>button]:right-auto"
        >
          <SheetTitle className="flex h-14 items-center px-4">
            <Brand />
          </SheetTitle>
          {nav}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              onClick={() => setMobileOpen(true)}
              data-testid="button-open-drawer"
              aria-label="فتح القائمة"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            {collapsed && (
              <button
                onClick={() => setCollapsed(false)}
                data-testid="button-expand-sidebar"
                aria-label="إظهار الشريط الجانبي"
                aria-expanded="false"
                aria-controls="desktop-sidebar"
                className="hidden h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
              >
                <PanelRightOpen className="h-[18px] w-[18px]" />
              </button>
            )}
            <span className="truncate px-1 text-[14px] font-medium" data-testid="text-header-title">
              {activeCase?.title ||
                (showPanel === 'clients'
                  ? 'الموكلون'
                  : showPanel === 'archive'
                    ? 'الأرشيف'
                    : active
                      ? TASKS.find((t) => t.id === active)?.label
                      : 'مساحة العمل')}
            </span>
            {activeCase?.archivedAt && (
              <span
                className="shrink-0 rounded border px-1.5 text-[11px] leading-5 text-muted-foreground"
                data-testid="badge-case-archived"
              >
                مؤرشفة
              </span>
            )}
            {activeCase?.clientName && (
              <span
                className="hidden max-w-[160px] shrink-0 truncate rounded-full bg-accent px-2 text-[11.5px] leading-6 text-muted-foreground sm:inline"
                data-testid="text-header-client"
              >
                {activeCase.clientName}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isLawyer && activeCase && (
              <button
                type="button"
                onClick={() => setManageOpen(true)}
                data-testid="button-manage-case"
                aria-label="إدارة القضية: الموكل والأتعاب والأرشفة"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Briefcase className="h-4 w-4" />
                <span className="hidden min-[400px]:inline">إدارة القضية</span>
              </button>
            )}
            <ThemeToggle />
            {!session.isLoading && !user && (
              <Link
                href="/login"
                data-testid="link-header-login"
                className="inline-flex h-9 items-center rounded-md border px-3 text-[13.5px] font-medium hover:bg-accent"
              >
                تسجيل الدخول
              </Link>
            )}
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          {session.isError ? (
            <div className="mx-auto w-full max-w-md p-6">
              <ErrorNote>تعذّر التحقق من الجلسة.</ErrorNote>
              <button
                onClick={() => session.refetch()}
                data-testid="button-retry-session"
                className="mt-3 h-10 rounded-md border px-4 text-[14px] hover:bg-accent"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : showPanel === 'clients' ? (
            <ClientsPanel
              key={focusClient ? `c-${focusClient.n}` : 'clients'}
              initialClientId={focusClient?.id ?? null}
            />
          ) : showPanel === 'archive' ? (
            <ArchivePanel
              cases={archivedCases}
              loading={cases.isLoading}
              error={cases.isError}
              onRetry={() => void cases.refetch()}
            />
          ) : active === 'analysis' && user && !isLawyer ? (
            <AdminNotice />
          ) : active === 'analysis' && routeCaseId && !caseId ? (
            <div className="mx-auto w-full max-w-2xl px-5 py-10" data-testid="text-case-not-found">
              <h2 className="text-[18px] font-semibold">القضية غير متاحة</h2>
              <p className="mt-2 text-[14px] leading-7 text-muted-foreground">
                رابط القضية غير صالح.
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex h-10 items-center rounded-md border px-4 text-[14px] hover:bg-accent"
              >
                العودة إلى مساحة العمل
              </Link>
            </div>
          ) : active === 'analysis' && isLawyer ? (
            <CaseView ws={ws} userId={userId} caseId={caseId} viewportHeight={viewport?.height} />
          ) : active === 'analysis' && session.isLoading ? (
            <div className="mx-auto w-full max-w-2xl space-y-3 px-5 py-10">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <TaskPicker
              user={!!user}
              name={user?.name}
              onSelect={selectTask}
              isLawyer={isLawyer}
              cases={activeCases}
              casesLoading={cases.isLoading}
              casesError={cases.isError}
              onRetryCases={() => void cases.refetch()}
              onClients={() => openPanel('clients')}
              onOpenClient={openClient}
            />
          )}
        </main>
      </div>

      <Dialog open={signInPrompt} onOpenChange={setSignInPrompt}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle className="pl-8">سجّل الدخول للمتابعة</DialogTitle>
            <DialogDescription className="leading-7">
              مساحة العمل متاحة للمحامين المسجّلين. سجّل الدخول أو أنشئ حسابًا برقم جوالك.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Link
              href="/login"
              data-testid="link-prompt-login"
              className="flex h-12 items-center justify-center rounded-lg bg-primary text-[15px] font-medium text-primary-foreground hover:opacity-90"
            >
              تسجيل الدخول
            </Link>
            <Link
              href="/register"
              data-testid="link-prompt-register"
              className="flex h-12 items-center justify-center rounded-lg border text-[15px] font-medium hover:bg-accent"
            >
              إنشاء حساب
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      {activeCase && (
        <CaseManageDialog
          key={activeCase.id}
          caseInfo={activeCase}
          open={manageOpen}
          onOpenChange={setManageOpen}
        />
      )}
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      <ReportDraftGuard />
    </div>
  );
}
function SidebarBody({
  user,
  loading,
  active,
  onSelect,
  onAccount,
  onSignIn,
  isLawyer,
  cases,
  casesLoading,
  casesError,
  onRetryCases,
  activeCaseId,
  onOpenCase,
  archivedCount,
  panel,
  onPanel,
}) {
  const [taskOpen, setTaskOpen] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <Popover open={taskOpen} onOpenChange={setTaskOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="button-new-task"
              aria-haspopup="dialog"
              className="flex h-11 w-full items-center gap-2.5 rounded-lg bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.15)] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" />
              <span className="flex-1 text-right">مهمة جديدة</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            dir="rtl"
            align="start"
            collisionPadding={12}
            className="w-[min(18rem,calc(100vw-1.5rem))] p-1.5"
            data-testid="popover-task-selector"
          >
            <p className="px-2 pb-1 pt-1 text-[11.5px] font-medium text-muted-foreground">
              اختر المهمة
            </p>
            <ul>
              {TASKS.map((t) => {
                const Icon = t.icon;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={!t.enabled}
                      onClick={() => {
                        setTaskOpen(false);
                        onSelect(t.id);
                      }}
                      data-testid={`button-task-${t.id}`}
                      className={`flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-2 text-right text-[13.5px] disabled:cursor-not-allowed ${active === t.id ? 'bg-accent font-medium' : t.enabled ? 'hover:bg-accent' : 'text-muted-foreground/70'}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 leading-5">{t.label}</span>
                      {!t.enabled && (
                        <span className="shrink-0 rounded border px-1.5 text-[10.5px] leading-5 text-muted-foreground">
                          غير مفعلة
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
        {isLawyer && (
          <button
            type="button"
            onClick={() => onPanel('clients')}
            aria-current={panel === 'clients' ? 'page' : undefined}
            data-testid="button-nav-clients"
            className={`mt-1.5 flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-[13.5px] ${panel === 'clients' ? 'bg-sidebar-accent font-medium' : 'hover:bg-sidebar-accent'}`}
          >
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-right">الموكلون</span>
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-1" aria-label="القضايا">
        {isLawyer && casesLoading ? (
          <div className="space-y-1.5 px-2 py-1">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : isLawyer && casesError ? (
          <div className="px-2 py-2 text-[12.5px] leading-6 text-muted-foreground">
            تعذّر تحميل القضايا.{' '}
            <button
              onClick={onRetryCases}
              data-testid="button-retry-cases"
              className="font-medium text-foreground underline underline-offset-4"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : isLawyer && cases && cases.length > 0 ? (
          <CaseOrganizer cases={cases} activeCaseId={activeCaseId} onOpenCase={onOpenCase} />
        ) : (
          <div
            className="flex items-start gap-2.5 rounded-md px-2 py-2 text-[12.5px] leading-6 text-muted-foreground"
            data-testid="text-saved-empty"
          >
            <FolderOpen className="mt-1 h-4 w-4 shrink-0" />
            <span>
              {!user
                ? 'سجّل الدخول لعرض قضاياك.'
                : !isLawyer
                  ? 'القضايا متاحة لحسابات المحامين فقط.'
                  : 'لا توجد قضايا محفوظة بعد. تُحفظ القضية عند أول إرسال أو رفع ملف.'}
            </span>
          </div>
        )}
      </nav>
      {isLawyer && (
        <div className="px-3 pb-2 pt-1">
          <button
            type="button"
            onClick={() => onPanel('archive')}
            aria-current={panel === 'archive' ? 'page' : undefined}
            data-testid="button-nav-archive"
            className={`flex h-10 w-full items-center gap-2.5 rounded-lg border border-dashed px-3 text-[13px] ${panel === 'archive' ? 'bg-sidebar-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'}`}
          >
            <Archive className="h-4 w-4" />
            <span className="flex-1 text-right">الأرشيف</span>
            <span className="text-[11px] tabular-nums" data-testid="text-archive-count">
              {archivedCount.toLocaleString('ar-SA')}
            </span>
          </button>
        </div>
      )}
      <div className="border-t p-3">
        {loading ? (
          <Skeleton className="h-11 w-full" />
        ) : user ? (
          <button
            onClick={onAccount}
            data-testid="button-account"
            className="flex h-11 w-full items-center gap-2.5 rounded-md px-2 text-right hover:bg-sidebar-accent"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-medium text-primary-foreground">
              {user.name.trim().charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[13.5px] font-medium"
                data-testid="text-sidebar-name"
              >
                {user.name}
              </span>
              <span
                className="block truncate text-[11.5px] text-muted-foreground"
                dir="ltr"
                style={{ textAlign: 'right' }}
              >
                {user.username}
              </span>
            </span>
          </button>
        ) : (
          <Link
            href="/login"
            onClick={onSignIn}
            data-testid="link-sidebar-login"
            className="flex h-11 w-full items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium hover:bg-sidebar-accent"
          >
            <LogIn className="h-4 w-4" /> تسجيل الدخول
          </Link>
        )}
      </div>
    </div>
  );
}
function TaskPicker({
  user,
  name,
  onSelect,
  isLawyer,
  cases,
  casesLoading,
  casesError,
  onRetryCases,
  onClients,
  onOpenClient,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const enabled = TASKS.filter((t) => t.enabled);
  const upcoming = TASKS.filter((t) => !t.enabled);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <p className="text-[12px] font-medium tracking-wide text-muted-foreground">
          مساحة عمل المحامي
        </p>
        <h1
          className="mt-1 text-[21px] font-semibold tracking-tight sm:text-[26px]"
          data-testid="text-welcome"
        >
          {user && name ? `مرحبًا، ${name}` : 'مايكرون للمحاماة'}
        </h1>
        <p className="mt-1 max-w-xl text-[13.5px] leading-7 text-muted-foreground">
          {user
            ? 'ابدأ تحليل قضية جديدة أو تابع عملك المثبت.'
            : 'أداة عمل للمحامين في المملكة العربية السعودية. سجّل الدخول لبدء العمل على قضاياك.'}
        </p>

        <div className="mt-5" data-testid="grid-services">
          {enabled.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => onSelect(t.id)}
                data-testid={`button-pick-${t.id}`}
                className="group flex min-h-[64px] w-full items-center gap-3 rounded-lg border bg-card p-3 text-right shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] transition-shadow duration-200 hover:shadow-[0_4px_14px_-8px_hsl(var(--foreground)/0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold leading-6">{t.label}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    {t.desc}
                  </span>
                </span>
                <ArrowLeft
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden
                />
              </button>
            );
          })}
        </div>

        {isLawyer && (
          <HomePinned
            cases={cases}
            casesLoading={casesLoading}
            casesError={casesError}
            onRetryCases={onRetryCases}
            onClients={onClients}
            onOpenClient={onOpenClient}
          />
        )}

        <section className="mt-7">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            aria-controls="upcoming-services"
            data-testid="button-toggle-services"
            className="flex min-h-11 w-full items-center gap-2 rounded-md text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-[14px] font-semibold">خدمات أخرى</span>
            <span className="rounded-full bg-muted px-2 text-[11.5px] leading-5 tabular-nums text-muted-foreground">
              {upcoming.length.toLocaleString('ar-SA')} غير مفعلة
            </span>
            <ChevronDown
              className={`ms-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${moreOpen ? '' : 'rotate-90'}`}
              aria-hidden
            />
          </button>
          {moreOpen && (
            <ul
              id="upcoming-services"
              className="mt-2 divide-y overflow-hidden rounded-lg border bg-card/60"
            >
              {upcoming.map((t) => {
                const Icon = t.icon;
                return (
                  <li key={t.id}>
                    <button
                      disabled
                      aria-disabled
                      data-testid={`button-pick-${t.id}`}
                      className="flex min-h-[52px] w-full cursor-not-allowed items-center gap-3 px-3 py-2 text-right"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground/80" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-muted-foreground">
                          {t.label}
                        </span>
                        <span className="block truncate text-[12px] text-muted-foreground/75">
                          {t.desc}
                        </span>
                      </span>
                      <span
                        className="shrink-0 rounded-full border px-2 text-[11px] leading-5 text-muted-foreground"
                        data-testid={`badge-disabled-${t.id}`}
                      >
                        غير مفعلة
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {!user && (
          <div className="mt-8 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/login"
              data-testid="link-cta-login"
              className="flex h-11 flex-1 items-center justify-center rounded-lg bg-primary text-[14.5px] font-medium text-primary-foreground hover:opacity-90"
            >
              تسجيل الدخول
            </Link>
            <Link
              href="/register"
              data-testid="link-cta-register"
              className="flex h-11 flex-1 items-center justify-center rounded-lg border text-[14.5px] font-medium hover:bg-accent"
            >
              إنشاء حساب
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
function AdminNotice() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10" data-testid="text-admin-notice">
      <ShieldCheck className="h-5 w-5 text-muted-foreground" />
      <h2 className="mt-3 text-[18px] font-semibold">مساحة القضايا مخصصة للمحامين</h2>
      <p className="mt-2 text-[14px] leading-7 text-muted-foreground">
        أنت مسجّل بحساب مشرف. لا يمكن إنشاء القضايا أو إرسال الرسائل من هذا الحساب.
      </p>
      <Link
        href="/admin"
        data-testid="link-admin-panel"
        className="mt-4 inline-flex h-10 items-center rounded-md border px-4 text-[14px] font-medium hover:bg-accent"
      >
        الانتقال إلى لوحة الإدارة
      </Link>
    </div>
  );
}
export function AccountDialog({ open, onOpenChange }) {
  const session = useSession();
  const user = session.data?.user;
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const request = useCsrfRequest();
  const logout = useLogout({
    request,
    mutation: {
      onSuccess: async () => {
        onOpenChange(false);
        // Keep the live session query and its fetch function. Clearing it then
        // fetching by key alone creates a query with no queryFn and a false
        // session error. All private data is still removed before navigation.
        await qc.cancelQueries();
        qc.removeQueries({
          predicate: (query) => query.queryKey[0] !== getGetSessionQueryKey()[0],
        });
        qc.getMutationCache().clear();
        // Logout returns an ActionResult, not SessionInfo. Clear the confirmed
        // signed-out identity, then obtain the new anonymous session and CSRF.
        qc.setQueryData(getGetSessionQueryKey(), (current) =>
          current ? { ...current, user: null, csrfToken: '' } : undefined,
        );
        try {
          await qc.fetchQuery({
            queryKey: getGetSessionQueryKey(),
            queryFn: ({ signal }) => getSession({ signal }),
            staleTime: 0,
          });
        } finally {
          navigate('/');
        }
      },
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="w-[calc(100%_-_2rem)] max-w-sm rounded-lg p-5 text-right">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="pl-8">الحساب</DialogTitle>
          <DialogDescription>بيانات حسابك في مايكرون.</DialogDescription>
        </DialogHeader>
        {user && (
          <dl className="divide-y rounded-lg border text-[14px]">
            <Row label="الاسم" value={user.name} testId="text-account-name" />
            <Row label="اسم المستخدم" value={user.username} testId="text-account-username" ltr />
            <Row
              label="الصفة"
              value={roleLabel[user.role] ?? user.role}
              testId="text-account-role"
            />
          </dl>
        )}
        {logout.isError && (
          <ErrorNote>{errorText(logout.error, 'تعذّر تسجيل الخروج. حاول مرة أخرى.')}</ErrorNote>
        )}
        <PrimaryButton
          variant="outline"
          onClick={() => guardReportNavigation(() => logout.mutate())}
          loading={logout.isPending}
          data-testid="button-logout"
        >
          {!logout.isPending && <LogOut className="h-4 w-4" />} تسجيل الخروج
        </PrimaryButton>
      </DialogContent>
    </Dialog>
  );
}
function Row({ label, value, testId, ltr }) {
  return (
    <div className="grid grid-cols-1 items-start gap-1 px-3 py-3 text-right min-[360px]:grid-cols-[96px_minmax(0,1fr)] min-[360px]:gap-3">
      <dt className="flex min-w-0 items-center gap-2 text-right text-muted-foreground">
        {label === 'الاسم' && <UserRound className="h-3.5 w-3.5 shrink-0" />}
        {label}
      </dt>
      <dd
        className="min-w-0 text-right font-medium [overflow-wrap:anywhere] [unicode-bidi:isolate]"
        data-testid={testId}
        dir={ltr ? 'ltr' : 'rtl'}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * DEVELOPMENT-ONLY UI prototype (Phase 6). Loaded exclusively through a
 * dynamic import guarded by import.meta.env.DEV, so this module and its
 * fictional fixture are excluded from production bundles.
 * No network calls, no hooks to the API, no AI execution, no persistence.
 */
import { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useVisualViewport } from '@/lib/use-visual-viewport';
import { ChevronDown, FileSearch, FlaskConical, MoreVertical, X } from 'lucide-react';
const SECTION_ORDER = [
  'summary',
  'facts',
  'characterization',
  'evidence',
  'position',
  'legal_basis',
  'risks',
  'conclusions',
];
const TITLES = {
  summary: 'الملخص',
  facts: 'الوقائع',
  characterization: 'التكييف القانوني',
  evidence: 'الأدلة وعبء الإثبات',
  position: 'مركز الموكل',
  legal_basis: 'الأساس النظامي',
  risks: 'المخاطر',
  conclusions: 'النتائج والتوصيات',
};
const BASIS = {
  lawyer_statement: 'إفادة المحامي',
  analysis: 'استنتاج تحليلي',
  conditional: 'مشروط',
  unverified: 'غير متحقق',
};
// Fictional, static demonstration fixture. Not a real case, not a legal conclusion.
const BASE = {
  summary: [
    {
      text: 'نزاع تجاري خيالي بين مورد مواد بناء ومقاول فرعي حول دفعة متأخرة عن توريد شحنتين.',
      basis: 'lawyer_statement',
    },
    {
      text: 'يبدو مركز الموكل قابلًا للدفاع إذا ثبت الاستلام، ويتوقف ذلك على مستندات لم تُقدَّم بعد.',
      basis: 'conditional',
    },
  ],
  facts: [
    {
      text: 'أفاد المحامي بأن الموكل ورّد شحنتين خلال فترة متقاربة دون عقد مكتوب موقّع.',
      basis: 'lawyer_statement',
    },
    {
      text: 'لم يُرفق في هذا النموذج أي مستند يثبت الاستلام أو قيمة الشحنتين.',
      basis: 'unverified',
    },
  ],
  characterization: [
    {
      text: 'تُعرض العلاقة مبدئيًا بوصفها توريدًا تجاريًا، ويحتاج التكييف النهائي إلى مراجعة المراسلات.',
      basis: 'analysis',
    },
  ],
  evidence: [
    {
      text: 'عبء إثبات التوريد يقع مبدئيًا على المطالِب، والمراسلات الإلكترونية قد تكون قرينة مساندة.',
      basis: 'analysis',
    },
    {
      text: 'لا توجد في هذا العرض مستندات موثقة؛ أي إشارة إلى دليل هنا افتراضية.',
      basis: 'unverified',
    },
  ],
  position: [
    {
      text: 'مركز الموكل يتحسن بوجود إيصالات استلام أو إقرار مكتوب من الطرف الآخر.',
      basis: 'conditional',
    },
  ],
  legal_basis: [
    {
      text: 'لم يُربط هذا النموذج بأي مصدر نظامي موثق. يظهر الأساس النظامي هنا فقط بعد استرجاع مصدر حقيقي.',
      basis: 'unverified',
    },
  ],
  risks: [
    { text: 'غياب العقد المكتوب قد يضعف إثبات قيمة الشحنتين المتفق عليها.', basis: 'analysis' },
    { text: 'احتمال دفع الطرف الآخر بعيب في المواد الموردة لم يُستبعد بعد.', basis: 'conditional' },
  ],
  conclusions: [
    {
      text: 'يُقترح جمع إيصالات الاستلام والمراسلات قبل أي إجراء، ثم إعادة تقييم المركز.',
      basis: 'analysis',
    },
  ],
};
const VERSIONS = [
  {
    id: 'v3',
    label: 'الإصدار 3',
    date: 'تاريخ تجريبي',
    change: 'أُضيف خطر الدفع بعيب المواد، ووُضّح عبء الإثبات في قسم الأدلة.',
    sections: BASE,
  },
  {
    id: 'v2',
    label: 'الإصدار 2',
    date: 'تاريخ تجريبي',
    change: 'عُدّل التكييف بعد تصحيح خيالي من المحامي بأن العلاقة توريد لا مقاولة.',
    sections: { ...BASE, risks: [BASE.risks[0]], evidence: [BASE.evidence[1]] },
  },
  {
    id: 'v1',
    label: 'الإصدار 1',
    date: 'تاريخ تجريبي',
    change: 'الإصدار الأول من التقرير التجريبي.',
    sections: {
      ...BASE,
      risks: [BASE.risks[0]],
      evidence: [BASE.evidence[1]],
      characterization: [
        {
          text: 'تُعرض العلاقة مبدئيًا بوصفها مقاولة من الباطن، وهذا التكييف بحاجة إلى تحقق.',
          basis: 'conditional',
        },
      ],
    },
  },
];
const LATEST = VERSIONS[0];
const PREVIEW_ONLY = 'غير متاح في النموذج التجريبي';
function DevLabel({ className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-dashed border-foreground/30 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ${className}`}
    >
      <FlaskConical className="h-3 w-3" aria-hidden />
      نموذج تجريبي خيالي — للتطوير فقط
    </span>
  );
}
/** Small card shown in the conversation; opens the analysis tab. */
export function MockReportCard({ onOpen }) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-4" data-testid="card-mock-report">
      <DevLabel />
      <p className="mt-2 text-[14px] font-semibold">تقرير تحليل تجريبي — {LATEST.label}</p>
      <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
        محتوى خيالي ثابت لعرض شكل الواجهة. ليس نتيجة تحليل محفوظة ولا رأيًا قانونيًا.
      </p>
      <button
        type="button"
        onClick={onOpen}
        data-testid="button-open-analysis"
        className="mt-3 inline-flex h-10 items-center rounded-md border px-4 text-[14px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        فتح التحليل
      </button>
    </div>
  );
}
// Reads env(safe-area-inset-*) once per open so Radix collision padding keeps
// the menu clear of notches, home indicators and rounded corners.
function safeAreaPadding() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const pad = (v) => (parseFloat(v) || 0) + 8;
  const out = {
    top: pad(cs.paddingTop),
    right: pad(cs.paddingRight),
    bottom: pad(cs.paddingBottom),
    left: pad(cs.paddingLeft),
  };
  probe.remove();
  return out;
}
const ITEM =
  'flex min-h-11 w-full shrink-0 cursor-pointer select-none items-center rounded-md px-3 py-1.5 text-right text-[14px] leading-6 outline-none hover:bg-accent focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent';
const ACTIONS = [
  { key: 'discuss', label: 'ناقش هذه النقطة' },
  { key: 'correct', label: 'تصحيح معلومة' },
  { key: 'note', label: 'إضافة ملاحظة' },
  { key: 'evidence', label: 'إضافة دليل' },
];
function ActionLabel({ a }) {
  return a.key === 'discuss' ? (
    <span className="font-medium">{a.label}</span>
  ) : (
    <span className="flex flex-col items-start text-muted-foreground">
      <span className="text-foreground/80">{a.label}</span>
      <span className="text-[11.5px] leading-5">{PREVIEW_ONLY}</span>
    </span>
  );
}
/** Compact (sheet) mode: narrow screens or short visible viewports, where an anchored popover can leave the screen. */
function useCompactMenus() {
  const read = () =>
    typeof window !== 'undefined' &&
    (window.innerWidth <= 767 || (window.visualViewport?.height ?? window.innerHeight) < 500);
  const [compact, setCompact] = useState(read);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCompact(read()));
    };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return compact;
}
/**
 * Shared native modal sheet: top layer, inert background, Escape and backdrop
 * dismissal. Sized to the visual viewport via CSS variables (keyboard, panning,
 * short screens) and safe areas: bottom sheet on mobile, centred in the visible
 * area from sm upwards. Placement never depends on an anchor.
 */
function ViewportSheet({ labelledBy, label, testId, onClose, children }) {
  const dialog = useRef(null);
  const viewport = useVisualViewport();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  const vh = viewport?.height;
  const offsetBottom = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.top)
    : 0;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      aria-label={label}
      dir="rtl"
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onKeyDown={(e) => {
        // Keep Tab cycling inside the sheet rather than reaching browser chrome.
        if (e.key !== 'Tab') return;
        const items = Array.from(dialog.current?.querySelectorAll('button:not([disabled])') ?? []);
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
      style={{
        ['--sheet-bottom']: `${Math.round(offsetBottom)}px`,
        ['--vv-top']: `${Math.round(viewport?.top ?? 0)}px`,
        ['--vv-h']: vh ? `${Math.round(vh)}px` : '100dvh',
      }}
      className="fixed inset-x-0 bottom-[var(--sheet-bottom,0px)] top-auto m-0 max-h-[calc(var(--vv-h,100dvh)-max(16px,env(safe-area-inset-top)))] w-full max-w-full flex-col overflow-hidden rounded-t-2xl border bg-card px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 text-foreground shadow-lg backdrop:bg-foreground/25 open:flex sm:inset-x-0 sm:bottom-auto sm:top-[calc(var(--vv-top,0px)+var(--vv-h,100dvh)/2)] sm:mx-auto sm:my-0 sm:h-fit sm:max-h-[calc(var(--vv-h,100dvh)-2rem)] sm:max-w-md sm:-translate-y-1/2 sm:rounded-xl sm:px-5 sm:pb-5"
    >
      <div
        className="mx-auto -mt-1 mb-2 h-1 w-10 shrink-0 rounded-full bg-foreground/15 sm:hidden"
        aria-hidden
      />
      {children}
    </dialog>
  );
}
function ParagraphMenu({ id, onDiscuss, onPreviewOnly }) {
  const [open, setOpen] = useState(false);
  const [padding, setPadding] = useState({ top: 8, right: 8, bottom: 8, left: 8 });
  const compact = useCompactMenus();
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const trigger = useRef(null);
  const sheetMenu = useRef(null);
  const discussing = useRef(false);
  // Refresh insets while open: rotation, browser chrome and keyboard changes
  // can alter safe areas. Radix still does all collision placement.
  useEffect(() => {
    if (!open || compact) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setPadding((prev) => {
          const next = safeAreaPadding();
          return prev.top === next.top &&
            prev.right === next.right &&
            prev.bottom === next.bottom &&
            prev.left === next.left
            ? prev
            : next;
        }),
      );
    };
    refresh();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', refresh);
    vv?.addEventListener('scroll', refresh);
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', refresh);
      vv?.removeEventListener('scroll', refresh);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
    };
  }, [open, compact]);
  // Sheet opened (or the open menu switched into sheet mode): focus first action.
  useEffect(() => {
    if (open && compact) sheetMenu.current?.querySelector('[role="menuitem"]')?.focus();
  }, [open, compact]);
  const run = (key) => {
    const a = ACTIONS.find((x) => x.key === key);
    if (key === 'discuss') {
      discussing.current = true;
      setOpen(false);
      onDiscuss();
      return;
    }
    onPreviewOnly(a.label);
  };
  const closeSheet = (restore) => {
    setOpen(false);
    if (restore) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const sheetKeys = (e) => {
    const items = Array.from(sheetMenu.current?.querySelectorAll('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement);
    const go = (n) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
  };
  const triggerButton = (
    <button
      ref={trigger}
      type="button"
      aria-label="إجراءات الفقرة"
      data-testid={`button-paragraph-menu-${id}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={compact ? () => setOpen(true) : undefined}
      onKeyDown={
        compact
          ? (e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
              }
            }
          : undefined
      }
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-accent aria-expanded:text-foreground"
    >
      <MoreVertical className="h-[18px] w-[18px]" />
    </button>
  );
  return (
    <>
      <DropdownMenu dir="rtl" modal={false} open={open && !compact} onOpenChange={setOpen}>
        {/* A native modal sheet must open on click, not Radix pointerdown:
            the remaining touch click would otherwise dismiss its backdrop. */}
        {compact ? (
          triggerButton
        ) : (
          <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          id={`menu-${id}`}
          aria-label="إجراءات الفقرة"
          data-testid={`menu-paragraph-${id}`}
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={padding}
          avoidCollisions
          sticky="always"
          updatePositionStrategy="always"
          onCloseAutoFocus={(e) => {
            if (discussing.current || compactRef.current) {
              e.preventDefault();
              discussing.current = false;
            }
          }}
          className="w-[min(15rem,calc(100vw-1.5rem))] rounded-lg p-1"
        >
          {ACTIONS.map((a, i) => (
            <div key={a.key}>
              <DropdownMenuItem
                data-testid={`menuitem-${a.key}-${id}`}
                className={ITEM}
                onSelect={() => run(a.key)}
              >
                <ActionLabel a={a} />
              </DropdownMenuItem>
              {i === 0 && <DropdownMenuSeparator className="my-1" />}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {open && compact && (
        <ViewportSheet
          labelledBy={`menu-title-${id}`}
          testId={`sheet-paragraph-${id}`}
          onClose={() => closeSheet(true)}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 pb-1">
            <p id={`menu-title-${id}`} className="text-[14px] font-semibold leading-7">
              إجراءات الفقرة
            </p>
            <button
              type="button"
              onClick={() => closeSheet(true)}
              aria-label="إغلاق القائمة"
              data-testid={`button-close-menu-${id}`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div
            ref={sheetMenu}
            id={`menu-${id}`}
            role="menu"
            aria-labelledby={`menu-title-${id}`}
            onKeyDown={sheetKeys}
            data-testid={`menu-paragraph-${id}`}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {ACTIONS.map((a, i) => (
              <button
                key={a.key}
                type="button"
                role="menuitem"
                tabIndex={i === 0 ? 0 : -1}
                data-testid={`menuitem-${a.key}-${id}`}
                onClick={() => {
                  if (a.key === 'discuss') run(a.key);
                  else {
                    closeSheet(true);
                    run(a.key);
                  }
                }}
                className={`${ITEM} ${i === 1 ? 'mt-1 border-t pt-2' : ''}`}
              >
                <ActionLabel a={a} />
              </button>
            ))}
          </div>
        </ViewportSheet>
      )}
    </>
  );
}
function SourcePreview({ onClose }) {
  return (
    <ViewportSheet
      labelledBy="source-preview-title"
      testId="dialog-source-preview"
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DevLabel />
            <h3 id="source-preview-title" className="mt-2 text-[16px] font-semibold leading-7">
              معاينة المصدر داخل القضية
            </h3>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="إغلاق المعاينة والعودة"
            data-testid="button-close-source-preview"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="mt-4 space-y-3 text-[14px] leading-7">
          <div
            className="rounded-md border border-dashed p-3"
            data-testid="text-source-placeholder"
          >
            <p className="text-[12px] font-medium text-muted-foreground">المستند</p>
            <p>لا يوجد مصدر موثق لهذه الفقرة</p>
          </div>
          <div className="rounded-md border border-dashed p-3">
            <p className="text-[12px] font-medium text-muted-foreground">الموضع</p>
            <p>غير محدد</p>
          </div>
          <div className="rounded-md border border-dashed p-3">
            <p className="text-[12px] font-medium text-muted-foreground">المقتطف</p>
            <p className="text-muted-foreground">
              يظهر هنا مقتطف المصدر وموضعه فقط عند وجود مصدر حقيقي متحقق منه. هذا عنصر نائب لعرض
              التخطيط.
            </p>
          </div>
        </div>
      </div>
    </ViewportSheet>
  );
}
export function AnalysisPanel({ onDiscuss }) {
  const [versionId, setVersionId] = useState(LATEST.id);
  const [openSections, setOpenSections] = useState(() => new Set(['summary']));
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(false);
  const previewTrigger = useRef(null);
  const version = VERSIONS.find((v) => v.id === versionId) ?? LATEST;
  const isLatest = version.id === LATEST.id;
  const toggle = (id) =>
    setOpenSections((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const closePreview = () => {
    setPreview(false);
    requestAnimationFrame(() => previewTrigger.current?.focus({ preventScroll: true }));
  };
  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto" data-testid="analysis-scroller">
        <div
          dir="rtl"
          className="mx-auto w-full max-w-2xl px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 sm:px-6 xl:grid xl:max-w-5xl xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start xl:gap-x-8 xl:px-8 xl:pt-8"
          data-testid="analysis-prototype"
        >
          <header className="xl:col-span-2">
            <DevLabel />
            <h2 className="mt-2 text-[19px] font-semibold leading-8 tracking-tight sm:text-[21px]">
              تقرير تحليل تجريبي
            </h2>
            <p className="mt-1 max-w-[62ch] text-[13.5px] leading-7 text-muted-foreground">
              بيانات ثابتة وخيالية لعرض الواجهة فقط. ليست نتيجة تحليل محفوظة، ولا تمثل استنتاجًا
              قانونيًا متحققًا أو دليلًا موثقًا. لا يُشغَّل أي تحليل من هذه الشاشة.
            </p>
          </header>

          <aside className="xl:sticky xl:top-6 xl:col-start-2 xl:row-start-2">
            <div
              className="mt-4 rounded-lg border bg-card p-3 xl:mt-6 xl:p-4"
              data-testid="version-panel"
            >
              <p className="text-[12px] font-medium text-muted-foreground" id="version-label">
                إصدارات التقرير التجريبية
              </p>
              <div
                role="radiogroup"
                aria-labelledby="version-label"
                className="mt-2 grid grid-cols-1 gap-1.5 min-[400px]:grid-cols-3 xl:grid-cols-1"
              >
                {VERSIONS.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={v.id === version.id}
                    onClick={() => setVersionId(v.id)}
                    data-testid={`button-version-${v.id}`}
                    className={`min-h-11 rounded-md border px-3 py-1.5 text-[13.5px] leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${v.id === version.id ? 'border-foreground/50 bg-accent font-semibold' : 'hover:bg-accent'}`}
                  >
                    {v.label}
                    {i === 0 ? ' · الأحدث' : ' · سابق'}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[13.5px] leading-7" data-testid="text-version-current">
                المعروض: {version.label} ({isLatest ? 'أحدث إصدار' : 'إصدار سابق'}) · {version.date}
              </p>
              <p
                className="mt-1 break-words text-[13px] leading-7 text-muted-foreground"
                data-testid="text-version-change"
              >
                ملخص التغيير: {version.change}
              </p>
              {!isLatest && (
                <button
                  type="button"
                  onClick={() => setVersionId(LATEST.id)}
                  data-testid="button-return-latest"
                  className="mt-2 min-h-11 w-full rounded-md border px-3 text-[13.5px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  العودة إلى أحدث إصدار
                </button>
              )}
            </div>
          </aside>

          <div className="min-w-0 xl:col-start-1 xl:row-start-2">
            {notice && (
              <div
                role="status"
                className="mt-3 flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-1 text-[13.5px] leading-6 xl:mt-6"
                data-testid="text-preview-notice"
              >
                <span>{notice}</span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  aria-label="إخفاء التنبيه"
                  data-testid="button-dismiss-notice"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="mt-4 space-y-2 xl:mt-6">
              {SECTION_ORDER.map((sid) => {
                const open = openSections.has(sid);
                return (
                  <section
                    key={sid}
                    className="rounded-lg border bg-card"
                    data-testid={`mock-section-${sid}`}
                    data-section-id={sid}
                  >
                    <h3>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={`mock-body-${sid}`}
                        onClick={() => toggle(sid)}
                        data-testid={`button-toggle-section-${sid}`}
                        className="flex min-h-12 w-full items-center justify-between gap-2 px-4 py-2 text-right text-[15px] font-semibold leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                      >
                        <span>{TITLES[sid]}</span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                      </button>
                    </h3>
                    {open && (
                      <div id={`mock-body-${sid}`} className="space-y-4 border-t px-4 pb-4 pt-3">
                        {version.sections[sid].map((p, i) => {
                          const pid = `${sid}-${i + 1}`;
                          return (
                            <div
                              key={pid}
                              className="flex items-start gap-1"
                              data-testid={`mock-paragraph-${pid}`}
                            >
                              <div className="min-w-0 flex-1">
                                <p
                                  className="max-w-[68ch] whitespace-pre-wrap break-words text-[15px] leading-8"
                                  data-testid={`text-paragraph-${pid}`}
                                >
                                  {p.text}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-4 text-[12.5px] text-muted-foreground">
                                  <span>التصنيف: {BASIS[p.basis]}</span>
                                  <button
                                    type="button"
                                    data-testid={`button-source-preview-${pid}`}
                                    onClick={(e) => {
                                      previewTrigger.current = e.currentTarget;
                                      setPreview(true);
                                    }}
                                    className="-mx-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-foreground/75 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                  >
                                    <FileSearch className="h-3.5 w-3.5" aria-hidden />
                                    معاينة المصدر
                                  </button>
                                </div>
                              </div>
                              <ParagraphMenu
                                id={pid}
                                onPreviewOnly={(label) => setNotice(`${label}: ${PREVIEW_ONLY}`)}
                                onDiscuss={() =>
                                  onDiscuss({
                                    versionLabel: `${version.label} (تجريبي)`,
                                    sectionTitle: TITLES[sid],
                                    paragraphLabel: `الفقرة ${i + 1}`,
                                    text: p.text,
                                  })
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {preview && <SourcePreview onClose={closePreview} />}
    </div>
  );
}

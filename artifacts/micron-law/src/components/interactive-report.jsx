/**
 * Persistent interactive report. The original saved report is version 0 and
 * immutable; every manual save, accepted proposal or restore creates a NEW
 * version server-side. No local legal inference, no AI execution.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { retainReportDraft } from '@/lib/report-draft-guard';
import { fileTypeLabel } from '@/lib/document-labels';
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  FileDown,
  GitCompare,
  History,
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  RotateCcw,
  FilePenLine,
} from 'lucide-react';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import {
  InteractionDialog,
  InteractionThread,
  RBTN,
  RPRIMARY,
} from '@/components/paragraph-interaction';
import {
  copyText,
  downloadVersion,
  mutationErrorText,
  useCreateVersion,
  useExecuteInteraction,
  useInteractions,
  useRejectInteraction,
  useReportVersions,
} from '@/lib/report-api';
export const SECTION_ORDER = [
  'summary',
  'facts',
  'characterization',
  'evidence',
  'position',
  'legal_basis',
  'risks',
  'conclusions',
];
export const TITLES = {
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
  documented: 'مستند مختار — دون توثيق الصفحات',
  lawyer_statement: 'إفادة المحامي',
  analysis: 'استنتاج تحليلي',
  conditional: 'مشروط',
  unverified: 'غير متحقق',
};
const KIND = {
  original: 'التقرير الأصلي',
  manual: 'تعديل يدوي',
  ai_accepted: 'مراجعة مقبولة',
  restore: 'استعادة',
};
const ORIGIN = {
  original: 'من التحليل الأصلي',
  manual: 'معدّلة يدويًا',
  ai_accepted: 'مراجعة مقترحة مقبولة',
};
const fmt = (s) => new Date(s).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
const vLabel = (v) => (v.number === 0 ? 'الأصلي' : `الإصدار ${v.number.toLocaleString('ar-SA')}`);
const keyOf = (sid, i) => `${sid}:${i}`;
const ordered = (r) =>
  SECTION_ORDER.map((sid) => r.sections.find((s) => s.section_id === sid)).filter(
    (s) => !!s && s.blocks.length > 0,
  );
function sourceLabel(refs, op) {
  const known = refs.map((r) => op.sourceRegistry.find((s) => s.id === r)).filter((s) => !!s);
  if (!known.length) return 'لا يوجد مرجع';
  return known
    .map((s) =>
      s.basis === 'documented'
        ? `${fileTypeLabel(s.filename)}: ${s.filename ?? 'مستند محفوظ'} — مرجع المستند، لا صفحة محددة`
        : 'رسالة المحامي المحفوظة',
    )
    .join('، ');
}
function provenanceNote(b, op) {
  const origin = b.origin ?? 'original';
  if (origin === 'original') return null;
  const ctx = b.original_source_refs?.length
    ? ` مراجع الفقرة الأصلية للسياق فقط وليست تحققًا: ${sourceLabel(b.original_source_refs, op)}.`
    : '';
  const prop = b.proposed_source_refs?.length
    ? ` مراجع أشار إليها المقترح — سياق غير متحقق منه وليست استشهادًا موثقًا: ${sourceLabel(b.proposed_source_refs, op)}.`
    : '';
  return `${ORIGIN[origin]} — المحتوى المعدّل غير متحقق منه.${ctx}${prop}`;
}
function blockText(b, op) {
  const note = provenanceNote(b, op);
  return `${b.text}\n[التصنيف: ${BASIS[b.basis] ?? 'غير مصنف'} | ${b.source_refs.length ? `المصدر: ${sourceLabel(b.source_refs, op)} (${b.source_refs.join('، ')})` : 'لا يوجد مرجع'}${note ? ` | ${note}` : ''}]`;
}
function sectionText(s, op) {
  return `${TITLES[s.section_id] ?? s.section_id}\n\n${s.blocks.map((b) => blockText(b, op)).join('\n\n')}`;
}
function reportText(r, v, op) {
  return [
    r.title,
    `${vLabel(v)} — ${KIND[v.kind]} — ${fmt(v.createdAt)}`,
    r.change_summary ?? '',
    ...r.alerts.map(
      (a) =>
        `تنبيه: ${a.message}${a.attachment_id ? ` — المرفق: ${sourceLabel([a.attachment_id], op)}` : ''}`,
    ),
    ...ordered(r).map((s) => sectionText(s, op)),
    'ملاحظة: لا تتضمن الإحالات استشهادات نظامية متحققًا منها.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
function diff(a, b) {
  const out = [];
  for (const sid of SECTION_ORDER) {
    const x = a.sections.find((s) => s.section_id === sid)?.blocks ?? [];
    const y = b.sections.find((s) => s.section_id === sid)?.blocks ?? [];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const before = x[i]?.text ?? null,
        after = y[i]?.text ?? null;
      if (before !== after) out.push({ sid, i, before, after });
    }
  }
  return out;
}
export function InteractiveReport({ caseId, operationId, originalSavedReport, op }) {
  const versions = useReportVersions(caseId, operationId);
  const interactions = useInteractions(caseId, operationId);
  const create = useCreateVersion(caseId, operationId);
  const reject = useRejectInteraction(caseId, operationId);
  const execute = useExecuteInteraction(caseId, operationId);
  const acceptIds = useRef(new Map());
  const { toast } = useToast();
  const list = useMemo(
    () => [...(versions.data ?? [])].sort((a, b) => a.number - b.number),
    [versions.data],
  );
  const fallback = useMemo(
    () => ({
      id: operationId,
      operationId,
      number: 0,
      kind: 'original',
      parentId: null,
      createdAt: op.finishedAt ?? op.createdAt,
      report: originalSavedReport,
    }),
    [operationId, op, originalSavedReport],
  );
  const latest = list.at(-1) ?? fallback;
  const [selectedId, setSelectedId] = useState(null);
  const selected = list.find((v) => v.id === selectedId) ?? latest;
  const isLatest = selected.id === latest.id;
  const live = !!versions.data;
  const [open, setOpen] = useState(() => new Set(['summary']));
  const [edits, setEdits] = useState(new Map());
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const saveRequestId = useRef(null);
  const [saveError, setSaveError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareWith, setCompareWith] = useState(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [jumpId, setJumpId] = useState(null);
  const actionFence = useRef(false);
  // Warn before leaving with unsaved manual edits. Nothing is written to storage.
  const dirty = edits.size > 0 || editing !== null;
  const savedElsewhere = (interactions.data ?? []).filter((it) => it.versionId !== selected.id);
  const openSavedInteraction = (it) => {
    if (dirty || busyId || !list.some((v) => v.id === it.versionId)) return;
    setSelectedId(it.versionId);
    setOpen((previous) => new Set([...previous, it.sectionId]));
    setJumpId(it.id);
  };
  useEffect(() => {
    if (!jumpId) return;
    const it = interactions.data?.find((item) => item.id === jumpId);
    if (!it || it.versionId !== selected.id || !open.has(it.sectionId)) return;
    const element = document.getElementById(`report-interaction-${jumpId}`);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'auto' });
    element.focus({ preventScroll: true });
    setJumpId(null);
  }, [jumpId, selected.id, open, interactions.data]);
  useEffect(() => (dirty ? retainReportDraft() : undefined), [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const editingOriginal = useRef('');
  const report = selected.report;
  const sections = ordered(report);
  const goTo = (sid) => {
    setOpen((p) => new Set([...p, sid]));
    requestAnimationFrame(() => {
      const el = document.getElementById(`real-section-${sid}`);
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el?.querySelector('button[aria-expanded]')?.focus({ preventScroll: true });
    });
  };
  const toggle = (s) =>
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const doCopy = async (text, what) => {
    const ok = await copyText(text);
    toast(
      ok
        ? {
            title: `نُسخ ${what}`,
            description: `من ${vLabel(selected)} مع بيانات التصنيف والمصدر المتاحة.`,
          }
        : {
            title: 'تعذّر النسخ',
            description: 'لم يسمح المتصفح بالنسخ. حدّد النص يدويًا.',
            variant: 'destructive',
          },
    );
  };
  const doExport = async (format) => {
    setExporting(format);
    try {
      await downloadVersion(
        caseId,
        operationId,
        selected.id,
        format,
        `${report.title || 'تقرير'} - ${vLabel(selected)}`,
      );
      toast({
        title: 'بدأ التنزيل',
        description: `${format === 'pdf' ? 'PDF' : 'Word'} — ${vLabel(selected)}`,
      });
    } catch (e) {
      toast({
        title: 'تعذّر التصدير',
        description: mutationErrorText(e, 'لم يُنشأ الملف. حاول مرة أخرى.'),
        variant: 'destructive',
      });
    } finally {
      setExporting(null);
    }
  };
  const startEdit = (sid, i, text) => {
    // Switching target keeps the in-progress draft as a pending edit instead of discarding it.
    if (editing && editing !== keyOf(sid, i)) {
      const prev = editing,
        t = draft.trim(),
        orig = editingOriginal.current;
      setEdits((p) => {
        const n = new Map(p);
        if (t && t !== orig) n.set(prev, t);
        return n;
      });
    }
    editingOriginal.current = text;
    setEditing(keyOf(sid, i));
    setDraft(edits.get(keyOf(sid, i)) ?? text);
  };
  const commitEdit = (sid, i, original) => {
    setEdits((p) => {
      const n = new Map(p);
      const t = draft;
      if (!t.trim() || t === original) n.delete(keyOf(sid, i));
      else n.set(keyOf(sid, i), t);
      return n;
    });
    setEditing(null);
    saveRequestId.current = null;
  };
  const saveEdits = () => {
    if (!edits.size || create.isPending) return;
    saveRequestId.current ??= crypto.randomUUID();
    setSaveError(null);
    const payload = [...edits].map(([k, text]) => {
      const [sectionId, idx] = k.split(':');
      return { sectionId, blockIndex: Number(idx), text };
    });
    create.mutate(
      { requestId: saveRequestId.current, baseVersionId: latest.id, edits: payload },
      {
        onSuccess: (v) => {
          setEdits(new Map());
          saveRequestId.current = null;
          setSelectedId(v.id);
          toast({
            title: 'حُفظ إصدار جديد',
            description: `${vLabel(v)} — بقي الإصدار السابق محفوظًا كما هو.`,
          });
        },
        onError: (e) =>
          setSaveError(mutationErrorText(e, 'تعذّر حفظ الإصدار. تعديلاتك باقية؛ حاول مرة أخرى.')),
      },
    );
  };
  const doRestore = () => {
    create.mutate(
      { requestId: crypto.randomUUID(), baseVersionId: latest.id, restoreVersionId: selected.id },
      {
        onSuccess: (v) => {
          setRestoreOpen(false);
          setSelectedId(v.id);
          toast({
            title: 'استُعيد المحتوى كإصدار جديد',
            description: `${vLabel(v)}. لم يُحذف أي إصدار.`,
          });
        },
        onError: (e) =>
          toast({
            title: 'تعذّرت الاستعادة',
            description: mutationErrorText(e, 'لم يُنشأ إصدار جديد.'),
            variant: 'destructive',
          }),
      },
    );
  };
  const accept = (it) => {
    // Only proposals made on the current latest version may apply; stable requestId keeps retries idempotent.
    if (it.versionId !== latest.id || busyId || actionFence.current) return;
    let rid = acceptIds.current.get(it.id);
    if (!rid) {
      rid = crypto.randomUUID();
      acceptIds.current.set(it.id, rid);
    }
    actionFence.current = true;
    setBusyId(it.id);
    create.mutate(
      { requestId: rid, baseVersionId: latest.id, proposalId: it.id },
      {
        onSuccess: (v) => {
          setSelectedId(v.id);
          toast({
            title: 'قُبلت المراجعة كإصدار جديد',
            description: 'عُدّلت الفقرة المستهدفة فقط.',
          });
        },
        onError: (e) =>
          toast({
            title: 'تعذّر القبول',
            description: mutationErrorText(e, 'لم يُنشأ إصدار جديد.'),
            variant: 'destructive',
          }),
        onSettled: () => {
          actionFence.current = false;
          setBusyId(null);
        },
      },
    );
  };
  const doExecute = (it) => {
    if (
      it.executionApproved !== true ||
      it.status !== 'prepared' ||
      it.executionSync ||
      interactions.isError ||
      busyId ||
      actionFence.current
    )
      return;
    actionFence.current = true;
    setBusyId(it.id);
    execute.mutate(it.id, {
      onSuccess: () =>
        toast({
          title: 'بدأ التنفيذ',
          description: 'نتابع حالته تلقائيًا، وتظهر النتيجة المحفوظة هنا عند اكتمالها.',
        }),
      onError: (e) =>
        toast({
          title: 'تعذّر تأكيد حالة التنفيذ',
          description:
            `${mutationErrorText(e, '')} نتابع الحالة المحفوظة دون إعادة إرسال الطلب.`.trim(),
        }),
      onSettled: () => {
        actionFence.current = false;
        setBusyId(null);
      },
    });
  };
  const doReject = (it) => {
    if (busyId || actionFence.current) return;
    actionFence.current = true;
    setBusyId(it.id);
    reject.mutate(it.id, {
      onSuccess: () =>
        toast({ title: 'رُفضت المراجعة المقترحة', description: 'لم يتغير التقرير.' }),
      onError: (e) =>
        toast({
          title: 'تعذّر الرفض',
          description: mutationErrorText(e, 'حاول مرة أخرى.'),
          variant: 'destructive',
        }),
      onSettled: () => {
        actionFence.current = false;
        setBusyId(null);
      },
    });
  };
  const selectedIndex = list.findIndex((v) => v.id === selected.id);
  const compareTarget = list.find((v) => v.id === compareWith) ?? list[selectedIndex - 1];
  const changes = compareTarget ? diff(compareTarget.report, report) : [];
  if (versions.isLoading)
    return (
      <div className="space-y-3" aria-busy="true" data-testid="report-loading">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  return (
    <div data-testid="real-report" className="space-y-4">
      {versions.isError && (
        <div role="alert" className="rounded-xl bg-muted/70 px-4 py-3 text-[13.5px] leading-7">
          تعذّر تحميل إصدارات التقرير. يُعرض التقرير الأصلي المحفوظ للقراءة فقط.
          <button
            type="button"
            className={`${RBTN} mt-2 flex`}
            onClick={() => void versions.refetch()}
            disabled={versions.isFetching}
            data-testid="button-retry-versions"
          >
            <RefreshCw
              className={`h-4 w-4 ${versions.isFetching ? 'animate-spin' : ''}`}
              aria-hidden
            />
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Version bar */}
      <div
        className="rounded-xl bg-card p-3 shadow-[0_1px_2px_hsl(var(--foreground)/0.06),0_0_0_1px_hsl(var(--border))] sm:p-4"
        data-testid="version-panel"
      >
        <div className="flex flex-wrap items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden />
          <label htmlFor="version-select" className="text-[12.5px] text-muted-foreground">
            الإصدار
          </label>
          <select
            id="version-select"
            value={selected.id}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={!live || edits.size > 0}
            data-testid="select-version"
            className="min-h-10 min-w-0 flex-1 rounded-md border bg-background px-2 text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none"
          >
            {(live ? list : [fallback])
              .slice()
              .reverse()
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {vLabel(v)} · {KIND[v.kind]}
                  {v.id === latest.id ? ' · الأحدث' : ''}
                </option>
              ))}
          </select>
        </div>
        <p
          className="mt-2 text-[12.5px] leading-6 text-muted-foreground"
          data-testid="text-version-current"
        >
          {KIND[selected.kind]} · {fmt(selected.createdAt)}
          {isLatest ? ' · أحدث إصدار' : ' · إصدار سابق للقراءة'}
          {edits.size > 0 && ' · احفظ التعديلات أو تجاهلها قبل تبديل الإصدار'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={RBTN}
            onClick={() => void doCopy(reportText(report, selected, op), 'التقرير كاملًا')}
            data-testid="button-copy-report"
          >
            <Copy className="h-4 w-4" aria-hidden />
            نسخ التقرير
          </button>
          <button
            type="button"
            className={RBTN}
            onClick={() => void doExport('docx')}
            disabled={!live || exporting !== null}
            data-testid="button-export-docx"
          >
            <FileDown className="h-4 w-4" aria-hidden />
            {exporting === 'docx' ? 'جارٍ التجهيز…' : 'Word'}
          </button>
          <button
            type="button"
            className={RBTN}
            onClick={() => void doExport('pdf')}
            disabled={!live || exporting !== null}
            data-testid="button-export-pdf"
          >
            <FileDown className="h-4 w-4" aria-hidden />
            {exporting === 'pdf' ? 'جارٍ التجهيز…' : 'PDF'}
          </button>
          {list.length > 1 && (
            <button
              type="button"
              className={RBTN}
              onClick={() => {
                setCompareWith(null);
                setCompareOpen(true);
              }}
              disabled={list.length < 2}
              data-testid="button-compare"
            >
              <GitCompare className="h-4 w-4" aria-hidden />
              مقارنة
            </button>
          )}
          {live && !isLatest && (
            <button
              type="button"
              className={RBTN}
              onClick={() => setRestoreOpen(true)}
              data-testid="button-restore"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              استعادة كإصدار جديد
            </button>
          )}
          {!isLatest && (
            <button
              type="button"
              className={RBTN}
              onClick={() => setSelectedId(latest.id)}
              data-testid="button-return-latest"
            >
              العودة للأحدث
            </button>
          )}
        </div>
      </div>

      {savedElsewhere.length > 0 && (
        <aside
          className="rounded-xl border bg-muted/30 px-3 py-3 text-[13px] leading-7"
          aria-label="طلبات محفوظة في إصدارات أخرى"
          data-testid="saved-interactions-other-versions"
        >
          <p className="font-medium">توجد مناقشات أو مراجعات محفوظة في إصدارات أخرى</p>
          <p className="text-muted-foreground">
            كل طلب مرتبط بإصداره وفقرتِه الأصلية؛ فتحه لا يغيّر التقرير ولا يبدأ أي تنفيذ.
          </p>
          <ul className="mt-2 space-y-2">
            {savedElsewhere.map((it) => {
              const version = list.find((v) => v.id === it.versionId);
              return (
                <li
                  key={it.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                  data-testid={`saved-interaction-link-${it.id}`}
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-medium">
                      {it.kind === 'discuss'
                        ? 'مناقشة'
                        : it.status === 'accepted'
                          ? 'مراجعة مقبولة صراحةً'
                          : 'مراجعة مقترحة'}
                    </span>{' '}
                    · {version ? vLabel(version) : 'إصدار غير متاح'} ·{' '}
                    {TITLES[it.sectionId] ?? it.sectionId} · الفقرة{' '}
                    {(it.blockIndex + 1).toLocaleString('ar-SA')}
                  </span>
                  <button
                    type="button"
                    className={RBTN}
                    onClick={() => openSavedInteraction(it)}
                    disabled={!version || dirty || busyId !== null}
                    data-testid={`button-open-saved-interaction-${it.id}`}
                  >
                    عرض {it.kind === 'discuss' ? 'المناقشة' : 'المراجعة'} المحفوظة
                  </button>
                </li>
              );
            })}
          </ul>
          {dirty && (
            <p className="mt-2 text-muted-foreground">
              احفظ التعديلات أو تجاهلها قبل فتح إصدار آخر.
            </p>
          )}
        </aside>
      )}

      <header className="px-0.5">
        <h3 className="text-[18px] font-semibold leading-8">{report.title}</h3>
        {report.change_summary && (
          <p className="mt-1 text-[13.5px] leading-7 text-muted-foreground">
            {report.change_summary}
          </p>
        )}
      </header>
      {report.alerts.length > 0 && (
        <ul className="space-y-2" aria-label="تنبيهات التقرير" data-testid="list-report-alerts">
          {report.alerts.map((al, i) => {
            const high = al.severity === 'high' || al.severity === 'critical';
            const long = al.message.length > 180;
            return (
              <li
                key={i}
                role="note"
                data-testid={`card-alert-${i}`}
                className={`rounded-lg border-s-[3px] px-3.5 py-2.5 shadow-[0_0_0_1px_hsl(var(--border))] ${high ? 'border-s-destructive bg-destructive/5' : 'border-s-muted-foreground/40 bg-muted/30'}`}
              >
                <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                  <AlertTriangle
                    className={`h-3.5 w-3.5 ${high ? 'text-destructive' : ''}`}
                    aria-hidden
                  />
                  {high ? 'تنبيه جوهري' : 'تنبيه'} {(i + 1).toLocaleString('ar-SA')}
                </p>
                {long && !high ? (
                  <details open className="group mt-1" data-testid={`details-alert-${i}`}>
                    <summary className="cursor-pointer list-none text-[14px] leading-7 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                      <span className="group-open:hidden">
                        {al.message.slice(0, 160)}…{' '}
                        <span className="text-[12px] text-muted-foreground underline underline-offset-4">
                          عرض التفاصيل
                        </span>
                      </span>
                      <span className="hidden text-[12px] text-muted-foreground underline underline-offset-4 group-open:inline">
                        إخفاء التفاصيل
                      </span>
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap text-[14px] leading-7 [overflow-wrap:anywhere]">
                      {al.message}
                    </p>
                  </details>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-7 [overflow-wrap:anywhere]">
                    {al.message}
                  </p>
                )}
                {al.attachment_id && (
                  <p className="mt-1 text-[12px] leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                    المرفق: {sourceLabel([al.attachment_id], op)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sections.length > 1 && (
        <nav
          aria-label="أقسام التقرير"
          data-testid="nav-report-sections"
          className="sticky top-0 z-[5] -mx-1 bg-background/95 px-1 py-1.5 backdrop-blur"
        >
          <ul className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sections.map((s) => (
              <li key={s.section_id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => goTo(s.section_id)}
                  data-testid={`button-nav-section-${s.section_id}`}
                  className={`min-h-9 whitespace-nowrap rounded-full border px-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${open.has(s.section_id) ? 'border-foreground/30 bg-accent font-medium text-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                >
                  {TITLES[s.section_id]}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="space-y-3">
        {sections.map((s) => {
          const isOpen = open.has(s.section_id);
          return (
            <section
              key={s.section_id}
              id={`real-section-${s.section_id}`}
              className="scroll-mt-14 overflow-hidden rounded-xl bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.05),0_0_0_1px_hsl(var(--border))]"
              data-testid={`real-section-${s.section_id}`}
            >
              <div className="flex items-center gap-1 pe-1">
                <h4 className="min-w-0 flex-1">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`real-body-${s.section_id}`}
                    onClick={() => toggle(s.section_id)}
                    data-testid={`button-toggle-section-${s.section_id}`}
                    className="flex min-h-12 w-full items-center justify-between gap-2 px-4 py-2 text-right text-[15.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span>
                      {TITLES[s.section_id]}
                      {(interactions.data ?? []).some(
                        (it) => it.versionId === selected.id && it.sectionId === s.section_id,
                      ) && (
                        <span className="ms-2 text-[12px] font-normal text-muted-foreground">
                          طلبات محفوظة
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>
                </h4>
                <button
                  type="button"
                  aria-label={`نسخ قسم ${TITLES[s.section_id]}`}
                  onClick={() => void doCopy(sectionText(s, op), `قسم ${TITLES[s.section_id]}`)}
                  data-testid={`button-copy-section-${s.section_id}`}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              {isOpen && (
                <div id={`real-body-${s.section_id}`} className="space-y-1 px-4 pb-4">
                  {s.blocks.map((b, i) => {
                    const k = keyOf(s.section_id, i);
                    const pending = edits.get(k);
                    const note = provenanceNote(b, op);
                    const its = (interactions.data ?? []).filter(
                      (x) =>
                        x.versionId === selected.id &&
                        x.sectionId === s.section_id &&
                        x.blockIndex === i,
                    );
                    const target = {
                      versionId: selected.id,
                      versionLabel: vLabel(selected),
                      sectionId: s.section_id,
                      sectionTitle: TITLES[s.section_id],
                      blockIndex: i,
                      text: b.text,
                    };
                    return (
                      <div
                        key={k}
                        className={`group rounded-lg px-1 py-3 -mx-1 sm:px-2 sm:-mx-2 ${pending ? 'bg-accent/60' : ''}`}
                        data-testid={`paragraph-${k}`}
                      >
                        <div className="flex items-start gap-0.5 sm:gap-1">
                          <div className="min-w-0 flex-1">
                            {editing === k ? (
                              <div className="space-y-2">
                                <textarea
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  autoFocus
                                  rows={Math.min(12, Math.max(4, Math.ceil(draft.length / 60)))}
                                  aria-label="تعديل نص الفقرة"
                                  data-testid={`input-edit-${k}`}
                                  className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-[15px] leading-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                                <p className="text-[12px] text-muted-foreground">
                                  تُمسح مراجع الفقرة عند تعديلها؛ يبقى المرجع الأصلي للسياق فقط.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className={RPRIMARY}
                                    onClick={() => commitEdit(s.section_id, i, b.text)}
                                    data-testid={`button-done-edit-${k}`}
                                  >
                                    إضافة إلى التعديلات
                                  </button>
                                  <button
                                    type="button"
                                    className={RBTN}
                                    onClick={() => setEditing(null)}
                                    data-testid={`button-cancel-edit-${k}`}
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="max-w-[68ch] whitespace-pre-wrap break-words text-[15px] leading-[1.95] sm:text-[15.5px]">
                                {pending ?? b.text}
                              </p>
                            )}
                            <p
                              className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-6 text-muted-foreground"
                              data-testid={`text-classification-${k}`}
                            >
                              <span className="rounded bg-muted px-1.5 font-medium text-foreground/80">
                                {BASIS[b.basis] ?? 'غير مصنف'}
                              </span>
                              <span className="min-w-0 [overflow-wrap:anywhere]">
                                {pending
                                  ? 'المرجع: يُمسح عند الحفظ'
                                  : b.source_refs.length
                                    ? `المصدر: ${sourceLabel(b.source_refs, op)}`
                                    : 'لا يوجد مرجع'}
                              </span>
                              {!pending && b.source_refs.length > 0 && (
                                <bdi
                                  className="min-w-0 font-mono text-[11px] [overflow-wrap:anywhere]"
                                  data-testid={`text-source-refs-${k}`}
                                >
                                  {b.source_refs.join('، ')}
                                </bdi>
                              )}
                              {pending && (
                                <span className="rounded bg-background px-1.5 font-medium text-foreground">
                                  تعديل غير محفوظ
                                </span>
                              )}
                            </p>
                            {note && (
                              <p
                                className="mt-1 text-[12px] leading-6 text-muted-foreground"
                                data-testid={`text-provenance-${k}`}
                              >
                                {note}
                              </p>
                            )}
                          </div>
                          {editing !== k && (
                            <DropdownMenu dir="rtl" modal={false}>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="إجراءات الفقرة"
                                  data-testid={`button-paragraph-menu-${k}`}
                                  className="-mt-1.5 -me-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent sm:me-0"
                                >
                                  <MoreHorizontal className="h-[18px] w-[18px]" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                collisionPadding={12}
                                className="w-[min(15rem,calc(100vw-1.5rem))] rounded-lg p-1"
                              >
                                <DropdownMenuItem
                                  disabled={!live}
                                  className="min-h-10 gap-2 text-[14px]"
                                  onSelect={() => setDialog({ target, kind: 'discuss' })}
                                  data-testid={`menuitem-discuss-${k}`}
                                >
                                  <MessageSquareText className="h-4 w-4" />
                                  ناقش هذه الفقرة
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!live || !isLatest}
                                  className="min-h-10 gap-2 text-[14px]"
                                  onSelect={() => startEdit(s.section_id, i, b.text)}
                                  data-testid={`menuitem-edit-${k}`}
                                >
                                  <PencilLine className="h-4 w-4" />
                                  تعديل يدوي
                                  {!isLatest && (
                                    <span className="text-[11px] text-muted-foreground">
                                      (الأحدث فقط)
                                    </span>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!live}
                                  className="min-h-10 gap-2 text-[14px]"
                                  onSelect={() => setDialog({ target, kind: 'revise' })}
                                  data-testid={`menuitem-revise-${k}`}
                                >
                                  <FilePenLine className="h-4 w-4" />
                                  طلب مراجعة مقترحة
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="min-h-10 gap-2 text-[14px]"
                                  onSelect={() => void doCopy(blockText(b, op), 'الفقرة')}
                                  data-testid={`menuitem-copy-${k}`}
                                >
                                  <Copy className="h-4 w-4" />
                                  نسخ الفقرة
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                        <InteractionThread
                          items={its}
                          currentText={b.text}
                          latestVersionId={latest.id}
                          canDecide={isLatest && edits.size === 0 && editing === null}
                          onAccept={accept}
                          onReject={doReject}
                          onExecute={doExecute}
                          busyId={busyId}
                          statusUnavailable={interactions.isError}
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

      {interactions.isError && (
        <p className="text-[12.5px] text-muted-foreground">
          تعذّر تحميل طلبات المناقشة والمراجعة.{' '}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => void interactions.refetch()}
            data-testid="button-retry-interactions"
          >
            إعادة المحاولة
          </button>
        </p>
      )}

      {edits.size > 0 && (
        <div
          className="sticky bottom-[max(12px,env(safe-area-inset-bottom))] z-10 rounded-xl bg-card p-3 shadow-[0_4px_16px_hsl(var(--foreground)/0.12),0_0_0_1px_hsl(var(--border))]"
          data-testid="bar-pending-edits"
          role="region"
          aria-label="تعديلات غير محفوظة"
        >
          <p className="text-[13.5px] font-medium">
            {edits.size.toLocaleString('ar-SA')} تعديل غير محفوظ
          </p>
          <p className="text-[12px] leading-6 text-muted-foreground">
            يُحفظ كإصدار جديد؛ لا يُستبدل أي إصدار سابق.
          </p>
          {saveError && (
            <p role="alert" className="mt-1 text-[12.5px] leading-6 text-destructive">
              {saveError}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={RPRIMARY}
              onClick={saveEdits}
              disabled={create.isPending}
              data-testid="button-save-version"
            >
              {create.isPending ? 'جارٍ الحفظ…' : 'حفظ كإصدار جديد'}
            </button>
            {saveError && (
              <button
                type="button"
                className={RBTN}
                onClick={() => void versions.refetch()}
                data-testid="button-refresh-versions"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                تحديث الإصدارات
              </button>
            )}
            <button
              type="button"
              className={RBTN}
              onClick={() => {
                setEdits(new Map());
                setSaveError(null);
                saveRequestId.current = null;
              }}
              disabled={create.isPending}
              data-testid="button-discard-edits"
            >
              تجاهل التعديلات
            </button>
          </div>
        </div>
      )}

      {dialog && (
        <InteractionDialog
          caseId={caseId}
          operationId={operationId}
          target={dialog.target}
          kind={dialog.kind}
          onClose={() => setDialog(null)}
        />
      )}

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent
          dir="rtl"
          className="max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-2xl overflow-y-auto rounded-xl p-5 text-right"
        >
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle className="pl-8 text-[16px]">مقارنة الإصدارات</DialogTitle>
            <DialogDescription className="text-[12.5px]">
              المعروض: {vLabel(selected)}. اختر الإصدار المقارن به.
            </DialogDescription>
          </DialogHeader>
          <select
            value={compareTarget?.id ?? ''}
            onChange={(e) => setCompareWith(e.target.value)}
            data-testid="select-compare-with"
            aria-label="الإصدار المقارن به"
            className="min-h-10 rounded-md border bg-background px-2 text-[13.5px]"
          >
            {list
              .filter((v) => v.id !== selected.id)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {vLabel(v)} · {KIND[v.kind]}
                </option>
              ))}
          </select>
          {!compareTarget ? (
            <p className="text-[13.5px] text-muted-foreground">لا يوجد إصدار آخر للمقارنة.</p>
          ) : changes.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground" data-testid="text-no-changes">
              لا فروق في نصوص الفقرات.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="list-changes">
              {changes.map((c) => (
                <li key={keyOf(c.sid, c.i)} className="rounded-lg bg-muted/50 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">
                    {TITLES[c.sid]} · الفقرة {(c.i + 1).toLocaleString('ar-SA')}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md bg-card px-3 py-2">
                      <p className="text-[11.5px] text-muted-foreground">{vLabel(compareTarget)}</p>
                      <p className="whitespace-pre-wrap text-[14px] leading-7">{c.before ?? '—'}</p>
                    </div>
                    <div className="rounded-md bg-card px-3 py-2 ring-1 ring-foreground/15">
                      <p className="text-[11.5px] text-muted-foreground">{vLabel(selected)}</p>
                      <p className="whitespace-pre-wrap text-[14px] leading-7">{c.after ?? '—'}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent
          dir="rtl"
          className="w-[calc(100%_-_1.5rem)] max-w-sm rounded-xl p-5 text-right"
        >
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle className="pl-8 text-[16px]">استعادة {vLabel(selected)}؟</DialogTitle>
            <DialogDescription className="leading-7">
              يُنشأ إصدار جديد بمحتوى هذا الإصدار. تبقى جميع الإصدارات، بما فيها الأحدث، محفوظة دون
              تغيير.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={RPRIMARY}
              onClick={doRestore}
              disabled={create.isPending}
              data-testid="button-confirm-restore"
            >
              {create.isPending ? 'جارٍ…' : 'استعادة كإصدار جديد'}
            </button>
            <button
              type="button"
              className={RBTN}
              onClick={() => setRestoreOpen(false)}
              data-testid="button-cancel-restore"
            >
              إلغاء
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

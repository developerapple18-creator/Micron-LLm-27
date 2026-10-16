/**
 * Paragraph-scoped interaction: request dialog (saves a PREPARED request only)
 * and the saved-interaction thread under each paragraph. Nothing here executes
 * AI work starts only through an explicit, server-authorized execution action.
 */
import { useEffect, useState } from 'react';
import { Check, Clock, FilePenLine, MessageSquareText, Send, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { interactionElapsed } from '@/lib/report-interaction-status';
import { mutationErrorText, usePrepareInteraction } from '@/lib/report-api';
export const RBTN =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-[13.5px] font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export const RPRIMARY = `${RBTN} border-foreground bg-foreground text-background hover:bg-foreground/90`;
export function InteractionDialog({ caseId, operationId, target, kind, onClose }) {
  const [instruction, setInstruction] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const prepare = usePrepareInteraction(caseId, operationId);
  const { toast } = useToast();
  const isDiscuss = kind === 'discuss';
  const submit = () => {
    const text = instruction.trim();
    if (!text || prepare.isPending) return;
    prepare.mutate(
      {
        requestId,
        versionId: target.versionId,
        sectionId: target.sectionId,
        blockIndex: target.blockIndex,
        kind,
        instruction: text,
      },
      {
        onSuccess: () => {
          toast({
            title: 'حُفظ الطلب',
            description:
              'لم يبدأ التنفيذ بعد. يمكنك بدء الطلب المحفوظ من إجراء «تنفيذ الطلب» بجوار الفقرة.',
          });
          onClose();
        },
      },
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
        className="max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-lg overflow-y-auto rounded-xl p-5 text-right"
      >
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="pl-8 text-[16px]">
            {isDiscuss ? 'مناقشة الفقرة' : 'طلب مراجعة مقترحة للفقرة'}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-6">
            {target.versionLabel} · {target.sectionTitle} · الفقرة{' '}
            {(target.blockIndex + 1).toLocaleString('ar-SA')}
          </DialogDescription>
        </DialogHeader>
        <blockquote
          className="max-h-48 overflow-y-auto rounded-lg bg-muted/60 px-3.5 py-3 text-[14px] leading-7 whitespace-pre-wrap"
          data-testid="text-interaction-paragraph"
        >
          {target.text}
        </blockquote>
        <label className="block text-[13px] font-medium" htmlFor="interaction-instruction">
          {isDiscuss ? 'سؤالك عن هذه الفقرة تحديدًا' : 'ما الذي تريد تغييره في هذه الفقرة؟'}
        </label>
        <textarea
          id="interaction-instruction"
          autoFocus
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={2000}
          rows={4}
          data-testid="input-interaction-instruction"
          className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-[14.5px] leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-[12.5px] leading-6 text-muted-foreground">
          يُحفظ الطلب مرتبطًا بهذه الفقرة وإصدارها فقط، ولا يُرسل إلى أي نموذج الآن. يبدأ التنفيذ
          عند اختيارك «تنفيذ الطلب».
          {!isDiscuss &&
            ' أي نص مقترح لاحقًا يُعرض للمقارنة ولا يُطبَّق إلا بقبولك، ويمس هذه الفقرة وحدها.'}
        </p>
        {prepare.isError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
          >
            {mutationErrorText(prepare.error, 'تعذّر حفظ الطلب. نصك باقٍ؛ حاول مرة أخرى.')}
          </p>
        )}
        <div className="flex flex-wrap justify-start gap-2">
          <button
            type="button"
            className={RPRIMARY}
            onClick={submit}
            disabled={!instruction.trim() || prepare.isPending}
            data-testid="button-save-interaction"
          >
            {prepare.isPending ? 'جارٍ الحفظ…' : 'حفظ الطلب'}
          </button>
          <button
            type="button"
            className={RBTN}
            onClick={onClose}
            data-testid="button-cancel-interaction"
          >
            إلغاء
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
const STATUS = {
  prepared: 'محفوظ — جاهز للتنفيذ',
  running: 'قيد التنفيذ',
  completed: 'اكتمل',
  failed: 'تعذّر الإكمال',
  accepted: 'قُبل',
  rejected: 'رُفض',
};
function ExecutionProgress({ item, unavailable }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (item.status !== 'running') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [item.status, item.startedAt]);
  const elapsed = interactionElapsed(
    item.startedAt,
    item.status === 'running' ? now : item.finishedAt ? Date.parse(item.finishedAt) : now,
  );
  return (
    <div className="mt-2 space-y-1 text-[12px] leading-6 text-muted-foreground">
      {item.status === 'running' && (
        <p className="flex flex-wrap items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>جارٍ المعالجة على الخادم</span>
          {elapsed ? (
            <time
              dir="ltr"
              className="font-mono tabular-nums text-foreground"
              aria-label="الوقت المنقضي"
              data-testid={`elapsed-interaction-${item.id}`}
            >
              {elapsed}
            </time>
          ) : (
            <span>جارٍ مزامنة وقت البدء…</span>
          )}
        </p>
      )}
      {(item.status === 'running' || item.executionSync) && (
        <p>
          نتابع الحالة تلقائيًا؛ سيظهر الرد المحفوظ هنا. مغادرة الصفحة لا تلغي التنفيذ ولا تعيد
          إرساله.
        </p>
      )}
      {(unavailable || item.executionSync === 'uncertain') && (
        <p role="status" data-testid={`sync-warning-${item.id}`}>
          تعذّر مؤقتًا تأكيد حالة الطلب. لا يعني ذلك فشل التنفيذ. نزامن الحالة عند عودة الاتصال
          والصلاحيات، دون إعادة تنفيذ الطلب.
        </p>
      )}
    </div>
  );
}
export function InteractionThread({
  items,
  currentText,
  latestVersionId,
  canDecide,
  onAccept,
  onReject,
  onExecute,
  busyId,
  statusUnavailable = false,
}) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-2" data-testid="list-paragraph-interactions">
      {items.map((it) => (
        <li
          key={it.id}
          id={`report-interaction-${it.id}`}
          tabIndex={-1}
          className="min-w-0 break-words rounded-lg border border-border/60 bg-muted/40 px-3 py-3 text-[13px] leading-6 [overflow-wrap:anywhere] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`interaction-${it.id}`}
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
            {it.kind === 'discuss' ? (
              <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <FilePenLine className="h-3.5 w-3.5" aria-hidden />
            )}
            <span className="font-medium text-foreground/80">
              {it.kind === 'discuss' ? 'مناقشة' : 'مراجعة مقترحة'}
            </span>
            <span aria-hidden>·</span>
            <span role="status" data-testid={`status-interaction-${it.id}`}>
              {it.executionSync === 'submitting' || (busyId === it.id && it.status === 'prepared')
                ? 'جارٍ تجهيز التنفيذ…'
                : it.executionSync === 'uncertain'
                  ? 'جارٍ التحقق من حالة التنفيذ'
                  : STATUS[it.status]}
            </span>
          </p>
          <p className="mt-1 whitespace-pre-wrap">{it.instruction}</p>
          {(it.status === 'prepared' || it.status === 'running') && (
            <p className="mt-1 flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <Clock className="mt-1 h-3 w-3 shrink-0" aria-hidden />
              {it.status === 'prepared' && !it.executionSync
                ? it.executionApproved === true
                  ? 'الطلب محفوظ وجاهز. يبدأ فقط عند ضغط تنفيذ الطلب أدناه.'
                  : 'لم يُنفّذ. حدّث الحالة للتحقق من إتاحة الطلب.'
                : 'تجري مزامنة الحالة المحفوظة تلقائيًا.'}
            </p>
          )}
          <ExecutionProgress item={it} unavailable={statusUnavailable} />
          {it.status === 'prepared' && it.executionApproved === true && (
            <button
              type="button"
              className={`${RPRIMARY} mt-2`}
              disabled={busyId !== null || !!it.executionSync || statusUnavailable}
              onClick={() => onExecute(it)}
              data-testid={`button-execute-${it.id}`}
            >
              <Send className="h-4 w-4" aria-hidden />
              {busyId === it.id ? 'جارٍ إرسال الطلب…' : 'تنفيذ الطلب'}
            </button>
          )}
          {it.status === 'failed' && (
            <p className="mt-1 text-[12px] text-destructive">
              سجّل الخادم تعذّر الإكمال. لن يُعاد التنفيذ تلقائيًا، ولم يُعتمد أي تعديل.
            </p>
          )}
          {it.kind === 'discuss' && it.answer && (
            <div className="mt-2 rounded-md bg-card px-3 py-2">
              <p className="text-[11.5px] text-muted-foreground">الرد (غير متحقق منه)</p>
              <p className="whitespace-pre-wrap text-[14px] leading-7">{it.answer}</p>
            </div>
          )}
          {it.kind === 'revise' && it.status === 'completed' && it.proposedText !== null && (
            <div className="mt-2 space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md bg-card px-3 py-2">
                  <p className="text-[11.5px] text-muted-foreground">النص الحالي</p>
                  <p className="whitespace-pre-wrap text-[14px] leading-7">{currentText}</p>
                </div>
                <div className="rounded-md bg-card px-3 py-2 ring-1 ring-foreground/15">
                  <p className="text-[11.5px] text-muted-foreground">النص المقترح</p>
                  <p
                    className="whitespace-pre-wrap text-[14px] leading-7"
                    data-testid={`text-proposed-${it.id}`}
                  >
                    {it.proposedText}
                  </p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">
                أي ادعاء جديد أو معدّل في النص المقترح غير متحقق منه، ولا تُنقل إليه مراجع الفقرة
                الأصلية بوصفها إثباتًا.
              </p>
              {!!it.sourceRefs.length && (
                <p className="break-words text-[12px] text-muted-foreground" dir="rtl">
                  إحالات اقترحها المزود للسياق فقط، دون تحقق:{' '}
                  <bdi className="break-all">{it.sourceRefs.join('، ')}</bdi>
                </p>
              )}
              {canDecide && it.versionId === latestVersionId ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={RPRIMARY}
                    disabled={busyId !== null}
                    onClick={() => onAccept(it)}
                    data-testid={`button-accept-${it.id}`}
                  >
                    <Check className="h-4 w-4" aria-hidden />
                    {busyId === it.id ? 'جارٍ…' : 'قبول كإصدار جديد'}
                  </button>
                  <button
                    type="button"
                    className={RBTN}
                    disabled={busyId !== null}
                    onClick={() => onReject(it)}
                    data-testid={`button-reject-${it.id}`}
                  >
                    <X className="h-4 w-4" aria-hidden />
                    رفض
                  </button>
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  {it.versionId !== latestVersionId
                    ? 'أُعدّ هذا المقترح على إصدار أقدم؛ لا يمكن تطبيقه على الإصدار الأحدث. اطلب مراجعة جديدة من الإصدار الأحدث.'
                    : 'القبول أو الرفض متاح من أحدث إصدار دون تعديلات غير محفوظة.'}
                </p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

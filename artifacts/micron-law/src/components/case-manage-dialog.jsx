/**
 * Compact case management beside the case header: client association,
 * archive/restore and optional private SAR fee records. Never touches the
 * legal conversation or analysis.
 */
import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, Banknote, PencilLine, Plus, UserRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { ClientFormDialog, GHOST, INPUT, LABEL, SOLID } from '@/components/client-form';
import { mutationErrorText, useUpdateCase } from '@/lib/report-api';
import { errorText } from '@/lib/session';
import {
  formatSAR,
  MONEY_RE,
  normalizeMoney,
  todayISO,
  useClients,
  useCreateReceipt,
  useFees,
  useSaveAgreement,
  useUpdateReceipt,
} from '@/lib/workspace-api';
export function CaseManageDialog({ caseInfo, open, onOpenChange, initialTab = 'client' }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="flex max-h-[92dvh] w-[calc(100%_-_1rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-xl p-0 text-right"
      >
        <DialogHeader className="border-b p-5 pb-3 text-right sm:text-right">
          <DialogTitle className="pl-8 text-[16px] leading-6 [overflow-wrap:anywhere]">
            إدارة القضية
          </DialogTitle>
          <DialogDescription className="truncate text-[12.5px]">
            {caseInfo.title || 'قضية بدون عنوان'}
          </DialogDescription>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-accent/60 p-1" role="tablist">
            {[
              ['client', 'الموكل والأرشفة', UserRound],
              ['fees', 'الأتعاب', Banknote],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                data-testid={`tab-manage-${id}`}
                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium ${tab === id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'client' ? <ClientTab caseInfo={caseInfo} /> : <FeesTab caseId={caseInfo.id} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
function ClientTab({ caseInfo }) {
  const clients = useClients();
  const updateCase = useUpdateCase();
  const { toast } = useToast();
  const [value, setValue] = useState(caseInfo.clientId ?? '');
  const [creating, setCreating] = useState(false);
  const archived = !!caseInfo.archivedAt;
  const save = (clientId, msg) =>
    updateCase.mutate(
      { caseId: caseInfo.id, clientId },
      {
        onSuccess: () => {
          setValue(clientId ?? '');
          toast({ title: msg });
        },
      },
    );
  const toggleArchive = () =>
    updateCase.mutate(
      { caseId: caseInfo.id, archived: !archived },
      {
        onSuccess: () =>
          toast({
            title: archived ? 'استُعيدت القضية من الأرشيف' : 'أُرشفت القضية',
            description: archived ? undefined : 'يمكن استعادتها في أي وقت من الأرشيف.',
          }),
        onError: (e) =>
          toast({
            title: 'تعذّر الحفظ',
            description: mutationErrorText(e, 'حاول مرة أخرى.'),
            variant: 'destructive',
          }),
      },
    );
  const dirty = value !== (caseInfo.clientId ?? '');
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[13.5px] font-semibold">الموكل المرتبط</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground" data-testid="text-current-client">
          {caseInfo.clientName ? `حاليًا: ${caseInfo.clientName}` : 'لا يوجد موكل مرتبط.'}
        </p>
        {clients.isLoading ? (
          <Skeleton className="mt-3 h-11 w-full" />
        ) : clients.isError ? (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            تعذّر تحميل الموكلين.{' '}
            <button
              className="underline"
              onClick={() => void clients.refetch()}
              data-testid="button-retry-manage-clients"
            >
              إعادة
            </button>
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            <select
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="اختيار الموكل"
              className={INPUT}
              data-testid="select-case-client"
            >
              <option value="">دون موكل</option>
              {[...(clients.data ?? [])]
                .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!dirty || updateCase.isPending}
                onClick={() =>
                  save(value || null, value ? 'رُبط الموكل بالقضية' : 'أُزيل ربط الموكل')
                }
                className={`${SOLID} min-h-10`}
                data-testid="button-save-case-client"
              >
                {updateCase.isPending ? 'جارٍ الحفظ…' : 'حفظ الربط'}
              </button>
              {caseInfo.clientId && (
                <button
                  type="button"
                  disabled={updateCase.isPending}
                  onClick={() => save(null, 'أُزيل ربط الموكل')}
                  className={`${GHOST} min-h-10`}
                  data-testid="button-remove-case-client"
                >
                  إزالة الربط
                </button>
              )}
              <button
                type="button"
                onClick={() => setCreating(true)}
                className={`${GHOST} min-h-10`}
                data-testid="button-create-client-inline"
              >
                <Plus className="h-4 w-4" />
                موكل جديد
              </button>
            </div>
          </div>
        )}
        {updateCase.isError && (
          <p role="alert" className="mt-2 text-[12.5px] text-destructive">
            {mutationErrorText(updateCase.error, 'تعذّر الحفظ. حاول مرة أخرى.')}
          </p>
        )}
      </section>
      <section className="rounded-lg border p-4">
        <h3 className="text-[13.5px] font-semibold">{archived ? 'القضية مؤرشفة' : 'الأرشفة'}</h3>
        <p className="mt-1 text-[12.5px] leading-6 text-muted-foreground">
          {archived
            ? 'لا تظهر في القضايا النشطة أو المثبتة أو المجلدات. المحادثة والتحليل والمرفقات محفوظة كما هي.'
            : 'تخفي القضية من القائمة النشطة دون حذف أي شيء. يمكن الاستعادة في أي وقت.'}
        </p>
        <button
          type="button"
          disabled={updateCase.isPending}
          onClick={toggleArchive}
          className={`${GHOST} mt-3 min-h-10`}
          data-testid="button-toggle-archive"
        >
          {archived ? (
            <>
              <ArchiveRestore className="h-4 w-4" />
              استعادة القضية
            </>
          ) : (
            <>
              <Archive className="h-4 w-4" />
              أرشفة القضية
            </>
          )}
        </button>
      </section>
      {creating && (
        <ClientFormDialog onClose={() => setCreating(false)} onSaved={(c) => setValue(c.id)} />
      )}
    </div>
  );
}
function FeesTab({ caseId }) {
  const fees = useFees(caseId);
  const [editAgreement, setEditAgreement] = useState(false);
  const [receipt, setReceipt] = useState(null);
  if (fees.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  if (fees.isError || !fees.data)
    return (
      <p className="text-[13px] text-muted-foreground">
        تعذّر تحميل سجل الأتعاب.{' '}
        <button
          className="font-medium text-foreground underline"
          onClick={() => void fees.refetch()}
          data-testid="button-retry-fees"
        >
          إعادة المحاولة
        </button>
      </p>
    );
  const f = fees.data;
  const out = f.outstandingAmount == null ? null : Number(f.outstandingAmount);
  return (
    <div className="space-y-5" data-testid="panel-fees">
      <p className="text-[12px] leading-6 text-muted-foreground">
        سجل خاص بهذه القضية للمتابعة فقط، بالريال السعودي. لا يُصدر فواتير ولا يستقبل مدفوعات.
      </p>
      <dl className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
        <Stat label="المتفق عليه" value={formatSAR(f.agreedAmount)} testId="text-fee-agreed" />
        <Stat label="المستلم" value={formatSAR(f.receivedAmount)} testId="text-fee-received" />
        <Stat
          label={out != null && out < 0 ? 'مستلم بالزيادة' : 'المتبقي'}
          testId="text-fee-outstanding"
          value={out == null ? 'غير محدد' : formatSAR(out < 0 ? String(-out) : f.outstandingAmount)}
          tone={out == null ? undefined : out < 0 ? 'warn' : out === 0 ? 'ok' : undefined}
        />
      </dl>
      {out != null && out < 0 && (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12.5px] leading-6"
          data-testid="text-fee-overpaid"
        >
          المبالغ المستلمة تتجاوز المبلغ المتفق عليه بمقدار {formatSAR(String(-out))}. راجع
          الإيصالات أو المبلغ المتفق عليه.
        </p>
      )}

      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13.5px] font-semibold">اتفاق الأتعاب</h3>
          {!editAgreement && (
            <button
              onClick={() => setEditAgreement(true)}
              className={`${GHOST} min-h-11 px-3 text-[13px]`}
              data-testid="button-edit-agreement"
            >
              <PencilLine className="h-3.5 w-3.5" />
              {f.agreedAmount == null && !f.terms ? 'إضافة' : 'تعديل'}
            </button>
          )}
        </div>
        {editAgreement ? (
          <AgreementForm caseId={caseId} initial={f} onDone={() => setEditAgreement(false)} />
        ) : (
          <div className="mt-2 space-y-2 text-[13px] leading-6">
            {f.terms ? (
              <p className="whitespace-pre-wrap" data-testid="text-fee-terms">
                {f.terms}
              </p>
            ) : (
              <p className="text-muted-foreground">لا توجد شروط مسجلة.</p>
            )}
            {f.notes && (
              <p className="whitespace-pre-wrap text-muted-foreground" data-testid="text-fee-notes">
                {f.notes}
              </p>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13.5px] font-semibold">
            الإيصالات{' '}
            <span className="tabular-nums text-muted-foreground">
              {f.receipts.length.toLocaleString('ar-SA')}
            </span>
          </h3>
          <button
            onClick={() => setReceipt({})}
            className={`${SOLID} min-h-11 px-3 text-[13px]`}
            data-testid="button-add-receipt"
          >
            <Plus className="h-3.5 w-3.5" />
            إيصال
          </button>
        </div>
        {f.receipts.length === 0 ? (
          <p
            className="mt-2 rounded-lg border border-dashed p-4 text-center text-[12.5px] text-muted-foreground"
            data-testid="text-no-receipts"
          >
            لم تُسجّل مبالغ مستلمة بعد.
          </p>
        ) : (
          <ul
            className="mt-2 divide-y overflow-hidden rounded-lg border"
            data-testid="list-receipts"
          >
            {[...f.receipts]
              .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))
              .map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[14px] font-medium tabular-nums ${Number(r.amount) === 0 ? 'text-muted-foreground line-through' : ''}`}
                      data-testid={`text-receipt-amount-${r.id}`}
                    >
                      {formatSAR(r.amount)}
                    </p>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      <span dir="ltr">{r.receivedOn}</span>
                      {r.notes ? ` · ${r.notes}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setReceipt({ r })}
                    aria-label="تصحيح الإيصال"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    data-testid={`button-edit-receipt-${r.id}`}
                  >
                    <PencilLine className="h-4 w-4" />
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
      {receipt && (
        <ReceiptDialog caseId={caseId} receipt={receipt.r} onClose={() => setReceipt(null)} />
      )}
    </div>
  );
}
function Stat({ label, value, testId, tone }) {
  return (
    <div
      className={`rounded-lg border p-3 ${tone === 'warn' ? 'border-amber-500/50 bg-amber-500/10' : tone === 'ok' ? 'bg-primary/5' : 'bg-card'}`}
    >
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd
        className="mt-0.5 text-[14.5px] font-semibold tabular-nums [overflow-wrap:anywhere]"
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}
function AgreementForm({ caseId, initial, onDone }) {
  const save = useSaveAgreement();
  const { toast } = useToast();
  const [amount, setAmount] = useState(initial.agreedAmount ?? '');
  const [terms, setTerms] = useState(initial.terms);
  const [notes, setNotes] = useState(initial.notes);
  const norm = normalizeMoney(amount);
  const invalid = norm !== '' && !MONEY_RE.test(norm);
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid || save.isPending) return;
        save.mutate(
          {
            caseId,
            data: { agreedAmount: norm || null, terms: terms.trim(), notes: notes.trim() },
          },
          {
            onSuccess: () => {
              toast({ title: 'حُفظ اتفاق الأتعاب' });
              onDone();
            },
          },
        );
      }}
    >
      <div>
        <label htmlFor="fee-amount" className={LABEL}>
          المبلغ المتفق عليه (ر.س) — اتركه فارغًا إن لم يُحدد
        </label>
        <input
          id="fee-amount"
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className={`${INPUT} text-right tabular-nums`}
          aria-invalid={invalid}
          data-testid="input-fee-amount"
        />
        {invalid && (
          <p className="mt-1 text-[12px] text-destructive">
            أدخل مبلغًا صحيحًا حتى 12 خانة وخانتين عشريتين.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="fee-terms" className={LABEL}>
          الشروط
        </label>
        <textarea
          id="fee-terms"
          rows={3}
          maxLength={5000}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          className={`${INPUT} py-2 leading-6`}
          data-testid="input-fee-terms"
        />
      </div>
      <div>
        <label htmlFor="fee-notes" className={LABEL}>
          ملاحظات
        </label>
        <textarea
          id="fee-notes"
          rows={2}
          maxLength={5000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`${INPUT} py-2 leading-6`}
          data-testid="input-fee-notes"
        />
      </div>
      {save.isError && (
        <p role="alert" className="text-[12.5px] text-destructive">
          {errorText(save.error, 'تعذّر الحفظ. حاول مرة أخرى.')}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={invalid || save.isPending}
          className={`${SOLID} min-h-10 flex-1`}
          data-testid="button-save-agreement"
        >
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={save.isPending}
          className={`${GHOST} min-h-10`}
          data-testid="button-cancel-agreement"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}
function ReceiptDialog({ caseId, receipt, onClose }) {
  const create = useCreateReceipt();
  const update = useUpdateReceipt();
  const { toast } = useToast();
  const requestId = useRef(crypto.randomUUID());
  const [amount, setAmount] = useState(receipt?.amount ?? '');
  const [date, setDate] = useState(receipt?.receivedOn ?? todayISO());
  const [notes, setNotes] = useState(receipt?.notes ?? '');
  const norm = normalizeMoney(amount);
  const invalid = !MONEY_RE.test(norm);
  const pending = create.isPending || update.isPending;
  const error = receipt ? update.error : create.error;
  const submit = () => {
    if (invalid || !date || pending) return;
    const data = { amount: norm, receivedOn: date, notes: notes.trim() };
    const done = () => {
      toast({ title: receipt ? 'صُحّح الإيصال' : 'سُجّل الإيصال' });
      onClose();
    };
    if (receipt) update.mutate({ caseId, receiptId: receipt.id, data }, { onSuccess: done });
    else
      create.mutate(
        { caseId, data: { ...data, requestId: requestId.current } },
        { onSuccess: done },
      );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !pending) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="w-[calc(100%_-_1.5rem)] max-w-sm rounded-xl p-5 text-right"
      >
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="pl-8 text-[16px]">
            {receipt ? 'تصحيح إيصال' : 'تسجيل مبلغ مستلم'}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-6">
            {receipt
              ? 'لتصحيح إيصال سُجّل خطأً أدخل المبلغ 0.00.'
              : 'سجل للمتابعة فقط؛ لا يُرسل شيء للموكل.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="rc-amount" className={LABEL}>
              المبلغ (ر.س)
            </label>
            <input
              id="rc-amount"
              autoFocus
              required
              inputMode="decimal"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={`${INPUT} text-right tabular-nums`}
              aria-invalid={amount !== '' && invalid}
              data-testid="input-receipt-amount"
            />
            {amount !== '' && invalid && (
              <p className="mt-1 text-[12px] text-destructive">
                مبلغ غير صالح: حتى 12 خانة وخانتين عشريتين.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="rc-date" className={LABEL}>
              تاريخ الاستلام
            </label>
            <input
              id="rc-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={INPUT}
              data-testid="input-receipt-date"
            />
          </div>
          <div>
            <label htmlFor="rc-notes" className={LABEL}>
              ملاحظات
            </label>
            <textarea
              id="rc-notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${INPUT} py-2 leading-6`}
              data-testid="input-receipt-notes"
            />
          </div>
          {error && (
            <p role="alert" className="text-[12.5px] text-destructive">
              {errorText(error, 'تعذّر الحفظ. حاول مرة أخرى.')}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={invalid || !date || pending}
              className={`${SOLID} flex-1`}
              data-testid="button-save-receipt"
            >
              {pending ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onClose}
              className={GHOST}
              data-testid="button-cancel-receipt"
            >
              إلغاء
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

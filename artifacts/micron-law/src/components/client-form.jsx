/** Create/edit dialog for a lawyer's private client record. */
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCreateClient, useUpdateClient } from '@/lib/workspace-api';
import { errorText } from '@/lib/session';
export const INPUT =
  'min-h-11 w-full rounded-lg border bg-background px-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const LABEL = 'mb-1 block text-[12.5px] font-medium text-muted-foreground';
export const SOLID =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
export const GHOST =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-background px-4 text-[14px] font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
export const clientTypeLabel = (t) =>
  t === 'individual' ? 'فرد' : t === 'organization' ? 'جهة' : '';
export function ClientFormDialog({ client, onClose, onSaved }) {
  const create = useCreateClient();
  const update = useUpdateClient();
  // Same requestId on every retry of this create attempt.
  const requestId = useRef(crypto.randomUUID());
  const [f, setF] = useState({
    name: client?.name ?? '',
    type: client?.type ?? '',
    mobile: client?.mobile ?? '',
    email: client?.email ?? '',
    reference: client?.reference ?? '',
    notes: client?.notes ?? '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const pending = create.isPending || update.isPending;
  const error = client ? update.error : create.error;
  const submit = () => {
    if (pending || !f.name.trim()) return;
    // Full field set; blank optional fields clear stored values.
    const data = {
      name: f.name.trim(),
      type: f.type || null,
      mobile: f.mobile.trim(),
      email: f.email.trim(),
      reference: f.reference.trim(),
      notes: f.notes.trim(),
    };
    if (client)
      update.mutate(
        { clientId: client.id, data },
        {
          onSuccess: (c) => {
            onSaved?.(c);
            onClose();
          },
        },
      );
    else
      create.mutate(
        { data: { ...data, requestId: requestId.current } },
        {
          onSuccess: (c) => {
            onSaved?.(c);
            onClose();
          },
        },
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
        className="max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-md overflow-y-auto rounded-xl p-5 text-right"
      >
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="pl-8 text-[16px]">
            {client ? 'تعديل بيانات الموكل' : 'موكل جديد'}
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            سجل خاص بك. الاسم مطلوب وبقية الحقول اختيارية.
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
            <label htmlFor="cl-name" className={LABEL}>
              الاسم
            </label>
            <input
              id="cl-name"
              autoFocus
              required
              maxLength={180}
              value={f.name}
              onChange={set('name')}
              className={INPUT}
              data-testid="input-client-name"
            />
          </div>
          <div>
            <span className={LABEL}>الصفة</span>
            <div className="grid grid-cols-3 gap-1 rounded-lg border p-1" role="radiogroup">
              {[
                ['', 'غير محدد'],
                ['individual', 'فرد'],
                ['organization', 'جهة'],
              ].map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={f.type === v}
                  onClick={() => setF((p) => ({ ...p, type: v }))}
                  data-testid={`radio-client-type-${v || 'none'}`}
                  className={`min-h-11 rounded-md text-[13px] ${f.type === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 min-[420px]:grid-cols-2">
            <div>
              <label htmlFor="cl-mobile" className={LABEL}>
                الجوال
              </label>
              <input
                id="cl-mobile"
                dir="ltr"
                inputMode="tel"
                maxLength={40}
                value={f.mobile}
                onChange={set('mobile')}
                className={`${INPUT} text-right`}
                data-testid="input-client-mobile"
              />
            </div>
            <div>
              <label htmlFor="cl-email" className={LABEL}>
                البريد الإلكتروني
              </label>
              <input
                id="cl-email"
                dir="ltr"
                type="email"
                maxLength={254}
                value={f.email}
                onChange={set('email')}
                className={`${INPUT} text-right`}
                data-testid="input-client-email"
              />
            </div>
          </div>
          <div>
            <label htmlFor="cl-ref" className={LABEL}>
              المرجع (رقم هوية، سجل، أو مرجع داخلي)
            </label>
            <input
              id="cl-ref"
              maxLength={200}
              value={f.reference}
              onChange={set('reference')}
              className={INPUT}
              data-testid="input-client-reference"
            />
          </div>
          <div>
            <label htmlFor="cl-notes" className={LABEL}>
              ملاحظات
            </label>
            <textarea
              id="cl-notes"
              rows={3}
              maxLength={5000}
              value={f.notes}
              onChange={set('notes')}
              className={`${INPUT} py-2 leading-6`}
              data-testid="input-client-notes"
            />
          </div>
          {error && (
            <p
              role="alert"
              className="text-[12.5px] text-destructive"
              data-testid="text-client-form-error"
            >
              {errorText(error, 'تعذّر الحفظ. حاول مرة أخرى.')}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={pending || !f.name.trim()}
              className={`${SOLID} flex-1`}
              data-testid="button-client-save"
            >
              {pending ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onClose}
              className={GHOST}
              data-testid="button-client-cancel"
            >
              إلغاء
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

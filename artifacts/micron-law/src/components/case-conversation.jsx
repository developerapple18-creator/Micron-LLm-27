import { AlertCircle, Check, Download, FileText, Loader2, RotateCw, X } from 'lucide-react';
import { formatBytes, formatDateTime } from '@/lib/case-drafts';
import { attachmentDescription, fileTypeLabel } from '@/lib/document-labels';
export function AttachmentLink({ a }) {
  const body = (
    <>
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium [unicode-bidi:plaintext]">
          {a.filename}
        </span>
        <span className="block text-[11.5px] text-muted-foreground">
          {fileTypeLabel(a.filename)} · {formatBytes(a.size)}
          {a.status !== 'ready' && ' · غير مكتمل'}
        </span>
        {a.status === 'ready' && (
          <span className="block text-[11.5px] leading-5 text-muted-foreground">
            {attachmentDescription(a)}
          </span>
        )}
      </span>
      {a.downloadUrl && a.status === 'ready' && (
        <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );
  const cls =
    'flex min-h-11 w-full max-w-xs items-center gap-2.5 rounded-md border bg-background px-2.5 py-1.5 text-right';
  return a.downloadUrl && a.status === 'ready' ? (
    <a
      href={a.downloadUrl}
      download={a.filename}
      className={`${cls} hover:bg-accent`}
      data-testid={`link-attachment-${a.id}`}
      aria-label={`تنزيل ${a.filename}`}
    >
      {body}
    </a>
  ) : (
    <div className={`${cls} opacity-70`} data-testid={`row-attachment-${a.id}`}>
      {body}
    </div>
  );
}
export function SavedMessage({ m }) {
  return (
    <article className="flex flex-col items-start gap-1.5" data-testid={`message-${m.id}`}>
      <div className="max-w-[92%] rounded-xl border bg-card px-3.5 py-2.5 sm:max-w-[80%]">
        {m.content && (
          <p
            className="whitespace-pre-wrap text-[15px] leading-7 [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
            data-testid={`text-message-${m.id}`}
          >
            {m.content}
          </p>
        )}
        {m.attachments.length > 0 && (
          <div className={`flex flex-col gap-1.5 ${m.content ? 'mt-2' : ''}`}>
            {m.attachments.map((a) => (
              <AttachmentLink key={a.id} a={a} />
            ))}
          </div>
        )}
      </div>
      <span
        className="flex items-center gap-1 px-1 text-[11.5px] text-muted-foreground"
        data-testid={`status-message-${m.id}`}
      >
        <Check className="h-3 w-3" /> محفوظة · {formatDateTime(m.createdAt)}
      </span>
    </article>
  );
}
export function PendingMessage({ s, onRetry, retryDisabled, saved = false }) {
  return (
    <article
      className="flex flex-col items-start gap-1.5"
      data-testid={`message-pending-${s.requestId}`}
    >
      {!saved && (
        <div
          className={`max-w-[92%] rounded-xl border px-3.5 py-2.5 sm:max-w-[80%] ${s.status === 'error' ? 'border-destructive/50 bg-card' : 'border-dashed bg-card/60'}`}
        >
          {s.content && (
            <p className="whitespace-pre-wrap text-[15px] leading-7 [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
              {s.content}
            </p>
          )}
          {s.attachments.length > 0 && (
            <div className={`flex flex-col gap-1.5 ${s.content ? 'mt-2' : ''}`}>
              {s.attachments.map((a) => (
                <AttachmentLink key={a.id} a={{ ...a, downloadUrl: null }} />
              ))}
            </div>
          )}
        </div>
      )}
      {s.status === 'sending' ? (
        <span
          className="flex items-center gap-1 px-1 text-[11.5px] text-muted-foreground"
          data-testid={`status-pending-${s.requestId}`}
        >
          <Loader2 className="h-3 w-3 animate-spin" />{' '}
          {s.reportQuestion
            ? 'جارٍ إرسال سؤال التقرير…'
            : s.startAnalysis
              ? 'جارٍ إرسال طلب التحليل…'
              : 'جارٍ الحفظ…'}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px]" role="alert">
          <span
            className="flex items-center gap-1 text-destructive"
            data-testid={`status-pending-${s.requestId}`}
          >
            <AlertCircle className="h-3.5 w-3.5" />{' '}
            {saved
              ? 'الرسالة محفوظة، لكن تأكيد الطلب غير مكتمل. تحقق من الحالة أو أعد إرسال الطلب الأصلي.'
              : s.error}
          </span>
          <button
            onClick={onRetry}
            disabled={retryDisabled}
            data-testid={`button-retry-message-${s.requestId}`}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-50"
          >
            <RotateCw className="h-3.5 w-3.5" /> إعادة المحاولة
          </button>
        </div>
      )}
    </article>
  );
}
const stageLabel = {
  preparing: 'جارٍ التجهيز…',
  uploading: 'جارٍ الرفع',
  finalizing: 'جارٍ التحقق على الخادم…',
  checking: 'بانتظار تأكيد التخزين',
  ready: 'جاهز',
  error: 'فشل',
};
export function UploadRow({ u, onRetry, onRemove }) {
  const busy = u.stage !== 'error' && u.stage !== 'ready';
  return (
    <div
      className={`relative flex min-h-11 items-center gap-2 overflow-hidden rounded-md border px-2.5 py-1.5 ${u.stage === 'error' ? 'border-destructive/50' : ''}`}
      data-testid={`row-upload-${u.localId}`}
    >
      {u.stage === 'uploading' && (
        <span
          className="absolute inset-y-0 right-0 bg-foreground/[0.06] transition-[width]"
          style={{ width: `${u.progress}%` }}
          aria-hidden
        />
      )}
      {busy ? (
        <Loader2 className="relative h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <AlertCircle className="relative h-4 w-4 shrink-0 text-destructive" />
      )}
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium [unicode-bidi:plaintext]">
          {u.filename}
        </span>
        <span
          className={`block text-[11.5px] ${u.stage === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          data-testid={`status-upload-${u.localId}`}
        >
          {u.stage === 'error' || u.stage === 'checking'
            ? u.error
            : `${stageLabel[u.stage]}${u.stage === 'uploading' ? ` ${u.progress}٪` : ''} · ${formatBytes(u.size)}`}
        </span>
      </span>
      {['error', 'checking'].includes(u.stage) && u.retryable && (
        <button
          onClick={onRetry}
          aria-label={u.stage === 'checking' ? 'تحديث تأكيد التخزين' : 'إعادة محاولة الرفع'}
          data-testid={`button-retry-upload-${u.localId}`}
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent"
        >
          <RotateCw className="h-4 w-4" />
        </button>
      )}
      {u.stage === 'error' && (
        <button
          onClick={onRemove}
          aria-label="إزالة"
          data-testid={`button-remove-upload-${u.localId}`}
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
export function ReadyChip({ a, onRemove, removing, disabled, error }) {
  const body = (
    <>
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate [unicode-bidi:plaintext]">{a.filename}</span>
      <Check className="h-3 w-3 shrink-0 text-muted-foreground" />
    </>
  );
  const props = {
    className:
      'inline-flex min-h-11 max-w-[220px] items-center gap-1.5 rounded-md border bg-background px-2 text-[12.5px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'data-testid': `chip-attachment-${a.id}`,
    title: `${a.filename} — جاهز، سيُرفق مع الرسالة التالية`,
  };
  return (
    <div className="max-w-full">
      <div className="inline-flex max-w-full items-center rounded-md border bg-background">
        {a.downloadUrl && !removing ? (
          <a
            {...props}
            className={`${props.className} border-0`}
            href={a.downloadUrl}
            download={a.filename}
            aria-label={`تنزيل ${a.filename}`}
          >
            {body}
          </a>
        ) : (
          <span {...props} className={`${props.className} border-0`}>
            {body}
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={removing || disabled}
          data-testid={`button-remove-attachment-${a.id}`}
          aria-label={`إزالة ${a.filename}`}
          title={`إزالة ${a.filename}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        </button>
      </div>
      {(error || a.status === 'removing') && (
        <p
          className="max-w-[270px] pt-1 text-[11.5px] text-destructive"
          role="alert"
          data-testid={`error-remove-attachment-${a.id}`}
        >
          {error ?? 'إزالة غير مكتملة — أعد محاولة الإزالة'}
        </p>
      )}
    </div>
  );
}
export function IncompleteRow({ a }) {
  return (
    <div
      className="flex min-h-10 items-center gap-2 rounded-md border border-dashed px-2.5 py-1 text-[12px] text-muted-foreground"
      data-testid={`row-incomplete-${a.id}`}
    >
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <span className="[unicode-bidi:plaintext]">{a.filename}</span> —{' '}
        {a.status === 'rejected'
          ? 'مرفوض، لم يُحفظ'
          : 'بانتظار تأكيد التخزين؛ تحقق من الحالة قبل إعادة الرفع.'}
      </span>
    </div>
  );
}

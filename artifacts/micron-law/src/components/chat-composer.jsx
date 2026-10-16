import { useLayoutEffect, useRef } from 'react';
import { ArrowUp, Loader2, Paperclip } from 'lucide-react';
export function ChatComposer({
  draft,
  setDraft,
  viewportHeight,
  onSend,
  sendDisabled = true,
  sending = false,
  onFiles,
  attachDisabled = true,
  attachTitle,
  accept,
  top,
  note,
  actions,
  context,
  placeholder,
  inputLabel,
  sendLabel,
}) {
  const input = useRef(null);
  const fileInput = useRef(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const maximum = Math.max(48, Math.min(192, (viewportHeight ?? window.innerHeight) * 0.35));
    const resize = () => {
      element.style.height = '0px';
      element.style.height = `${Math.max(44, Math.min(element.scrollHeight, maximum))}px`;
      element.style.overflowY = element.scrollHeight > maximum ? 'auto' : 'hidden';
    };
    resize();
    let previousWidth = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== previousWidth) {
        previousWidth = element.clientWidth;
        // Hiding/showing the mounted composer changes its width. Defer height
        // writes outside ResizeObserver delivery to avoid a resize feedback loop.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(resize);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [draft, viewportHeight]);
  const canSend = !!onSend && !sendDisabled && !sending;
  return (
    <div className="shrink-0 px-3 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-5">
      <div className="mx-auto w-full max-w-2xl">
        <div
          dir="rtl"
          data-testid="composer"
          className="rounded-xl border bg-card p-2 focus-within:border-foreground/40"
        >
          {context}
          {top && <div className="max-h-40 overflow-y-auto px-1 pb-2">{top}</div>}
          <div className="flex items-end gap-1">
            <button
              type="button"
              disabled={attachDisabled || !onFiles}
              onClick={() => fileInput.current?.click()}
              title={attachTitle ?? 'إرفاق ملف'}
              aria-label={attachTitle ?? 'إرفاق ملف'}
              data-testid="button-attach"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </button>
            {actions}
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={accept}
              data-testid="input-file"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length) onFiles?.(files);
              }}
            />
            <textarea
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={1}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  window.matchMedia('(pointer: fine)').matches
                ) {
                  e.preventDefault();
                  if (canSend) onSend?.();
                }
              }}
              aria-label={inputLabel ?? 'وقائع القضية'}
              placeholder={placeholder ?? 'اكتب وقائع القضية...'}
              data-testid="input-composer"
              className="block min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-right text-base leading-6 outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              disabled={!canSend}
              onClick={() => canSend && onSend?.()}
              aria-label={sending ? 'جارٍ الإرسال' : (sendLabel ?? 'إرسال')}
              title={sendLabel}
              data-testid="button-send"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              {sending ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <ArrowUp className="h-[18px] w-[18px]" />
              )}
            </button>
          </div>
        </div>
        <p
          className="mt-1 text-center text-[11px] leading-4 text-muted-foreground"
          data-testid="text-composer-note"
        >
          {note ?? 'الإرسال والمرفقات غير متاحة في هذا الإصدار'}
        </p>
      </div>
    </div>
  );
}

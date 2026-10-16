import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
export function formatDate(s) {
  try {
    return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium' }).format(new Date(s));
  } catch {
    return s;
  }
}
export function DocReader({ doc, onClose }) {
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        dir="rtl"
        className="flex h-[100dvh] max-h-[100dvh] max-w-2xl flex-col gap-0 p-0 sm:h-[85vh] sm:max-h-[85vh]"
      >
        {doc && (
          <>
            <DialogHeader className="border-b px-6 py-5 text-right sm:text-right">
              <DialogTitle className="pl-8 text-[17px] font-semibold" data-testid="text-doc-title">
                {doc.title}
              </DialogTitle>
              <DialogDescription className="text-[12.5px]">
                الإصدار {doc.version} · {formatDate(doc.createdAt)}
                {doc.testing ? ' · نسخة تجريبية' : ''}
              </DialogDescription>
            </DialogHeader>
            <article
              className="doc-prose flex-1 overflow-y-auto px-6 py-6 text-foreground/90"
              data-testid="text-doc-content"
            >
              {doc.content}
            </article>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { bindReportDraftDialog } from '@/lib/report-draft-guard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
export function ReportDraftGuard() {
  const [action, setAction] = useState(null);
  useEffect(() => bindReportDraftDialog((next) => setAction(() => next)), []);
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) setAction(null);
      }}
    >
      <DialogContent dir="rtl" className="w-[calc(100%_-_2rem)] max-w-sm">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="pl-8">تعديلات تقرير غير محفوظة</DialogTitle>
          <DialogDescription>
            المغادرة ستترك المسودة دون حفظها كنسخة جديدة. لا يتغير أي تقرير محفوظ.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-md border px-4"
            onClick={() => setAction(null)}
          >
            العودة للتعديل
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md bg-destructive px-4 text-destructive-foreground"
            onClick={() => {
              const next = action;
              setAction(null);
              next?.();
            }}
            data-testid="button-discard-report-navigation"
          >
            المغادرة دون حفظ
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

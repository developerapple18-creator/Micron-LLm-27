import { useRef } from 'react';
import { FilePlus2, MoreHorizontal, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
/** Presentation only: selection does not upload, save or start any operation. */
export function ComposerActions({ onSelect, allowUpdatedAnalysis = true }) {
  const selected = useRef(false);
  return (
    <DropdownMenu dir="rtl" modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="إجراءات القضية"
          title="إجراءات القضية"
          data-testid="button-composer-actions"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(280px,calc(100vw-24px))] p-1.5 text-right"
        data-testid="composer-actions-menu"
        onCloseAutoFocus={(e) => {
          if (!selected.current) return;
          selected.current = false;
          e.preventDefault();
          requestAnimationFrame(() =>
            document
              .querySelector('[data-testid="input-composer"]')
              ?.focus({ preventScroll: true }),
          );
        }}
      >
        <DropdownMenuItem
          className="min-h-14 items-start rounded-md p-2.5"
          data-testid="action-add-evidence"
          onSelect={() => {
            selected.current = true;
            onSelect('update');
          }}
        >
          <FilePlus2 className="mt-1" />
          <span className="min-w-0">
            <span className="block font-medium">إضافة مستندات أو وقائع</span>
            <span className="block pt-0.5 text-xs leading-5 text-muted-foreground">
              احفظ الإضافات دون تغيير التقرير.
            </span>
          </span>
        </DropdownMenuItem>
        {allowUpdatedAnalysis && (
          <DropdownMenuItem
            className="min-h-14 items-start rounded-md p-2.5"
            data-testid="action-updated-analysis"
            onSelect={() => {
              selected.current = true;
              onSelect('analysis');
            }}
          >
            <RefreshCw className="mt-1" />
            <span className="min-w-0">
              <span className="block font-medium">إصدار تحليل محدّث</span>
              <span className="block pt-0.5 text-xs leading-5 text-muted-foreground">
                تقرير جديد؛ يبقى السابق محفوظًا.
              </span>
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

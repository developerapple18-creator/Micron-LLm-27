import { useQueryClient } from '@tanstack/react-query';
import { getGetCaseConversationQueryKey } from '@workspace/api-client-react';
import { useExecuteInteraction } from '@/lib/report-api';
export function ReportQuestionAnswer({ q, caseId, onOpen, onEvidence }) {
  const execute = useExecuteInteraction(caseId, q.operationId);
  const qc = useQueryClient();
  return (
    <div
      className="space-y-2 text-[14px] leading-7"
      data-testid={`report-question-${q.id}`}
      dir="rtl"
    >
      <p className="text-[12px] text-muted-foreground">
        مناقشة نسخة التقرير المحفوظة — دون إعادة قراءة المرفقات
      </p>
      {q.answer ? (
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{q.answer}</p>
      ) : q.status === 'running' ? (
        <p role="status">جارٍ الإجابة في سياق التقرير…</p>
      ) : q.status === 'prepared' ? (
        <button
          type="button"
          className="min-h-11 rounded-md border px-3"
          disabled={execute.isPending}
          onClick={() =>
            execute.mutate(q.id, {
              onSuccess: () => {
                void qc.invalidateQueries({ queryKey: getGetCaseConversationQueryKey(caseId) });
              },
            })
          }
        >
          متابعة إرسال السؤال المحفوظ
        </button>
      ) : (
        <p role="alert" className="text-destructive">
          لم تكتمل الإجابة. لن يُعاد الطلب تلقائيًا؛ التقرير الأصلي محفوظ.
        </p>
      )}
      {execute.isError && (
        <p role="alert" className="text-destructive">
          تعذّر تأكيد حالة السؤال. حدّث الحالة قبل اتخاذ إجراء آخر.
        </p>
      )}
      <div className="flex flex-wrap gap-2 text-[12px]">
        <button
          type="button"
          className="min-h-11 rounded-md border px-3"
          onClick={() => onOpen(q.operationId)}
        >
          فتح التقرير المرتبط
        </button>
        <button type="button" className="min-h-11 rounded-md border px-3" onClick={onEvidence}>
          إضافة مستندات أو وقائع لتحديث التحليل
        </button>
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        السؤال لا يعدّل التقرير. الأدلة الجديدة تُحفظ أولًا، وإعادة التحليل تتطلب اختيارك الصريح.
      </p>
    </div>
  );
}

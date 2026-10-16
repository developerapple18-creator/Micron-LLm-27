import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { validAnswer } from '@/lib/clarification-draft';
export function GuidedClarification({
  questions,
  value,
  onChange,
  paused,
  onResume,
  disabled,
  persistent,
  viewportHeight,
}) {
  const index = Math.max(
    0,
    questions.findIndex((q) => q.id === value.current),
  );
  const q = questions[index];
  if (!q) return null;
  const answer = value.answers[q.id];
  const answered = questions.filter((item) => validAnswer(item, value.answers[item.id]));
  const choose = (choice) =>
    onChange({ current: q.id, answers: { ...value.answers, [q.id]: choice } });
  const navigate = (id) => onChange({ ...value, current: id });
  const option =
    'min-h-11 min-w-11 rounded-md border px-2.5 py-1 text-[13px] leading-5 text-right hover:bg-accent disabled:opacity-50';
  const selected = (kind, text) => answer?.kind === kind && answer.value === text;
  const choice = (kind, text) => (
    <button
      type="button"
      key={`${kind}:${text}`}
      disabled={disabled}
      aria-pressed={selected(kind, text)}
      data-testid={`clarification-choice-${q.id}-${kind}`}
      className={`${option} ${selected(kind, text) ? 'border-foreground bg-accent font-medium' : 'bg-background'}`}
      onClick={() => choose({ kind, value: text })}
    >
      {text}
    </button>
  );
  return (
    <section
      dir="rtl"
      tabIndex={-1}
      aria-label="الإجابة عن الاستيضاح"
      data-testid="guided-clarification"
      className="mb-2 rounded-lg border bg-muted/30 p-2"
    >
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="font-medium">
          استيضاح {index + 1} من {questions.length}
        </span>
        <span className="text-muted-foreground">{answered.length} إجابة مختارة</span>
      </div>
      {paused ? (
        <>
          <p className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-6">
            {q.question}
          </p>
          <div className="flex items-center justify-between gap-2 text-[12px] leading-5">
            <span>الإجابات المختارة محفوظة؛ يمكنك العودة إليها دون إرسال.</span>
            <button
              type="button"
              onClick={onResume}
              className="min-h-11 shrink-0 underline"
              data-testid="resume-clarification"
            >
              متابعة الاستيضاح
            </button>
          </div>
        </>
      ) : (
        <div
          className="overflow-y-auto overscroll-contain"
          style={{
            maxHeight: viewportHeight ? Math.min(248, Math.round(viewportHeight * 0.34)) : 248,
          }}
        >
          <p
            className="mt-1 whitespace-pre-wrap break-words text-[13px] font-medium leading-6"
            data-testid={`guided-question-${q.id}`}
          >
            {q.question}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {[...new Set(q.options)].map((text) => choice('option', text))}
            {q.allow_unknown && !q.options.includes('لا أعلم') && choice('unknown', 'لا أعلم')}
            {q.allow_not_applicable &&
              !q.options.includes('لا ينطبق') &&
              choice('not_applicable', 'لا ينطبق')}
            <button
              type="button"
              disabled={disabled}
              aria-pressed={answer?.kind === 'custom'}
              className={`${option} border-dashed ${answer?.kind === 'custom' ? 'bg-accent font-medium' : ''}`}
              data-testid="clarification-custom"
              onClick={() =>
                choose({ kind: 'custom', value: answer?.kind === 'custom' ? answer.value : '' })
              }
            >
              إجابة أخرى
            </button>
          </div>
          {answer?.kind === 'custom' && (
            <textarea
              rows={2}
              value={answer.value}
              disabled={disabled}
              aria-label={`إجابة أخرى: ${q.question}`}
              placeholder="اكتب إجابتك عن هذا السؤال…"
              data-testid="clarification-custom-input"
              onChange={(e) => choose({ kind: 'custom', value: e.target.value })}
              className="mt-1 block w-full resize-y rounded-md border bg-background p-2 text-base leading-6"
            />
          )}
          {answer && (
            <button
              type="button"
              disabled={disabled}
              className="min-h-11 text-[12px] underline"
              data-testid="clear-clarification-answer"
              onClick={() => {
                const answers = { ...value.answers };
                delete answers[q.id];
                onChange({ current: q.id, answers });
              }}
            >
              مسح اختيار هذا السؤال
            </button>
          )}
          {questions.length > 1 && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-1 text-[12px]"
                disabled={index === 0}
                data-testid="clarification-prev"
                onClick={() => navigate(questions[index - 1].id)}
              >
                <ChevronRight className="h-4 w-4" />
                السابق
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-1 text-[12px]"
                disabled={index === questions.length - 1}
                data-testid="clarification-next"
                onClick={() => navigate(questions[index + 1].id)}
              >
                التالي
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          )}
          {answered.length > 0 && (
            <details data-testid="clarification-summary" className="text-[12px]">
              <summary className="min-h-11 cursor-pointer py-3">
                مراجعة الإجابات المختارة ({answered.length})
              </summary>
              <ul className="space-y-1">
                {answered.map((item) => (
                  <li key={item.id} className="flex items-start gap-1">
                    <span className="min-w-0 flex-1 break-words">
                      {item.question} — {value.answers[item.id].value}
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center"
                      aria-label={`تغيير الإجابة: ${item.question}`}
                      onClick={() => navigate(item.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {!persistent && (
        <p role="alert" className="text-[12px] text-destructive">
          تعذّر حفظ الاختيارات في المتصفح؛ لا تحدّث الصفحة قبل حفظ إجابتك.
        </p>
      )}
      {!paused && (
        <p className="text-[11px] leading-4 text-muted-foreground">
          زر الإرسال يتابع التحليل مرة واحدة. النص أدناه سياق إضافي، وليس إجابة عن كل الأسئلة.
        </p>
      )}
    </section>
  );
}

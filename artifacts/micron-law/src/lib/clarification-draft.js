export const emptyClarificationDraft = () => ({ current: '', answers: {} });
export const clarificationDraftKey = (user, caseId, operation) =>
  `micron:guided-clarification:${user}:${caseId}:${operation}`;
/** Presentation follows the current analysis branch, never an older superseded root. */
export function pendingClarificationOperation(operations) {
  let root = 0;
  operations.forEach((op, i) => {
    if (!op.parentOperationId && op.status !== 'failed') root = i;
  });
  return operations
    .slice(root)
    .reverse()
    .find(
      (op) =>
        op.status === 'completed' &&
        op.result?.kind === 'clarification' &&
        !operations.some(
          (child) => child.parentOperationId === op.id && child.failureCode !== 'context_changed',
        ),
    );
}
export function readClarificationDraft(key) {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (
      !raw ||
      typeof raw.current !== 'string' ||
      !raw.answers ||
      typeof raw.answers !== 'object' ||
      Array.isArray(raw.answers)
    )
      return emptyClarificationDraft();
    return {
      current: raw.current,
      answers: Object.fromEntries(
        Object.entries(raw.answers).filter(([, a]) => {
          const v = a;
          return (
            v &&
            ['option', 'custom', 'unknown', 'not_applicable'].includes(v.kind) &&
            typeof v.value === 'string'
          );
        }),
      ),
    };
  } catch {
    return emptyClarificationDraft();
  }
}
export function saveClarificationDraft(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function validAnswer(q, a) {
  if (!a) return false;
  if (a.kind === 'custom') return !!a.value.trim();
  if (a.kind === 'option') return q.options.includes(a.value);
  if (a.kind === 'unknown') return q.allow_unknown && a.value === 'لا أعلم';
  return q.allow_not_applicable && a.value === 'لا ينطبق';
}
/** Serialize only explicit, valid choices once at Send; extra text has no inferred IDs. */
export function clarificationSubmission(questions, draft, extra) {
  const answered = questions.filter((q) => validAnswer(q, draft.answers[q.id]));
  const blocks = answered.map(
    (q) => `السؤال: ${q.question}\nالإجابة: ${draft.answers[q.id].value}`,
  );
  if (extra.trim()) blocks.push(`سياق إضافي من المحامي (دون ربط تلقائي بأسئلة أخرى):\n${extra}`);
  return {
    content: blocks.join('\n\n'),
    questionIds: answered.map((q) => q.id),
    emptyCustom: questions.some(
      (q) => draft.answers[q.id]?.kind === 'custom' && !draft.answers[q.id].value.trim(),
    ),
  };
}

const choices = ['question', 'update', 'analysis', 'continue'];
const actionKey = (user, caseId) => `micron:composer-action:${user}:${caseId ?? 'new'}`;
export function readComposerIntent(user, caseId) {
  try {
    const value = sessionStorage.getItem(actionKey(user, caseId));
    return choices.includes(value) ? value : 'question';
  } catch {
    return 'question';
  }
}
export function saveComposerIntent(user, caseId, value) {
  try {
    sessionStorage.setItem(actionKey(user, caseId), value);
  } catch {
    /* Keep in-memory selection. */
  }
}
export function readSavedUpdates(user) {
  try {
    const value = JSON.parse(sessionStorage.getItem(`micron:saved-updates:${user}`) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, id]) =>
          /^[\da-f-]{36}$/i.test(key) && typeof id === 'string' && /^[\da-f-]{36}$/i.test(id),
      ),
    );
  } catch {
    return {};
  }
}
export function saveUpdateReceipt(user, caseId, requestId) {
  const next = { ...readSavedUpdates(user), [caseId]: requestId };
  try {
    sessionStorage.setItem(`micron:saved-updates:${user}`, JSON.stringify(next));
  } catch {
    /* UI state remains. */
  }
}
/** An explicit UI action, not legal interpretation of the lawyer's draft. */
export const UPDATED_ANALYSIS_REQUEST =
  'أصدر تحليلاً محدثًا للقضية اعتمادًا على المستندات والوقائع المحفوظة.';

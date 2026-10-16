import { useState } from 'react';
import {
  clarificationDraftKey,
  emptyClarificationDraft,
  readClarificationDraft,
  saveClarificationDraft,
} from '@/lib/clarification-draft';
export function useClarificationDraft(user, caseId, operation) {
  const key = clarificationDraftKey(user, caseId ?? 'new', operation ?? 'none');
  const [state, setState] = useState(() => ({
    key,
    value: readClarificationDraft(key),
    persistent: true,
  }));
  const value = state.key === key ? state.value : readClarificationDraft(key);
  const change = (next) => {
    const persistent = saveClarificationDraft(key, next);
    setState({ key, value: next, persistent });
  };
  return {
    value,
    change,
    clear: () => change(emptyClarificationDraft()),
    persistent: state.key !== key || state.persistent,
  };
}

// Track presence only, never persist legal text or ownership data.
const drafts = new Set();
export function retainReportDraft() {
  const token = Symbol();
  drafts.add(token);
  return () => {
    drafts.delete(token);
  };
}
let ask;
export function hasReportDraft() {
  return drafts.size > 0;
}
export function bindReportDraftDialog(handler) {
  ask = handler;
  return () => {
    if (ask === handler) ask = undefined;
  };
}
export function guardReportNavigation(action) {
  if (!hasReportDraft()) {
    action();
    return;
  }
  let used = false;
  ask?.(() => {
    if (!used) {
      used = true;
      action();
    }
  });
}

export function interactionPollDelay(items, error) {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  if (error) {
    const terminal = ['completed', 'failed', 'accepted', 'rejected'];
    if (items?.length && items.every((it) => terminal.includes(it.status) && !it.executionSync))
      return false;
    return 5_000;
  }
  return items?.some((it) => it.status === 'running' || it.executionSync) ? 3_000 : false;
}
export function interactionElapsed(startedAt, now = Date.now()) {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

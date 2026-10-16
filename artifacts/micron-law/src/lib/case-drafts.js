// Session-scoped (per tab, per user) persistence for unsent drafts and the
// lazy case-creation idempotency key. Nothing here is ever sent to the server
// except the request id itself.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function read(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: in-memory only */
  }
}
const draftsKey = (userId) => `micron:drafts:${userId}`;
const createKey = (userId) => `micron:create-case:${userId}`;
export function loadDrafts(userId) {
  try {
    const parsed = JSON.parse(read(draftsKey(userId)) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string' && v) out[k] = v;
    return out;
  } catch {
    return {};
  }
}
export function saveDrafts(userId, drafts) {
  const clean = {};
  for (const [k, v] of Object.entries(drafts)) if (v) clean[k] = v;
  write(draftsKey(userId), Object.keys(clean).length ? JSON.stringify(clean) : null);
}
export function readCreateRecord(userId) {
  try {
    const r = JSON.parse(read(createKey(userId)) ?? 'null');
    return r && typeof r.requestId === 'string' && UUID_RE.test(r.requestId)
      ? {
          requestId: r.requestId,
          caseId: typeof r.caseId === 'string' && UUID_RE.test(r.caseId) ? r.caseId : null,
        }
      : null;
  } catch {
    return null;
  }
}
/** Stable id for the not-yet-created case; reused until creation and migration are confirmed. */
export function getCreateRequestId(userId) {
  const r = readCreateRecord(userId);
  if (r) return r.requestId;
  const requestId = newRequestId();
  write(createKey(userId), JSON.stringify({ requestId, caseId: null }));
  return requestId;
}
export function setCreatedCaseId(userId, requestId, caseId) {
  write(createKey(userId), JSON.stringify({ requestId, caseId }));
}
export function clearCreateRequestId(userId) {
  write(createKey(userId), null);
}
const sendsKey = (userId) => `micron:outgoing:${userId}`;
export function loadOutgoing(userId) {
  try {
    const v = JSON.parse(read(sendsKey(userId)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function saveOutgoing(userId, items) {
  write(sendsKey(userId), items.length ? JSON.stringify(items) : null);
}
export function formatBytes(n) {
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ك.ب`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} م.ب`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} ج.ب`;
}
const dtf = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-arab', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const df = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-arab', {
  day: 'numeric',
  month: 'short',
});
export function formatDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dtf.format(d);
}
export function formatShortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : df.format(d);
}

/**
 * Typed client for saved-report versions, paragraph interactions and case
 * organization. GET status synchronization is read-only; mutations never retry.
 * Paid execution occurs only through an explicit, server-gated owner action.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getGetCaseConversationQueryKey, getListCasesQueryKey } from '@workspace/api-client-react';
import { useCsrfRequest, useSession } from '@/lib/session';
import { interactionPollDelay } from '@/lib/report-interaction-status';
export class ApiError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const apiUrl = (path) => `${BASE}${path}`;
async function readError(res) {
  let msg = '';
  try {
    const j = await res.json();
    msg = typeof j?.error === 'string' ? j.error : '';
  } catch {
    /* non-JSON */
  }
  return new ApiError(res.status, msg);
}
export async function apiJson(path, init = {}) {
  const res = await fetch(apiUrl(path), {
    method: init.method ?? 'GET',
    credentials: 'include',
    signal: init.signal,
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.csrf ? { 'x-csrf-token': init.csrf } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}
export function mutationErrorText(err, fallback) {
  if (err instanceof ApiError) {
    if (err.status === 409)
      return 'تغيّر التقرير منذ فتحه (حُفظ إصدار أحدث). حدّث الإصدارات ثم أعد المحاولة؛ تعديلاتك غير المحفوظة باقية.';
    if (err.status === 403) return 'هذا الإجراء غير متاح لحسابك.';
    if (err.message) return err.message;
  }
  return fallback;
}
const useCsrf = () => useCsrfRequest().headers['x-csrf-token'];
const useUid = () => useSession().data?.user?.id ?? 'anonymous';
const reportPath = (caseId, opId) => `/api/cases/${caseId}/reports/${opId}`;
export const versionsKey = (caseId, opId, uid) =>
  uid ? ['report-versions', caseId, opId, uid] : ['report-versions', caseId, opId];
export const interactionsKey = (caseId, opId, uid) =>
  uid ? ['report-interactions', caseId, opId, uid] : ['report-interactions', caseId, opId];
export const foldersKey = (uid) => (uid ? ['case-folders', uid] : ['case-folders']);
export function useReportVersions(caseId, opId) {
  const uid = useUid();
  return useQuery({
    queryKey: versionsKey(caseId, opId, uid),
    retry: 2,
    staleTime: 10_000,
    queryFn: ({ signal }) => apiJson(`${reportPath(caseId, opId)}/versions`, { signal }),
  });
}
export function useCreateVersion(caseId, opId) {
  const csrf = useCsrf();
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (body) =>
      apiJson(`${reportPath(caseId, opId)}/versions`, { method: 'POST', body, csrf }),
    onSuccess: (v) => {
      qc.setQueryData(versionsKey(caseId, opId, uid), (old) =>
        old && !old.some((x) => x.id === v.id) ? [...old, v] : old,
      );
      void qc.invalidateQueries({ queryKey: versionsKey(caseId, opId) });
      void qc.invalidateQueries({ queryKey: interactionsKey(caseId, opId) });
    },
  });
}
export function useInteractions(caseId, opId) {
  const uid = useUid();
  return useQuery({
    queryKey: interactionsKey(caseId, opId, uid),
    retry: false,
    staleTime: 10_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchIntervalInBackground: false,
    refetchInterval: (query) => interactionPollDelay(query.state.data, query.state.error),
    queryFn: async ({ signal }) => {
      // Bound a stalled status GET, not the independently running paid execution.
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const timeout = setTimeout(abort, 12_000);
      try {
        return await apiJson(`${reportPath(caseId, opId)}/interactions`, {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
    },
  });
}
/** Saves a PREPARED request only. Never executes. */
export function usePrepareInteraction(caseId, opId) {
  const csrf = useCsrf();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (body) =>
      apiJson(`${reportPath(caseId, opId)}/interactions`, { method: 'POST', body, csrf }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: interactionsKey(caseId, opId) });
    },
  });
}
export function useRejectInteraction(caseId, opId) {
  const csrf = useCsrf();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (id) =>
      apiJson(`${reportPath(caseId, opId)}/interactions/${id}/reject`, {
        method: 'POST',
        body: {},
        csrf,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: interactionsKey(caseId, opId) });
    },
  });
}
/**
 * Paid execution of ONE prepared interaction. Only render a trigger when the
 * server reports executionApproved === true; never call on mount/poll/reload.
 */
export function useExecuteInteraction(caseId, opId) {
  const csrf = useCsrf();
  const uid = useUid();
  const qc = useQueryClient();
  const key = interactionsKey(caseId, opId, uid);
  return useMutation({
    retry: false,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key, exact: true });
      qc.setQueryData(key, (old) =>
        old?.map((it) => (it.id === id ? { ...it, executionSync: 'submitting' } : it)),
      );
    },
    mutationFn: (id) =>
      apiJson(`${reportPath(caseId, opId)}/interactions/${id}/execute`, {
        method: 'POST',
        body: {},
        csrf,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(key, (old) => old?.map((it) => (it.id === saved.id ? saved : it)));
    },
    onError: (_error, id) => {
      // A disconnected POST is not proof of provider failure. Poll; never resend.
      qc.setQueryData(key, (old) =>
        old?.map((it) => (it.id === id ? { ...it, executionSync: 'uncertain' } : it)),
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: interactionsKey(caseId, opId) });
    },
  });
}
/** Authenticated binary download of an exact saved version. */
export async function downloadVersion(caseId, opId, versionId, format, fallbackName) {
  const params = new URLSearchParams({ caseId, operationId: opId, versionId, format });
  const res = await fetch(apiUrl(`/api/report-exports?${params}`), { credentials: 'include' });
  if (!res.ok) throw await readError(res);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(cd)?.[1];
  const name = star ? decodeURIComponent(star) : plain || `${fallbackName}.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function useFolders(enabled) {
  const uid = useUid();
  return useQuery({
    queryKey: foldersKey(uid),
    enabled,
    retry: 1,
    staleTime: 30_000,
    queryFn: ({ signal }) => apiJson('/api/case-folders', { signal }),
  });
}
export function useCreateFolder() {
  const csrf = useCsrf();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (name) =>
      apiJson('/api/case-folders', {
        method: 'POST',
        body: { requestId: crypto.randomUUID(), name },
        csrf,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersKey() });
    },
  });
}
export function useRenameFolder() {
  const csrf = useCsrf();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ id, ...body }) =>
      apiJson(`/api/case-folders/${id}`, { method: 'PATCH', body, csrf }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersKey() });
    },
  });
}
export function useUpdateCase() {
  const csrf = useCsrf();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ caseId, ...body }) =>
      apiJson(`/api/cases/${caseId}`, { method: 'PATCH', body, csrf }),
    onSuccess: (c) => {
      // Patch every cached case list (keys are prefixed by the generated key) so the header updates immediately.
      qc.setQueriesData({ queryKey: getListCasesQueryKey() }, (old) =>
        Array.isArray(old) ? old.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : old,
      );
      void qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetCaseConversationQueryKey(c.id) });
      // Client lists/details show related cases and counts.
      void qc.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/api/clients'),
      });
    },
  });
}
/** Clipboard with legacy fallback; resolves true only if the copy actually succeeded. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Per-user scoped wrappers over generated client and fee hooks. Every query key
 * is suffixed with the signed-in user id; every mutation sends CSRF and
 * invalidates by generated prefix. No personal data is logged.
 */
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCaseFeesQueryKey,
  getGetLawyerClientQueryKey,
  getListCasesQueryKey,
  getListLawyerClientsQueryKey,
  useCreateCaseFeeReceipt,
  useCreateLawyerClient,
  useGetCaseFees,
  useGetLawyerClient,
  useListLawyerClients,
  useSaveCaseFeeAgreement,
  useUpdateCaseFeeReceipt,
  useUpdateLawyerClient,
  useSetLawyerClientPin,
} from '@workspace/api-client-react';
import { useCsrfRequest, useSession } from '@/lib/session';
const useUid = () => useSession().data?.user?.id ?? 'anonymous';
const isClientKey = (q) =>
  typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/api/clients');
export function useClients(enabled = true) {
  const uid = useUid();
  return useListLawyerClients({
    query: {
      queryKey: [...getListLawyerClientsQueryKey(), uid],
      enabled,
      staleTime: 20_000,
      retry: 1,
    },
  });
}
export function useClient(clientId) {
  const uid = useUid();
  const id = clientId ?? '';
  return useGetLawyerClient(id, {
    query: {
      queryKey: [...getGetLawyerClientQueryKey(id), uid],
      enabled: !!clientId,
      staleTime: 10_000,
      retry: 1,
    },
  });
}
export function useCreateClient() {
  const request = useCsrfRequest();
  const qc = useQueryClient();
  return useCreateLawyerClient({
    request,
    mutation: {
      retry: false,
      onSuccess: () => {
        void qc.invalidateQueries({ predicate: isClientKey });
      },
    },
  });
}
export function useUpdateClient() {
  const request = useCsrfRequest();
  const qc = useQueryClient();
  return useUpdateLawyerClient({
    request,
    mutation: {
      retry: false,
      onSuccess: () => {
        void qc.invalidateQueries({ predicate: isClientKey });
        // Case rows carry clientName.
        void qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
      },
    },
  });
}
export function usePinClient() {
  const request = useCsrfRequest();
  const qc = useQueryClient();
  return useSetLawyerClientPin({
    request,
    mutation: {
      retry: false,
      onSuccess: () => {
        void qc.invalidateQueries({ predicate: isClientKey });
      },
    },
  });
}
export function useFees(caseId) {
  const uid = useUid();
  return useGetCaseFees(caseId, {
    query: { queryKey: [...getGetCaseFeesQueryKey(caseId), uid], staleTime: 10_000, retry: 1 },
  });
}
function useFeesSync() {
  const qc = useQueryClient();
  const uid = useUid();
  return (caseId, fees) => {
    qc.setQueryData([...getGetCaseFeesQueryKey(caseId), uid], fees);
    void qc.invalidateQueries({ queryKey: getGetCaseFeesQueryKey(caseId) });
  };
}
export function useSaveAgreement() {
  const request = useCsrfRequest();
  const sync = useFeesSync();
  return useSaveCaseFeeAgreement({
    request,
    mutation: { retry: false, onSuccess: (f, v) => sync(v.caseId, f) },
  });
}
export function useCreateReceipt() {
  const request = useCsrfRequest();
  const sync = useFeesSync();
  return useCreateCaseFeeReceipt({
    request,
    mutation: { retry: false, onSuccess: (f, v) => sync(v.caseId, f) },
  });
}
export function useUpdateReceipt() {
  const request = useCsrfRequest();
  const sync = useFeesSync();
  return useUpdateCaseFeeReceipt({
    request,
    mutation: { retry: false, onSuccess: (f, v) => sync(v.caseId, f) },
  });
}
/* ---------- money helpers ---------- */
export const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
/** Converts Arabic-Indic digits and separators to an ASCII decimal string. */
export function normalizeMoney(v) {
  return v
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u066B]/g, '.')
    .replace(/[,\u066C\s]/g, '');
}
export function formatSAR(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `${n.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
}
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

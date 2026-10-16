import { useQueryClient } from '@tanstack/react-query';
import { useGetSession, getGetSessionQueryKey } from '@workspace/api-client-react';
export function useSession() {
  const q = useGetSession({
    query: { queryKey: getGetSessionQueryKey(), staleTime: 30_000, retry: 1 },
  });
  return q;
}
export function useCsrfRequest() {
  const { data } = useSession();
  return { headers: { 'x-csrf-token': data?.csrfToken ?? '' } };
}
export function useApplySession() {
  const qc = useQueryClient();
  return (s) => {
    qc.setQueryData(getGetSessionQueryKey(), s);
    void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
  };
}
export function errorText(err, fallback = 'تعذّر إتمام الطلب. حاول مرة أخرى.') {
  const e = err;
  const msg = e?.data?.error;
  if (typeof msg === 'string' && /[\u0600-\u06FF]/.test(msg)) return msg;
  return fallback;
}
export function errorStatus(err) {
  return err?.status;
}
export const roleLabel = { lawyer: 'محامٍ', admin: 'مشرف' };

import { useState } from 'react';
import { useLocation } from 'wouter';
import { useAdminLogin } from '@workspace/api-client-react';
import { AuthFrame, ErrorNote, Field, PrimaryButton } from '@/components/kit';
import { errorText, useApplySession, useCsrfRequest } from '@/lib/session';
export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [, navigate] = useLocation();
  const apply = useApplySession();
  const request = useCsrfRequest();
  const login = useAdminLogin({
    request,
    mutation: {
      onSuccess: (s) => {
        apply(s);
        navigate('/admin');
      },
    },
  });
  const submit = (e) => {
    e.preventDefault();
    if (username.trim() && password)
      login.mutate({ data: { username: username.trim(), password } });
  };
  return (
    <AuthFrame>
      <p className="text-[12px] font-medium text-muted-foreground">لوحة الإدارة</p>
      <h1 className="mt-1 text-[24px] font-semibold tracking-tight">دخول المشرف</h1>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <Field
          id="username"
          label="اسم المستخدم"
          autoComplete="username"
          dir="ltr"
          style={{ textAlign: 'right' }}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          data-testid="input-username"
        />
        <Field
          id="password"
          label="كلمة المرور"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="input-password"
        />
        {login.isError && (
          <ErrorNote>{errorText(login.error, 'تعذّر تسجيل الدخول. تحقق من البيانات.')}</ErrorNote>
        )}
        <PrimaryButton
          type="submit"
          loading={login.isPending}
          disabled={!username.trim() || !password}
          data-testid="button-admin-login"
        >
          دخول
        </PrimaryButton>
      </form>
    </AuthFrame>
  );
}

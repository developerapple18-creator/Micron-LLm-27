import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ShieldCheck } from 'lucide-react';
import { useLogin } from '@workspace/api-client-react';
import { AuthFrame, ErrorNote, Field, PrimaryButton } from '@/components/kit';
import { errorText, useApplySession, useCsrfRequest } from '@/lib/session';
export default function Login() {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [, navigate] = useLocation();
  const apply = useApplySession();
  const request = useCsrfRequest();
  const login = useLogin({
    request,
    mutation: {
      onSuccess: (s) => {
        apply(s);
        navigate('/');
      },
    },
  });
  const submit = (e) => {
    e.preventDefault();
    if (!mobile.trim() || !password || login.isPending) return;
    login.mutate({ data: { mobile: mobile.trim(), password } });
  };
  return (
    <AuthFrame
      footer={
        <span className="inline-flex items-center gap-2">
          <span>
            ليس لديك حساب؟{' '}
            <Link
              href="/register"
              data-testid="link-register"
              className="font-medium text-foreground underline underline-offset-4"
            >
              إنشاء حساب
            </Link>
          </span>
          <Link
            href="/admin/login"
            data-testid="link-admin-login"
            aria-label="تسجيل دخول إدارة النظام"
            title="تسجيل دخول إدارة النظام"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />
          </Link>
        </span>
      }
    >
      <h1 className="text-[24px] font-semibold tracking-tight">تسجيل الدخول</h1>
      <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
        أدخل رقم جوالك وكلمة المرور.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <Field
          id="mobile"
          label="رقم الجوال"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          dir="ltr"
          placeholder="05XXXXXXXX"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          data-testid="input-mobile"
          style={{ textAlign: 'right' }}
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
        <div className="flex justify-start">
          <Link
            href="/reset-password"
            data-testid="link-forgot"
            className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            نسيت كلمة المرور؟
          </Link>
        </div>
        {login.isError && (
          <ErrorNote>
            {errorText(login.error, 'تعذّر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.')}
          </ErrorNote>
        )}
        <PrimaryButton
          type="submit"
          loading={login.isPending}
          disabled={!mobile.trim() || !password || login.isPending}
          data-testid="button-login"
        >
          دخول
        </PrimaryButton>
      </form>
    </AuthFrame>
  );
}

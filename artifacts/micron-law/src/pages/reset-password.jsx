import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  useStartPasswordReset,
  useVerifyPasswordReset,
  useCompletePasswordReset,
} from '@workspace/api-client-react';
import { AuthFrame, ErrorNote, Field, PrimaryButton } from '@/components/kit';
import { OtpActions, OtpCode, OTP_LENGTH, useSecondsUntil } from '@/components/otp-code';
import { errorStatus, errorText, useApplySession, useCsrfRequest, useSession } from '@/lib/session';
const NEUTRAL = 'إذا كان الرقم مسجلًا لدينا فستصلك رسالة نصية برمز التحقق.';
export default function ResetPassword() {
  const [step, setStep] = useState(1);
  const [mobile, setMobile] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [, navigate] = useLocation();
  const session = useSession();
  const request = useCsrfRequest();
  const apply = useApplySession();
  const expiresIn = useSecondsUntil(challenge?.expiresAt);
  const start = useStartPasswordReset({
    request,
    mutation: {
      onSuccess: (c) => {
        setChallenge(c);
        setSentAt(Date.now());
        setCode('');
        verify.reset();
        complete.reset();
        setStep(2);
      },
    },
  });
  const verify = useVerifyPasswordReset({
    request,
    mutation: {
      onSuccess: () => {
        setPassword('');
        setConfirm('');
        setStep(3);
      },
    },
  });
  const complete = useCompletePasswordReset({
    request,
    mutation: {
      onSuccess: (s) => {
        apply(s);
        navigate('/');
      },
    },
  });
  const restart = () => {
    setStep(1);
    setChallenge(null);
    setCode('');
    start.reset();
    verify.reset();
    complete.reset();
  };
  const pwError =
    password && password.length < 12
      ? 'يجب ألا تقل كلمة المرور عن 12 حرفًا.'
      : password.length > 128
        ? 'يجب ألا تزيد كلمة المرور عن 128 حرفًا.'
        : '';
  const confirmError = confirm && confirm !== password ? 'كلمتا المرور غير متطابقتين.' : '';
  const pwOk = password.length >= 12 && password.length <= 128 && confirm === password;
  const pending = start.isPending || verify.isPending || complete.isPending;
  const submit = (e) => {
    e.preventDefault();
    if (pending) return;
    if (step === 1 && mobile.trim()) start.mutate({ data: { mobile: mobile.trim() } });
    if (step === 2 && code.length === OTP_LENGTH && expiresIn > 0)
      verify.mutate({ data: { code } });
    if (step === 3 && pwOk) complete.mutate({ data: { password, confirmPassword: confirm } });
  };
  const disabled =
    pending ||
    (step === 1
      ? !mobile.trim()
      : step === 2
        ? code.length !== OTP_LENGTH || expiresIn <= 0
        : !pwOk);
  const err = step === 1 ? start.error : step === 2 ? verify.error || start.error : complete.error;
  const stale =
    step === 3 &&
    complete.isError &&
    [400, 401, 403, 410].includes(errorStatus(complete.error) ?? 0);
  return (
    <AuthFrame
      footer={
        <>
          تذكرت كلمة المرور؟{' '}
          <Link
            href="/login"
            data-testid="link-login"
            className="font-medium text-foreground underline underline-offset-4"
          >
            تسجيل الدخول
          </Link>
        </>
      }
    >
      <div
        className="mb-8 flex gap-1.5"
        aria-label={`الخطوة ${step} من 3`}
        data-testid="status-step"
      >
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`h-1 flex-1 rounded-full ${n <= step ? 'bg-foreground' : 'bg-border'}`}
          />
        ))}
      </div>
      <p className="text-[12px] font-medium text-muted-foreground">الخطوة {step} من 3</p>
      <h1 className="mt-1 text-[24px] font-semibold tracking-tight">
        {step === 1 ? 'استعادة كلمة المرور' : step === 2 ? 'أدخل رمز التحقق' : 'كلمة مرور جديدة'}
      </h1>
      <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
        {step === 1 && 'أدخل رقم الجوال المرتبط بحسابك.'}
        {step === 2 && (
          <>
            أرسلنا الطلب للرقم{' '}
            <span dir="ltr" className="font-medium text-foreground">
              {challenge?.mobile}
            </span>
          </>
        )}
        {step === 3 && 'اختر كلمة مرور جديدة لا تقل عن 12 حرفًا.'}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        {step === 1 && (
          <Field
            id="mobile"
            label="رقم الجوال"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="05XXXXXXXX"
            style={{ textAlign: 'right' }}
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            data-testid="input-mobile"
          />
        )}
        {step === 2 && (
          <>
            <p
              role="status"
              className="rounded-lg border bg-muted/50 px-3.5 py-3 text-[13.5px] leading-6 text-muted-foreground"
              data-testid="text-reset-notice"
            >
              {NEUTRAL}
            </p>
            <OtpCode
              id="reset-otp"
              value={code}
              onChange={setCode}
              disabled={verify.isPending || expiresIn <= 0}
              invalid={verify.isError}
              hint={session.data?.developmentOtp ? 'بيئة التطوير: الرمز 1111' : undefined}
            />
            <OtpActions
              sentAt={sentAt}
              expiresIn={expiresIn}
              busy={pending}
              onResend={() => {
                verify.reset();
                start.mutate({ data: { mobile: challenge?.mobile || mobile.trim() } });
              }}
              onChangeMobile={restart}
            />
          </>
        )}
        {step === 3 && (
          <>
            <input
              type="text"
              autoComplete="username"
              value={challenge?.mobile ?? ''}
              readOnly
              hidden
            />
            <Field
              id="password"
              label="كلمة المرور الجديدة"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={pwError}
              hint="من 12 إلى 128 حرفًا"
              data-testid="input-password"
            />
            <Field
              id="confirm"
              label="تأكيد كلمة المرور"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={confirmError}
              data-testid="input-confirm-password"
            />
          </>
        )}
        {err && <ErrorNote>{errorText(err)}</ErrorNote>}
        {stale && (
          <button
            type="button"
            onClick={restart}
            className="min-h-11 text-sm underline"
            data-testid="button-restart"
          >
            البدء من جديد
          </button>
        )}
        <PrimaryButton
          type="submit"
          loading={pending}
          disabled={disabled}
          data-testid="button-next"
        >
          {step === 1 ? 'إرسال الرمز' : step === 2 ? 'تحقق' : 'حفظ كلمة المرور والدخول'}
        </PrimaryButton>
      </form>
    </AuthFrame>
  );
}

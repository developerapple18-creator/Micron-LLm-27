import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  useStartRegistration,
  useVerifyMobile,
  useCompleteRegistration,
  useGetLegalDocuments,
  getGetLegalDocumentsQueryKey,
} from '@workspace/api-client-react';
import { Check } from 'lucide-react';
import { OtpActions, OtpCode, OTP_LENGTH, useSecondsUntil } from '@/components/otp-code';
import { AuthFrame, ErrorNote, Field, PrimaryButton, Skeleton } from '@/components/kit';
import { DocReader } from '@/components/doc-reader';
import { errorStatus, errorText, useApplySession, useCsrfRequest, useSession } from '@/lib/session';
const KINDS = ['terms', 'usage', 'privacy'];
const KIND_LABEL = {
  terms: 'الشروط والأحكام',
  usage: 'سياسة الاستخدام',
  privacy: 'سياسة الخصوصية',
};
export default function Register() {
  const [step, setStep] = useState(1);
  const [mobile, setMobile] = useState('');
  const [verified, setVerified] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState({});
  const [reading, setReading] = useState(null);
  const [notice, setNotice] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const [sentAt, setSentAt] = useState(0);
  const [, navigate] = useLocation();
  const session = useSession();
  const request = useCsrfRequest();
  const apply = useApplySession();
  const expiresIn = useSecondsUntil(expiresAt);
  const docsQ = useGetLegalDocuments({
    query: { queryKey: getGetLegalDocumentsQueryKey(), enabled: step === 3 },
  });
  const docs = useMemo(() => {
    const list = docsQ.data ?? [];
    return KINDS.map((k) => list.find((d) => d.kind === k && d.published)).filter(Boolean);
  }, [docsQ.data]);
  const docsReady = docs.length === 3;
  const start = useStartRegistration({
    request,
    mutation: {
      onSuccess: (c) => {
        setVerified(c.mobile);
        setExpiresAt(c.expiresAt);
        setSentAt(Date.now());
        verify.reset();
        setCode('');
        setAccepted({});
        setNotice('');
        complete.reset();
        setStep(2);
      },
    },
  });
  const verify = useVerifyMobile({ request, mutation: { onSuccess: () => setStep(3) } });
  const complete = useCompleteRegistration({
    request,
    mutation: {
      onSuccess: (s) => {
        apply(s);
        navigate('/');
      },
      onError: (e) => {
        if (errorStatus(e) === 409) {
          setAccepted({});
          setNotice(errorText(e, 'يرجى مراجعة الوثائق القانونية والمحاولة مجددًا.'));
          void docsQ.refetch();
        }
      },
    },
  });
  const pwError =
    password && password.length < 12
      ? 'يجب ألا تقل كلمة المرور عن 12 حرفًا.'
      : password.length > 128
        ? 'يجب ألا تزيد كلمة المرور عن 128 حرفًا.'
        : '';
  const confirmError = confirm && confirm !== password ? 'كلمتا المرور غير متطابقتين.' : '';
  const allAccepted = docsReady && docs.every((d) => accepted[d.id]);
  const canFinish =
    password.length >= 12 && password.length <= 128 && confirm === password && allAccepted;
  const pending = start.isPending || verify.isPending || complete.isPending;
  const submit = (e) => {
    e.preventDefault();
    if (pending) return;
    if (step === 1 && mobile.trim()) start.mutate({ data: { mobile: mobile.trim() } });
    if (step === 2 && code.length === OTP_LENGTH && expiresIn > 0)
      verify.mutate({ data: { code } });
    if (step === 3 && canFinish) {
      setNotice('');
      complete.mutate({
        data: {
          ...(name.trim() ? { name: name.trim() } : {}),
          password,
          confirmPassword: confirm,
          acceptedDocumentIds: docs.map((d) => d.id),
        },
      });
    }
  };
  const disabled =
    pending ||
    (step === 1
      ? !mobile.trim()
      : step === 2
        ? code.length !== OTP_LENGTH || expiresIn <= 0
        : !canFinish);
  const err = step === 1 ? start.error : step === 2 ? verify.error || start.error : complete.error;
  return (
    <AuthFrame
      footer={
        <>
          لديك حساب؟{' '}
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
        {step === 1 ? 'إنشاء حساب' : step === 2 ? 'تأكيد رقم الجوال' : 'إكمال البيانات'}
      </h1>
      <p className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
        {step === 1 &&
          (session.data?.developmentOtp
            ? 'أدخل رقم جوالك للمتابعة. لا تُرسل رسائل نصية في بيئة التطوير.'
            : 'أدخل رقم جوالك لاستقبال رمز التحقق برسالة نصية.')}
        {step === 2 && (
          <>
            أدخل رمز التحقق لرقم{' '}
            <span dir="ltr" className="font-medium text-foreground">
              {verified}
            </span>
          </>
        )}
        {step === 3 && 'أكمل بيانات حسابك ووافق على الوثائق القانونية.'}
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
            {start.data?.message && (
              <p role="status" className="text-sm leading-6 text-muted-foreground">
                {start.data.message}
              </p>
            )}
            <OtpCode
              id="otp"
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
                start.mutate({ data: { mobile: verified || mobile.trim() } });
              }}
              onChangeMobile={() => {
                setStep(1);
                setExpiresAt(null);
                setCode('');
                start.reset();
                verify.reset();
              }}
            />
          </>
        )}
        {step === 3 && (
          <>
            <Field
              id="verified"
              label="اسم المستخدم — رقم الجوال المؤكد"
              value={verified}
              readOnly
              dir="ltr"
              style={{ textAlign: 'right' }}
              data-testid="input-verified-mobile"
            />
            <Field
              id="password"
              label="كلمة المرور"
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={128}
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
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={confirmError}
              data-testid="input-confirm-password"
            />
            <Field
              id="name"
              label="الاسم (اختياري)"
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-name"
            />
            <div className="pt-2">
              <p className="mb-2 text-[13px] font-medium text-foreground/80">الوثائق القانونية</p>
              {docsQ.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : docsQ.isError ? (
                <div className="space-y-2">
                  <ErrorNote>{errorText(docsQ.error, 'تعذّر تحميل الوثائق القانونية.')}</ErrorNote>
                  <button
                    type="button"
                    onClick={() => docsQ.refetch()}
                    data-testid="button-retry-docs"
                    className="h-10 rounded-md border px-4 text-[13.5px] hover:bg-accent"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              ) : !docsReady ? (
                <div
                  className="rounded-lg border bg-muted/50 px-3.5 py-3 text-[13.5px] leading-6 text-muted-foreground"
                  data-testid="text-docs-unavailable"
                >
                  التسجيل غير متاح حاليًا لعدم نشر جميع الوثائق القانونية بعد. يرجى المحاولة لاحقًا.
                </div>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3.5 py-3">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={!!accepted[d.id]}
                        aria-label={`${d.kind === 'privacy' ? 'الإقرار بالاطلاع على' : 'الموافقة على'} ${d.title}`}
                        onClick={() => setAccepted((a) => ({ ...a, [d.id]: !a[d.id] }))}
                        data-testid={`checkbox-${d.kind}`}
                        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border ${accepted[d.id] ? 'border-foreground bg-foreground text-background' : 'border-input bg-background'}`}
                      >
                        {accepted[d.id] && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </button>
                      <span className="flex-1 text-[13.5px] leading-6">
                        {d.kind === 'privacy' ? 'أقر باطلاعي على ' : 'أوافق على '}
                        <button
                          type="button"
                          onClick={() => setReading(d)}
                          data-testid={`link-doc-${d.kind}`}
                          className="font-medium underline underline-offset-4"
                        >
                          {d.title || KIND_LABEL[d.kind]}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {notice && <ErrorNote testId="text-notice">{notice}</ErrorNote>}
          </>
        )}
        {err && !(step === 3 && errorStatus(err) === 409) && (
          <ErrorNote>{errorText(err)}</ErrorNote>
        )}
        {step === 3 && errorStatus(err) === 400 && (
          <button
            type="button"
            onClick={() => {
              setStep(1);
              complete.reset();
            }}
            className="text-sm underline"
          >
            التحقق من الجوال مجددًا
          </button>
        )}
        <PrimaryButton
          type="submit"
          loading={pending}
          disabled={disabled}
          data-testid="button-next"
        >
          {step === 3 ? 'إنشاء الحساب' : 'التالي'}
        </PrimaryButton>
      </form>
      <DocReader doc={reading} onClose={() => setReading(null)} />
    </AuthFrame>
  );
}

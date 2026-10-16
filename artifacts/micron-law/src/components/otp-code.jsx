import { useEffect, useState } from 'react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
export const OTP_LENGTH = 4;
export function normalizeDigits(v) {
  return v
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '')
    .slice(0, OTP_LENGTH);
}
export function OtpCode({
  id,
  value,
  onChange,
  disabled,
  invalid,
  label = 'رمز التحقق',
  hint,
  testId = 'input-otp',
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[13px] font-medium text-foreground/80">
        {label}
      </label>
      <div dir="ltr" className="flex justify-center">
        <InputOTP
          id={id}
          maxLength={OTP_LENGTH}
          value={value}
          onChange={(v) => onChange(normalizeDigits(v))}
          pasteTransformer={(t) => normalizeDigits(t)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="^[0-9٠-٩۰-۹]*$"
          disabled={disabled}
          aria-label={`${label}، ${OTP_LENGTH} أرقام`}
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={invalid || undefined}
          data-testid={testId}
          containerClassName="gap-0"
        >
          <InputOTPGroup className="gap-2.5 sm:gap-3">
            {Array.from({ length: OTP_LENGTH }, (_, i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className={`h-14 w-12 rounded-lg border bg-card text-[22px] font-semibold tabular-nums shadow-none first:rounded-lg last:rounded-lg sm:h-[60px] sm:w-14 ${invalid ? 'border-destructive' : 'border-input'} data-[active=true]:border-foreground/50`}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      {hint && (
        <p
          id={hintId}
          className="text-center text-[12.5px] text-muted-foreground"
          data-testid="text-otp-hint"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
function secondsUntil(iso) {
  return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000)) : 0;
}

/** Seconds remaining until an ISO timestamp; ticks every second. */
export function useSecondsUntil(iso) {
  const [seconds, setSeconds] = useState(() => secondsUntil(iso));
  useEffect(() => {
    setSeconds(secondsUntil(iso));
    if (!iso) return;
    const timer = window.setInterval(() => setSeconds(secondsUntil(iso)), 1000);
    return () => window.clearInterval(timer);
  }, [iso]);
  return seconds;
}
export function formatMMSS(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Resend/change-mobile controls with a 60s client-side cooldown matching the server. */
export function OtpActions({ sentAt, onResend, onChangeMobile, busy, expiresIn }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const wait = Math.max(0, 60 - Math.floor((now - sentAt) / 1000));
  return (
    <div className="space-y-2 text-center">
      <p
        className="text-[12.5px] text-muted-foreground"
        aria-live="polite"
        data-testid="text-otp-expiry"
      >
        {expiresIn > 0 ? (
          <>
            ينتهي الرمز خلال{' '}
            <span dir="ltr" className="tabular-nums">
              {formatMMSS(expiresIn)}
            </span>
          </>
        ) : (
          'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.'
        )}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-4">
        <button
          type="button"
          onClick={onResend}
          disabled={busy || wait > 0}
          data-testid="button-resend"
          className="min-h-11 text-[13px] text-foreground underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
          {wait > 0 ? (
            <>
              إعادة الإرسال بعد{' '}
              <span dir="ltr" className="tabular-nums">
                {wait}
              </span>{' '}
              ث
            </>
          ) : (
            'إعادة إرسال الرمز'
          )}
        </button>
        <button
          type="button"
          onClick={onChangeMobile}
          disabled={busy}
          data-testid="button-change-mobile"
          className="min-h-11 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
        >
          تغيير رقم الجوال
        </button>
      </div>
    </div>
  );
}

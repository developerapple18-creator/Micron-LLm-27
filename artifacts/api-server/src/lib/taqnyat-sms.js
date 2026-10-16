import { HttpError } from './security.js';
import { logger } from './logger.js';
/** Only fixed diagnostic labels may leave the adapter, never provider text or identifiers. */
function failureReason(status, message) {
  if (status === 401) return 'credentials_rejected';
  const reasons = {
    'invalid credentials information': 'credentials_rejected',
    'this ip not authorized to using the api': 'ip_not_authorized',
    "you can't use proxy to send": 'proxy_not_allowed',
    'sending by api is disabled': 'provider_api_disabled',
    'this country not authorized to using the api': 'country_not_authorized',
    'sender name is not accepted': 'sender_not_accepted',
    'sender name not active': 'sender_inactive',
    'sender name is expierd': 'sender_expired',
    'your balance is 0': 'insufficient_balance',
    'your balance is not enough': 'insufficient_balance',
    'mobile(s) number(s) is not specified or incorrect': 'invalid_recipient',
  };
  const normalized =
    typeof message === 'string'
      ? message
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/[.\s]+$/g, '')
      : '';
  return Object.hasOwn(reasons, normalized)
    ? reasons[normalized]
    : 'provider_response_not_accepted';
}
/** Production-only credentials. Configuring Secrets never enables sending. */
export function requireSmsConfiguration() {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.SMS_AUTH_ENABLED !== 'true' ||
    !process.env.TAQNYAT_BEARER_TOKEN?.trim() ||
    !process.env.TAQNYAT_SENDER?.trim()
  )
    throw new HttpError(503, 'التحقق برسائل الجوال غير مفعّل حاليًا. يرجى المحاولة لاحقًا.');
}
function numbers(value) {
  if (Array.isArray(value)) return value.map(String);
  // The vendor documents both arrays and stringified arrays (including trailing commas).
  if (typeof value === 'string') {
    try {
      return numbers(JSON.parse(value.replace(/,\s*]/g, ']')));
    } catch {
      return [];
    }
  }
  return [];
}
export async function sendVerificationSms(mobile, code, purpose) {
  requireSmsConfiguration();
  const recipient = mobile.replace(/^\+/, '');
  if (!/^9665\d{8}$/.test(recipient) || !/^\d{4}$/.test(code))
    throw new Error('Invalid SMS verification input');
  const diagnostic = { reason: 'transport_error' };
  try {
    const response = await fetch('https://api.taqnyat.sa/v1/messages', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${process.env.TAQNYAT_BEARER_TOKEN.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipients: [recipient],
        sender: process.env.TAQNYAT_SENDER.trim(),
        body:
          purpose === 'registration'
            ? `رمز التحقق هو ${code} للتسجيل في ميكرون`
            : `رمز التحقق هو ${code} لإعادة تعيين كلمة المرور في ميكرون`,
      }),
    });
    diagnostic.httpStatus = response.status;
    diagnostic.reason = response.status === 401 ? 'credentials_rejected' : 'invalid_response_json';
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid SMS response');
    const result = data;
    if (
      typeof result.statusCode === 'number' &&
      Number.isInteger(result.statusCode) &&
      result.statusCode >= 100 &&
      result.statusCode <= 599
    )
      diagnostic.providerStatus = result.statusCode;
    diagnostic.reason = failureReason(response.status, result.message);
    if (
      response.status !== 201 ||
      result.statusCode !== 201 ||
      !result.messageId ||
      !numbers(result.accepted).includes(recipient) ||
      numbers(result.rejected).length
    )
      throw new Error('SMS not confirmed');
  } catch (error) {
    if (
      diagnostic.httpStatus === undefined &&
      error instanceof Error &&
      error.name === 'TimeoutError'
    )
      diagnostic.reason = 'transport_timeout';
    logger.warn({ event: 'sms_delivery_unconfirmed', ...diagnostic }, 'SMS delivery not confirmed');
    // Never propagate provider bodies, request headers, recipient numbers or OTPs.
    // No retries, including ambiguous delivery/timeouts.
    throw new HttpError(
      502,
      'تعذّر تأكيد إرسال رمز التحقق. انتظر دقيقة ثم أعد الطلب بنفسك؛ لن نعيد الإرسال تلقائيًا.',
    );
  }
}

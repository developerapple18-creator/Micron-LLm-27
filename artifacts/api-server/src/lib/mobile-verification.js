import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { pool } from '@workspace/db';
import { developmentOtpEnabled, HttpError, throttle } from './security.js';
import { requireSmsConfiguration, sendVerificationSms } from './taqnyat-sms.js';
export function verificationMode() {
  if (developmentOtpEnabled()) return 'development';
  requireSmsConfiguration();
  return 'sms';
}
function digest(session, id, purpose, mobile, code) {
  return createHmac('sha256', process.env.SESSION_SECRET)
    .update(JSON.stringify([session, id, purpose, mobile, code]))
    .digest('hex');
}
export async function startMobileVerification(
  session,
  mobile,
  purpose,
  accountId = null,
  passwordTag = null,
  deliver = true,
) {
  const mode = verificationMode();
  await throttle(`otp-mobile:${mobile}`, 3);
  const id = randomUUID(),
    code = mode === 'development' ? '1111' : String(randomInt(10_000)).padStart(4, '0');
  const result = await pool.query(
    `INSERT INTO verification_challenges
    (session_id,mobile,expires_at,attempts,verified_at,challenge_id,purpose,code_mode,code_digest,account_id,password_tag,issued_at)
    VALUES($1,$2,now()+interval '5 minutes',0,NULL,$3,$4,$5,NULL,$6,$7,now())
    ON CONFLICT(session_id) DO UPDATE SET mobile=$2,expires_at=now()+interval '5 minutes',attempts=0,
      verified_at=NULL,challenge_id=$3,purpose=$4,code_mode=$5,code_digest=NULL,account_id=$6,password_tag=$7,issued_at=now()
    WHERE verification_challenges.issued_at<=now()-interval '1 minute'
    RETURNING expires_at`,
    [session, mobile, id, purpose, mode, accountId, passwordTag],
  );
  if (!result.rowCount) throw new HttpError(429, 'انتظر دقيقة قبل طلب رمز جديد.');
  try {
    if (mode === 'sms' && deliver) await sendVerificationSms(mobile, code, purpose);
    const saved = await pool.query(
      `UPDATE verification_challenges SET code_digest=$3
      WHERE session_id=$1 AND challenge_id=$2 AND expires_at>now()`,
      [session, id, deliver ? digest(session, id, purpose, mobile, code) : null],
    );
    if (!saved.rowCount) throw new HttpError(409, 'تغير طلب التحقق. ابدأ من جديد.');
  } catch (error) {
    await pool.query(
      `UPDATE verification_challenges SET code_digest=NULL,expires_at=now()
      WHERE session_id=$1 AND challenge_id=$2`,
      [session, id],
    );
    throw error;
  }
  return {
    mobile,
    expiresAt: result.rows[0].expires_at.toISOString(),
    message:
      mode === 'development'
        ? 'تحقق تطويري فقط؛ لم تُرسل رسالة.'
        : 'قبِل المزوّد طلب إرسال رمز التحقق. قد يستغرق وصول الرسالة بعض الوقت.',
  };
}
/** Row lock protects attempt count and the single-use transition across concurrent requests. */
export async function verifyMobileChallenge(session, code, purpose) {
  const mode = verificationMode(),
    client = await pool.connect();
  let row,
    valid = false;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM verification_challenges
      WHERE session_id=$1 AND purpose=$2 AND code_mode=$3 AND expires_at>now()
        AND verified_at IS NULL AND attempts<5 AND code_digest IS NOT NULL FOR UPDATE`,
      [session, purpose, mode],
    );
    row = found.rows[0];
    if (row) {
      const actual = digest(session, row.challenge_id, purpose, row.mobile, code);
      valid =
        row.code_digest.length === actual.length &&
        timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(row.code_digest, 'hex'));
      await client.query(
        `UPDATE verification_challenges SET attempts=attempts+1,
        verified_at=CASE WHEN $2 THEN now() ELSE NULL END,
        code_digest=CASE WHEN $2 THEN NULL ELSE code_digest END WHERE session_id=$1`,
        [session, valid],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (!row)
    throw new HttpError(
      400,
      'انتهت صلاحية الرمز أو استُخدم أو تجاوزت المحاولات. اطلب رمزًا جديدًا.',
    );
  if (!valid) throw new HttpError(400, 'رمز التحقق غير صحيح.');
  return row;
}

import { Router } from 'express';
import argon2 from 'argon2';
import { pool } from '@workspace/db';
import {
  StartPasswordResetBody,
  VerifyPasswordResetBody,
  CompletePasswordResetBody,
} from '@workspace/api-zod';
import {
  audit,
  hashText,
  HttpError,
  normalizeMobile,
  passwordOptions,
  rotateSession,
  sessionInfo,
  throttle,
} from '../lib/security.js';
import {
  startMobileVerification,
  verificationMode,
  verifyMobileChallenge,
} from '../lib/mobile-verification.js';
const router = Router();
router.post('/auth/password-reset/start', async (req, res) => {
  verificationMode();
  const mobile = normalizeMobile(StartPasswordResetBody.parse(req.body).mobile);
  await throttle(`reset-ip:${req.ip}`, 15);
  const { rows } = await pool.query(
    "SELECT id,password_hash FROM accounts WHERE username=$1 AND role='lawyer'",
    [mobile],
  );
  let expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  try {
    const challenge = await startMobileVerification(
      req.sessionID,
      mobile,
      'password_reset',
      rows[0]?.id ?? null,
      rows[0] ? hashText(rows[0].password_hash) : null,
      Boolean(rows[0]),
    );
    expiresAt = challenge.expiresAt;
  } catch (error) {
    // Identical outward response for delivery errors and unknown accounts; no account enumeration.
    if (!(error instanceof HttpError) || error.status !== 502) throw error;
    await audit(req, 'password_reset_delivery_unconfirmed');
  }
  res.json({
    mobile,
    expiresAt,
    message:
      'إذا كان الرقم مسجّلًا لدينا، فسيصلك رمز لاستعادة كلمة المرور. قد يستغرق وصول الرسالة بعض الوقت.',
  });
});
router.post('/auth/password-reset/verify', async (req, res) => {
  const { code } = VerifyPasswordResetBody.parse(req.body);
  await throttle(`verify-ip:${req.ip}`, 30);
  try {
    await verifyMobileChallenge(req.sessionID, code, 'password_reset');
  } catch (error) {
    await audit(req, 'password_reset_verification_failed');
    throw error;
  }
  res.json({ message: 'تم التحقق. يمكنك تعيين كلمة مرور جديدة.' });
});
router.post('/auth/password-reset/complete', async (req, res) => {
  const mode = verificationMode(),
    data = CompletePasswordResetBody.parse(req.body);
  await throttle(`reset-complete-ip:${req.ip}`, 15);
  if (data.password !== data.confirmPassword)
    throw new HttpError(400, 'كلمتا المرور غير متطابقتين.');
  const passwordHash = await argon2.hash(data.password, passwordOptions);
  const client = await pool.connect();
  let userId;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT c.account_id,c.password_tag,a.password_hash FROM verification_challenges c
      JOIN accounts a ON a.id=c.account_id AND a.username=c.mobile AND a.role='lawyer'
      WHERE c.session_id=$1 AND c.purpose='password_reset' AND c.code_mode=$2 AND c.verified_at IS NOT NULL
        AND c.expires_at>now() AND c.challenge_id IS NOT NULL FOR UPDATE OF c,a`,
      [req.sessionID, mode],
    );
    if (!rows[0] || rows[0].password_tag !== hashText(rows[0].password_hash))
      throw new HttpError(
        400,
        'انتهى طلب الاستعادة أو تغيرت بيانات الحساب. ابدأ الاستعادة مجددًا.',
      );
    userId = rows[0].account_id;
    await client.query('UPDATE accounts SET password_hash=$2,password_reset_at=now() WHERE id=$1', [
      userId,
      passwordHash,
    ]);
    await client.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [userId]);
    await client.query('DELETE FROM verification_challenges WHERE account_id=$1 OR session_id=$2', [
      userId,
      req.sessionID,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await rotateSession(req, userId);
  await audit(req, 'lawyer_password_reset_succeeded');
  res.json(await sessionInfo(req));
});
export default router;

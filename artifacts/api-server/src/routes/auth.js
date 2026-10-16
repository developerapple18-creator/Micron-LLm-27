import { Router } from 'express';
import argon2 from 'argon2';
import { pool } from '@workspace/db';
import {
  StartRegistrationBody,
  VerifyMobileBody,
  CompleteRegistrationBody,
  LoginBody,
  AdminLoginBody,
} from '@workspace/api-zod';
import {
  HttpError,
  normalizeMobile,
  throttle,
  passwordOptions,
  sessionInfo,
  rotateSession,
  requestEvidence,
  audit,
} from '../lib/security.js';
import {
  startMobileVerification,
  verificationMode,
  verifyMobileChallenge,
} from '../lib/mobile-verification.js';
import passwordReset from './password-reset.js';
const router = Router();
const dummyHash = argon2.hash('unusable-dummy-password-for-timing', passwordOptions);
router.get('/auth/session', async (req, res) => {
  res.json(await sessionInfo(req));
});
router.post('/auth/start', async (req, res) => {
  const { mobile: input } = StartRegistrationBody.parse(req.body);
  const mobile = normalizeMobile(input);
  await throttle(`otp-ip:${req.ip}`, 20);
  res.json(await startMobileVerification(req.sessionID, mobile, 'registration'));
});
router.post('/auth/verify', async (req, res) => {
  const { code } = VerifyMobileBody.parse(req.body);
  await throttle(`verify-ip:${req.ip}`, 30);
  try {
    await verifyMobileChallenge(req.sessionID, code, 'registration');
  } catch (error) {
    await audit(req, 'mobile_registration_verification_failed');
    throw error;
  }
  await audit(req, 'mobile_registration_verified');
  res.json({ message: 'تم التحقق من رقم الجوال.' });
});
router.post('/auth/register', async (req, res) => {
  const mode = verificationMode();
  await throttle(`register-ip:${req.ip}`, 15);
  const data = CompleteRegistrationBody.parse(req.body);
  if (data.password !== data.confirmPassword)
    throw new HttpError(400, 'كلمتا المرور غير متطابقتين.');
  const passwordHash = await argon2.hash(data.password, passwordOptions);
  const client = await pool.connect();
  let userId;
  try {
    await client.query('BEGIN');
    // Publication and registration use the same transaction lock to eliminate version races.
    await client.query('SELECT pg_advisory_xact_lock(190011)');
    const challenge = await client.query(
      `SELECT mobile FROM verification_challenges WHERE session_id=$1 AND purpose='registration'
        AND code_mode=$2 AND challenge_id IS NOT NULL AND verified_at IS NOT NULL AND expires_at>now() FOR UPDATE`,
      [req.sessionID, mode],
    );
    if (!challenge.rowCount) throw new HttpError(400, 'يرجى التحقق من رقم الجوال مجددًا.');
    const docs = await client.query(
      'SELECT DISTINCT ON(kind) * FROM legal_documents WHERE published=true ORDER BY kind,version DESC',
    );
    if (docs.rowCount !== 3)
      throw new HttpError(409, 'التسجيل متوقف حتى نشر الوثائق القانونية الثلاث.');
    if (
      new Set(data.acceptedDocumentIds).size !== 3 ||
      docs.rows.some((doc) => !data.acceptedDocumentIds.includes(doc.id))
    ) {
      throw new HttpError(409, 'تم تحديث الوثائق. يرجى قراءتها والموافقة على النسخ الجديدة.');
    }
    const mobile = challenge.rows[0].mobile;
    const inserted = await client.query(
      "INSERT INTO accounts(role,username,name,password_hash) VALUES('lawyer',$1,$2,$3) RETURNING id",
      [mobile, data.name?.trim() || 'محامٍ', passwordHash],
    );
    userId = inserted.rows[0].id;
    const { ip, userAgent } = requestEvidence(req);
    for (const doc of docs.rows) {
      const action = doc.kind === 'privacy' ? 'privacy_acknowledged' : 'document_accepted';
      const event = await client.query(
        'INSERT INTO audit_events(actor_id,action,ip,user_agent) VALUES($1,$2,$3,$4) RETURNING id',
        [userId, action, ip, userAgent],
      );
      await client.query(
        `INSERT INTO legal_acceptances(user_id,mobile,document_id,document_title,document_version,content_hash,action,audit_id,ip,user_agent)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          userId,
          mobile,
          doc.id,
          doc.title,
          doc.version,
          doc.content_hash,
          action,
          event.rows[0].id,
          ip,
          userAgent,
        ],
      );
    }
    await client.query('DELETE FROM verification_challenges WHERE session_id=$1', [req.sessionID]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505')
      throw new HttpError(409, 'تعذر إنشاء الحساب بهذا الرقم. جرّب تسجيل الدخول.');
    throw error;
  } finally {
    client.release();
  }
  await rotateSession(req, userId);
  res.status(201).json(await sessionInfo(req));
});
for (const role of ['lawyer', 'admin']) {
  router.post(role === 'admin' ? '/admin/login' : '/auth/login', async (req, res) => {
    await throttle(`login-ip:${req.ip}`, 50);
    if (role === 'admin') {
      const initialized = await pool.query("SELECT 1 FROM accounts WHERE role='admin' LIMIT 1");
      if (!initialized.rowCount)
        throw new HttpError(503, 'دخول الإدارة متوقف حتى استكمال إعداد بيانات المدير الآمنة.');
    }
    const data = role === 'admin' ? AdminLoginBody.parse(req.body) : LoginBody.parse(req.body);
    const username = 'mobile' in data ? normalizeMobile(data.mobile) : data.username.trim();
    await throttle(`login:${role}:${username}`, 10);
    const { rows } = await pool.query(
      'SELECT id,password_hash FROM accounts WHERE role=$1 AND username=$2',
      [role, username],
    );
    const valid = await argon2.verify(rows[0]?.password_hash || (await dummyHash), data.password);
    if (!rows[0] || !valid) {
      await audit(req, `${role}_login_failed`);
      throw new HttpError(401, 'بيانات الدخول غير صحيحة.');
    }
    await rotateSession(req, rows[0].id);
    await audit(req, `${role}_login_succeeded`);
    res.json(await sessionInfo(req));
  });
}
router.use(passwordReset);
router.post('/auth/logout', async (req, res) => {
  await audit(req, 'logout');
  await pool.query('DELETE FROM verification_challenges WHERE session_id=$1', [req.sessionID]);
  await new Promise((resolve, reject) =>
    req.session.destroy((error) => (error ? reject(error) : resolve())),
  );
  res.clearCookie('micron.sid', { path: '/', httpOnly: true, secure: true, sameSite: 'none' });
  res.json({ message: 'تم تسجيل الخروج.' });
});
export default router;

// Actual auth routes, passwords, CSRF, sessions and SQL; all writes in TEMP.
import express from 'express';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { pool, publicFingerprints } from './workflow-fixture-db.js';
import {
  sessionMiddleware,
  csrfProtection,
  HttpError,
  hashText,
  passwordOptions,
} from '../src/lib/security.js';
import auth from '../src/routes/auth.js';
import legal from '../src/routes/legal.js';
import cases from '../src/routes/cases.js';
const protectedTables = [
  'accounts',
  'sessions',
  'verification_challenges',
  'attempt_limits',
  'audit_events',
  'legal_documents',
  'legal_acceptances',
];
async function authFingerprint() {
  const hashes = {};
  for (const t of protectedTables)
    hashes[t] = (
      await pool.query(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) AS hash FROM public.${t} t`,
      )
    ).rows[0];
  return hashes;
}
const before = await authFingerprint();
for (const t of protectedTables)
  await pool.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING ALL)`);
const password = 'Synthetic-Auth-Password-2026!';
await pool.query(
  "INSERT INTO accounts(role,username,name,password_hash) VALUES('lawyer',$1,$2,$3),('admin',$4,$5,$3)",
  [
    '+966500000123',
    'محامٍ اصطناعي لاختبار المصادقة',
    await argon2.hash(password, passwordOptions),
    'synthetic-admin',
    'مدير اصطناعي',
  ],
);
for (const kind of ['terms', 'usage', 'privacy'])
  await pool.query(
    `INSERT INTO legal_documents(id,kind,title,content,version,published,testing,content_hash)
    VALUES($1,$2,$3,$4,1,true,true,$5)`,
    [
      randomUUID(),
      kind,
      'وثيقة اختبار اصطناعية ' + kind,
      'هذا نص اختبار معزول غير نافذ قانونًا.',
      hashText(kind),
    ],
  );
let delivery = 'accepted';
const messages = [];
const capturedSessions = [];
globalThis.fetch = async (input, init) => {
  if (String(input) !== 'https://api.taqnyat.sa/v1/messages')
    throw new Error('External traffic disabled');
  if (delivery === 'timeout') throw new Error('Synthetic timeout; no external request');
  if (delivery === 'rejected')
    return Response.json({ statusCode: 400, message: 'synthetic-provider-token' }, { status: 400 });
  const body = JSON.parse(String(init?.body)),
    mobile = body.recipients[0];
  const code = body.body.match(/\b\d{4}\b/)?.[0];
  if (!code || !mobile || init?.method !== 'POST') throw new Error('Unexpected SMS payload');
  messages.push({ mobile, code, body: body.body });
  return Response.json(
    { statusCode: 201, messageId: messages.length, accepted: [mobile], rejected: [] },
    { status: 201 },
  );
};
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.get('/__fixture/otp', (req, res) =>
  res.json(messages.filter((m) => m.mobile === req.query.mobile).at(-1) ?? null),
);
app.get('/__fixture/stats', async (_req, res) =>
  res.json({
    externalRequests: 0,
    messages: messages.length,
    public: await publicFingerprints(),
    auth: { before, after: await authFingerprint() },
    accounts: (await pool.query('SELECT count(*)::int AS count FROM accounts')).rows[0].count,
    acceptances: (await pool.query('SELECT count(*)::int AS count FROM legal_acceptances')).rows[0]
      .count,
  }),
);
app.post('/__fixture/control', async (req, res) => {
  if (req.body.delivery) delivery = req.body.delivery;
  if (req.body.enabled != null) process.env.SMS_AUTH_ENABLED = String(req.body.enabled);
  if (req.body.mode) {
    process.env.NODE_ENV = req.body.mode;
    process.env.ENABLE_DEVELOPMENT_OTP = req.body.mode === 'development' ? 'true' : 'false';
  }
  if (req.body.mobile && req.body.action === 'age')
    await pool.query(
      "UPDATE verification_challenges SET issued_at=now()-interval '2 minutes' WHERE mobile=$1",
      [req.body.mobile],
    );
  if (req.body.mobile && req.body.action === 'expire')
    await pool.query(
      "UPDATE verification_challenges SET expires_at=now()-interval '1 second' WHERE mobile=$1",
      [req.body.mobile],
    );
  if (req.body.action === 'resetLimits') await pool.query('DELETE FROM attempt_limits');
  if (req.body.action === 'changePassword')
    await pool.query("UPDATE accounts SET password_hash=$1 WHERE username='+966500000123'", [
      await argon2.hash(password, passwordOptions),
    ]);
  if (req.body.action === 'resurrectCaptured')
    for (const row of capturedSessions)
      await pool.query(
        `INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3)
      ON CONFLICT(sid) DO UPDATE SET sess=$2,expire=$3`,
        [row.sid, row.sess, row.expire],
      );
  res.json({ ok: true });
});
app.use(sessionMiddleware);
app.use(csrfProtection);
app.get('/api/__fixture/session-metadata', (req, res) =>
  res.json({
    maxAge: req.session.cookie.originalMaxAge,
    authenticatedAt: req.session.authenticatedAt,
  }),
);
app.post('/api/__fixture/capture-session', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM sessions WHERE sid=$1', [req.sessionID]);
  if (req.body.legacy) {
    delete rows[0].sess.passwordTag;
    delete rows[0].sess.authenticatedAt;
  }
  capturedSessions.push(rows[0]);
  res.json({ captured: true });
});
app.post('/api/__fixture/age-session', (req, res) => {
  req.session.authenticatedAt = Date.now() - 30 * 24 * 60 * 60 * 1000 - 1000;
  res.json({ aged: true });
});
app.use('/api', auth);
app.use('/api', legal);
app.use('/api', cases);
app.use((error, _req, res, _next) => {
  res
    .status(error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 500)
    .json({ error: error instanceof HttpError ? error.message : 'تعذّر إكمال طلب الاختبار.' });
});
app.listen(19486, '127.0.0.1', () =>
  console.log('AUTH FIXTURE READY 19486; TEMP only; external traffic disabled'),
);

import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:19486',
  password = 'Synthetic-Auth-Password-2026!',
  mobile = '+966500000123';
let checks = 0;
const ok = (v, label) => {
  assert.ok(v, label);
  checks++;
};
const control = async (body) =>
  (
    await fetch(base + '/__fixture/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();
const sms = async (number) =>
  await (await fetch(base + '/__fixture/otp?mobile=' + number.replace('+', ''))).json();
const stats = async () => await (await fetch(base + '/__fixture/stats')).json();
function client() {
  return {
    cookie: '',
    csrf: '',
    async call(path, data, expected = 200, csrf = this.csrf) {
      const r = await fetch(base + '/api' + path, {
        method: data == null ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
          Cookie: this.cookie,
          'X-CSRF-Token': csrf,
        },
        ...(data == null ? {} : { body: JSON.stringify(data) }),
      });
      const c = r.headers.get('set-cookie');
      if (c) this.cookie = c.split(';')[0];
      const body = await r.json();
      assert.equal(r.status, expected, JSON.stringify({ path, status: r.status, body }));
      if (body.csrfToken) this.csrf = body.csrfToken;
      return body;
    },
  };
}
const initClient = async () => {
  const c = client();
  await c.call('/auth/session');
  return c;
};
const a = await initClient(),
  otherDevice = await initClient(),
  outsider = await initClient();
await control({ enabled: false });
await a.call('/auth/start', { mobile }, 503);
checks++;
const beforeLogin = (await stats()).messages,
  oldCsrf = a.csrf,
  oldCookie = a.cookie;
const signed = await a.call('/auth/login', { mobile, password });
ok(
  signed.user?.role === 'lawyer' &&
    !signed.loginChallenge &&
    (await stats()).messages === beforeLogin,
  'Production password login works with SMS disabled and sends nothing',
);
ok(a.csrf !== oldCsrf && a.cookie !== oldCookie, 'Login rotates session and CSRF');
ok(
  (await a.call('/__fixture/session-metadata')).maxAge === 30 * 86400000,
  'Lawyer cookie persists30days',
);
await otherDevice.call('/auth/login', { mobile, password });
await a.call('/__fixture/capture-session', {});
await otherDevice.call('/__fixture/capture-session', { legacy: true });
await a.call('/auth/login', { mobile, password: 'incorrect' }, 401);
checks++;
await outsider.call('/auth/start', { mobile }, 403, 'bad-csrf');
checks++;
await control({ enabled: true });
const r = await initClient(),
  number = '+966522222222';
await r.call('/auth/start', { mobile: number });
const registration = await sms(number);
ok(
  /^\d{4}$/.test(registration.code) &&
    registration.body === `رمز التحقق هو ${registration.code} للتسجيل في ميكرون`,
  'Four-digit registration code and exact Arabic message',
);
await r.call('/auth/start', { mobile: number }, 429);
checks++;
await outsider.call('/auth/verify', { code: registration.code }, 400);
checks++;
await r.call('/auth/password-reset/verify', { code: registration.code }, 400);
checks++;
const verified = await Promise.allSettled([
  r.call('/auth/verify', { code: registration.code }),
  r.call('/auth/verify', { code: registration.code }),
]);
ok(
  verified.filter((v) => v.status === 'fulfilled').length === 1,
  'Concurrent correct code consumed once',
);
const docs = await r.call('/legal/documents');
const input = { password, confirmPassword: password, acceptedDocumentIds: docs.map((d) => d.id) };
await r.call('/auth/register', { ...input, acceptedDocumentIds: [] }, 400);
checks++;
const created = await r.call('/auth/register', input, 201);
ok(
  created.user?.name === 'محامٍ' &&
    created.user.username === number &&
    (await stats()).acceptances === 3,
  'Optional name and three current legal acceptances retained',
);
ok(
  (await r.call('/__fixture/session-metadata')).maxAge === 30 * 86400000,
  'Registration grants30day session',
);
await r.call('/auth/register', input, 400);
checks++;
const reset = await initClient(),
  unknown = await initClient();
const knownReply = await reset.call('/auth/password-reset/start', { mobile });
const sent = await sms(mobile),
  beforeUnknown = (await stats()).messages;
const unknownReply = await unknown.call('/auth/password-reset/start', { mobile: '+966599999999' });
ok(
  knownReply.message === unknownReply.message &&
    Object.keys(knownReply).join() === Object.keys(unknownReply).join() &&
    (await stats()).messages === beforeUnknown,
  'Reset start does not enumerate accounts or send to unknown phones',
);
ok(
  sent.body === `رمز التحقق هو ${sent.code} لإعادة تعيين كلمة المرور في ميكرون`,
  'Exact four-digit password reset message',
);
await outsider.call('/auth/password-reset/verify', { code: sent.code }, 400);
checks++;
await reset.call('/auth/verify', { code: sent.code }, 400);
checks++;
await reset.call('/auth/password-reset/complete', { password, confirmPassword: password }, 400);
checks++;
await reset.call('/auth/password-reset/verify', { code: sent.code });
ok(
  !(await reset.call('/auth/session')).user,
  'Verifying reset code does not grant an authenticated session',
);
await reset.call('/auth/password-reset/verify', { code: sent.code }, 400);
checks++;
const newPassword = 'Synthetic-Changed-Password-2026!';
await reset.call(
  '/auth/password-reset/complete',
  { password: 'short', confirmPassword: 'short' },
  400,
);
checks++;
await reset.call(
  '/auth/password-reset/complete',
  { password: newPassword, confirmPassword: password },
  400,
);
checks++;
const finished = await reset.call('/auth/password-reset/complete', {
  password: newPassword,
  confirmPassword: newPassword,
});
ok(
  finished.user?.id === signed.user.id &&
    (await reset.call('/__fixture/session-metadata')).maxAge === 30 * 86400000,
  'Password reset authenticates correct account with30days',
);
await reset.call(
  '/auth/password-reset/complete',
  { password: newPassword, confirmPassword: newPassword },
  400,
);
checks++;
ok(
  !(await a.call('/auth/session')).user && !(await otherDevice.call('/auth/session')).user,
  'Other devices revoked after reset',
);
await control({ action: 'resurrectCaptured' });
ok(
  !(await a.call('/auth/session')).user && !(await otherDevice.call('/auth/session')).user,
  'Late inflight session saves cannot resurrect old sessions, including legacy sessions',
);
await outsider.call('/auth/login', { mobile, password }, 401);
await outsider.call('/auth/login', { mobile, password: newPassword });
checks++;
const afterResetLogin = (await stats()).messages;
await outsider.call('/auth/logout', {});
ok(
  !(await outsider.call('/auth/session')).user && (await stats()).messages === afterResetLogin,
  'Logout/login require no SMS',
);
const exp = await initClient(),
  expiryPhone = '+966533333333';
await exp.call('/auth/start', { mobile: expiryPhone });
await control({ mobile: expiryPhone, action: 'expire' });
await exp.call('/auth/verify', { code: (await sms(expiryPhone)).code }, 400);
checks++;
await control({ mobile: expiryPhone, action: 'age' });
await exp.call('/auth/start', { mobile: expiryPhone });
for (let i = 0; i < 5; i++) await exp.call('/auth/verify', { code: 'wrong' }, 400);
await exp.call('/auth/verify', { code: (await sms(expiryPhone)).code }, 400);
checks++;
await control({ action: 'resetLimits' });
const ttl = await initClient();
await ttl.call('/auth/login', { mobile, password: newPassword });
await ttl.call('/__fixture/age-session', {});
ok(!(await ttl.call('/auth/session')).user, 'Absolute30day server expiry even if cookie survives');
const admin = await initClient();
await admin.call('/admin/login', { username: 'synthetic-admin', password });
ok(
  (await admin.call('/__fixture/session-metadata')).maxAge === 8 * 3600000,
  'Admin security duration unchanged8hours',
);
for (const delivery of ['rejected', 'timeout']) {
  await control({ delivery });
  const f = await initClient();
  const error = await f.call(
    '/auth/start',
    { mobile: '+966511111' + (delivery === 'rejected' ? '111' : '112') },
    502,
  );
  ok(
    !JSON.stringify(error).includes('synthetic-provider-token'),
    'Provider failure sanitized and no retry',
  );
}
await control({ delivery: 'accepted', mode: 'development', action: 'resetLimits' });
const dev = await initClient(),
  count = (await stats()).messages;
await dev.call('/auth/start', { mobile: '+966588888888' });
await dev.call('/auth/verify', { code: '1111' });
ok((await stats()).messages === count, 'Development cannot send using production credentials');
await control({ mode: 'production' });
await dev.call('/auth/register', input, 400);
checks++;
const final = await stats();
ok(
  JSON.stringify(final.auth.before) === JSON.stringify(final.auth.after) &&
    JSON.stringify(final.public.before) === JSON.stringify(final.public.after),
  'Public historical auth/accounts/passwords/legal/case data unchanged; all writes TEMP',
);
console.log(`PASS: ${checks} focused authentication checks; zero real SMS/OpenAI.`);

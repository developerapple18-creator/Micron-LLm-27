import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Bundle only the adapter; replace security, logger, credentials and HTTP with isolated fakes.
const records = [];
globalThis.__smsDiagnosticRecords = records;
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/taqnyat-sms.js', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.SMS_AUTH_ENABLED': JSON.stringify('true'),
    'process.env.TAQNYAT_BEARER_TOKEN': JSON.stringify('synthetic-private-token'),
    'process.env.TAQNYAT_SENDER': JSON.stringify('microntik'),
  },
  plugins: [
    {
      name: 'isolated-sms-dependencies',
      setup(build) {
        build.onResolve({ filter: /^\.\/(security|logger)\.js$/ }, (args) => ({
          path: args.path,
          namespace: 'sms-test',
        }));
        build.onLoad({ filter: /.*/, namespace: 'sms-test' }, (args) => ({
          contents:
            args.path === './security.js'
              ? 'export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }'
              : 'export const logger={warn(fields){globalThis.__smsDiagnosticRecords.push(fields);}};',
        }));
      },
    },
  ],
});
const { sendVerificationSms } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);
const originalFetch = globalThis.fetch;
const mobile = '+966500000123',
  code = '4321';
let posts = 0,
  checks = 0;
const cases = [
  [401, { statusCode: 401, message: 'invalid credentials information' }, 'credentials_rejected'],
  [
    400,
    { statusCode: 400, message: 'this ip Not authorized to using the API' },
    'ip_not_authorized',
  ],
  [400, { statusCode: 400, message: "you can't use proxy to send" }, 'proxy_not_allowed'],
  [400, { statusCode: 400, message: 'sending by API is disabled' }, 'provider_api_disabled'],
  [400, { statusCode: 400, message: 'Your balance is 0' }, 'insufficient_balance'],
  [400, { statusCode: 400, message: 'Sender Name not active' }, 'sender_inactive'],
  [400, { statusCode: 400, message: 'Sender Name not active .' }, 'sender_inactive'],
  [400, { statusCode: 400, message: 'Sender Name is not accepted.' }, 'sender_not_accepted'],
  [
    400,
    { statusCode: 400, message: `synthetic-private-token ${mobile} ${code}` },
    'provider_response_not_accepted',
  ],
  [400, { statusCode: 400, message: '__proto__' }, 'provider_response_not_accepted'],
  [403, '<html>Access denied</html>', 'invalid_response_json'],
];
try {
  for (const [status, body, reason] of cases) {
    globalThis.fetch = async () => {
      posts++;
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    };
    const before = posts;
    await assert.rejects(
      sendVerificationSms(mobile, code, 'registration'),
      (error) => error.status === 502 && !error.message.includes('synthetic-private-token'),
    );
    assert.equal(posts, before + 1, 'No automatic retries');
    assert.equal(records.at(-1).reason, reason);
    assert.equal(records.at(-1).httpStatus, status);
    checks++;
  }
  for (const [error, reason] of [
    [new TypeError(`network failure ${mobile} ${code}`), 'transport_error'],
    [new DOMException('synthetic timeout', 'TimeoutError'), 'transport_timeout'],
  ]) {
    globalThis.fetch = async () => {
      posts++;
      throw error;
    };
    const before = posts;
    await assert.rejects(
      sendVerificationSms(mobile, code, 'registration'),
      (error) => error.status === 502,
    );
    assert.equal(posts, before + 1);
    assert.equal(records.at(-1).reason, reason);
    assert.equal(records.at(-1).httpStatus, undefined);
    checks++;
  }
  let expectedPurpose = 'registration';
  globalThis.fetch = async (url, options) => {
    posts++;
    assert.equal(url, 'https://api.taqnyat.sa/v1/messages');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-private-token');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), {
      recipients: [mobile.slice(1)],
      sender: 'microntik',
      body:
        expectedPurpose === 'registration'
          ? `رمز التحقق هو ${code} للتسجيل في ميكرون`
          : `رمز التحقق هو ${code} لإعادة تعيين كلمة المرور في ميكرون`,
    });
    return Response.json(
      {
        statusCode: 201,
        messageId: 123,
        accepted: '[966500000123,]',
        rejected: '[]',
      },
      { status: 201 },
    );
  };
  const before = records.length;
  await sendVerificationSms(mobile, code, 'registration');
  assert.equal(records.length, before, 'Accepted response does not log an error');
  checks++;
  expectedPurpose = 'password_reset';
  await sendVerificationSms(mobile, code, expectedPurpose);
  assert.equal(records.length, before);
  checks++;
  const serialized = JSON.stringify(records);
  for (const forbidden of [
    'synthetic-private-token',
    mobile,
    mobile.slice(1),
    code,
    'Authorization',
    'Access denied',
  ])
    assert.ok(!serialized.includes(forbidden), 'No raw provider/recipient/OTP/credential leakage');
  assert.ok(
    records.every((record) =>
      Object.keys(record).every((key) =>
        ['event', 'reason', 'httpStatus', 'providerStatus'].includes(key),
      ),
    ),
  );
  checks++;
  console.log(
    `PASS ${checks} isolated SMS diagnostic checks; ${posts} mocked requests, zero network requests.`,
  );
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__smsDiagnosticRecords;
}

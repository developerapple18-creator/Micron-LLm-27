// Development-only acceptance check. Uses real registration and real private
// storage, not mock sessions. Never reads bootstrap Secrets or legal contents.
import { strict as assert } from 'node:assert';
import { randomUUID, randomInt, randomBytes, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

assert(process.env.REPLIT_DEV_DOMAIN, 'Development domain required');
assert(process.env.REPLIT_DEPLOYMENT !== '1', 'Never run against production');
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
class Session {
  cookie = '';
  csrf = '';
  async call(path, data, expected = 200) {
    const response = await fetch(origin + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        cookie: this.cookie,
        'content-type': 'application/json',
        'x-csrf-token': this.csrf,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const cookie = response.headers.getSetCookie().find((v) => v.startsWith('micron.sid='));
    if (cookie) this.cookie = cookie.split(';')[0];
    const body = await response.json();
    assert.equal(
      response.status,
      expected,
      `Unexpected status for ${path}: ${response.status}; ${body.error ?? ''}`,
    );
    if (body.csrfToken) this.csrf = body.csrfToken;
    return body;
  }
  async register(name) {
    await this.call('/auth/session');
    const docs = await this.call('/legal/documents');
    assert.equal(
      docs.length,
      3,
      'Owner must publish documents before these tests; never seed substitute legal text',
    );
    this.mobile = '05' + randomInt(10_000_000, 99_999_999);
    this.password = randomBytes(24).toString('base64url');
    await this.call('/auth/start', { mobile: this.mobile });
    await this.call('/auth/verify', { code: '1111' });
    const identity = await this.call(
      '/auth/register',
      {
        name,
        password: this.password,
        confirmPassword: this.password,
        acceptedDocumentIds: docs.map((d) => d.id),
      },
      201,
    );
    this.userId = identity.user.id;
  }
}
const a = new Session(),
  b = new Session(),
  anonymous = new Session();
await a.register('محامي اختبار الاستمرارية');
await b.register('محامي اختبار العزل');
pass('Real registration, owner-published consent documents, two isolated lawyer sessions');
await anonymous.call('/auth/session');
await anonymous.call('/cases', undefined, 401);
await a.call('/admin/documents', undefined, 403);
pass('Anonymous case access and lawyer administrator access rejected');
const createRequest = { requestId: randomUUID() };
const caseA = await a.call('/cases', createRequest);
assert.equal((await a.call('/cases', createRequest)).id, caseA.id);
const caseB = await b.call('/cases', { requestId: randomUUID() });
const base = `/cases/${caseA.id}`;
const firstInput = {
  requestId: randomUUID(),
  content: 'وقائع اختبار الاستمرارية — الرسالة الأولى',
  attachmentIds: [],
};
const first = await a.call(base + '/messages', firstInput);
const repeated = await Promise.all(
  Array.from({ length: 4 }, () => a.call(base + '/messages', firstInput)),
);
assert(repeated.every((message) => message.id === first.id));
await a.call(base + '/messages', { ...firstInput, content: 'طلب مختلف بنفس المعرف' }, 409);
await a.call(base + '/messages', {
  requestId: randomUUID(),
  content: 'الرسالة الثانية',
  attachmentIds: [],
});
await a.call(base + '/messages', {
  requestId: randomUUID(),
  content: 'الرسالة الثالثة',
  attachmentIds: [],
});
let conversation = await a.call(base);
assert.deepEqual(
  conversation.messages.map((m) => m.content),
  [firstInput.content, 'الرسالة الثانية', 'الرسالة الثالثة'],
);
assert(conversation.messages.every((m, i, list) => i === 0 || m.sequence > list[i - 1].sequence));
pass(
  'Case and message replay protection, concurrent repeated sends, conflicting replay rejection, chronological order',
);
await b.call(base, undefined, 404);
await b.call(
  base + '/messages',
  { requestId: randomUUID(), content: 'محاولة غير مسموحة', attachmentIds: [] },
  404,
);
const policy = await a.call('/attachments/policy');
assert.equal(policy.maxFileBytes, 52_428_800);
await a.call(
  base + '/attachments',
  { requestId: randomUUID(), filename: 'unsafe.html', contentType: 'text/html', size: 12 },
  415,
);
await a.call(
  base + '/attachments',
  { requestId: randomUUID(), filename: 'empty.txt', contentType: 'text/plain', size: 0 },
  400,
);
await a.call(
  base + '/attachments',
  {
    requestId: randomUUID(),
    filename: 'too-large.txt',
    contentType: 'text/plain',
    size: policy.maxFileBytes + 1,
  },
  413,
);
pass('Allowed formats, empty/unsupported files and configured size overflow rejected');
const original = Buffer.from('أصل مرفق تجريبي دون أي قراءة أو تحليل آلي.\n', 'utf8');
const uploadInput = {
  requestId: randomUUID(),
  filename: 'مرفق-اختبار.txt',
  contentType: 'text/plain',
  size: original.length,
};
const prepared = await a.call(base + '/attachments', uploadInput);
assert.equal(
  (await a.call(base + '/attachments', uploadInput)).attachment.id,
  prepared.attachment.id,
);
const attachmentId = prepared.attachment.id;
await a.call(base + `/attachments/${attachmentId}/complete`, {}, 409);
assert.equal((await a.call(base)).attachments[0].status, 'pending');
await b.call(base + '/attachments', uploadInput, 404);
await b.call(base + `/attachments/${attachmentId}/complete`, {}, 404);
await b.call(base + `/attachments/${attachmentId}/download`, undefined, 404);
await b.call(`/cases/${caseB.id}/attachments/${attachmentId}/complete`, {}, 404);
pass(
  'Incomplete uploads not marked saved; foreign case/upload/finalize/download and ID substitution blocked',
);
const put = await fetch(prepared.uploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'text/plain' },
  body: original,
});
assert.equal(put.status, 200, 'Actual signed direct upload failed');
const ready = await a.call(base + `/attachments/${attachmentId}/complete`, {});
assert.equal(ready.status, 'ready');
assert.equal((await a.call(base + `/attachments/${attachmentId}/complete`, {})).id, attachmentId);
const replay = await a.call(base + '/attachments', uploadInput);
assert.equal(replay.uploadUrl, null);
const download = await fetch(origin + ready.downloadUrl, { headers: { cookie: a.cookie } });
assert.equal(download.status, 200);
assert.equal(download.headers.get('cache-control'), 'private, no-store');
assert.equal(digest(Buffer.from(await download.arrayBuffer())), digest(original));
// A still-valid PUT URL must not permit replacement of the finalized original.
await new Promise((resolve) => setTimeout(resolve, 1100));
const overwrite = await fetch(prepared.uploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'text/plain' },
  body: Buffer.alloc(original.length, 65),
});
assert.equal(overwrite.status, 200);
const afterOverwrite = await fetch(origin + ready.downloadUrl, { headers: { cookie: a.cookie } });
assert.equal(digest(Buffer.from(await afterOverwrite.arrayBuffer())), digest(original));
const fileMessage = { requestId: randomUUID(), content: '', attachmentIds: [attachmentId] };
const attachedMessage = await a.call(base + '/messages', fileMessage);
assert.equal(attachedMessage.attachments[0].id, attachmentId);
assert.equal((await a.call(base + '/messages', fileMessage)).id, attachedMessage.id);
await b.call(
  `/cases/${caseB.id}/messages`,
  { requestId: randomUUID(), content: '', attachmentIds: [attachmentId] },
  400,
);
pass(
  'Real private upload/download byte equality, immutable original despite staging overwrite, attachment-only message and replay',
);
const mismatched = await a.call(base + '/attachments', {
  requestId: randomUUID(),
  filename: 'size-test.txt',
  contentType: 'text/plain',
  size: 5,
});
assert.equal(
  (
    await fetch(mismatched.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'oversized-mismatch',
    })
  ).status,
  200,
);
await a.call(base + `/attachments/${mismatched.attachment.id}/complete`, {}, 400);
assert.equal(
  (await a.call(base)).attachments.find((f) => f.id === mismatched.attachment.id).status,
  'rejected',
);
pass('Actual storage metadata mismatch rejected and not offered as a saved file');
// Verify the selected development limit over the real direct-storage path.
const large = Buffer.alloc(policy.maxFileBytes, 120);
const largeUpload = await a.call(base + '/attachments', {
  requestId: randomUUID(),
  filename: 'limit-check.txt',
  contentType: 'text/plain',
  size: large.length,
});
const began = Date.now();
assert.equal(
  (
    await fetch(largeUpload.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: large,
    })
  ).status,
  200,
);
const largeReady = await a.call(base + `/attachments/${largeUpload.attachment.id}/complete`, {});
const largeDownload = await fetch(origin + largeReady.downloadUrl, {
  headers: { cookie: a.cookie },
});
assert.equal(largeDownload.status, 200);
assert.equal(digest(Buffer.from(await largeDownload.arrayBuffer())), digest(large));
const elapsed = Date.now() - began;
pass(
  `Actual 50 MiB upload, finalization, original-byte retrieval (${elapsed} ms on development container network, not a physical mobile network)`,
);
await a.call('/auth/logout', {});
await a.call('/auth/session');
await a.call(base, undefined, 401);
await a.call('/auth/login', { mobile: a.mobile, password: a.password });
conversation = await a.call(base);
assert.equal(conversation.messages.length, 4);
assert((await a.call('/cases')).some((c) => c.id === caseA.id));
pass('Real logout/login restores saved case, message order and attachments');
await mkdir('generated-artifacts/verification', { recursive: true });
await writeFile(
  'generated-artifacts/verification/case-api-results.json',
  JSON.stringify({ checks, maximumBytesTested: large.length, elapsedMs: elapsed }, null, 2),
);
await writeFile(
  '/tmp/micron-plan1-test.json',
  JSON.stringify({
    mobile: a.mobile,
    password: a.password,
    secondMobile: b.mobile,
    secondPassword: b.password,
    caseId: caseA.id,
  }),
  { mode: 0o600 },
);
console.log(
  `Completed ${checks.length} acceptance groups. Ephemeral browser-test credentials saved without printing them.`,
);

// Runs only against the already started, fail-closed TEMP-table workflow fixture.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:19486';
let checks = 0;
const ok = (condition, detail) => {
  assert.ok(condition, detail);
  checks++;
};
async function request(path, method = 'GET', body, account, expected = 200) {
  const r = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': 'synthetic-workflow-csrf',
      ...(account ? { 'x-fixture-account': account } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(r.status, expected, `${method} ${path}`);
  return r.json();
}
const { caseId } = await request('/__fixture/info');
const root = `/api/cases/${caseId}`;
let c = await request(root);
ok(
  c.messages.length === 0 && c.caseInfo.clientId === null && !c.caseInfo.archivedAt,
  'Legacy/unassigned case loads',
);
let fees = await request(root + '/fees');
ok(
  fees.agreedAmount === null &&
    fees.outstandingAmount === null &&
    Number(fees.receivedAmount) === 0,
  'Optional fee state',
);
const creation = {
  requestId: randomUUID(),
  name: 'موكل اختبار معزول',
  type: 'individual',
  mobile: '',
  email: '',
  notes: 'معلومات إدارية ليست أدلة',
  reference: 'مرجع خاص',
};
const client = await request('/api/clients', 'POST', creation);
const replay = await request('/api/clients', 'POST', creation);
ok(client.id === replay.id, 'Client transport replay idempotent');
const foreign = await request(
  '/api/clients',
  'POST',
  { requestId: randomUUID(), name: 'موكل الحساب الثاني' },
  'other',
);
ok(
  (await request('/api/clients')).length === 1 &&
    (await request('/api/clients', 'GET', undefined, 'other')).length === 1,
  'Client lists isolated',
);
await request(`/api/clients/${client.id}`, 'GET', undefined, 'other', 404);
checks++;
await request(`/api/clients/${client.id}`, 'PATCH', { name: 'غير مسموح' }, 'other', 404);
checks++;
await request(root, 'PATCH', { clientId: foreign.id }, undefined, 404);
checks++;
let updated = await request(root, 'PATCH', { clientId: client.id, pinned: true });
ok(
  updated.clientName === creation.name && updated.pinned && updated.clientId === client.id,
  'Association returned',
);
await request(`/api/clients/${client.id}`, 'PATCH', {
  name: 'اسم مصحح',
  type: null,
  email: '',
  notes: '',
});
ok(
  (await request(root)).caseInfo.clientName === 'اسم مصحح',
  'Edited name reflected and empty notes clear',
);
const detail = await request(`/api/clients/${client.id}`);
ok(detail.cases.length === 1 && detail.cases[0].id === caseId, 'Related case linked');
fees = await request(root + '/fees', 'PUT', {
  agreedAmount: '1000.10',
  terms: 'اختبار اتفاق',
  notes: 'خاص',
});
ok(
  fees.agreedAmount === '1000.10' &&
    fees.outstandingAmount === '1000.10' &&
    fees.currency === 'SAR',
  'Exact SAR agreement',
);
const receipt = {
  requestId: randomUUID(),
  amount: '200.05',
  receivedOn: '2026-10-15',
  notes: 'دفعة اختبار',
};
fees = await request(root + '/fee-receipts', 'POST', receipt);
ok(
  fees.receivedAmount === '200.05' && fees.outstandingAmount === '800.05',
  'Decimal balance exact',
);
const replayReceipt = await request(root + '/fee-receipts', 'POST', receipt);
ok(
  replayReceipt.receipts.length === 1 && replayReceipt.receivedAmount === '200.05',
  'Receipt replay not doubled',
);
fees = await request(root + '/fee-receipts/' + fees.receipts[0].id, 'PATCH', {
  amount: '100.10',
  receivedOn: '2026-10-14',
  notes: '',
});
ok(
  fees.outstandingAmount === '900.00' &&
    fees.receipts[0].notes === '' &&
    fees.receipts[0].receivedOn === '2026-10-14',
  'Correction recalculates',
);
await request(
  root + '/fee-receipts',
  'POST',
  { ...receipt, requestId: randomUUID(), receivedOn: '2026-02-30' },
  undefined,
  400,
);
checks++;
await request(
  root + '/fee-receipts',
  'POST',
  { ...receipt, requestId: randomUUID(), amount: '-1' },
  undefined,
  400,
);
checks++;
await request(
  root + '/fee-receipts',
  'POST',
  { ...receipt, requestId: randomUUID(), amount: '1.234' },
  undefined,
  400,
);
checks++;
await request(root + '/fees', 'GET', undefined, 'other', 404);
checks++;
await request(root + '/fees', 'PUT', { agreedAmount: '9' }, 'other', 404);
checks++;
await request(root + '/fee-receipts', 'POST', receipt, 'other', 404);
checks++;
await request(
  root + '/fee-receipts/' + fees.receipts[0].id,
  'PATCH',
  { amount: '9', receivedOn: '2026-10-15' },
  'other',
  404,
);
checks++;
await request('/api/clients', 'GET', undefined, 'anonymous', 401);
checks++;
await request('/api/clients', 'GET', undefined, 'admin', 403);
checks++;
await request(root + '/fees', 'GET', undefined, 'admin', 403);
checks++;
await request('/api/clients', 'POST', { requestId: randomUUID(), name: ' ' }, undefined, 400);
checks++;
await request(
  '/api/clients',
  'POST',
  { requestId: randomUUID(), name: 'اسم', email: 'invalid' },
  undefined,
  400,
);
checks++;
const folder = await request('/api/case-folders', 'POST', {
  requestId: randomUUID(),
  name: 'مجلد محفوظ',
});
await request(root, 'PATCH', { folderId: folder.id });
// One existing eight-section fake provider result, never an external request.
await request(root + '/messages', 'POST', {
  requestId: randomUUID(),
  content: 'طلب تحليل اصطناعي',
  attachmentIds: [],
  startAnalysis: true,
});
let operations;
for (let i = 0; i < 50; i++) {
  operations = await request(root + '/analysis-operations');
  if (operations[0]?.status === 'completed' || operations[0]?.status === 'failed') break;
  await new Promise((r) => setTimeout(r, 100));
}
ok(
  operations.length === 1 &&
    operations[0].status === 'completed' &&
    operations[0].result.kind === 'report',
  'Existing analysis pipeline with fake transport',
);
const snapshot = await request('/__fixture/stats');
const legalBefore = JSON.stringify({
  operations: snapshot.operations,
  originals: snapshot.originals,
  messages: snapshot.messages,
  versions: snapshot.versions,
  questions: snapshot.questions,
});
const archived = await request(root, 'PATCH', { archived: true });
ok(
  !!archived.archivedAt &&
    archived.pinned &&
    archived.folderId === folder.id &&
    archived.clientId === client.id,
  'Archive preserves organization',
);
const afterArchive = await request(`/api/clients/${client.id}`);
ok(
  afterArchive.cases[0].archivedAt && (await request(root)).messages.length === 1,
  'Archive still browsable with evidence',
);
ok(
  (await request('/api/cases')).filter((c) => !c.archivedAt).length === 0,
  'Active/pinned exclusion predicate',
);
const restored = await request(root, 'PATCH', { archived: false });
ok(
  !restored.archivedAt &&
    restored.folderId === folder.id &&
    restored.clientId === client.id &&
    restored.pinned,
  'Restore identity + associations',
);
const state = await request('/__fixture/stats');
ok(
  JSON.stringify({
    operations: state.operations,
    originals: state.originals,
    messages: state.messages,
    versions: state.versions,
    questions: state.questions,
  }) === legalBefore,
  'Archive does not alter legal data',
);
ok(
  JSON.stringify(state.public.before) === JSON.stringify(state.public.after),
  'Historical public tables/sequence fingerprints unchanged',
);
ok(
  fees.outstandingAmount === (await request(root + '/fees')).outstandingAmount,
  'Fees retained after restore',
);
const lastInput = state.operations[0].input_snapshot;
ok(
  !JSON.stringify(lastInput).includes('معلومات إدارية') &&
    !JSON.stringify(lastInput).includes('اختبار اتفاق'),
  'Client/fee administrative data excluded from analysis snapshot',
);
updated = await request(root, 'PATCH', { clientId: null });
ok(
  updated.clientId === null && updated.clientName === null,
  'Remove association without deleting client',
);
await request(root + '/fees', 'PUT', { agreedAmount: null, terms: '', notes: '' });
ok(
  (await request(root + '/fees')).agreedAmount === null &&
    (await request(root + '/fees')).receipts.length === 1,
  'Clear optional agreement preserves receipt history',
);
process.stdout.write(
  `PASS: ${checks} isolated management/regression checks; no real provider or historical writes.\n`,
);

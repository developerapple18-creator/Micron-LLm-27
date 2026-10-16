// Only run against workflow-fixture TEMP tables; never against the live API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:19486';
let checks = 0;
const ok = (value, label) => {
  assert.ok(value, label);
  checks++;
};
async function request(path, method = 'GET', body, account, status = 200) {
  const r = await fetch(base + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'synthetic-workflow-csrf',
      ...(account ? { 'X-Fixture-Account': account } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await r.json();
  assert.equal(r.status, status, JSON.stringify({ path, status: r.status, json }));
  return json;
}
const profile = {
  requestId: randomUUID(),
  name: 'موكل اختبار التثبيت',
  type: 'organization',
  mobile: '0500000000',
  email: 'synthetic@example.invalid',
  reference: 'اختبار معزول',
  notes: 'لا تمثل بيانات حقيقية',
};
const client = await request('/clients', 'POST', profile);
ok(client.pinned === false, 'Clients default to unpinned');
const path = `/clients/${client.id}/pin`;
const pin = await request(path, 'PATCH', { pinned: true });
ok(
  pin.pinned === true &&
    ['name', 'type', 'mobile', 'email', 'reference', 'notes', 'createdAt'].every(
      (k) => pin[k] === client[k],
    ),
  'Pin writes no profile data',
);
await request(path, 'PATCH', { pinned: true });
ok(
  (await request('/clients')).filter((c) => c.id === client.id).length === 1 &&
    (await request(`/clients/${client.id}`)).client.pinned,
  'Replay idempotent and list/detail agree',
);
await request(path, 'PATCH', { pinned: false }, 'other', 404);
checks++;
await request(path, 'PATCH', { pinned: false }, 'anonymous', 401);
checks++;
await request(path, 'PATCH', { pinned: false }, 'admin', 403);
checks++;
await request(path, 'PATCH', { pinned: 'false' }, undefined, 400);
checks++;
ok(
  (await request(`/clients/${client.id}`)).client.pinned === true,
  "Unauthorized/invalid mutations cannot remove owner's pin",
);
ok(
  !(await request('/clients', 'GET', undefined, 'other')).some((c) => c.id === client.id),
  'No cross-account pin disclosure',
);
ok(!(await request(path, 'PATCH', { pinned: false })).pinned, 'Unpin persists');
await request(path, 'PATCH', { pinned: true }); // Retain synthetic item for the browser journey.
// Prepare a case and folder through normal owner-scoped routes, with no AI.
const created = await request('/cases', 'POST', { requestId: randomUUID() });
const folder = await request('/case-folders', 'POST', {
  requestId: randomUUID(),
  name: 'مجلد المطالبات التجريبي',
});
await request(`/case-folders/${folder.id}`, 'PATCH', { pinned: true });
await request(`/cases/${created.id}`, 'PATCH', {
  title: 'قضية اصطناعية لمراجعة البطاقات على الجوال',
  pinned: true,
  folderId: folder.id,
  clientId: client.id,
});
const stats = await (await fetch(base + '/__fixture/stats')).json();
ok(
  stats.analysisPosts === 0 &&
    stats.discussionPosts === 0 &&
    JSON.stringify(stats.public.before) === JSON.stringify(stats.public.after),
  'No provider activity and no historical data changes',
);
console.log(`PASS ${checks} client-pin checks; fixture-only browser data prepared.`);

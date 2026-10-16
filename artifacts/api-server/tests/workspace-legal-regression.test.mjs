// Focused cross-feature regression; fixture alone supplies all provider responses.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const host = 'http://127.0.0.1:19486';
let checks = 0;
const ok = (value, message) => {
  assert.ok(value, message);
  checks++;
};
async function call(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(host + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(r.ok, `${method} ${path} ${r.status}`);
  return r.json();
}
async function until(load, ready) {
  for (let i = 0; i < 60; i++) {
    const data = await load();
    if (ready(data)) return data;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Mock lifecycle did not finish');
}
const c = await call('/api/cases', { requestId: randomUUID() }),
  path = `/api/cases/${c.id}`;
await call('/__fixture/mode', { mode: 'clarification-many' });
await call(path + '/messages', {
  requestId: randomUUID(),
  content: 'وقائع اختبار استيضاح معزول',
  attachmentIds: [],
  startAnalysis: true,
});
let ops = await until(
  () => call(path + '/analysis-operations'),
  (ops) => ops[0]?.status === 'completed',
);
ok(ops[0].result.clarification.questions.length === 3, 'Guided exact question IDs delivered');
const root = ops[0],
  responseId = randomUUID();
await call('/__fixture/mode', { mode: 'report' });
const response = {
  requestId: responseId,
  content: 'أمثل المدعى عليه. تصحيح لاحق محفوظ.',
  attachmentIds: [],
  clarification: { operationId: root.id, questionIds: ['side'] },
  startAnalysis: true,
};
await call(path + '/messages', response);
await call(path + '/messages', response);
ops = await until(
  () => call(path + '/analysis-operations'),
  (ops) => ops.length === 2 && ops[1].status === 'completed',
);
const report = ops[1];
ok(
  report.parentOperationId === root.id && report.result.report.sections.length === 8,
  'One follow-up + eight sections after replay',
);
const reportPath = path + `/reports/${report.id}`;
const original = (await call(reportPath + '/versions'))[0];
ok(
  original.kind === 'original' && original.number === 0,
  'Existing virtual original report-version',
);
await call(path + '/messages', {
  requestId: randomUUID(),
  content: 'سؤال عن التقرير المحفوظ',
  attachmentIds: [],
  startAnalysis: false,
  reportQuestion: { operationId: report.id, versionId: original.id },
});
let interactions = await until(
  () => call(reportPath + '/interactions'),
  (list) => list.some((i) => i.sectionId === '__report__' && i.status === 'completed'),
);
ok(
  interactions[0].versionId === original.id && !!interactions[0].answer,
  'Saved report question linked without file resend',
);
const discussion = await call(reportPath + '/interactions', {
  requestId: randomUUID(),
  versionId: original.id,
  sectionId: 'facts',
  blockIndex: 0,
  kind: 'discuss',
  instruction: 'ناقش الفقرة اصطناعيًا',
});
await call(reportPath + `/interactions/${discussion.id}/execute`, {});
interactions = await until(
  () => call(reportPath + '/interactions'),
  (list) => list.find((i) => i.id === discussion.id)?.status === 'completed',
);
ok(
  interactions.find((i) => i.id === discussion.id).proposedText === null,
  'Paragraph discussion does not rewrite',
);
const revision = await call(reportPath + '/interactions', {
  requestId: randomUUID(),
  versionId: original.id,
  sectionId: 'facts',
  blockIndex: 0,
  kind: 'revise',
  instruction: 'اقترح تعديلًا اصطناعيًا',
});
await call(reportPath + `/interactions/${revision.id}/execute`, {});
interactions = await until(
  () => call(reportPath + '/interactions'),
  (list) => list.find((i) => i.id === revision.id)?.status === 'completed',
);
ok(
  interactions.find((i) => i.id === revision.id).proposedText != null &&
    (await call(reportPath + '/versions')).length === 1,
  'Proposal not applied automatically',
);
const accepted = await call(reportPath + '/versions', {
  requestId: randomUUID(),
  baseVersionId: original.id,
  proposalId: revision.id,
});
ok(accepted.kind === 'ai_accepted' && accepted.number === 1, 'Explicit acceptance appends version');
const restored = await call(reportPath + '/versions', {
  requestId: randomUUID(),
  baseVersionId: accepted.id,
  restoreVersionId: original.id,
});
ok(
  restored.kind === 'restore' &&
    restored.number === 2 &&
    (await call(reportPath + '/versions')).length === 3,
  'History remains append-only on restoration',
);
for (const format of ['docx', 'pdf']) {
  const r = await fetch(
    host +
      `/api/report-exports?caseId=${c.id}&operationId=${report.id}&versionId=${restored.id}&format=${format}`,
  );
  ok(r.ok && (await r.arrayBuffer()).byteLength > 500, `${format} saved version export`);
}
await call(path + '/messages', {
  requestId: randomUUID(),
  content: 'دليل إضافي محفوظ دون تحليل',
  attachmentIds: [],
  startAnalysis: false,
});
ok(
  (await call(path + '/analysis-operations')).length === 2,
  'Adding evidence alone does not generate',
);
await call(path + '/messages', {
  requestId: randomUUID(),
  content: 'أصدر تحليلًا محدثًا صراحة',
  attachmentIds: [],
  newAnalysis: true,
  startAnalysis: true,
});
ops = await until(
  () => call(path + '/analysis-operations'),
  (ops) => ops.length === 3 && ops[2].status === 'completed',
);
ok(
  JSON.stringify(ops.find((o) => o.id === report.id).result) === JSON.stringify(report.result),
  'Explicit updated analysis preserves original result',
);
const state = await call('/__fixture/stats');
ok(
  state.discussionFiles === 0 &&
    JSON.stringify(state.public.before) === JSON.stringify(state.public.after),
  'No source files resent for report questions; historical public data unchanged',
);
process.stdout.write(
  `PASS: ${checks} isolated legal workspace regressions, including exports; zero external AI/SMS.\n`,
);

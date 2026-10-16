import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pool } from '@workspace/db';
import { submitCaseMessage } from '../src/lib/analysis-submission.js';
import { saveCaseMessage } from '../src/lib/case-message.js';
import { listAnalysis } from '../src/lib/analysis-lifecycle.js';
import { sectionOrder } from '../src/lib/analysis-contract.js';
import { accountTestBudgetSummary } from '../src/lib/analysis-account-budget.js';
import { throttle } from '../src/lib/security.js';
delete process.env.MICRON_ANALYSIS_ACCOUNT_TEST_BUDGET;
delete process.env.MICRON_ANALYSIS_APPROVED_OPERATION_ID;
delete process.env.MICRON_ANALYSIS_CHAIN_SPENDING_APPROVAL;
let external = 0,
  calls = 0;
globalThis.fetch = async () => {
  external++;
  throw new Error('External HTTP forbidden');
};
const schema = `single_send_${randomUUID().replaceAll('-', '')}`,
  owner = randomUUID(),
  other = randomUUID();
const tables = [
  'accounts',
  'cases',
  'case_messages',
  'case_attachments',
  'case_analysis_operations',
];
const rawConnect = pool.connect.bind(pool);
const pdf = Buffer.from('%PDF-1.4\n% Synthetic unread fixture; not legal evidence\n%%EOF\n');
const policy = { ownerId: owner, sessionId: randomUUID(), limitUsd: 10 };
const checks = [];
const pass = (message) => {
  checks.push(message);
  console.log('PASS', message);
};
async function snapshot() {
  const client = await rawConnect();
  try {
    const rows = [];
    for (const table of [
      ...tables,
      'attempt_limits',
      'legal_documents',
      'legal_acceptances',
      'audit_events',
    ])
      rows.push(
        (
          await client.query(
            `SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS hash FROM public.${table} t`,
          )
        ).rows[0],
      );
    return rows;
  } finally {
    client.release();
  }
}
async function hashes() {
  return Promise.all(
    ['shared-legal-core.md', 'case-analysis-prompt.md', 'case-analysis.schema.json'].map(
      async (p) =>
        createHash('sha256')
          .update(await readFile(`lib/legal-contracts/${p}`))
          .digest('hex'),
    ),
  );
}
const input = (more = {}) => ({
  requestId: randomUUID(),
  content: 'إفادة خيالية بالمحاكاة فقط',
  attachmentIds: [],
  startAnalysis: true,
  ...more,
});
async function newCase() {
  return (
    await pool.query('INSERT INTO cases(owner_id,request_id) VALUES($1,$2) RETURNING id', [
      owner,
      randomUUID(),
    ])
  ).rows[0].id;
}
async function file(caseId, contentType = 'application/pdf') {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO case_attachments(id,owner_id,case_id,request_id,filename,content_type,size,status,staging_path,storage_path,generation)
    VALUES($1,$2,$3,$1,$4,$5,$6,'ready',$7,$8,'123')`,
    [
      id,
      owner,
      caseId,
      contentType === 'application/pdf' ? 'fictional.pdf' : 'unsupported.txt',
      contentType,
      pdf.length,
      `/fixture/${id}/stage`,
      `/fixture/${id}/original`,
    ],
  );
  return id;
}
const clarification = {
  kind: 'clarification',
  report: null,
  blocked: null,
  clarification: {
    context: 'استيضاح بالمحاكاة فقط',
    questions: [
      {
        id: 'q_fixture',
        question: 'أي طرف تمثل؟',
        options: ['المدعي', 'المدعى عليه'],
        allow_unknown: true,
        allow_not_applicable: true,
      },
    ],
  },
};
const report = (source) => ({
  kind: 'report',
  clarification: null,
  blocked: null,
  report: {
    title: 'تقرير محاكى لاختبار الإرسال الواحد',
    change_summary: null,
    alerts: [],
    sections: sectionOrder.map((section_id) => ({
      section_id,
      blocks: [{ text: 'نتيجة محاكية فقط.', basis: 'lawyer_statement', source_refs: [source] }],
    })),
  },
});
const contexts = [];
const provider = (result, wait) => async (request, _signal, telemetry) => {
  calls++;
  assert.equal(request.model, 'gpt-6.1-sol');
  const c = request.input[2].content;
  const context = JSON.parse(
    typeof c === 'string' ? c : c.find((p) => p.type === 'input_text').text,
  );
  contexts.push(context);
  if (wait) await wait;
  if (telemetry) telemetry.httpStatus = 200;
  return {
    result: result ?? report(context.source_registry[0].id),
    usage: { input_tokens: 100, output_tokens: 20 },
    model: 'mock-only',
  };
};
const options = (p = provider(), budget = policy, bytes = pdf, timeoutMs) => ({
  pdfReader: async () => bytes,
  execution: {
    provider: p,
    approvedId: null,
    accountBudget: budget,
    pdfReader: async () => bytes,
    timeoutMs,
  },
});
async function main() {
  const before = await snapshot(),
    legal = await hashes(),
    client = await rawConnect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    for (const table of [...tables, 'attempt_limits', 'report_interactions'])
      await client.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
    await client.query(`CREATE SEQUENCE "${schema}".message_sequence`);
    await client.query(
      `ALTER TABLE "${schema}".case_messages ALTER COLUMN sequence SET DEFAULT nextval('"${schema}".message_sequence')`,
    );
  } finally {
    client.release();
  }
  pool.connect = async () => {
    const c = await rawConnect();
    await c.query(`SET search_path TO "${schema}"`);
    return c;
  };
  pool.query = async (...args) => {
    const c = await pool.connect();
    try {
      return await c.query(...args);
    } finally {
      c.release();
    }
  };
  try {
    for (const id of [owner, other])
      await pool.query(
        "INSERT INTO accounts(id,role,username,name,password_hash) VALUES($1,'lawyer',$2,'Isolated single-send fixture','no-login')",
        [id, randomUUID()],
      );
    if (process.argv.includes('--rate-only')) {
      for (let i = 0; i < 20; i++) await throttle(`analysis-execute:${owner}`, 20);
      const rateCase = await newCase(),
        rateInput = input();
      const blocked = await submitCaseMessage(owner, rateCase, rateInput, options());
      assert.equal(blocked.operation?.status, 'pending');
      assert.equal(calls, 0);
      assert.equal((await accountTestBudgetSummary(pool, owner, policy)).requests, 0);
      pass(
        'One-Send orchestration preserves the existing execution rate limit before reservation or provider dispatch',
      );
      await pool.query('DELETE FROM attempt_limits');
      const resumed = await submitCaseMessage(owner, rateCase, rateInput, options());
      await resumed.completion;
      assert.equal(resumed.operation?.id, blocked.operation?.id);
      assert.equal(calls, 1);
      const replay = await submitCaseMessage(owner, rateCase, rateInput, options());
      await replay.completion;
      assert.equal(calls, 1);
      assert.equal((await listAnalysis(owner, rateCase))[0].status, 'completed');
      assert.equal(external, 0);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await hashes(), legal);
      pass(
        'A later explicit resend after rate recovery uses the same operation once; public data/legal instructions remain unchanged',
      );
      return;
    }
    const first = await newCase(),
      request = input();
    let release;
    const wait = new Promise((r) => {
      release = r;
    });
    const batch = await Promise.all(
      Array.from({ length: 10 }, () =>
        submitCaseMessage(owner, first, request, options(provider(undefined, wait))),
      ),
    );
    release();
    await Promise.all(batch.map((x) => x.completion));
    assert.equal(calls, 1);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM case_messages WHERE case_id=$1', [first]))
        .rows[0].n,
      1,
    );
    assert.equal((await listAnalysis(owner, first)).length, 1);
    const completed = await submitCaseMessage(owner, first, request, options());
    await completed.completion;
    assert.equal(calls, 1);
    assert.equal(completed.operation?.status, 'completed');
    await listAnalysis(owner, first);
    assert.equal(calls, 1);
    pass(
      'One Send saves, prepares and starts once; ten concurrent duplicates, terminal replay and GET recovery do not repeat provider execution',
    );
    const withPdf = await newCase(),
      attached = await file(withPdf);
    const doc = await submitCaseMessage(
      owner,
      withPdf,
      input({ attachmentIds: [attached] }),
      options(),
    );
    await doc.completion;
    const savedDoc = (await listAnalysis(owner, withPdf))[0];
    assert.equal(savedDoc.status, 'completed');
    assert(savedDoc.sourceRegistry.some((s) => s.id === attached));
    assert.equal(savedDoc.pdfEvidence?.status, 'result_saved_validated');
    pass(
      'Explicitly attached PDF is selected automatically, with unchanged inline delivery and saved source identity',
    );
    const beforeInvalid = calls;
    for (const multi of [false, true]) {
      const c = await newCase();
      const ids = multi ? [await file(c), await file(c)] : [await file(c, 'text/plain')];
      const blocked = await submitCaseMessage(owner, c, input({ attachmentIds: ids }), options());
      assert.equal(blocked.operation?.failureCode, 'unsupported_input');
      assert.equal(blocked.message.attachments.length, ids.length);
    }
    const brokenCase = await newCase(),
      brokenFile = await file(brokenCase);
    const broken = await submitCaseMessage(
      owner,
      brokenCase,
      input({ attachmentIds: [brokenFile] }),
      options(provider(), policy, Buffer.alloc(pdf.length)),
    );
    assert.equal(broken.operation?.failureCode, 'preparation_failed');
    assert.equal(calls, beforeInvalid);
    assert.equal((await listAnalysis(owner, brokenCase))[0].status, 'failed');
    pass(
      'Unsupported/multiple/unreadable files remain saved with durable failure feedback; none is silently ignored or sent to a provider',
    );
    const closedCase = await newCase(),
      closedInput = input();
    const closed = await submitCaseMessage(owner, closedCase, closedInput, {
      execution: { approvedId: null, provider: provider() },
    });
    assert.equal(closed.operation?.status, 'pending');
    assert.equal(calls, beforeInvalid);
    const resumed = await submitCaseMessage(owner, closedCase, closedInput, options());
    await resumed.completion;
    assert.equal(resumed.operation?.id, closed.operation?.id);
    pass(
      'Unapproved account execution stays pending and uncharged; a later deliberate re-submission resumes the same operation, not a new one',
    );
    const textCase = await newCase();
    const root = await submitCaseMessage(
      owner,
      textCase,
      input(),
      options(provider(clarification)),
    );
    await root.completion;
    await saveCaseMessage(
      owner,
      textCase,
      input({ startAnalysis: undefined, content: 'تصحيح خيالي محفوظ قبل إرسال الإجابة' }),
    );
    const answer = await submitCaseMessage(
      owner,
      textCase,
      input({
        content: 'إجابة حرة محفوظة دون تصنيف دلالي',
        clarification: { operationId: root.operation.id, questionIds: [] },
      }),
      options(),
    );
    await answer.completion;
    const child = (await listAnalysis(owner, textCase)).at(-1);
    assert.equal(child.parentOperationId, root.operation.id);
    assert.equal(child.status, 'completed');
    const snap = (
      await pool.query('SELECT input_snapshot FROM case_analysis_operations WHERE id=$1', [
        child.id,
      ])
    ).rows[0].input_snapshot;
    assert.equal(snap.messages.length, 3);
    assert.deepEqual(snap.messages.at(-1).clarification.questionIds, []);
    assert(snap.messages.some((m) => m.content === 'تصحيح خيالي محفوظ قبل إرسال الإجابة'));
    pass(
      'One Send continues a text clarification with all saved corrections and exact free text; no automatic association to every question',
    );
    const stalled = await newCase(),
      stalledInput = input(),
      beforeTimeout = calls;
    const timeout = await submitCaseMessage(
      owner,
      stalled,
      stalledInput,
      options(provider(undefined, new Promise(() => {})), policy, pdf, 10),
    );
    await timeout.completion;
    assert.equal((await listAnalysis(owner, stalled))[0].failureCode, 'timeout');
    const replay = await submitCaseMessage(owner, stalled, stalledInput, options());
    await replay.completion;
    assert.equal(calls, beforeTimeout + 1);
    assert.equal(replay.operation?.status, 'failed');
    pass(
      'Timeout and refresh/replay retain one reservation and cannot retry a started paid operation',
    );
    await assert.rejects(submitCaseMessage(other, first, input(), options()));
    const tinyCase = await newCase(),
      tiny = { ...policy, sessionId: randomUUID(), limitUsd: 0.000001 },
      beforeBudget = calls;
    const denied = await submitCaseMessage(owner, tinyCase, input(), options(provider(), tiny));
    assert.equal(denied.operation?.status, 'pending');
    assert.equal(calls, beforeBudget);
    assert.equal((await accountTestBudgetSummary(pool, owner, tiny)).requests, 0);
    const saveOnlyCase = await newCase();
    const saveOnly = await submitCaseMessage(
      owner,
      saveOnlyCase,
      input({ startAnalysis: undefined }),
      options(),
    );
    assert.equal((await listAnalysis(owner, saveOnlyCase)).length, 0);
    assert(saveOnly.message.id);
    assert.equal(calls, beforeBudget);
    pass(
      'Ownership and budget fences still run before dispatch; legacy save-only requests never activate analysis',
    );
    assert.equal(external, 0);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await hashes(), legal);
    pass('Zero external HTTP and no changes to nine public tables or approved Core/Prompt/Schema');
    console.log(
      JSON.stringify({ checks: checks.length, mockedProviderCalls: calls, realRequests: external }),
    );
  } finally {
    const cleanup = await rawConnect();
    try {
      await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      cleanup.release();
      await pool.end();
    }
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

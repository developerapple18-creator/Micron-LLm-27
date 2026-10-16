/** Real lifecycle/row locks in an isolated schema; synthetic data, injected providers, no paid HTTP. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import { pool } from '@workspace/db';
import { createAnalysis, getAnalysis, listAnalysis } from '../src/lib/analysis-lifecycle.js';
import { saveCaseMessage } from '../src/lib/case-message.js';
import { beginExecution, analysisCapability } from '../src/lib/analysis-execution.js';
import {
  prepareInteraction,
  beginInteraction,
  listInteractions,
} from '../src/lib/report-interactions.js';
import { listVersions, saveVersion } from '../src/lib/report-versions.js';
import { sectionOrder } from '../src/lib/analysis-contract.js';
import { interpretProviderEnvelope } from '../src/lib/analysis-provider.js';
import { csrfProtection, HttpError } from '../src/lib/security.js';
import analysisRouter from '../src/routes/analysis.js';
const schema = `runtime_test_${randomUUID().replaceAll('-', '')}`;
const owners = [randomUUID(), randomUUID()];
const tables = [
  'accounts',
  'cases',
  'case_messages',
  'case_attachments',
  'case_analysis_operations',
  'report_versions',
  'report_interactions',
  'attempt_limits',
];
const publicTables = [
  ...tables,
  'legal_documents',
  'legal_acceptances',
  'audit_events',
  'case_folders',
  'case_organization',
];
const connect = pool.connect.bind(pool),
  query = pool.query.bind(pool),
  fetchOriginal = globalThis.fetch;
const fixtures = [];
const completions = [],
  releases = [];
let checks = 0,
  calls = 0,
  external = 0,
  server;
const pass = (label) => {
  checks++;
  console.log(`PASS ${label}`);
};
globalThis.fetch = async () => {
  external++;
  throw new Error('ALL EXTERNAL HTTP BLOCKED');
};
async function publicState() {
  const c = await connect();
  try {
    return await Promise.all(
      publicTables.map(
        async (table) =>
          (
            await c.query(
              `SELECT count(*)::int n,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) h FROM public.${table} t`,
            )
          ).rows[0],
      ),
    );
  } finally {
    c.release();
  }
}
async function legalHashes() {
  return Promise.all(
    ['shared-legal-core.md', 'case-analysis-prompt.md', 'case-analysis.schema.json'].map(
      async (file) =>
        createHash('sha256')
          .update(await readFile(`lib/legal-contracts/${file}`))
          .digest('hex'),
    ),
  );
}
async function fixture(owner) {
  const f = { owner, caseId: randomUUID(), messageId: randomUUID() };
  await pool.query(
    "INSERT INTO cases(id,owner_id,request_id,title,task_type) VALUES($1,$2,$3,'Synthetic runtime only','case_analysis')",
    [f.caseId, owner, randomUUID()],
  );
  await pool.query(
    "INSERT INTO case_messages(id,case_id,owner_id,request_id,content) VALUES($1,$2,$3,$4,'Synthetic legal facts')",
    [f.messageId, f.caseId, owner, randomUUID()],
  );
  fixtures.push(f);
  return f;
}
function reportFor(source) {
  return {
    kind: 'report',
    clarification: null,
    blocked: null,
    report: {
      title: 'Synthetic isolated report',
      alerts: [],
      change_summary: null,
      sections: sectionOrder.map((section_id) => ({
        section_id,
        blocks: [{ text: 'Synthetic paragraph', basis: 'lawyer_statement', source_refs: [source] }],
      })),
    },
  };
}
const before = await publicState(),
  legalBefore = await legalHashes();
try {
  const setup = await connect();
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    for (const table of tables)
      await setup.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
    await setup.query(`CREATE SEQUENCE "${schema}".message_sequence`);
    await setup.query(
      `ALTER TABLE "${schema}".case_messages ALTER COLUMN sequence SET DEFAULT nextval('"${schema}".message_sequence')`,
    );
  } finally {
    setup.release();
  }
  const scoped = async () => {
    const c = await connect();
    await c.query(`SET search_path TO "${schema}"`);
    return c;
  };
  pool.connect = scoped;
  pool.query = async (...args) => {
    const c = await scoped();
    try {
      return await c.query(...args);
    } finally {
      c.release();
    }
  };
  for (const owner of owners)
    await pool.query(
      "INSERT INTO accounts(id,role,username,name,password_hash) VALUES($1,'lawyer',$2,'Synthetic lawyer','no-login')",
      [owner, randomUUID()],
    );
  const work = await Promise.all([fixture(owners[0]), fixture(owners[1]), fixture(owners[0])]);
  const operations = await Promise.all(
    work.map((f) => createAnalysis(f.owner, f.caseId, f.messageId)),
  );
  let entered = 0,
    allEntered,
    release;
  const entry = new Promise((resolve) => {
    allEntered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  releases.push(release);
  const providerFor = (f) => async (request) => {
    calls++;
    if (++entered === 3) allEntered();
    assert.equal(request.model, 'gpt-6.1-sol');
    assert.equal(request.max_output_tokens, 12000);
    await gate;
    return { result: reportFor(f.messageId), usage: { input_tokens: 50, output_tokens: 50 } };
  };
  const runs = await Promise.all(
    work.map((f, i) =>
      beginExecution(f.owner, f.caseId, operations[i].id, { provider: providerFor(f) }),
    ),
  );
  completions.push(...runs.map((r) => r.completion));
  await entry;
  const prior = calls;
  await (
    await beginExecution(work[0].owner, work[0].caseId, operations[0].id, {
      provider: providerFor(work[0]),
    })
  ).completion;
  assert.equal(calls, prior);
  release();
  await Promise.all(runs.map((r) => r.completion));
  for (const [i, f] of work.entries()) {
    const op = await getAnalysis(f.owner, f.caseId, operations[i].id);
    assert.equal(op.status, 'completed');
    assert.equal(op.result.report.sections.length, 8);
    assert.equal(
      (
        await pool.query('SELECT spending_reservation FROM case_analysis_operations WHERE id=$1', [
          op.id,
        ])
      ).rows[0].spending_reservation,
      null,
    );
  }
  pass(
    'two independent lawyers and two cases for the same lawyer execute concurrently without financial entitlements or shared account fences',
  );
  pass(
    'running replay is idempotent; complete validated eight-section products persist without reservations',
  );
  const multiText = await fixture(owners[0]);
  const unselected = randomUUID();
  await pool.query(
    `INSERT INTO case_attachments(id,case_id,owner_id,request_id,filename,content_type,size,status,staging_path,storage_path,generation)
    VALUES($1,$2,$3,$4,'unselected.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',100,'ready','synthetic','synthetic','1')`,
    [unselected, multiText.caseId, multiText.owner, randomUUID()],
  );
  const correction = await saveCaseMessage(multiText.owner, multiText.caseId, {
    requestId: randomUUID(),
    content: 'Synthetic later correction',
    attachmentIds: [],
  });
  const multiOp = await createAnalysis(multiText.owner, multiText.caseId, correction.id);
  const multiRun = await beginExecution(multiText.owner, multiText.caseId, multiOp.id, {
    provider: async (request) => {
      calls++;
      const context = JSON.parse(request.input.at(-1).content);
      assert.equal(context.phase, 'initial');
      assert.deepEqual(context.attachment_registry, []);
      assert.deepEqual(
        context.previous_messages.map((m) => m.id),
        [multiText.messageId, correction.id],
      );
      assert.deepEqual(
        context.source_registry.map((s) => s.id),
        [multiText.messageId, correction.id],
      );
      return { result: reportFor(correction.id) };
    },
  });
  await multiRun.completion;
  assert.equal(
    (await getAnalysis(multiText.owner, multiText.caseId, multiOp.id)).status,
    'completed',
  );
  pass(
    'obsolete single-message/any-stored-file trial restrictions removed; explicit text analysis preserves all facts/corrections and never reads an unselected file',
  );
  const chain = await fixture(owners[1]);
  const clarification = {
    kind: 'clarification',
    report: null,
    blocked: null,
    clarification: {
      context: 'Synthetic question',
      questions: [
        {
          id: 'q1',
          question: 'Synthetic clarification?',
          options: ['yes', 'no'],
          allow_unknown: true,
          allow_not_applicable: true,
        },
      ],
    },
  };
  let parent = await createAnalysis(chain.owner, chain.caseId, chain.messageId);
  const start = await beginExecution(chain.owner, chain.caseId, parent.id, {
    provider: async () => {
      calls++;
      return { result: clarification };
    },
  });
  await start.completion;
  for (let round = 1; round <= 4; round++) {
    const answer = await saveCaseMessage(chain.owner, chain.caseId, {
      requestId: randomUUID(),
      content: `Synthetic answer ${round}`,
      attachmentIds: [],
      clarification: { operationId: parent.id, questionIds: ['q1'] },
    });
    const next = await createAnalysis(chain.owner, chain.caseId, answer.id, parent.id);
    const run = await beginExecution(chain.owner, chain.caseId, next.id, {
      provider: async (request) => {
        calls++;
        assert.equal(JSON.parse(request.input.at(-1).content).runtime_limits.followup_round, round);
        return { result: round === 4 ? reportFor(answer.id) : clarification };
      },
    });
    await run.completion;
    parent = await getAnalysis(chain.owner, chain.caseId, next.id);
    assert.equal(parent.status, 'completed');
    assert.equal(parent.followupRound, round);
  }
  pass(
    'four explicit text clarification rounds work: obsolete two-round development ceiling removed, saved context/parent fences retained',
  );
  const pdfParent = await fixture(owners[0]);
  const pp = await createAnalysis(pdfParent.owner, pdfParent.caseId, pdfParent.messageId);
  const pr = await beginExecution(pdfParent.owner, pdfParent.caseId, pp.id, {
    provider: async () => {
      calls++;
      return { result: clarification };
    },
  });
  await pr.completion;
  await pool.query(
    "UPDATE case_analysis_operations SET input_snapshot=jsonb_set(input_snapshot,'{pdf}','{\"synthetic_marker\":true}'::jsonb) WHERE id=$1",
    [pp.id],
  );
  const pa = await saveCaseMessage(pdfParent.owner, pdfParent.caseId, {
    requestId: randomUUID(),
    content: 'Synthetic PDF continuation',
    attachmentIds: [],
    clarification: { operationId: pp.id, questionIds: ['q1'] },
  });
  const beforeUnsupported = calls;
  await assert.rejects(
    () => createAnalysis(pdfParent.owner, pdfParent.caseId, pa.id, pp.id),
    /متابعة المستندات غير مدعومة/,
  );
  assert.equal(calls, beforeUnsupported);
  pass(
    'removing trial gates does not silently activate unsupported PDF clarification or dispatch an incomplete document context',
  );
  const same = await fixture(owners[1]);
  const repeated = await Promise.all([
    createAnalysis(same.owner, same.caseId, same.messageId),
    createAnalysis(same.owner, same.caseId, same.messageId),
  ]);
  assert.equal(repeated[0].id, repeated[1].id);
  const beforeSame = calls;
  const immediate = async () => {
    calls++;
    return { result: reportFor(same.messageId) };
  };
  const twins = await Promise.all([
    beginExecution(same.owner, same.caseId, repeated[0].id, { provider: immediate }),
    beginExecution(same.owner, same.caseId, repeated[0].id, { provider: immediate }),
  ]);
  await Promise.all(twins.map((t) => t.completion));
  assert.equal(calls - beforeSame, 1);
  pass(
    'concurrent duplicate prepare and execute use real case/row locks: exactly one operation and provider call',
  );
  const f = work[0],
    op = operations[0].id;
  const historical = {
    scope: 'account_test',
    sessionId: randomUUID(),
    estimatedMicros: 10000000,
    limitMicros: 10000000,
    marker: 'synthetic historic record',
  };
  await pool.query('UPDATE case_analysis_operations SET spending_reservation=$2 WHERE id=$1', [
    op,
    historical,
  ]);
  const initialResult = (
    await pool.query('SELECT result FROM case_analysis_operations WHERE id=$1', [op])
  ).rows[0].result;
  const original = (await listVersions(f.owner, f.caseId, op))[0];
  const paragraphProvider = async (request) => {
    calls++;
    const context = JSON.parse(request.input.at(-1).content);
    return {
      result: {
        answer: 'Synthetic answer',
        proposedText: context.kind === 'revise' ? 'Synthetic proposed revision' : null,
        sourceRefs: [f.messageId],
      },
    };
  };
  const prepare = (kind) =>
    prepareInteraction(f.owner, f.caseId, op, {
      requestId: randomUUID(),
      versionId: original.id,
      sectionId: 'summary',
      blockIndex: 0,
      kind,
      instruction: 'Synthetic instruction',
    });
  for (let i = 0; i < 5; i++) {
    const p = await prepare('discuss');
    assert.equal(p.executionApproved, true);
    const run = await beginInteraction(f.owner, f.caseId, op, p.id, {
      provider: paragraphProvider,
    });
    completions.push(run.completion);
    await run.completion;
    assert.equal(
      (await listInteractions(f.owner, f.caseId, op)).find((x) => x.id === p.id).status,
      'completed',
    );
  }
  pass(
    'five paragraph discussions succeed despite exhausted synthetic historical $10 ledger: no four-interaction or Leo-only gate',
  );
  const revision = await prepare('revise'),
    beforeRevision = calls;
  const revisionRuns = await Promise.all([
    beginInteraction(f.owner, f.caseId, op, revision.id, { provider: paragraphProvider }),
    beginInteraction(f.owner, f.caseId, op, revision.id, { provider: paragraphProvider }),
  ]);
  await Promise.all(revisionRuns.map((r) => r.completion));
  assert.equal(calls - beforeRevision, 1);
  assert.equal((await listVersions(f.owner, f.caseId, op)).length, 1);
  const accepted = await saveVersion(f.owner, f.caseId, op, {
    requestId: randomUUID(),
    baseVersionId: original.id,
    proposalId: revision.id,
  });
  assert.equal(accepted.report.sections[0].blocks[0].text, 'Synthetic proposed revision');
  assert.deepEqual(
    (await listVersions(f.owner, f.caseId, op)).find((v) => v.id === original.id).report,
    original.report,
  );
  assert.deepEqual(
    (
      await pool.query(
        'SELECT result,spending_reservation FROM case_analysis_operations WHERE id=$1',
        [op],
      )
    ).rows[0],
    { result: initialResult, spending_reservation: historical },
  );
  pass(
    'proposed revision executes once; only explicit acceptance appends a version, original report/version and historic financial JSON unchanged',
  );
  const otherF = work[1],
    otherOp = operations[1].id,
    otherVersion = (await listVersions(otherF.owner, otherF.caseId, otherOp))[0];
  const otherP = await prepareInteraction(otherF.owner, otherF.caseId, otherOp, {
    requestId: randomUUID(),
    versionId: otherVersion.id,
    sectionId: 'summary',
    blockIndex: 0,
    kind: 'discuss',
    instruction: 'Synthetic other lawyer',
  });
  const otherRun = await beginInteraction(otherF.owner, otherF.caseId, otherOp, otherP.id, {
    provider: async () => {
      calls++;
      return {
        result: {
          answer: 'Independent lawyer',
          proposedText: null,
          sourceRefs: [otherF.messageId],
        },
      };
    },
  });
  await otherRun.completion;
  await assert.rejects(
    () => getAnalysis(owners[1], f.caseId, op),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => beginInteraction(owners[1], f.caseId, op, revision.id, { provider: paragraphProvider }),
    (e) => e.status === 404,
  );
  pass(
    'paragraph execution works for the second lawyer; cross-tenant operation and paragraph access denied',
  );
  const incomplete = await prepare('discuss');
  const ir = await beginInteraction(f.owner, f.caseId, op, incomplete.id, {
    provider: async (_r, _s, t = {}) => {
      calls++;
      return interpretProviderEnvelope(
        { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
        t,
      );
    },
  });
  await ir.completion;
  const ip = (await listInteractions(f.owner, f.caseId, op)).find((p) => p.id === incomplete.id);
  assert.equal(ip.status, 'failed');
  assert.equal(ip.answer, null);
  const countBeforeRefresh = calls;
  for (let i = 0; i < 3; i++) {
    await listAnalysis(f.owner, f.caseId);
    await listInteractions(f.owner, f.caseId, op);
    await listVersions(f.owner, f.caseId, op);
  }
  await (
    await beginInteraction(f.owner, f.caseId, op, incomplete.id, { provider: paragraphProvider })
  ).completion;
  assert.equal(calls, countBeforeRefresh);
  pass(
    'incomplete paragraph rejected; refresh/reconnect reads saved state and terminal replay never redispatches',
  );
  // Exercise unchanged authentication/role/CSRF middleware with isolated synthetic accounts.
  const admin = randomUUID();
  await pool.query(
    "INSERT INTO accounts(id,role,username,name,password_hash) VALUES($1,'admin',$2,'Synthetic admin','no-login')",
    [admin, randomUUID()],
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: req.headers['x-fixture-owner'], csrfToken: 'synthetic-token' };
    next();
  });
  app.use(csrfProtection);
  app.use(analysisRouter);
  app.use((error, _req, res, _next) =>
    res.status(error instanceof HttpError ? error.status : 500).json({ error: 'synthetic status' }),
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const request = (owner, method = 'GET', path = `/cases/${f.caseId}/analysis-operations/${op}`) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: owner ? { 'x-fixture-owner': owner } : {},
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
  assert.equal(await request(), 401);
  assert.equal(await request(admin), 403);
  assert.equal(await request(owners[1]), 404);
  assert.equal(await request(f.owner), 200);
  assert.equal(
    await request(f.owner, 'POST', `/cases/${f.caseId}/analysis-operations/${op}/execute`),
    403,
  );
  const cap = await analysisCapability(f.owner, f.caseId);
  assert.ok(!('testBudget' in cap));
  assert.ok(!('approvedOperationId' in cap));
  pass(
    'actual route auth: anonymous 401, non-lawyer 403, other tenant 404, owner 200, missing CSRF 403; capability exposes no financial policy',
  );
  const scopedCounts = (
    await pool.query(
      'SELECT count(*)::int n FROM report_interactions WHERE spending_reservation IS NOT NULL',
    )
  ).rows[0].n;
  assert.equal(scopedCounts, 0);
  assert.equal(external, 0);
  assert.deepEqual(await publicState(), before);
  assert.deepEqual(await legalHashes(), legalBefore);
  pass(
    'zero new financial reservations, external HTTP, public data changes or legal-prompt/schema changes',
  );
  console.log(
    JSON.stringify({
      checks,
      mockedProviderCalls: calls,
      externalHttp: external,
      realOpenAICalls: 0,
      publicWrites: 0,
    }),
  );
} finally {
  releases.forEach((release) => release());
  await Promise.allSettled(completions);
  if (server) await new Promise((resolve) => server.close(() => resolve()));
  pool.connect = connect;
  pool.query = query;
  globalThis.fetch = fetchOriginal;
  const cleanup = await connect();
  try {
    await cleanup.query('SET search_path TO public');
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    cleanup.release();
    await pool.end();
  }
}

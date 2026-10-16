import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import express from 'express';
import { pool } from '@workspace/db';
import { reportWorkspaceDDL } from '../src/lib/report-workspace-schema.js';
import { listVersions, saveVersion } from '../src/lib/report-versions.js';
import {
  prepareInteraction,
  beginInteraction,
  listInteractions,
  rejectInteraction,
  interactionView,
  interactionRequest,
} from '../src/lib/report-interactions.js';
import {
  accountTestBudgetSummary,
  approvedAccountTestBudget,
} from '../src/lib/analysis-account-budget.js';
import {
  createFolder,
  renameFolder,
  updateCase,
  listFolders,
} from '../src/lib/case-organization.js';
import { exportDocx, exportPdf, exportLines } from '../src/lib/report-export.js';
import { saveCaseMessage } from '../src/lib/case-message.js';
import { sectionOrder } from '../src/lib/analysis-contract.js';
import reportRouter from '../src/routes/report-workspace.js';
import casesRouter from '../src/routes/cases.js';
const schema = `report_test_${randomUUID().replaceAll('-', '')}`,
  owner = randomUUID(),
  other = randomUUID();
const caseId = randomUUID(),
  op = randomUUID(),
  msg = randomUUID(),
  sessionId = randomUUID();
const tables = [
  'accounts',
  'cases',
  'case_messages',
  'case_attachments',
  'case_analysis_operations',
  'attempt_limits',
];
const publicTables = [
  ...tables,
  'legal_documents',
  'legal_acceptances',
  'audit_events',
  'case_folders',
  'case_organization',
  'report_versions',
  'report_interactions',
];
const paths = ['shared-legal-core.md', 'case-analysis-prompt.md', 'case-analysis.schema.json'];
const rawConnect = pool.connect.bind(pool),
  rawQuery = pool.query.bind(pool);
const originalFetch = globalThis.fetch;
let external = 0,
  calls = 0,
  checks = 0;
const pass = (s) => {
  checks++;
  console.log(`PASS ${s}`);
};
globalThis.fetch = async () => {
  external++;
  throw new Error('EXTERNAL HTTP BLOCKED');
};
const report = {
  title: 'تقرير اختبار عربي اصطناعي',
  change_summary: null,
  alerts: [
    { severity: 'warning', message: 'بيانات اختبار فقط وليست رأيًا قانونيًا', attachment_id: null },
  ],
  sections: sectionOrder.map((section_id) => ({
    section_id,
    blocks: [
      {
        text: 'تطالب شركة افتراضية بمبلغ 50000 ريال عن عقد بتاريخ 1447/01/02.\nهذه فقرة اصطناعية للتحقق من العربية واتجاه النص فقط.',
        basis: 'lawyer_statement',
        source_refs: [msg],
      },
      {
        text: 'تبقى هذه الفقرة الأخرى كما هي دون أي تعديل.',
        basis: 'conditional',
        source_refs: [],
      },
    ],
  })),
};
async function hashes() {
  return Promise.all(
    paths.map(async (p) =>
      createHash('sha256')
        .update(await readFile(`lib/legal-contracts/${p}`))
        .digest('hex'),
    ),
  );
}
async function snapshot() {
  const c = await rawConnect();
  try {
    return await Promise.all(
      publicTables.map(
        async (t) =>
          (
            await c.query(
              `SELECT count(*)::int n,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) h FROM public.${t} t`,
            )
          ).rows[0],
      ),
    );
  } finally {
    c.release();
  }
}
const basePath = `/cases/${caseId}/reports/${op}`;
const budget = { ownerId: owner, sessionId, limitUsd: 10 };
const prepare = (kind, versionId = op) =>
  prepareInteraction(owner, caseId, op, {
    requestId: randomUUID(),
    versionId,
    sectionId: 'summary',
    blockIndex: 0,
    kind,
    instruction: 'وضح هذه الفقرة فقط مع بيان حدود الاستنتاج.',
  });
const provider = async (request) => {
  calls++;
  assert.equal(request.model, 'gpt-6.1-sol');
  assert.deepEqual(request.tools, []);
  assert.equal(request.text.format.name, 'focused_paragraph_interaction');
  const context = JSON.parse(request.input.at(-1).content);
  return {
    result: {
      answer: 'إجابة محاكاة مشروطة، بلا تحقق مستقل.',
      proposedText: context.kind === 'revise' ? 'نص مراجعة اصطناعي قبله المحامي.' : null,
      sourceRefs: [msg],
    },
    usage: { input_tokens: 100, output_tokens: 30 },
    model: 'mock-only',
  };
};
const options = (id, p = provider) => ({
  provider: p,
  budget,
  approval: { ownerId: owner, interactionId: id, maxReservationUsd: 1 },
});
let server;
async function request(path, method = 'GET', body, principal = owner) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path: `/api${path}`,
        method,
        headers: { 'content-type': 'application/json', 'x-fixture-owner': principal },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          let body;
          try {
            body = JSON.parse(data.toString());
          } catch {
            /* binary */
          }
          resolve({ status: res.statusCode, body, data, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function main() {
  const before = await snapshot(),
    legal = await hashes(),
    setup = await rawConnect();
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    for (const t of tables)
      await setup.query(`CREATE TABLE "${schema}".${t} (LIKE public.${t} INCLUDING ALL)`);
    await setup.query(`CREATE SEQUENCE "${schema}".message_sequence`);
    await setup.query(
      `ALTER TABLE "${schema}".case_messages ALTER COLUMN sequence SET DEFAULT nextval('"${schema}".message_sequence')`,
    );
  } finally {
    setup.release();
  }
  const scoped = async () => {
    const c = await rawConnect();
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
  try {
    await pool.query(reportWorkspaceDDL);
    for (const id of [owner, other])
      await pool.query(
        "INSERT INTO accounts(id,role,username,name,password_hash) VALUES($1,'lawyer',$2,'Synthetic report fixture','no-login')",
        [id, randomUUID()],
      );
    await pool.query('INSERT INTO cases(id,owner_id,request_id) VALUES($1,$2,$3)', [
      caseId,
      owner,
      randomUUID(),
    ]);
    await pool.query(
      "INSERT INTO case_messages(id,case_id,owner_id,request_id,content) VALUES($1,$2,$3,$4,'Synthetic only')",
      [msg, caseId, owner, randomUUID()],
    );
    const original = { kind: 'report', report, clarification: null, blocked: null };
    await pool.query(
      `INSERT INTO case_analysis_operations(id,case_id,owner_id,message_id,status,result,source_registry,started_at,finished_at)
      VALUES($1,$2,$3,$4,'completed',$5,$6,now(),now())`,
      [
        op,
        caseId,
        owner,
        msg,
        original,
        JSON.stringify([{ id: msg, basis: 'lawyer_statement', messageId: msg }]),
      ],
    );
    const v0 = (await listVersions(owner, caseId, op))[0];
    assert.deepEqual(v0.report, report);
    if (process.argv.includes('--entitlement-only')) {
      const oldBudget = process.env.MICRON_ANALYSIS_ACCOUNT_TEST_BUDGET;
      const oldApproval = process.env.MICRON_REPORT_INTERACTION_APPROVAL;
      try {
        process.env.MICRON_ANALYSIS_ACCOUNT_TEST_BUDGET = JSON.stringify(budget);
        const entitlement = { ownerId: owner, sessionId, maxRequests: 4, maxReservationUsd: 1 };
        process.env.MICRON_REPORT_INTERACTION_APPROVAL = JSON.stringify(entitlement);
        const first = await prepare('discuss');
        assert.equal(first.executionApproved, true);
        for (const invalid of [
          { ...entitlement, ownerId: other },
          { ...entitlement, sessionId: randomUUID() },
          { ...entitlement, maxRequests: 5 },
        ]) {
          process.env.MICRON_REPORT_INTERACTION_APPROVAL = JSON.stringify(invalid);
          assert.equal((await listInteractions(owner, caseId, op))[0].executionApproved, false);
        }
        process.env.MICRON_REPORT_INTERACTION_APPROVAL = JSON.stringify(entitlement);
        process.env.NODE_ENV = 'production';
        assert.equal((await listInteractions(owner, caseId, op))[0].executionApproved, false);
        process.env.NODE_ENV = 'development';
        const reserve = (estimatedMicros) => ({
          scope: 'account_test',
          sessionId,
          limitMicros: 10000000,
          estimatedMicros,
        });
        await pool.query(
          'UPDATE case_analysis_operations SET spending_reservation=$2 WHERE id=$1',
          [op, reserve(9999999)],
        );
        await assert.rejects(
          beginInteraction(owner, caseId, op, first.id, { provider }),
          (e) => e.status === 403,
        );
        assert.equal(calls, 0);
        // Different synthetic scenario; no public/owner ledger is reset.
        await pool.query(
          'UPDATE case_analysis_operations SET spending_reservation=$2 WHERE id=$1',
          [op, reserve(740000)],
        );
        const secondCase = randomUUID(),
          secondOp = randomUUID(),
          secondMsg = randomUUID();
        await pool.query('INSERT INTO cases(id,owner_id,request_id) VALUES($1,$2,$3)', [
          secondCase,
          owner,
          randomUUID(),
        ]);
        await pool.query(
          "INSERT INTO case_messages(id,case_id,owner_id,request_id,content) VALUES($1,$2,$3,$4,'اصطناعي فقط')",
          [secondMsg, secondCase, owner, randomUUID()],
        );
        await pool.query(
          'INSERT INTO case_analysis_operations(id,case_id,owner_id,message_id,status,result,source_registry,started_at,finished_at) SELECT $1,$2,owner_id,$3,status,result,source_registry,started_at,finished_at FROM case_analysis_operations WHERE id=$4',
          [secondOp, secondCase, secondMsg, op],
        );
        const work = [{ p: first, c: caseId, o: op }];
        for (let n = 1; n < 5; n++) {
          const c = n % 2 ? secondCase : caseId,
            o = n % 2 ? secondOp : op;
          work.push({
            c,
            o,
            p: await prepareInteraction(owner, c, o, {
              requestId: randomUUID(),
              versionId: o,
              sectionId: 'summary',
              blockIndex: 0,
              kind: n % 2 ? 'revise' : 'discuss',
              instruction: 'اختبار معزول فقط',
            }),
          });
        }
        const sessionProvider = async (request) => {
          calls++;
          if (calls === 4) throw Error('synthetic_timeout_no_retry');
          const context = JSON.parse(request.input.at(-1).content);
          return {
            result: {
              answer: 'محاكاة فقط',
              proposedText: context.kind === 'revise' ? 'نص اصطناعي' : null,
              sourceRefs: [],
            },
            usage: { input_tokens: 100, output_tokens: 20 },
            model: 'mock-only',
          };
        };
        const outcomes = await Promise.allSettled(
          work.map((w) => beginInteraction(owner, w.c, w.o, w.p.id, { provider: sessionProvider })),
        );
        const admitted = outcomes.filter((x) => x.status === 'fulfilled');
        assert.equal(admitted.length, 4);
        await Promise.all(admitted.map((x) => x.value.completion));
        assert.equal(calls, 4);
        assert.equal(
          outcomes.filter((x) => x.status === 'rejected' && x.reason.status === 403).length,
          1,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int n FROM report_interactions WHERE owner_id=$1 AND spending_reservation IS NOT NULL',
              [owner],
            )
          ).rows[0].n,
          4,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM report_interactions WHERE owner_id=$1 AND status='failed'",
              [owner],
            )
          ).rows[0].n,
          1,
        );
        const finished = work.find((_, i) => outcomes[i].status === 'fulfilled');
        await (
          await beginInteraction(owner, finished.c, finished.o, finished.p.id, {
            provider: sessionProvider,
          })
        ).completion;
        assert.equal(calls, 4);
        await assert.rejects(
          beginInteraction(other, caseId, op, first.id, { provider: sessionProvider }),
          (e) => e.status === 404,
        );
        const summary = await accountTestBudgetSummary(pool, owner, budget);
        assert.equal(summary.requests, 5);
        assert(summary.reservedUsd > 0.74 && summary.reservedUsd < 10);
        assert.equal(summary.knownUsageRequests, 3);
        assert.equal(summary.unknownUsageRequests, 2);
        assert.deepEqual(
          (await pool.query('SELECT result FROM case_analysis_operations WHERE id=$1', [op]))
            .rows[0].result,
          original,
        );
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await hashes(), legal);
        assert.equal(external, 0);
        pass(
          'Session owner/development isolation; shared existing budget; insufficient funds denied; five concurrent cross-case attempts admit four; failure holds slot; duplicate/foreign denied; originals unchanged; zero external requests',
        );
      } finally {
        process.env.NODE_ENV = 'development';
        if (oldBudget === undefined) delete process.env.MICRON_ANALYSIS_ACCOUNT_TEST_BUDGET;
        else process.env.MICRON_ANALYSIS_ACCOUNT_TEST_BUDGET = oldBudget;
        if (oldApproval === undefined) delete process.env.MICRON_REPORT_INTERACTION_APPROVAL;
        else process.env.MICRON_REPORT_INTERACTION_APPROVAL = oldApproval;
      }
      return;
    }
    if (process.argv.includes('--pins-only')) {
      const f = await createFolder(owner, { requestId: randomUUID(), name: 'مجلد تثبيت معزول' });
      assert.equal(f.pinned, false);
      assert.equal((await renameFolder(owner, f.id, { pinned: true })).pinned, true);
      await renameFolder(owner, f.id, { name: 'اسم جديد' });
      assert.equal((await listFolders(owner))[0].pinned, true);
      await updateCase(owner, caseId, { folderId: f.id, pinned: true });
      const renamed = await updateCase(owner, caseId, { title: 'قضية مثبتة' });
      assert.equal(renamed.pinned, true);
      assert.equal(renamed.folderId, f.id);
      assert.equal((await updateCase(owner, caseId, { folderId: null })).pinned, true);
      assert.equal((await updateCase(owner, caseId, { pinned: false })).folderId, null);
      assert.equal((await renameFolder(owner, f.id, { pinned: false })).pinned, false);
      await assert.rejects(renameFolder(other, f.id, { pinned: true }), (e) => e.status === 404);
      await assert.rejects(updateCase(other, caseId, { pinned: true }), (e) => e.status === 404);
      await assert.rejects(renameFolder(owner, f.id, {}), (e) => e.status === 400);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await hashes(), legal);
      assert.equal(external, 0);
      pass(
        'Persistent folder/case pins, rename/move preservation, unpin, ownership denial; no owner data, prompt or provider changes',
      );
      return;
    }
    if (process.argv.includes('--edge-only')) {
      const raw = '  تعديل يدوي مع مسافات مقصودة.\n';
      const v = await saveVersion(owner, caseId, op, {
        requestId: randomUUID(),
        baseVersionId: op,
        edits: [{ sectionId: 'summary', blockIndex: 0, text: raw }],
      });
      assert.equal(v.report.sections[0].blocks[0].text, raw);
      const emptyCase = randomUUID();
      await pool.query('INSERT INTO cases(id,owner_id,request_id) VALUES($1,$2,$3)', [
        emptyCase,
        owner,
        randomUUID(),
      ]);
      await updateCase(owner, emptyCase, { title: 'اسم اختاره المحامي قبل الإرسال' });
      await saveCaseMessage(owner, emptyCase, {
        requestId: randomUUID(),
        content: 'رسالة حفظ اصطناعية فقط',
        attachmentIds: [],
      });
      assert.equal(
        (await pool.query('SELECT title FROM cases WHERE id=$1', [emptyCase])).rows[0].title,
        'اسم اختاره المحامي قبل الإرسال',
      );
      await pool.query('UPDATE case_analysis_operations SET spending_reservation=$2 WHERE id=$1', [
        op,
        {
          scope: 'account_test',
          sessionId,
          limitMicros: 10000000,
          estimatedMicros: 740000,
          accounting: 'conservative_reservation_not_actual_billing',
        },
      ]);
      const p = await prepare('revise', v.id);
      assert.equal(p.executionApproved, false);
      const invalid = async () => {
        calls++;
        return {
          result: {
            answer: 'محاكاة غير صالحة',
            proposedText: 'محاكاة',
            sourceRefs: ['not-an-approved-source'],
          },
          usage: { input_tokens: 100, output_tokens: 30 },
        };
      };
      const execution = await beginInteraction(owner, caseId, op, p.id, options(p.id, invalid));
      await execution.completion;
      assert.equal((await listInteractions(owner, caseId, op))[0].status, 'failed');
      const ledger = await accountTestBudgetSummary(pool, owner, budget);
      assert.equal(ledger.requests, 2);
      assert.equal(ledger.knownUsageRequests, 1);
      assert.equal(ledger.unknownUsageRequests, 1);
      assert.ok(ledger.reservedUsd > 0.74);
      assert.equal(ledger.estimatedUsageUsd, 0.00055);
      pass(
        'Exact manual whitespace and observed usage preserved even on rejected provider output; root analysis and paragraph spending share one ledger',
      );
      const pending = await prepare('discuss', v.id);
      const tiny = { ...budget, sessionId: randomUUID(), limitUsd: 0.000001 };
      await assert.rejects(
        beginInteraction(owner, caseId, op, pending.id, { ...options(pending.id), budget: tiny }),
        (e) => e.status === 403,
      );
      assert.equal(calls, 1);
      assert.equal(
        (await listInteractions(owner, caseId, op)).find((i) => i.id === pending.id).status,
        'prepared',
      );
      await assert.rejects(
        beginInteraction(owner, caseId, op, pending.id, { provider, budget }),
        (e) => e.status === 403,
      );
      const burst = await prepare('discuss', v.id);
      const admitted = await Promise.race([
        Promise.all(
          Array.from({ length: 16 }, () =>
            beginInteraction(owner, caseId, op, burst.id, options(burst.id)),
          ),
        ),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Concurrent claim pool deadlock')),
            15000,
          );
          timer.unref();
        }),
      ]);
      await Promise.all(admitted.map((a) => a.completion));
      assert.equal(calls, 2);
      pass(
        'Sixteen concurrent claims exceed pool size without deadlock and dispatch exactly one mocked request',
      );
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await hashes(), legal);
      assert.equal(external, 0);
      pass(
        'Insufficient budget and independent-approval absence deny before dispatch, with no public data or legal-prompt changes',
      );
      return;
    }
    const edited = 'تعديل يدوي اصطناعي على هذه الفقرة وحدها.';
    const save = {
      requestId: randomUUID(),
      baseVersionId: op,
      edits: [{ sectionId: 'summary', blockIndex: 0, text: edited }],
    };
    const versions = await Promise.all(
      Array.from({ length: 5 }, () => saveVersion(owner, caseId, op, save)),
    );
    const v1 = versions[0];
    assert.ok(versions.every((v) => v.id === v1.id));
    assert.equal((await listVersions(owner, caseId, op)).length, 2);
    const block = v1.report.sections[0].blocks[0];
    assert.equal(block.text, edited);
    assert.equal(block.origin, 'manual');
    assert.deepEqual(block.source_refs, []);
    assert.equal(block.basis, 'unverified');
    assert.deepEqual(v1.report.sections.slice(1), report.sections.slice(1));
    assert.deepEqual(v1.report.sections[0].blocks[1], report.sections[0].blocks[1]);
    await assert.rejects(
      saveVersion(owner, caseId, op, { ...save, requestId: randomUUID() }),
      (e) => e.status === 409,
    );
    await assert.rejects(
      pool.query('UPDATE report_versions SET report=$2 WHERE id=$1', [v1.id, report]),
      /append-only/,
    );
    pass(
      'Manual edit, save/reopen, paragraph isolation, cleared inherited claims, concurrency/idempotency and immutable versions',
    );
    const restored = await saveVersion(owner, caseId, op, {
      requestId: randomUUID(),
      baseVersionId: v1.id,
      restoreVersionId: op,
    });
    assert.equal(restored.number, 2);
    assert.deepEqual(restored.report, report);
    assert.equal(restored.parentId, v1.id);
    assert.deepEqual((await listVersions(owner, caseId, op))[1].report, v1.report);
    pass(
      'Restore creates a new version; previous versions and the original provider result remain exact',
    );
    const discussion = await prepare('discuss', restored.id);
    await assert.rejects(
      beginInteraction(owner, caseId, op, discussion.id, { budget, provider }),
      (e) => e.status === 403,
    );
    assert.equal(calls, 0);
    const d = await beginInteraction(owner, caseId, op, discussion.id, options(discussion.id));
    await d.completion;
    assert.ok(
      (await listInteractions(owner, caseId, op)).find((i) => i.id === discussion.id).answer,
    );
    const proposal = await prepare('revise', restored.id);
    const executions = await Promise.all(
      Array.from({ length: 5 }, () =>
        beginInteraction(owner, caseId, op, proposal.id, options(proposal.id)),
      ),
    );
    await Promise.all(executions.map((e) => e.completion));
    assert.equal(calls, 2);
    const accepted = await saveVersion(owner, caseId, op, {
      requestId: randomUUID(),
      baseVersionId: restored.id,
      proposalId: proposal.id,
    });
    assert.equal(accepted.kind, 'ai_accepted');
    assert.equal(accepted.report.sections[0].blocks[0].text, 'نص مراجعة اصطناعي قبله المحامي.');
    assert.deepEqual(accepted.report.sections.slice(1), report.sections.slice(1));
    assert.deepEqual(accepted.report.sections[0].blocks[0].source_refs, []);
    pass(
      'Separate approval gate closed by default; focused mocked discussion/revision, exact-target acceptance and no duplicate provider dispatch',
    );
    const rejected = await prepare('revise', accepted.id);
    const r = await beginInteraction(owner, caseId, op, rejected.id, options(rejected.id));
    await r.completion;
    await rejectInteraction(owner, caseId, op, rejected.id);
    await assert.rejects(
      saveVersion(owner, caseId, op, {
        requestId: randomUUID(),
        baseVersionId: accepted.id,
        proposalId: rejected.id,
      }),
      (e) => e.status === 409,
    );
    const failure = await prepare('revise', accepted.id);
    const failProvider = async () => {
      calls++;
      throw new Error('mock timeout');
    };
    const f = await beginInteraction(
      owner,
      caseId,
      op,
      failure.id,
      options(failure.id, failProvider),
    );
    await f.completion;
    const count = calls;
    await (
      await beginInteraction(owner, caseId, op, failure.id, options(failure.id, failProvider))
    ).completion;
    assert.equal(calls, count);
    const summary = await accountTestBudgetSummary(pool, owner, budget);
    assert.equal(summary.requests, 4);
    assert.equal(summary.knownUsageRequests, 3);
    assert.equal(summary.unknownUsageRequests, 1);
    assert.ok(summary.reservedUsd > 0);
    pass(
      'Reject does not mutate reports; failure never retries, retains shared-budget reservation, missing usage remains unknown',
    );
    const folder = await createFolder(owner, { requestId: randomUUID(), name: 'عقود اصطناعية' });
    await updateCase(owner, caseId, { title: 'قضية اختبار معاد تسميتها', folderId: folder.id });
    await renameFolder(owner, folder.id, { name: 'نزاعات اصطناعية' });
    assert.equal((await listFolders(owner))[0].name, 'نزاعات اصطناعية');
    await assert.rejects(
      updateCase(other, caseId, { title: 'Wrong owner' }),
      (e) => e.status === 404,
    );
    const otherFolder = await createFolder(other, { requestId: randomUUID(), name: 'حساب آخر' });
    await assert.rejects(
      updateCase(owner, caseId, { folderId: otherFolder.id }),
      (e) => e.status === 404,
    );
    await assert.rejects(listVersions(other, caseId, op), (e) => e.status === 404);
    await assert.rejects(
      prepareInteraction(other, caseId, op, {
        requestId: randomUUID(),
        versionId: op,
        sectionId: 'summary',
        blockIndex: 0,
        kind: 'discuss',
        instruction: 'غير مسموح',
      }),
      (e) => e.status === 404,
    );
    pass(
      'Persistent rename/folder movement preserves IDs/evidence; cross-account folder, case, report and interaction isolation',
    );
    const dir = 'generated-artifacts/report-workspace';
    await mkdir(dir, { recursive: true });
    const docx = await exportDocx(accepted),
      pdf = await exportPdf(accepted);
    await writeFile(`${dir}/arabic-selected-version.docx`, docx);
    await writeFile(`${dir}/arabic-selected-version.pdf`, pdf);
    assert.equal(docx.subarray(0, 2).toString(), 'PK');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const xml = spawnSync(
      'unzip',
      ['-p', `${dir}/arabic-selected-version.docx`, 'word/document.xml'],
      { encoding: 'utf8', maxBuffer: 2000000 },
    );
    assert.equal(xml.status, 0);
    assert.match(xml.stdout, /w:bidi/);
    assert.match(xml.stdout, /w:rtl/);
    assert.match(xml.stdout, /نص مراجعة اصطناعي قبله المحامي/);
    const txt = spawnSync('pdftotext', ['-layout', `${dir}/arabic-selected-version.pdf`, '-'], {
      encoding: 'utf8',
      maxBuffer: 2000000,
    });
    assert.equal(txt.status, 0);
    assert.match(txt.stdout, /[\u0600-\u06ff]/);
    assert.equal(exportLines(accepted).filter((l) => l.heading === 2).length, 8);
    spawnSync('pdftoppm', [
      '-f',
      '1',
      '-singlefile',
      '-scale-to',
      '1200',
      '-png',
      `${dir}/arabic-selected-version.pdf`,
      `${dir}/arabic-pdf-page`,
    ]);
    pass(
      'Actual editable DOCX bidi/rtl XML and genuine rendered PDF, Arabic fonts/text, selected accepted version and all eight sections',
    );
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: req.headers['x-fixture-owner'] };
      next();
    });
    app.use('/api', reportRouter, casesRouter);
    app.use((e, _req, res, _next) => res.status(e.status ?? 400).json({ error: e.message }));
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const apiVersions = await request(`${basePath}/versions`);
    assert.equal(apiVersions.status, 200);
    assert.equal(apiVersions.body.at(-1).id, accepted.id);
    const cases = await request('/cases');
    assert.equal(cases.body[0].folderId, folder.id);
    assert.equal(cases.body[0].title, 'قضية اختبار معاد تسميتها');
    assert.equal((await request(`${basePath}/versions`, 'GET', undefined, other)).status, 404);
    assert.equal(
      (await request(`${basePath}/interactions/${discussion.id}/execute`, 'POST', {}, other))
        .status,
      404,
    );
    const apiDoc = await request(
      `/report-exports?caseId=${caseId}&operationId=${op}&versionId=${accepted.id}&format=docx`,
    );
    assert.equal(apiDoc.status, 200);
    assert.match(apiDoc.headers['content-disposition'], /filename\*=UTF-8''/);
    assert.equal(apiDoc.data.subarray(0, 2).toString(), 'PK');
    assert.equal(
      (
        await request(
          `/report-exports?caseId=${caseId}&operationId=${op}&versionId=${accepted.id}&format=pdf`,
          'GET',
          undefined,
          other,
        )
      ).status,
      404,
    );
    const denied = await prepare('discuss', accepted.id);
    assert.equal(
      (await request(`${basePath}/interactions/${denied.id}/execute`, 'POST', {})).status,
      403,
    );
    assert.equal(calls, count);
    pass(
      'Actual Express routes with isolated fixture principals: GET versions/cases, authenticated export, ownership denial and closed paid execution',
    );
    assert.deepEqual(
      (await pool.query('SELECT result FROM case_analysis_operations WHERE id=$1', [op])).rows[0]
        .result,
      original,
    );
    assert.deepEqual(await hashes(), legal);
    assert.deepEqual(await snapshot(), before);
    assert.equal(external, 0);
    pass('Public tables and approved Core/Prompt/Schema unchanged; no external HTTP/OpenAI calls');
    console.log(JSON.stringify({ checks, mockedProviderCalls: calls, realOpenAIRequests: 0 }));
  } finally {
    if (server) await new Promise((r) => server.close(() => r()));
    pool.query = rawQuery;
    pool.connect = rawConnect;
    const c = await rawConnect();
    try {
      await c.query('SET search_path TO public');
      await c.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      c.release();
    }
    globalThis.fetch = originalFetch;
    await pool.end();
  }
}
async function ownerReadiness() {
  try {
    const owner = JSON.parse(process.env.MICRON_ANALYSIS_ACCOUNT_TEST_BUDGET ?? 'null')?.ownerId;
    const budget = approvedAccountTestBudget(owner);
    if (!budget) throw Error('Owner budget closed');
    const account = (await pool.query('SELECT name,role FROM accounts WHERE id=$1', [owner]))
      .rows[0];
    const summary = await accountTestBudgetSummary(pool, owner, budget);
    const { rows } = await pool.query(
      "SELECT * FROM report_interactions WHERE owner_id=$1 AND status='prepared' ORDER BY created_at DESC",
      [owner],
    );
    const candidates = [];
    for (const r of rows) {
      const version = (await listVersions(owner, r.case_id, r.operation_id)).find(
        (v) => v.id === r.version_id,
      );
      if (!version) throw Error('Saved version missing');
      const paragraph = version.report.sections.find((s) => s.section_id === r.section_id)?.blocks[
        r.block_index
      ];
      if (!paragraph) throw Error('Paragraph missing');
      candidates.push({
        id: r.id,
        caseId: r.case_id,
        operationId: r.operation_id,
        versionId: r.version_id,
        kind: r.kind,
        status: r.status,
        executionApproved: interactionView(r).executionApproved,
        reservationEstimateUsd: interactionRequest(r, version.report, paragraph)
          .estimatedMaximumUsd,
        alreadyReserved: r.spending_reservation !== null,
      });
    }
    console.log(JSON.stringify({ account, summary, candidates, externalRequests: external }));
  } finally {
    await pool.end();
  }
}
await (process.argv.includes('--owner-readiness') ? ownerReadiness() : main());

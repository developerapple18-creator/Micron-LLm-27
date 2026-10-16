/**
 * Owner-authorized, isolated text-only probe. No application routes or DB access.
 * node artifacts/api-server/scripts/verify-case-analysis.mjs              (free preflight)
 * node artifacts/api-server/scripts/verify-case-analysis.mjs --run-once   (ONE paid attempt)
 * A durable exclusive marker prevents re-running this authorization.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { globSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const files = {
  '01-shared-legal-core-v0.2.md': 'shared-legal-core.md',
  '02-case-analysis-journey-v1.0.md': 'case-analysis-journey.md',
  '03-case-analysis-prompt-v0.1.md': 'case-analysis-prompt.md',
  '04-clarification-and-report-contract-v0.1.md': 'clarification-and-report-contract.md',
  '05-case-analysis-json-schema-v0.1.json': 'case-analysis.schema.json',
};
const outputDir = path.join(root, 'generated-artifacts/phase-2-text-only');
const resultPath = path.join(outputDir, 'result.json');
const model = 'gpt-6.1-sol';
const maxOutputTokens = 6000;
const timeoutMs = 180_000;
const allowedKeywords = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'anyOf',
]);

function checkSchema(schema) {
  let properties = 0,
    depth = 0;
  function visit(node, level = 0) {
    for (const key of Object.keys(node))
      assert(allowedKeywords.has(key), `Unreviewed schema keyword: ${key}`);
    if (node.type === 'object') {
      level++;
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      properties += Object.keys(node.properties).length;
      for (const child of Object.values(node.properties)) visit(child, level);
    }
    if (node.items) visit(node.items, level + 1);
    if (node.anyOf) for (const child of node.anyOf) visit(child, level);
    depth = Math.max(depth, level);
  }
  assert.equal(schema.type, 'object');
  assert.equal(schema.anyOf, undefined);
  visit(schema);
  assert(properties <= 5000 && depth <= 10, 'OpenAI schema size/depth limit');
  return { compatible: true, properties, conservativeDepth: depth };
}
function validateBranch(value, sources) {
  const errors = [];
  const problem = (condition, name) => {
    if (!condition) errors.push(name);
  };
  const nonempty = (text) => typeof text === 'string' && text.trim().length > 0;
  for (const kind of ['clarification', 'report', 'blocked']) {
    problem(kind === value.kind ? value[kind] !== null : value[kind] === null, `branch:${kind}`);
  }
  if (errors.length) return errors;
  if (value.kind === 'clarification') {
    const questions = value.clarification.questions;
    problem(nonempty(value.clarification.context), 'clarification:context');
    problem(questions.length >= 1 && questions.length <= 3, 'clarification:question-count');
    problem(
      new Set(questions.map((q) => q.id)).size === questions.length,
      'clarification:duplicate-id',
    );
    for (const q of questions) {
      problem(nonempty(q.id) && nonempty(q.question), 'clarification:empty-question');
      problem(q.options.every(nonempty), 'clarification:empty-option');
    }
  } else if (value.kind === 'report') {
    const report = value.report;
    const order = [
      'summary',
      'facts',
      'characterization',
      'evidence',
      'position',
      'legal_basis',
      'risks',
      'conclusions',
    ];
    problem(nonempty(report.title), 'report:title');
    problem(
      JSON.stringify(report.sections.map((s) => s.section_id)) === JSON.stringify(order),
      'report:eight-ordered-unique-sections',
    );
    problem(report.change_summary === null, 'report:initial-change-summary');
    for (const section of report.sections) {
      problem(section.blocks.length > 0, `report:empty-section:${section.section_id}`);
      for (const block of section.blocks) {
        problem(nonempty(block.text), 'report:empty-text');
        problem(
          block.source_refs.every((id) => sources.has(id)),
          'report:unknown-source',
        );
        if (block.basis === 'documented' || block.basis === 'legal_source') {
          problem(
            block.source_refs.length > 0 &&
              block.source_refs.every((id) => sources.get(id) === block.basis),
            'report:unsupported-documentary-or-legal-source',
          );
        }
      }
    }
    for (const alert of report.alerts) {
      problem(alert.attachment_id === null, 'report:nonexistent-attachment');
      problem(nonempty(alert.message), 'report:empty-alert');
    }
  } else {
    problem(nonempty(value.blocked.message), 'blocked:message');
    problem(
      value.blocked.needed.length > 0 && value.blocked.needed.every(nonempty),
      'blocked:needed',
    );
  }
  return errors;
}

async function main({ prepareOnly = false, sourceIdOverride = null } = {}) {
  const started = performance.now();
  const manifest = JSON.parse(
    await readFile(path.join(root, 'lib/legal-contracts/manifest.json'), 'utf8'),
  );
  const documents = {};
  for (const [logical, actual] of Object.entries(files)) {
    const bytes = await readFile(path.join(root, 'lib/legal-contracts', actual));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      manifest.files[logical],
      `Approved-file hash mismatch: ${logical}`,
    );
    documents[logical] = bytes.toString('utf8');
  }
  const format = JSON.parse(documents['05-case-analysis-json-schema-v0.1.json']);
  assert(
    format.type === 'json_schema' &&
      format.strict === true &&
      format.name === 'micron_case_analysis_v1',
  );
  const compatibility = checkSchema(format.schema);
  // Reuse installed AJV 8 without adding dependencies or changing package files.
  const ajvFile = globSync('node_modules/.pnpm/ajv@8*/node_modules/ajv/dist/ajv.js', {
    cwd: root,
  })[0];
  assert(ajvFile, 'Installed AJV 8 is required; stop rather than install implicitly');
  const Ajv = createRequire(import.meta.url)(path.join(root, ajvFile));
  const validate = new Ajv({ strict: true, allErrors: true }).compile(format.schema);
  const sourceId = sourceIdOverride ?? randomUUID();
  const fictionalCase = `هذه قضية خيالية أنشئت للاختبار فقط، وجميع الأشخاص والوقائع افتراضية.
أنا أمثل المدعي «ناصر» ضد المدعى عليه «سعد»، وهما شخصان طبيعيان بالغان غير تاجرين ومقيمان في الرياض. بحسب إفادة موكلي، أقرض سعدًا 120000 ريال دون عائد في 1 يناير 2026، واتفقا على حلول كامل الدين في 1 يوليو 2026. أفاد موكلي بأن تحويلًا بنكيًا ومحادثات تثبت سبب المبلغ وأجل السداد، لكنني لا أرفق هذه المستندات في هذا الاختبار ولم تتح لك قراءتها.
أفاد موكلي بأن سعدًا سدد 40000 ريال في 10 مارس 2026، وأن الباقي 80000 ريال لم يسدد بعد حلول الأجل. بحسب نقل موكلي لموقف الخصم، يقر سعد بأصل القرض وبالرصيد لكنه يدعي أن ناصر أبرأه شفهيًا من الباقي في أغسطس 2026؛ وموكلي ينفي صدور أي إبراء. لا توجد معلومات متاحة عن دليل الإبراء المزعوم، ولا يجوز اعتباره ثابتًا أو نفيه قطعًا.
لم ترفع الدعوى بعد، ولا يوجد حكم أو تبليغ أو سند تنفيذي بحسب إفادة موكلي. أطلب تحليل مركز المدعي في المطالبة بمبلغ 80000 ريال، والأدلة وعبء الإثبات وأقوى حجة مقابلة والنتائج المشروطة. لا أطلب صحيفة دعوى. لا توجد مرفقات أو مصادر نظامية موثقة أو أدوات بحث في هذا التشغيل.`;
  const context = {
    task: 'case_analysis',
    phase: 'initial',
    represented_party: 'المدعي',
    lawyer_message: fictionalCase,
    case_context: { fictional_test: true, current_date: '2026-10-13' },
    attachment_registry: [],
    source_registry: [{ id: sourceId, basis: 'lawyer_statement', text: fictionalCase }],
    previous_report: null,
    tool_capabilities: [],
    runtime_limits: { max_output_tokens: maxOutputTokens, timeout_ms: timeoutMs, max_requests: 1 },
  };
  const request = {
    model,
    service_tier: 'default',
    store: false,
    reasoning: { effort: 'medium' },
    max_output_tokens: maxOutputTokens,
    tools: [],
    input: [
      { role: 'developer', content: documents['01-shared-legal-core-v0.2.md'] },
      { role: 'developer', content: documents['03-case-analysis-prompt-v0.1.md'] },
      { role: 'user', content: JSON.stringify(context) },
    ],
    text: { format }, // Exact approved schema; journey/contract prose is not repeated as a prompt.
  };
  const body = JSON.stringify(request);
  // UTF-8 bytes overestimate ordinary text token count. Include generous framing
  // overhead and worst noncached input rate ($2.50/M including cache writes).
  const inputTokenUpperEstimate = Buffer.byteLength(body, 'utf8') + 4096;
  assert(inputTokenUpperEstimate < 272000, 'Stop before long-context premium');
  const maxCostEstimateUsd = (inputTokenUpperEstimate * 2.5 + maxOutputTokens * 10) / 1e6;
  assert(maxCostEstimateUsd < 1, 'Estimated cost must be below USD 1');
  const preflight = {
    approvedHashesMatch: true,
    compatibility,
    model,
    serviceTier: 'default',
    store: false,
    tools: [],
    maxOutputTokens,
    timeoutMs,
    inputTokenUpperEstimate,
    maxCostEstimateUsd,
  };
  if (prepareOnly) return { request, body, preflight, validate, sourceId };
  console.log(JSON.stringify({ preflight, paidRequests: 0 }, null, 2));
  if (!process.argv.includes('--run-once')) return;
  assert(process.env.REPLIT_DEPLOYMENT !== '1', 'Development-only authorization');
  assert(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY is not configured');
  await mkdir(outputDir, { recursive: true });
  // Exclusive marker persists even on error/timeout. Never delete automatically.
  await writeFile(
    path.join(outputDir, 'paid-attempt.json'),
    JSON.stringify({ startedAt: new Date().toISOString(), model, maxCostEstimateUsd }),
    { flag: 'wx', mode: 0o600 },
  );
  const result = { preflight, paidRequests: 1, requestSucceeded: false, output: null };
  const requestStarted = performance.now();
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body,
    }); // Exactly one fetch; no SDK retries, loops, parallel calls or fallback.
    const data = await response.json();
    result.requestDurationMs = Math.round(performance.now() - requestStarted);
    result.httpStatus = response.status;
    if (!response.ok) {
      result.apiErrorCode = /^[a-z0-9_]+$/i.test(data.error?.code ?? '') ? data.error.code : null;
      result.responseStatus = 'api_error'; // Never log raw error messages/headers.
    } else {
      result.requestSucceeded = true;
      result.actualModel = data.model;
      result.responseId = data.id;
      result.responseStatus = data.status;
      result.actualServiceTier = data.service_tier ?? null;
      result.usage = data.usage ?? null;
      const usage = data.usage;
      if (usage) {
        const input = usage.input_tokens,
          output = usage.output_tokens;
        const cached = usage.input_tokens_details?.cached_tokens ?? 0;
        const noncached = Math.max(0, input - cached);
        const writes = usage.input_tokens_details?.cache_write_tokens;
        const knownWrites = Number.isInteger(writes) && writes >= 0 && writes <= noncached;
        result.estimatedTokenCostUsd =
          (knownWrites
            ? (noncached - writes) * 2 + writes * 2.5 + cached * 0.1 + output * 10
            : noncached * 2 + cached * 0.1 + output * 10) / 1e6;
        result.conservativeTokenCostUsd = (noncached * 2.5 + cached * 0.1 + output * 10) / 1e6;
        result.costNote = knownWrites
          ? 'Standard published rates using reported cache_write_tokens; reasoning is already included in output_tokens. Estimated cost, not an invoice.'
          : 'Standard published rates; lower estimate excludes unknown cache-write surcharge, upper estimate treats all noncached input as cache writes. Reasoning is included in output_tokens.';
      }
      const parts = (data.output ?? [])
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? []);
      result.refusal = parts.some((part) => part.type === 'refusal');
      if (data.status === 'completed' && !result.refusal) {
        const text = parts
          .filter((part) => part.type === 'output_text')
          .map((part) => part.text)
          .join('');
        try {
          const parsed = JSON.parse(text);
          result.output = parsed;
          result.schemaValid = validate(parsed);
          result.schemaErrors = validate.errors ?? [];
          result.branchErrors = result.schemaValid
            ? validateBranch(parsed, new Map([[sourceId, 'lawyer_statement']]))
            : [];
          result.branchValid = result.schemaValid && result.branchErrors.length === 0;
          result.kind = parsed.kind;
          result.contractPassed = result.schemaValid && result.branchValid;
        } catch {
          result.schemaValid = false;
          result.branchValid = false;
          result.contractPassed = false;
          result.outputParseFailed = true;
        }
      } else {
        result.contractPassed = false;
        result.incompleteReason = data.incomplete_details?.reason ?? null;
      }
    }
  } catch (error) {
    result.requestDurationMs = Math.round(performance.now() - requestStarted);
    result.transportErrorType = error instanceof Error ? error.name : 'Unknown';
    result.responseStatus = 'unknown'; // Possibly billed; do not retry.
  }
  result.totalExecutionMs = Math.round(performance.now() - started);
  await writeFile(resultPath, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ resultSaved: path.relative(root, resultPath), ...result }, null, 2));
}
// Pure preparation for the separately authorized streaming diagnostic.
export async function prepareCaseAnalysisTest(sourceId) {
  return main({ prepareOnly: true, sourceIdOverride: sourceId });
}
export { validateBranch };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    // No raw exception values: malformed credentials can appear in native errors.
    console.error(
      JSON.stringify({
        stopped: true,
        errorType: error instanceof Error ? error.name : 'Unknown',
        noAutomaticRetry: true,
      }),
    );
    process.exitCode = 1;
  });

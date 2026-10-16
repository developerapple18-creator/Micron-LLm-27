/**
 * Separate owner authorization: ONE streaming probe, never a retry of test one.
 * Default invocation is offline preparation/self-check; --run-once sends once.
 * Reuses the original case, prompts, request builder and validation unchanged.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { prepareCaseAnalysisTest, validateBranch } from './verify-case-analysis.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const hash = (text) => createHash('sha256').update(text).digest('hex');

function sseParser(onEvent) {
  let pending = '',
    data = [],
    eventName = '';
  const dispatch = () => {
    if (data.length) {
      const payload = data.join('\n');
      if (payload !== '[DONE]') {
        const event = JSON.parse(payload);
        assert.equal(typeof event.type, 'string');
        if (eventName) assert.equal(eventName, event.type);
        onEvent(event);
      }
    }
    data = [];
    eventName = '';
  };
  const line = (value) => {
    if (!value) {
      dispatch();
      return;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') data.push(content);
    if (field === 'event') eventName = content;
  };
  return {
    feed(text) {
      pending += text;
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        let value = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (value.endsWith('\r')) value = value.slice(0, -1);
        line(value);
      }
    },
    finish() {
      if (pending) line(pending.endsWith('\r') ? pending.slice(0, -1) : pending);
      pending = '';
      dispatch();
    },
  };
}

function offlineParserCheck() {
  const events = [
    { type: 'response.created' },
    {
      type: 'response.output_text.delta',
      delta: '{"نص":"خيالي"}',
      output_index: 1,
      content_index: 0,
    },
    { type: 'response.completed', response: { status: 'completed' } },
  ];
  const wire =
    ': keepalive\r\n\r\n' +
    events.map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join('') +
    'data: [DONE]\n\n';
  const seen = [],
    decoder = new TextDecoder();
  const parser = sseParser((event) => seen.push(event));
  // One-byte chunks deliberately split UTF-8 Arabic, JSON, CRLF and frames.
  for (const byte of Buffer.from(wire))
    parser.feed(decoder.decode(Uint8Array.of(byte), { stream: true }));
  parser.feed(decoder.decode());
  parser.finish();
  assert.deepEqual(seen, events);
}

export async function runStreamingDiagnostic({ temporaryStyle = null } = {}) {
  const dir = path.join(
    root,
    temporaryStyle
      ? 'generated-artifacts/phase-2-conciseness-test'
      : 'generated-artifacts/phase-2-streaming-diagnostic',
  );
  let stage = 'preflight';
  const baseline = JSON.parse(
    await readFile(path.join(root, 'generated-artifacts/phase-2-text-only/result.json'), 'utf8'),
  );
  assert.equal(baseline.contractPassed, true);
  const refs = [
    ...new Set(
      baseline.output.report.sections.flatMap((s) => s.blocks.flatMap((b) => b.source_refs)),
    ),
  ];
  assert.equal(refs.length, 1);
  const sourceId = refs[0];
  const prepared = await prepareCaseAnalysisTest(sourceId);
  const { request, validate } = prepared;
  assert(validate(baseline.output));
  assert.deepEqual(validateBranch(baseline.output, new Map([[sourceId, 'lawyer_statement']])), []);
  assert.equal(
    prepared.preflight.inputTokenUpperEstimate,
    baseline.preflight.inputTokenUpperEstimate,
  );
  assert.equal(request.model, baseline.actualModel);
  assert.equal(request.store, false);
  request.stream = true; // The ONLY change to the reconstructed original API payload.
  const { stream, ...withoutStreaming } = request;
  assert.equal(JSON.stringify(withoutStreaming), prepared.body);
  assert.equal(stream, true);
  let previousStreaming = null;
  if (temporaryStyle !== null) {
    assert.equal(typeof temporaryStyle, 'string');
    assert(temporaryStyle.length > 0);
    previousStreaming = JSON.parse(
      await readFile(
        path.join(root, 'generated-artifacts/phase-2-streaming-diagnostic/result.json'),
        'utf8',
      ),
    );
    assert.equal(previousStreaming.diagnosticSucceeded, true);
    assert.equal(
      previousStreaming.preflight.reconstructedBaselinePayloadSha256,
      hash(prepared.body),
    );
    assert(validate(previousStreaming.output));
    assert.deepEqual(
      validateBranch(previousStreaming.output, new Map([[sourceId, 'lawyer_statement']])),
      [],
    );
    const unchangedStreamingBody = JSON.stringify(request);
    // Separate temporary message; approved prompt bytes and fictional input stay unchanged.
    request.input.splice(request.input.length - 1, 0, {
      role: 'developer',
      content: temporaryStyle,
    });
    const reverted = structuredClone(request);
    const removed = reverted.input.splice(reverted.input.length - 2, 1);
    assert.deepEqual(removed, [{ role: 'developer', content: temporaryStyle }]);
    assert.equal(JSON.stringify(reverted), unchangedStreamingBody);
  }
  const body = JSON.stringify(request);
  const inputUpper = Buffer.byteLength(body, 'utf8') + 4096;
  const maximumCostUsd = (inputUpper * 2.5 + request.max_output_tokens * 10) / 1e6;
  assert(inputUpper < 272000 && maximumCostUsd < 1);
  offlineParserCheck();
  const preflight = {
    approvedHashesMatch: true,
    originalValidationReused: true,
    originalSourceIdReused: true,
    onlyApiParameterChange: temporaryStyle
      ? 'one temporary output-style developer message versus streaming baseline'
      : 'stream:true',
    temporaryStyleOnly: temporaryStyle !== null,
    model: request.model,
    store: request.store,
    serviceTier: request.service_tier,
    reasoningEffort: request.reasoning.effort,
    maxOutputTokens: request.max_output_tokens,
    timeoutMs: prepared.preflight.timeoutMs,
    reconstructedBaselinePayloadSha256: hash(prepared.body),
    nonStreamingPayloadMatchesBaselineBuilder: true,
    maximumCostUsd,
    offlineParserCheckPassed: true,
  };
  console.log(JSON.stringify({ preflight, paidRequests: 0 }, null, 2));
  if (!process.argv.includes('--run-once')) return;
  assert(process.env.REPLIT_DEPLOYMENT !== '1');
  assert(process.env.OPENAI_API_KEY);
  stage = 'exclusive-attempt-marker';
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'paid-attempt.json'),
    JSON.stringify({
      startedAt: new Date().toISOString(),
      model: request.model,
      maximumCostUsd,
    }),
    { flag: 'wx', mode: 0o600 },
  );

  const result = {
    preflight,
    paidRequests: 1,
    httpSucceeded: false,
    contractPassed: false,
    timestamps: {},
    eventCounts: {},
    protocolIssues: [],
    output: null,
  };
  const start = performance.now();
  const stamp = () => ({
    utc: new Date().toISOString(),
    elapsedMs: Number((performance.now() - start).toFixed(3)),
  });
  const mark = (name) => {
    result.timestamps[name] ??= stamp();
  };
  const texts = new Map();
  let terminalResponse = null,
    sequence = null,
    refused = false;
  result.timestamps.requestInitiated = stamp();
  try {
    stage = 'http-request';
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(prepared.preflight.timeoutMs),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body,
    }); // No retries, SDK, parallel requests, fallback or follow-up API calls.
    mark('httpHeadersReceived');
    result.httpStatus = response.status;
    result.httpSucceeded = response.ok;
    if (!response.ok) {
      const error = await response.json();
      result.apiErrorCode = /^[a-z0-9_]+$/i.test(error.error?.code ?? '') ? error.error.code : null;
      mark('requestFinished');
    } else {
      assert(response.headers.get('content-type')?.includes('text/event-stream'));
      assert(response.body);
      stage = 'stream-consumption';
      const parser = sseParser((event) => {
        mark('firstStreamingEventReceived');
        const type = /^[a-z0-9_.]+$/i.test(event.type) ? event.type : 'unknown';
        result.eventCounts[type] = (result.eventCounts[type] ?? 0) + 1;
        if (Number.isInteger(event.sequence_number)) {
          if (sequence !== null && event.sequence_number !== sequence + 1)
            result.protocolIssues.push('event-sequence-gap');
          sequence = event.sequence_number;
        }
        if (event.type === 'response.output_text.delta') {
          mark('firstOutputTextDeltaReceived');
          result.timestamps.lastOutputTextDeltaReceived = stamp();
          assert.equal(typeof event.delta, 'string');
          const key = `${event.output_index}:${event.content_index}`;
          texts.set(key, (texts.get(key) ?? '') + event.delta);
        }
        if (event.type === 'response.output_text.done') {
          const key = `${event.output_index}:${event.content_index}`;
          if ((texts.get(key) ?? '') !== event.text)
            result.protocolIssues.push('text-done-mismatch');
        }
        if (event.type.includes('refusal')) refused = true;
        if (event.type === 'response.completed') {
          mark('responseCompletedReceived');
          terminalResponse = event.response;
        }
        if (event.type === 'response.incomplete' || event.type === 'response.failed')
          terminalResponse = event.response;
        if (event.type === 'error') result.protocolIssues.push('stream-error-event');
      });
      const decoder = new TextDecoder('utf-8', { fatal: true });
      for await (const chunk of response.body) {
        mark('firstBodyChunkReceived');
        parser.feed(decoder.decode(chunk, { stream: true }));
      }
      // EOF is the request-end timestamp, distinct from response.completed.
      mark('requestFinished');
      parser.feed(decoder.decode());
      parser.finish();
      stage = 'final-validation';
      const assembled = [...texts]
        .sort(([a], [b]) => {
          const [ao, ac] = a.split(':').map(Number),
            [bo, bc] = b.split(':').map(Number);
          return ao - bo || ac - bc;
        })
        .map(([, value]) => value)
        .join('');
      const finalTexts = (terminalResponse?.output ?? [])
        .filter((i) => i.type === 'message')
        .flatMap((i) => i.content ?? []);
      const finalText = finalTexts
        .filter((p) => p.type === 'output_text')
        .map((p) => p.text)
        .join('');
      result.assembledMatchesCompletedResponse = assembled === finalText;
      result.refusal = refused || finalTexts.some((p) => p.type === 'refusal');
      result.responseStatus = terminalResponse?.status ?? 'no-terminal-response';
      result.actualModel = terminalResponse?.model ?? null;
      result.actualServiceTier = terminalResponse?.service_tier ?? null;
      result.responseId = terminalResponse?.id ?? null;
      result.usage = terminalResponse?.usage ?? null;
      if (result.usage) {
        const u = result.usage,
          cached = u.input_tokens_details?.cached_tokens ?? 0;
        const writes = u.input_tokens_details?.cache_write_tokens;
        const remaining = u.input_tokens - cached;
        const knownWrites = Number.isInteger(writes) && writes >= 0 && writes <= remaining;
        result.estimatedTokenCostUsd =
          ((remaining - (knownWrites ? writes : 0)) * 2 +
            (knownWrites ? writes : 0) * 2.5 +
            cached * 0.1 +
            u.output_tokens * 10) /
          1e6;
        result.conservativeTokenCostUsd =
          (remaining * 2.5 + cached * 0.1 + u.output_tokens * 10) / 1e6;
        result.cacheWriteCountKnown = knownWrites;
        result.costNote =
          'Same Standard rates as test one; reasoning is included in output_tokens. Estimated cost, not an invoice.';
      }
      if (
        result.responseStatus === 'completed' &&
        !result.refusal &&
        result.timestamps.responseCompletedReceived
      ) {
        const parsed = JSON.parse(assembled);
        result.output = parsed;
        result.schemaValid = validate(parsed);
        result.schemaErrors = validate.errors ?? [];
        result.branchErrors = result.schemaValid
          ? validateBranch(parsed, new Map([[sourceId, 'lawyer_statement']]))
          : [];
        result.branchValid = result.schemaValid && result.branchErrors.length === 0;
        result.contractPassed = result.schemaValid && result.branchValid;
      }
      result.diagnosticSucceeded =
        result.contractPassed &&
        result.assembledMatchesCompletedResponse &&
        !result.protocolIssues.length;
    }
  } catch (error) {
    result.failureStage = stage;
    result.errorType = error instanceof Error ? error.name : 'Unknown';
    result.diagnosticSucceeded = false;
    // May already be billed. Preserve the marker and never reconnect/retry.
  }
  result.timestamps.observationEnded = stamp();
  const times = result.timestamps;
  const interval = (a, b) =>
    times[a] && times[b] ? Number((times[b].elapsedMs - times[a].elapsedMs).toFixed(3)) : null;
  result.intervalsMs = {
    requestToHeaders: interval('requestInitiated', 'httpHeadersReceived'),
    headersToFirstEvent: interval('httpHeadersReceived', 'firstStreamingEventReceived'),
    requestToFirstEvent: interval('requestInitiated', 'firstStreamingEventReceived'),
    requestToFirstTextDelta: interval('requestInitiated', 'firstOutputTextDeltaReceived'),
    firstEventToFirstTextDelta: interval(
      'firstStreamingEventReceived',
      'firstOutputTextDeltaReceived',
    ),
    firstTextDeltaToCompleted: interval(
      'firstOutputTextDeltaReceived',
      'responseCompletedReceived',
    ),
    lastTextDeltaToCompleted: interval('lastOutputTextDeltaReceived', 'responseCompletedReceived'),
    completedToRequestFinished: interval('responseCompletedReceived', 'requestFinished'),
    totalRequest: interval('requestInitiated', 'requestFinished'),
  };
  result.comparison = {
    baselineRequestMs: baseline.requestDurationMs,
    differenceMs:
      result.intervalsMs.totalRequest === null
        ? null
        : Number((result.intervalsMs.totalRequest - baseline.requestDurationMs).toFixed(3)),
    baselineWasNonStreamingAndMeasuredThroughResponseJson: true,
  };
  if (previousStreaming) {
    const delta = (current, previous) =>
      typeof current === 'number' && typeof previous === 'number'
        ? Number((current - previous).toFixed(6))
        : null;
    result.comparison = {
      baselineWasStreaming: true,
      baselineRequestMs: previousStreaming.intervalsMs.totalRequest,
      baselineFirstTextDeltaMs: previousStreaming.intervalsMs.requestToFirstTextDelta,
      baselineOutputTokens: previousStreaming.usage.output_tokens,
      baselineEstimatedCostUsd: previousStreaming.estimatedTokenCostUsd,
      totalRequestDifferenceMs: delta(
        result.intervalsMs.totalRequest,
        previousStreaming.intervalsMs.totalRequest,
      ),
      firstTextDeltaDifferenceMs: delta(
        result.intervalsMs.requestToFirstTextDelta,
        previousStreaming.intervalsMs.requestToFirstTextDelta,
      ),
      outputTokensDifference: delta(
        result.usage?.output_tokens,
        previousStreaming.usage.output_tokens,
      ),
      estimatedCostDifferenceUsd: delta(
        result.estimatedTokenCostUsd,
        previousStreaming.estimatedTokenCostUsd,
      ),
    };
  }
  await writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  const { output, ...safeSummary } = result;
  console.log(
    JSON.stringify(
      { resultSaved: path.relative(root, path.join(dir, 'result.json')), ...safeSummary },
      null,
      2,
    ),
  );
  if (!result.diagnosticSucceeded) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runStreamingDiagnostic().catch((error) => {
    console.error(
      JSON.stringify({
        stopped: true,
        errorType: error instanceof Error ? error.name : 'Unknown',
        code: /^[A-Z_]+$/.test(error?.code ?? '') ? error.code : null,
        noAutomaticRetry: true,
      }),
    );
    process.exitCode = 1;
  });

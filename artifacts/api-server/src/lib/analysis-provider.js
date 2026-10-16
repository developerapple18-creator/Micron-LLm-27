import core from '../../../../lib/legal-contracts/shared-legal-core.md';
import prompt from '../../../../lib/legal-contracts/case-analysis-prompt.md';
import format from '../../../../lib/legal-contracts/case-analysis.schema.json';
import { createHash } from 'node:crypto';
import manifest from '../../../../lib/legal-contracts/manifest.json';
export const MODEL = 'gpt-6.1-sol';
export const MAX_OUTPUT = 12_000;
// Existing paragraph interactions retain their original deadline.
export const TIMEOUT_MS = 180_000;
// Keep a full minute below the existing five-minute claim lease for validation/persistence.
export const ANALYSIS_TIMEOUT_MS = 240_000;
export class ProviderFailure extends Error {
  code;
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function buildAnalysisRequest(text, sourceId) {
  for (const [name, body] of [
    ['01-shared-legal-core-v0.2.md', core],
    ['03-case-analysis-prompt-v0.1.md', prompt],
  ]) {
    if (createHash('sha256').update(body).digest('hex') !== manifest.files[name]) {
      throw new ProviderFailure('invalid_result');
    }
  }
  const context = {
    task: 'case_analysis',
    phase: 'initial',
    represented_party: null,
    lawyer_message: text,
    case_context: { current_date: new Date().toISOString().slice(0, 10) },
    attachment_registry: [],
    source_registry: [{ id: sourceId, basis: 'lawyer_statement', text }],
    previous_report: null,
    tool_capabilities: [],
    runtime_limits: {
      max_output_tokens: MAX_OUTPUT,
      timeout_ms: ANALYSIS_TIMEOUT_MS,
      max_requests: 1,
    },
  };
  const request = {
    model: MODEL,
    service_tier: 'default',
    store: false,
    reasoning: { effort: 'medium' },
    max_output_tokens: MAX_OUTPUT,
    tools: [],
    input: [
      { role: 'developer', content: core },
      { role: 'developer', content: prompt },
      { role: 'user', content: JSON.stringify(context) },
    ],
    text: { format },
  };
  return { request };
}
/** Same approved instructions/schema/model; only the authorized runtime context expands. */
export function buildAnswerRequest(snapshot) {
  const first = snapshot.messages[0];
  if (!first) throw new ProviderFailure('invalid_result');
  const built = buildAnalysisRequest(first.content, first.id);
  const context = JSON.parse(built.request.input[2].content);
  context.phase = snapshot.round > 0 ? 'answer' : 'initial';
  context.lawyer_message = snapshot.messages.at(-1).content;
  context.previous_messages = snapshot.messages;
  context.previous_clarifications = snapshot.clarifications;
  context.clarification_responses = snapshot.messages.filter((m) => m.clarification);
  context.source_registry = snapshot.messages.map((m) => ({
    id: m.id,
    basis: 'lawyer_statement',
    text: m.content,
  }));
  context.runtime_limits.followup_round = snapshot.round;
  built.request.input[2].content = JSON.stringify(context);
  return { request: built.request };
}
/** Never retain arbitrary provider strings, partial legal output, or error bodies. */
export function sanitizedIncompleteReason(data) {
  if (data.status !== 'incomplete') return undefined;
  const reason = data.incomplete_details?.reason;
  return reason === 'max_output_tokens' || reason === 'content_filter' ? reason : 'unknown';
}
export function parseProviderResponse(data) {
  const parts = (data.output ?? [])
    .filter((p) => p.type === 'message')
    .flatMap((p) => p.content ?? []);
  if (data.status !== 'completed' || parts.some((p) => p.type === 'refusal'))
    throw new ProviderFailure('incomplete_response');
  try {
    return JSON.parse(
      parts
        .filter((p) => p.type === 'output_text')
        .map((p) => p.text ?? '')
        .join(''),
    );
  } catch {
    throw new ProviderFailure('invalid_result');
  }
}
/** Diagnostics and usage must survive the strict rejection of incomplete output. */
export function interpretProviderEnvelope(data, telemetry) {
  telemetry.completionStatus = data.status;
  telemetry.responseId = data.id;
  telemetry.incompleteReason = sanitizedIncompleteReason(data);
  telemetry.actualModel = data.model;
  telemetry.actualServiceTier = data.service_tier;
  telemetry.usage = data.usage;
  return { result: parseProviderResponse(data), usage: data.usage, model: data.model };
}
/** One HTTP request, no SDK retries, no streaming or tools. Key stays server-side. */
export const openAIProvider = async (request, signal, telemetry = {}) => {
  if (!process.env.OPENAI_API_KEY) throw new ProviderFailure('provider_error');
  const body = JSON.stringify(request);
  const httpStart = performance.now();
  telemetry.dispatchedAt = new Date().toISOString();
  let response, raw;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body,
    });
    telemetry.httpStatus = response.status;
    captureProviderError(response, undefined, telemetry);
    raw = await response.text();
  } finally {
    telemetry.httpMs = performance.now() - httpStart;
    telemetry.httpFinishedAt = new Date().toISOString();
  }
  if (!response.ok) {
    captureProviderError(response, raw, telemetry);
    try {
      const code = JSON.parse(raw)?.error?.code;
      if (
        ['context_length_exceeded', 'request_too_large', 'file_too_large', 'invalid_file'].includes(
          code,
        )
      )
        telemetry.providerIssue = code;
    } catch {
      /* Never retain arbitrary provider error messages or documents. */
    }
    throw new ProviderFailure('provider_error');
  }
  const parseStart = performance.now();
  try {
    const data = JSON.parse(raw);
    return interpretProviderEnvelope(data, telemetry);
  } finally {
    telemetry.responseParsingMs = performance.now() - parseStart;
  }
};
/** Bounded allowlists only: never store/log error.message, param or request bodies. */
export function captureProviderError(response, raw, telemetry) {
  telemetry.httpStatus = response.status;
  const id = response.headers.get('x-request-id');
  if (id && /^[A-Za-z0-9_-]{1,160}$/.test(id)) telemetry.requestId = id;
  if (!raw) return;
  try {
    const e = JSON.parse(raw)?.error;
    const codes = [
      'server_error',
      'internal_error',
      'rate_limit_exceeded',
      'context_length_exceeded',
      'request_too_large',
      'file_too_large',
      'invalid_file',
      'invalid_api_key',
      'insufficient_quota',
      'invalid_request_error',
    ];
    const types = [
      'server_error',
      'invalid_request_error',
      'rate_limit_error',
      'authentication_error',
      'permission_error',
    ];
    telemetry.errorCode = codes.includes(e?.code) ? e.code : 'unknown';
    telemetry.errorType = types.includes(e?.type) ? e.type : 'unknown';
    if (
      ['context_length_exceeded', 'request_too_large', 'file_too_large', 'invalid_file'].includes(
        e?.code,
      )
    )
      telemetry.providerIssue = e.code;
  } catch {
    telemetry.errorCode = 'unparseable_error';
  }
}

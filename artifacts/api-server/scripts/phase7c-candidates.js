/** Offline-only candidate builder. Never imported by an application route. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildAnalysisRequest } from '../src/lib/analysis-provider.js';
import { assertDevelopmentAnalysis } from '../src/lib/analysis-stream.js';
export async function candidateRequests(text, source) {
  assertDevelopmentAnalysis();
  const baseline = buildAnalysisRequest(text, source);
  const core = await readFile(
    'legal-candidates/phase7c/01-shared-legal-core-v0.3.candidate.md',
    'utf8',
  );
  const prompt = await readFile(
    'legal-candidates/phase7c/03-case-analysis-prompt-v0.2.candidate.md',
    'utf8',
  );
  const coreOnly = structuredClone(baseline.request),
    promptOnly = structuredClone(baseline.request);
  coreOnly.input[0].content = core;
  promptOnly.input[1].content = prompt;
  const inputOnly = structuredClone(baseline.request);
  const context = JSON.parse(inputOnly.input[2].content);
  // Keep the original message exactly once and bind its source explicitly.
  context.lawyer_message_source_id = source;
  context.source_registry = [{ id: source, basis: 'lawyer_statement', messageId: source }];
  inputOnly.input[2].content = JSON.stringify(context);
  return { baseline: baseline.request, coreOnly, promptOnly, inputOnly };
}
export function requestSize(request) {
  const serialized = JSON.stringify(request);
  const bytes = Buffer.byteLength(serialized);
  return {
    sha256: createHash('sha256').update(serialized).digest('hex'),
    bytes,
    inputTokenUpperEstimate: bytes + 4096,
    conservativeMaximumUsd: ((bytes + 4096) * 2.5 + 6000 * 10) / 1e6,
  };
}

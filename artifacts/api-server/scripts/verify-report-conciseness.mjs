/**
 * Owner-authorized ONE concise-report experiment, isolated from the application.
 * Default is offline preflight; --run-once consumes this authorization once.
 * No permanent legal prompt changes; reuse the streaming runner and validators.
 */
import { runStreamingDiagnostic } from './verify-streaming-latency.mjs';

const temporaryStyle =
  'Produce a focused, professionally concise legal analysis. Preserve all eight required sections, every material legal issue, the strongest opposing argument, evidentiary distinctions, necessary qualifications, and source traceability. Avoid repeating the same facts, cautions, or conclusions across sections. Each section should contribute distinct value. Do not omit material analysis merely to shorten the response.';

runStreamingDiagnostic({ temporaryStyle }).catch((error) => {
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

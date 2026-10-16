/** ONE authorized execution through the existing API. Never calls the provider directly. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
assert(process.env.REPLIT_DEV_DOMAIN && process.env.REPLIT_DEPLOYMENT !== '1', 'Development only');
const mode = process.argv[2];
assert(['--prepare', '--execute-once'].includes(mode), 'Explicit prepare or execute-once required');
const dir = 'generated-artifacts/phase7a';
await mkdir(dir, { recursive: true });
const credentials = JSON.parse(await readFile('/tmp/micron-phase7a-fixture.json', 'utf8'));
const proposed = JSON.parse(await readFile(`${dir}/mock-tests.json`, 'utf8')).proposedPaidCase;
assert.equal(typeof proposed, 'string');
let cookie = '',
  csrf = '';
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
async function call(path, data, expected = 200) {
  const res = await fetch(origin + '/api' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });
  const next = res.headers.getSetCookie().find((v) => v.startsWith('micron.sid='));
  if (next) cookie = next.split(';')[0];
  const body = await res.json();
  assert.equal(res.status, expected, `Unexpected HTTP status ${path}`);
  if (body.csrfToken) csrf = body.csrfToken;
  return body;
}
await call('/auth/session');
await call('/auth/login', { mobile: credentials.mobile, password: credentials.password });
const fixture = credentials.cases.fresh;
const base = `/cases/${fixture.caseId}`;
async function checkInput() {
  const detail = await call(base);
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0].content, proposed);
  assert.equal(detail.messages[0].id, fixture.messageId);
  assert.equal(detail.attachments.length, 0);
  return detail;
}
await checkInput();
if (mode === '--prepare') {
  const capability = await call(`${base}/analysis-capability`);
  assert.equal(capability.eligible, true);
  assert.equal(capability.executionEnabled, false, 'Start locked');
  const operation = await call(`${base}/analysis-operations`, { messageId: fixture.messageId });
  assert.equal(operation.id, fixture.operationId);
  assert.equal(operation.status, 'pending');
  const plan = {
    preparedAt: new Date().toISOString(),
    caseId: fixture.caseId,
    operationId: operation.id,
    messageId: fixture.messageId,
    inputText: proposed,
    model: 'gpt-6.1-sol',
    store: false,
    reasoning: 'medium',
    maxOutputTokens: 6000,
    timeoutMs: 180000,
    maxProviderRequests: 1,
  };
  await writeFile(`${dir}/real-test-plan.json`, JSON.stringify(plan, null, 2), { flag: 'wx' });
  console.log(
    JSON.stringify({
      prepared: true,
      caseId: plan.caseId,
      operationId: plan.operationId,
      providerRequests: 0,
    }),
  );
} else {
  const plan = JSON.parse(await readFile(`${dir}/real-test-plan.json`, 'utf8'));
  assert.equal(plan.operationId, fixture.operationId);
  assert.equal(plan.inputText, proposed);
  const capability = await call(`${base}/analysis-capability`);
  assert.equal(capability.executionEnabled, true);
  assert.equal(capability.approvedOperationId, plan.operationId);
  const op = await call(`${base}/analysis-operations/${plan.operationId}`);
  assert.equal(op.status, 'pending', 'Do not execute or retry a running/terminal operation');
  const receipt = {
    caseId: plan.caseId,
    operationId: plan.operationId,
    confirmedAt: new Date().toISOString(),
    executePosts: 1,
    observations: [],
  };
  // Exclusive marker is committed before POST. A lost response must NEVER permit a second attempt.
  await writeFile(`${dir}/real-test-attempt.json`, JSON.stringify(receipt, null, 2), {
    flag: 'wx',
  });
  const start = performance.now();
  try {
    const accepted = await call(`${base}/analysis-operations/${plan.operationId}/execute`, {}, 202);
    receipt.acceptedAt = new Date().toISOString();
    receipt.confirmationResponseMs = performance.now() - start;
    receipt.acceptedStatus = accepted.status;
  } catch {
    receipt.executeResponseLostOrRejected = true; // Read recovery only; do not repeat POST.
  }
  const deadline = performance.now() + 330000;
  let terminal;
  while (performance.now() < deadline) {
    try {
      const current = await call(`${base}/analysis-operations/${plan.operationId}`);
      receipt.observations.push({ at: new Date().toISOString(), status: current.status });
      if (current.status === 'completed' || current.status === 'failed') {
        terminal = current;
        break;
      }
    } catch {
      receipt.readFailures = (receipt.readFailures ?? 0) + 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  receipt.observedElapsedMs = performance.now() - start;
  receipt.finalOperation = terminal ?? null;
  if (terminal) {
    receipt.firstTerminalVisibleAt = receipt.observations.at(-1).at;
    const recovered = await call(`${base}/analysis-operations/${plan.operationId}`);
    receipt.readRecoveryMatches = JSON.stringify(recovered) === JSON.stringify(terminal);
  }
  await writeFile(`${dir}/real-test-result.json`, JSON.stringify(receipt, null, 2));
  console.log(
    JSON.stringify({
      caseId: receipt.caseId,
      operationId: receipt.operationId,
      executePosts: 1,
      status: terminal?.status ?? 'unobserved',
      kind: terminal?.result?.kind ?? null,
      confirmationResponseMs: receipt.confirmationResponseMs,
      observedElapsedMs: receipt.observedElapsedMs,
      readRecoveryMatches: receipt.readRecoveryMatches,
    }),
  );
}

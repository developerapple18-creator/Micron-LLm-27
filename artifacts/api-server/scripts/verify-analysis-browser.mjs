/** Local browser verification using synthetic credentials only; no agent/API AI calls. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.NODE_ENV, 'development');
assert.notEqual(process.env.REPLIT_DEPLOYMENT, '1');
assert(process.env.REPLIT_DEV_DOMAIN);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bindingFile = '/tmp/micron-analysis-lifecycle-fixture.json';
const binding = JSON.parse(await readFile(bindingFile, 'utf8'));
const fixture = JSON.parse(
  await readFile(
    path.join(root, 'generated-artifacts/phase-2-streaming-diagnostic/result.json'),
    'utf8',
  ),
).output;
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || '/mnt/pid2/node_modules/playwright',
);
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const dir = path.join(root, 'generated-artifacts/analysis-lifecycle');
const checks = [],
  errors = [];
const pass = (text) => {
  checks.push(text);
  console.log(`PASS ${text}`);
};
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  async function login(context, second = false) {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.name));
    await page.goto(origin + '/login');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('input-mobile').fill(second ? binding.secondMobile : binding.mobile);
    await page
      .getByTestId('input-password')
      .fill(second ? binding.secondPassword : binding.password);
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.status() === 200),
      page.getByTestId('button-login').click(),
    ]);
    await page.waitForURL(origin + '/');
    return page;
  }
  async function view(page, name) {
    const target = binding.cases[name];
    await page.goto(origin + `/cases/${target.caseId}`);
    await page.getByTestId(`analysis-operation-${target.operationId}`).waitFor();
    return page.getByTestId(`analysis-operation-${target.operationId}`);
  }
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desktop = await login(desktopContext);
  const completed = await view(desktop, 'completed');
  assert.match(await completed.getByTestId('analysis-status').innerText(), /مكتملة/);
  assert.equal(await completed.locator('[data-testid^="analysis-section-"]').count(), 8);
  const allBlocks = fixture.report.sections.flatMap((s) => s.blocks.map((b) => b.text));
  for (const text of allBlocks) assert((await completed.innerText()).includes(text));
  await desktop.reload();
  await desktop.getByTestId('analysis-saved-report').waitFor();
  const exact = await desktop.evaluate(async (target) => {
    const res = await fetch(
      `/api/cases/${target.caseId}/analysis-operations/${target.operationId}`,
      { credentials: 'include' },
    );
    return (await res.json()).result;
  }, binding.cases.completed);
  assert.deepEqual(exact, fixture);
  await desktop.goto(origin + '/');
  await view(desktop, 'completed');
  assert.equal(await desktop.locator('[data-testid^="analysis-section-"]').count(), 8);
  await desktop.getByTestId('analysis-section-summary').scrollIntoViewIfNeeded();
  await desktop.screenshot({ path: path.join(dir, 'desktop-completed.png') });
  pass(
    'Desktop: eight headings and every saved block shown; reload and navigation restore the exact result',
  );

  const pending = await view(desktop, 'pending');
  assert.match(await pending.getByTestId('analysis-status').innerText(), /معلقة/);
  await desktop.reload();
  assert.match(await desktop.getByTestId('analysis-status').innerText(), /معلقة/);
  const transition = (action) =>
    execFileSync(
      path.join(root, 'scripts/node_modules/.bin/tsx'),
      [
        path.join(root, 'artifacts/api-server/scripts/development-analysis-fixture.js'),
        `--action=${action}`,
        '--case=pending',
      ],
      { cwd: root, env: { ...process.env, NODE_ENV: 'development' }, stdio: 'pipe' },
    );
  transition('claim');
  await desktop.getByTestId('analysis-status').filter({ hasText: 'جارٍ التنفيذ' }).waitFor();
  await desktop.reload();
  await desktop.getByTestId('analysis-status').filter({ hasText: 'جارٍ التنفيذ' }).waitFor();
  assert.equal(await desktop.getByTestId('analysis-saved-report').count(), 0);
  transition('complete');
  await desktop.getByTestId('analysis-saved-report').waitFor();
  await desktop.reload();
  await desktop.getByTestId('analysis-saved-report').waitFor();
  pass(
    'Desktop: pending/running survive reload; polling discovers externally stored completion; no report appears before completion',
  );

  const failed = await view(desktop, 'failed');
  await failed.getByTestId('analysis-failure').waitFor();
  assert.equal(await failed.getByTestId('analysis-saved-report').count(), 0);
  await desktop.reload();
  await desktop.getByTestId('analysis-failure').waitFor();
  await view(desktop, 'interrupted');
  assert((await desktop.getByTestId('analysis-failure').innerText()).includes('انقطع'));
  assert.equal(await desktop.getByTestId('analysis-saved-report').count(), 0);
  pass('Desktop: failure/interruption survive refresh and never render a completed report');

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await login(mobileContext);
  const mobileCompleted = await view(mobile, 'completed');
  assert.equal(await mobileCompleted.locator('[data-testid^="analysis-section-"]').count(), 8);
  await mobile.reload();
  await mobile.getByTestId('analysis-saved-report').waitFor();
  for (const id of fixture.report.sections.map((s) => s.section_id)) {
    const section = mobile.getByTestId(`analysis-section-${id}`);
    await section.scrollIntoViewIfNeeded();
    const box = await section.boundingBox();
    assert(box && box.x >= -1 && box.x + box.width <= 391, 'Section exceeds mobile viewport');
  }
  await mobile.getByTestId('analysis-section-summary').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: path.join(dir, 'mobile-completed.png') });
  await view(mobile, 'failed');
  await mobile.getByTestId('analysis-failure').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: path.join(dir, 'mobile-failed.png') });
  assert.equal(await mobile.getByTestId('analysis-saved-report').count(), 0);
  pass(
    'Mobile 390x844: eight sections readable without horizontal overflow; refresh restores result; failure is explicit',
  );

  const foreignContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const foreign = await login(foreignContext, true);
  await foreign.goto(origin + `/cases/${binding.cases.completed.caseId}`);
  await foreign.getByTestId('text-case-not-found').waitFor();
  assert.equal(await foreign.getByTestId('analysis-saved-report').count(), 0);
  pass('Another lawyer opening the case URL sees unavailability and no result');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(dir, 'browser-tests.json'),
    JSON.stringify({ checks, pageErrors: errors, paidRequests: 0 }, null, 2),
    { mode: 0o600 },
  );
  console.log(
    `Completed ${checks.length} browser groups; screenshots saved under generated-artifacts/analysis-lifecycle.`,
  );
} catch (error) {
  let message = error instanceof Error ? error.message : 'Unknown';
  for (const secret of [
    binding.password,
    binding.secondPassword,
    binding.mobile,
    binding.secondMobile,
  ]) {
    if (secret) message = message.split(secret).join('[synthetic credential redacted]');
  }
  console.error(
    JSON.stringify({
      browserVerificationFailed: true,
      errorType: error instanceof Error ? error.name : 'Unknown',
      message: message.slice(0, 2000),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}

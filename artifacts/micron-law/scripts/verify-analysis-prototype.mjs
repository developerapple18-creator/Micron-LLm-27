/** Local, unpaid browser checks against synthetic development accounts only. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

assert.equal(process.env.NODE_ENV, 'development');
assert.notEqual(process.env.REPLIT_DEPLOYMENT, '1');
assert(process.env.REPLIT_DEV_DOMAIN);
const root = fileURLToPath(new URL('../../../', import.meta.url));
let binding;
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const output = path.join(root, 'generated-artifacts/analysis-responsive');
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || '/mnt/pid2/node_modules/playwright',
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const checks = [],
  pageErrors = [],
  aiRequests = [];
let activePage;
const pass = (text) => {
  checks.push(text);
  console.log(`PASS ${text}`);
};
const sectionIds = [
  'summary',
  'facts',
  'characterization',
  'evidence',
  'position',
  'legal_basis',
  'risks',
  'conclusions',
];
await mkdir(output, { recursive: true });
try {
  // Temporary credentials from earlier verification do not survive environment
  // replacement. Seed only ordinary fictional cases, never analysis operations.
  const bindingFile = '/tmp/micron-analysis-prototype-fixture.json';
  try {
    binding = JSON.parse(await readFile(bindingFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    class Session {
      cookie = '';
      csrf = '';
      async call(endpoint, data, expected = 200) {
        const response = await fetch(origin + '/api' + endpoint, {
          method: data === undefined ? 'GET' : 'POST',
          headers: {
            cookie: this.cookie,
            'content-type': 'application/json',
            'x-csrf-token': this.csrf,
          },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
        const cookie = response.headers
          .getSetCookie()
          .find((value) => value.startsWith('micron.sid='));
        if (cookie) this.cookie = cookie.split(';')[0];
        const body = await response.json();
        assert.equal(response.status, expected, endpoint + ' returned unexpected status');
        if (body.csrfToken) this.csrf = body.csrfToken;
        return body;
      }
      async register(name) {
        await this.call('/auth/session');
        const docs = await this.call('/legal/documents');
        assert.equal(docs.length, 3);
        this.mobile = '05' + randomInt(10_000_000, 99_999_999);
        this.password = randomBytes(24).toString('base64url');
        await this.call('/auth/start', { mobile: this.mobile });
        await this.call('/auth/verify', { code: '1111' });
        await this.call(
          '/auth/register',
          {
            name,
            password: this.password,
            confirmPassword: this.password,
            acceptedDocumentIds: docs.map((doc) => doc.id),
          },
          201,
        );
      }
    }
    const owner = new Session(),
      other = new Session();
    await owner.register('حساب تطوير خيالي لنموذج الواجهة');
    await other.register('حساب تطوير خيالي لعزل نموذج الواجهة');
    const cases = {};
    for (const name of ['reading', 'ordinary']) {
      const created = await owner.call('/cases', { requestId: randomUUID() });
      await owner.call(`/cases/${created.id}/messages`, {
        requestId: randomUUID(),
        content:
          name === 'reading'
            ? Array.from(
                { length: 55 },
                (_, i) =>
                  `سطر خيالي ${i + 1} لاختبار موضع القراءة فقط، ولا يتعلق بقضية حقيقية أو تحليل قانوني.`,
              ).join('\n')
            : 'قضية خيالية لاختبار الإرسال والمرفقات العادية دون تحليل.',
        attachmentIds: [],
      });
      cases[name] = { caseId: created.id };
    }
    binding = {
      mobile: owner.mobile,
      password: owner.password,
      secondMobile: other.mobile,
      secondPassword: other.password,
      cases,
    };
    await writeFile(bindingFile, JSON.stringify(binding), { mode: 0o600 });
  }
  async function login(context, second = false) {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    activePage = page;
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    await page.addInitScript(() => {
      window.__prototypeErrors = [];
      window.addEventListener('error', (e) =>
        window.__prototypeErrors.push({ type: 'error', message: e.message, filename: e.filename }),
      );
      window.addEventListener('unhandledrejection', (e) =>
        window.__prototypeErrors.push({ type: 'rejection', message: String(e.reason) }),
      );
    });
    await page.route(
      /https?:\/\/[^/]*(?:openai|anthropic|openrouter|generativelanguage)[^/]*\//,
      (route) => {
        aiRequests.push(new URL(route.request().url()).hostname);
        return route.abort();
      },
    );
    await page.goto(origin + '/login');
    // Close the platform's dismissible preview notice through its own control;
    // it otherwise covers the workspace header and theme button on mobiles.
    const bannerClose = page.getByRole('button', { name: 'Close banner', exact: true });
    if (await bannerClose.count()) await bannerClose.click();
    await page.getByTestId('input-mobile').fill(second ? binding.secondMobile : binding.mobile);
    await page
      .getByTestId('input-password')
      .fill(second ? binding.secondPassword : binding.password);
    const [loginResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/auth/login')),
      page.getByTestId('button-login').click(),
    ]);
    assert.equal(
      loginResponse.status(),
      200,
      'Synthetic login did not succeed; respect rate-limit wait before rerunning',
    );
    await page.waitForURL(origin + '/');
    return page;
  }
  async function exercise(viewport, touch) {
    const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
    const page = await login(context);
    const caseId = binding.cases.reading.caseId;
    await page.goto(origin + `/cases/${caseId}`);
    await page.getByTestId('case-tabs').waitFor();
    await page.getByTestId('card-mock-report').waitFor();
    const apiSnapshot = () =>
      page.evaluate(async (id) => {
        const [operations, conversation] = await Promise.all([
          fetch(`/api/cases/${id}/analysis-operations`).then((r) => r.json()),
          fetch(`/api/cases/${id}`).then((r) => r.json()),
        ]);
        return { operations, conversation };
      }, caseId);
    const before = await apiSnapshot();
    const writes = [];
    page.on('request', (request) => {
      if (
        new URL(request.url()).pathname.startsWith('/api/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
      )
        writes.push(request.method() + ' ' + new URL(request.url()).pathname);
    });
    const click = (locator) => (touch ? locator.tap() : locator.click());
    const draft = `مسودة خيالية غير مرسلة لاختبار التبويبات ${touch ? 'جوال' : 'سطح المكتب'}`;
    await page.getByTestId('input-composer').fill(draft);
    const conversation = page.getByTestId('conversation');
    const setScroll = (locator, position) =>
      locator.evaluate((el, pos) => {
        el.scrollTop = pos;
        return el.scrollTop;
      }, position);
    const scroll = (locator) => locator.evaluate((el) => el.scrollTop);
    const c0 = await setScroll(conversation, 160);
    assert(c0 > 100);
    await click(page.getByTestId('tab-analysis'));
    const analysis = page.getByTestId('analysis-scroller');
    await page.getByTestId('analysis-prototype').waitFor({ state: 'visible' });
    assert.equal(
      await page.getByTestId('analysis-prototype').evaluate((el) => getComputedStyle(el).direction),
      'rtl',
    );
    assert.deepEqual(
      await page
        .locator('[data-section-id]')
        .evaluateAll((nodes) => nodes.map((el) => el.dataset.sectionId)),
      sectionIds,
    );
    for (const sid of sectionIds)
      assert.equal(
        await page.getByTestId(`button-toggle-section-${sid}`).getAttribute('aria-expanded'),
        String(sid === 'summary'),
      );
    assert.match(
      await page.getByTestId('text-version-current').innerText(),
      /الإصدار 3.*أحدث إصدار/,
    );
    await click(page.getByTestId('button-toggle-section-facts'));
    await click(page.getByTestId('button-toggle-section-evidence'));
    assert.equal(
      await page.getByTestId('button-toggle-section-summary').getAttribute('aria-expanded'),
      'true',
    );
    assert.equal(
      await page.getByTestId('button-toggle-section-facts').getAttribute('aria-expanded'),
      'true',
    );
    assert.equal(
      await page.getByTestId('button-toggle-section-evidence').getAttribute('aria-expanded'),
      'true',
    );
    const a0 = await setScroll(analysis, 180);
    await click(page.getByTestId('tab-conversation'));
    await page.waitForTimeout(80);
    assert(Math.abs((await scroll(conversation)) - c0) < 2);
    assert.equal(await page.getByTestId('input-composer').inputValue(), draft);
    await click(page.getByTestId('tab-analysis'));
    await page.waitForTimeout(80);
    assert(Math.abs((await scroll(analysis)) - a0) < 2);
    await click(page.getByTestId('tab-conversation'));
    const bottom = await conversation.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    await click(page.getByTestId('tab-analysis'));
    await click(page.getByTestId('tab-conversation'));
    await page.waitForTimeout(80);
    assert(
      Math.abs((await scroll(conversation)) - bottom) < 2,
      'Bottom position was lost after viewport height changed',
    );
    await click(page.getByTestId('tab-analysis'));
    pass(
      `${touch ? 'Mobile 390x844' : 'Desktop 1440x1000'}: RTL, section order/defaults, multiple expansion, middle/bottom scroll and unsent draft preserved`,
    );

    await click(page.getByTestId('button-version-v1'));
    assert.match(
      await page.getByTestId('text-version-current').innerText(),
      /الإصدار 1.*إصدار سابق/,
    );
    assert.match(await page.getByTestId('text-version-change').innerText(), /الإصدار الأول/);
    await click(page.getByTestId('button-version-v2'));
    const paragraph = await page.getByTestId('text-paragraph-facts-1').innerText();
    await click(page.getByTestId('button-paragraph-menu-facts-1'));
    for (const action of ['discuss', 'correct', 'note', 'evidence'])
      await page.getByTestId(`menuitem-${action}-facts-1`).waitFor({ state: 'visible' });
    await click(page.getByTestId('menuitem-note-facts-1'));
    assert.match(
      await page.getByTestId('text-preview-notice').innerText(),
      /غير متاح في النموذج التجريبي/,
    );
    await page.getByTestId('menu-paragraph-facts-1').waitFor({ state: 'hidden' });
    await click(page.getByTestId('button-paragraph-menu-facts-1'));
    await click(page.getByTestId('menuitem-discuss-facts-1'));
    await page.getByTestId('banner-discuss-preview').waitFor();
    assert.equal(await page.getByTestId('tab-conversation').getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByTestId('text-discuss-paragraph').innerText(), paragraph);
    assert.match(
      await page.getByTestId('text-discuss-version').innerText(),
      /الإصدار 2 \(تجريبي\)/,
    );
    assert.match(await page.getByTestId('text-discuss-ref').innerText(), /الوقائع.*الفقرة 1/);
    assert.equal(await page.getByTestId('input-composer').inputValue(), draft);
    await click(page.getByTestId('button-dismiss-discuss'));
    await click(page.getByTestId('tab-analysis'));
    await click(page.getByTestId('button-return-latest'));
    assert.match(
      await page.getByTestId('text-version-current').innerText(),
      /الإصدار 3.*أحدث إصدار/,
    );
    await click(page.getByTestId('button-source-preview-facts-1'));
    const dialog = page.getByTestId('dialog-source-preview');
    await dialog.waitFor({ state: 'visible' });
    assert.match(await dialog.innerText(), /لا يوجد مصدر موثق.*غير محدد/s);
    assert(!/المادة \d|صفحة \d/.test(await dialog.innerText()));
    assert(await dialog.evaluate((el) => el.matches(':modal')));
    const sourcePos = await scroll(analysis);
    await page.keyboard.press('Tab');
    assert(await dialog.evaluate((el) => el.contains(document.activeElement)));
    await click(page.getByTestId('button-close-source-preview'));
    await page.waitForTimeout(80);
    assert(Math.abs((await scroll(analysis)) - sourcePos) < 2);
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
      'button-source-preview-facts-1',
    );
    await click(page.getByTestId('button-source-preview-facts-1'));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await setScroll(analysis, 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: path.join(output, touch ? 'mobile-analysis.png' : 'desktop-analysis.png'),
    });
    await click(page.getByTestId('button-toggle-section-facts'));
    assert.equal(
      await page.getByTestId('button-toggle-section-facts').getAttribute('aria-expanded'),
      'false',
    );
    assert.deepEqual(
      await apiSnapshot(),
      before,
      'Prototype changed persisted operations or conversation',
    );
    assert.deepEqual(writes, [], 'Prototype issued backend writes');
    pass(
      `${touch ? 'Mobile' : 'Desktop'}: touch/click menus, exact paragraph/version discussion preview, versions, source placeholder/focus/scroll; zero backend writes and unchanged stored data`,
    );
    await click(page.getByTestId('tab-conversation'));
    await click(page.getByTestId('button-open-analysis'));
    assert.equal(await page.getByTestId('tab-analysis').getAttribute('aria-selected'), 'true');
    if (!touch) {
      await page.getByTestId('tab-analysis').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(
        await page.getByTestId('tab-conversation').getAttribute('aria-selected'),
        'true',
      );
    }
    await context.close();
  }
  if (!process.env.TEST_ONLY_RESPONSIVE) {
    if (process.env.TEST_VIEWPORT !== 'mobile')
      await exercise({ width: 1440, height: 1000 }, false);
    await exercise({ width: 390, height: 844 }, true);
  }

  // Shared-component responsive checks. Chromium viewport resizing is not
  // equivalent to real iOS Safari browser chrome or its on-screen keyboard.
  if (!process.env.TEST_ONLY_CORE) {
    const responsiveContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const responsive = await login(responsiveContext);
    await responsive.goto(origin + `/cases/${binding.cases.reading.caseId}`);
    await responsive.getByTestId('tab-analysis').click();
    await responsive.getByTestId('analysis-prototype').waitFor({ state: 'visible' });
    for (const sid of sectionIds.slice(1))
      await responsive.getByTestId(`button-toggle-section-${sid}`).click();
    const responsiveWrites = [];
    responsive.on('request', (req) => {
      if (
        new URL(req.url()).pathname.startsWith('/api/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method())
      )
        responsiveWrites.push(req.method());
    });
    const dimensions = [
      [320, 568],
      [375, 667],
      [390, 844],
      [430, 932],
      [844, 390],
      [768, 1024],
      [1024, 768],
      [1440, 1000],
      [1920, 1080],
    ];
    async function usableViewport(page) {
      return page.evaluate(() => {
        const vv = window.visualViewport;
        return {
          x: vv?.offsetLeft ?? 0,
          y: vv?.offsetTop ?? 0,
          width: vv?.width ?? innerWidth,
          height: vv?.height ?? innerHeight,
        };
      });
    }
    async function fitsViewport(page, locator, name) {
      const box = await locator.boundingBox(),
        vv = await usableViewport(page);
      assert(box && box.width > 0 && box.height > 0, `${name} has no usable geometry`);
      assert(
        box.x >= vv.x - 1 &&
          box.y >= vv.y - 1 &&
          box.x + box.width <= vv.x + vv.width + 1 &&
          box.y + box.height <= vv.y + vv.height + 1,
        `${name} clips outside usable visual viewport: ${JSON.stringify({ box, vv })}`,
      );
    }
    async function menuGeometry(pid, targetY, touch = true) {
      const scroller = responsive.getByTestId('analysis-scroller'),
        trigger = responsive.getByTestId(`button-paragraph-menu-${pid}`);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.evaluate((el, y) => {
        const pane = document.querySelector('[data-testid="analysis-scroller"]');
        pane.scrollTop += el.getBoundingClientRect().top - y;
      }, targetY);
      const triggerPosition = await trigger.boundingBox();
      if (touch) await trigger.tap();
      else {
        await trigger.focus();
        await responsive.keyboard.press('Enter');
      }
      const menu = responsive.getByTestId(`menu-paragraph-${pid}`);
      await menu.waitFor({ state: 'visible' });
      await responsive.waitForTimeout(180);
      await fitsViewport(responsive, menu, `menu ${pid}`);
      assert(
        await menu.evaluate(
          (el) =>
            el.closest('dialog')?.matches(':modal') ||
            !el.closest('[data-testid="analysis-scroller"]'),
        ),
        'Menu lacks portal/native top-layer isolation from report scrolling',
      );
      for (const action of ['discuss', 'correct', 'note', 'evidence']) {
        const item = responsive.getByTestId(`menuitem-${action}-${pid}`);
        await item.scrollIntoViewIfNeeded();
        await fitsViewport(responsive, item, `${pid}/${action}`);
        assert((await item.boundingBox()).height >= 43, 'Menu touch target too small');
        const itemBox = await item.boundingBox(),
          menuBox = await menu.boundingBox();
        assert(
          itemBox.y >= menuBox.y - 1 &&
            itemBox.y + itemBox.height <= menuBox.y + menuBox.height + 1,
          'Item remains clipped by overlay scroll area',
        );
      }
      await responsive.keyboard.press('ArrowDown');
      assert(
        await menu.evaluate((el) => el.contains(document.activeElement)),
        'Keyboard focus left menu',
      );
      if (pid === 'conclusions-1') {
        await responsive.screenshot({
          path: path.join(
            output,
            `menu-${(await responsive.viewportSize()).width}x${(await responsive.viewportSize()).height}.png`,
          ),
        });
      }
      await responsive.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
      await responsive.waitForFunction(
        (pid) =>
          document.activeElement?.getAttribute('data-testid') === `button-paragraph-menu-${pid}`,
        pid,
      );
      assert.equal(
        await responsive.evaluate(() => document.activeElement?.getAttribute('data-testid')),
        `button-paragraph-menu-${pid}`,
      );
      return triggerPosition;
    }
    for (const [width, height] of dimensions) {
      await responsive.setViewportSize({ width, height });
      await responsive.waitForTimeout(100);
      for (const [pid, y] of [
        ['summary-1', 130],
        ['evidence-1', height / 2],
        ['conclusions-1', height - 64],
      ])
        await menuGeometry(pid, y);
      assert(
        await responsive.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Unexpected page horizontal scrolling',
      );
      assert(
        await responsive
          .getByTestId('analysis-scroller')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        'Report overflows horizontally',
      );
      const sourceButton = responsive.getByTestId('button-source-preview-conclusions-1');
      await sourceButton.click();
      await fitsViewport(
        responsive,
        responsive.getByTestId('dialog-source-preview'),
        'source dialog',
      );
      if (width === 390)
        await responsive.screenshot({ path: path.join(output, 'source-mobile.png') });
      await responsive.getByTestId('button-close-source-preview').click();
      await responsive.getByTestId('analysis-scroller').evaluate((el) => {
        el.scrollTop = 0;
      });
      if ([390, 1440, 1920].includes(width)) {
        await responsive.screenshot({ path: path.join(output, `layout-${width}-light.png`) });
        await responsive.getByTestId('button-theme').click();
        await responsive.screenshot({ path: path.join(output, `layout-${width}-dark.png`) });
        await menuGeometry('conclusions-1', height - 64, false);
        await responsive.getByTestId('button-theme').click();
      }
      pass(
        `Responsive ${width}x${height}: top/middle/bottom menu geometry, all four reachable items, portal/keyboard/Escape/focus, source bounds and no horizontal overflow`,
      );
    }
    // Resize an already-open overlay and verify each item remains reachable.
    await responsive.setViewportSize({ width: 390, height: 844 });
    await responsive.getByTestId('button-paragraph-menu-conclusions-1').click();
    await responsive.setViewportSize({ width: 390, height: 320 });
    const shrinkingMenu = responsive.getByTestId('menu-paragraph-conclusions-1');
    await responsive.waitForTimeout(250);
    await fitsViewport(responsive, shrinkingMenu, 'menu after visual viewport resize');
    for (const action of ['discuss', 'correct', 'note', 'evidence']) {
      const item = responsive.getByTestId(`menuitem-${action}-conclusions-1`);
      await item.scrollIntoViewIfNeeded();
      await fitsViewport(responsive, item, 'resized menu item');
    }
    await responsive.keyboard.press('Escape');
    await responsive.getByTestId('button-source-preview-conclusions-1').click();
    await responsive.setViewportSize({ width: 320, height: 260 });
    await responsive.waitForTimeout(100);
    await fitsViewport(
      responsive,
      responsive.getByTestId('dialog-source-preview'),
      'source after viewport shrink',
    );
    await responsive.getByTestId('button-close-source-preview').scrollIntoViewIfNeeded();
    await responsive.getByTestId('button-close-source-preview').click();
    await responsive.getByTestId('tab-conversation').click();
    const wrappedDraft = 'نص عربي طويل '.repeat(22) + 'contract-مستند-English-2026.docx';
    await responsive.getByTestId('input-composer').fill(wrappedDraft);
    await fitsViewport(
      responsive,
      responsive.getByTestId('composer'),
      'composer under keyboard-size viewport',
    );
    await fitsViewport(
      responsive,
      responsive.getByTestId('button-send'),
      'send button under keyboard-size viewport',
    );
    assert(await responsive.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await responsive.setViewportSize({ width: 390, height: 844 });
    assert.equal(await responsive.getByTestId('input-composer').inputValue(), wrappedDraft);
    assert.deepEqual(responsiveWrites, []);
    pass(
      'Open-overlay resize/short-height scroll reachability; long Arabic/mixed text composer remains usable without writes',
    );
    await responsiveContext.close();

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await login(context);
    const caseId = binding.cases.ordinary.caseId;
    await page.goto(origin + `/cases/${caseId}`);
    await page.getByTestId('case-tabs').waitFor();
    const aiExecutions = [];
    page.on('request', (request) => {
      if (
        /analysis|discuss|clarification|regenerate/.test(new URL(request.url()).pathname) &&
        request.method() !== 'GET'
      )
        aiExecutions.push(new URL(request.url()).pathname);
    });
    const filename = 'عقد-Contract-English-2026-اسم-طويل-للمستند-التجريبي.txt';
    await page.getByTestId('input-file').setInputFiles({
      name: filename,
      mimeType: 'text/plain',
      buffer: Buffer.from('Fictional development attachment. No AI processing.'),
    });
    const queue = page.getByTestId('composer-attachments');
    await queue.getByRole('button', { name: `إزالة ${filename}` }).waitFor();
    await page
      .getByTestId('input-composer')
      .fill('رسالة عادية خيالية لاختبار المرفقات — دون تحليل');
    await page.getByTestId('tab-analysis').tap();
    await page.getByTestId('tab-conversation').tap();
    assert((await queue.innerText()).includes(filename));
    const savedResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/cases/${caseId}/messages`) &&
        r.request().method() === 'POST' &&
        r.status() === 200,
    );
    await page.getByTestId('button-send').tap();
    const message = await (await savedResponse).json();
    assert.equal(message.attachments.length, 1);
    const download = page.getByTestId(`link-attachment-${message.attachments[0].id}`);
    await download.waitFor();
    const fileResponse = await context.request.get(
      new URL(await download.getAttribute('href'), origin).href,
    );
    assert.equal(fileResponse.status(), 200);
    assert.equal(await fileResponse.text(), 'Fictional development attachment. No AI processing.');
    await page.reload();
    await download.waitFor();
    assert.equal(await page.getByTestId('input-composer').inputValue(), '');
    assert.deepEqual(aiExecutions, []);
    pass(
      'Existing ordinary chat: real small attachment upload survives tab switch, sends once, downloads exact bytes and reload restores message; no analysis execution',
    );
    await context.close();

    const foreignContext = await browser.newContext();
    const foreign = await login(foreignContext, true);
    await foreign.goto(origin + `/cases/${binding.cases.reading.caseId}`);
    await foreign.getByTestId('text-case-not-found').waitFor();
    assert.equal(await foreign.getByTestId('case-tabs').count(), 0);
    assert.equal(await foreign.getByTestId('analysis-prototype').count(), 0);
    await foreignContext.close();
    pass('Foreign case: no mock report or tabs exposed');
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(aiRequests, []);
  await writeFile(
    path.join(
      output,
      process.env.TEST_ONLY_CORE ? 'core-browser-tests.json' : 'browser-tests.json',
    ),
    JSON.stringify({ checks, pageErrors, aiRequests, paidRequests: 0 }, null, 2),
  );
  console.log(`Completed ${checks.length} focused browser groups.`);
} catch (error) {
  let message = error instanceof Error ? error.message : 'Unknown error';
  for (const secret of [
    binding?.password,
    binding?.secondPassword,
    binding?.mobile,
    binding?.secondMobile,
  ])
    if (secret) message = message.split(secret).join('[redacted]');
  console.error(message.slice(0, 2400));
  console.error(JSON.stringify({ pageErrors }));
  if (activePage && !activePage.isClosed()) {
    console.error(JSON.stringify(await activePage.evaluate(() => window.__prototypeErrors)));
    console.error(
      await activePage.evaluate(
        () =>
          document.querySelector('vite-error-overlay')?.shadowRoot?.textContent?.slice(-1800) ??
          'No error overlay',
      ),
    );
    await activePage.screenshot({ path: path.join(output, 'failure.png') });
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}

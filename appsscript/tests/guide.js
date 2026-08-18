const { chromium } = require('/home/user/Team-5-Circles-/node_modules/playwright-core');
const URL = 'file:///home/user/Team-5-Circles-/standalone/5c-pulse.html';

let pass = 0, fail = 0;
const ok = (label, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); cond ? pass++ : fail++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(800);

  ok('hero title', await page.getByRole('heading', { name: '5C Pulse' }).isVisible());
  ok('logo renders', (await page.locator('header.hero img').boundingBox()).width > 30);
  ok('six steps present', (await page.locator('.step').count()) === 6);
  ok('deploy settings named', await page.getByText('Who has access:', { exact: true }).isVisible());

  /* the embedded demo boots inside its iframe */
  const demo = page.frameLocator('.browser iframe');
  await demo.locator('#scrSetup:not(.hide)').waitFor({ timeout: 10000 });
  ok('demo iframe boots to welcome screen', true);
  await demo.locator('#suName').fill('Guide Tester');
  await demo.locator('#suGo').click();
  await demo.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  const pin = (await demo.locator('#pvPin').textContent()).trim();
  ok('demo setup works inside the guide (' + pin + ')', /^\d{4}$/.test(pin));
  await demo.locator('#pvOk').click();
  await demo.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  ok('demo app opens inside the guide', true);

  /* copy button carries the real file */
  await page.locator('#copyCode').click();
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('copy file 1 puts Code.gs on the clipboard', /5C PULSE · server/.test(clip) && /function api\(/.test(clip));
  await page.locator('#copyIndex').click();
  await page.waitForTimeout(400);
  const clip2 = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('copy file 2 puts index.html on the clipboard', /5C PULSE · client/.test(clip2) && /google\.script\.run/.test(clip2));

  /* no horizontal scroll, desktop + mobile */
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal scroll at 1280px (' + overflow + ')', overflow <= 1);
  await page.screenshot({ path: '/tmp/5cpg/shots2/guide-top.png' });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(400);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal scroll at 375px (' + overflow + ')', overflow <= 1);
  await page.screenshot({ path: '/tmp/5cpg/shots2/guide-mobile.png' });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 6).join('\n') : 'No console/page errors.');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('CRASH: ' + e.message); process.exit(2); });

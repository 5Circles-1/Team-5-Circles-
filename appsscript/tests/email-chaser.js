/**
 * 5C Pulse — email bridge suite.
 * A ring for someone away from the app knocks on their inbox (throttled),
 * and the evening chaser trigger emails whoever hasn't filed that day —
 * all against the REAL Code.gs on the fake Google, outbox in the fake db.
 */
const { chromium } = require('/home/user/Team-5-Circles-/node_modules/playwright-core');
const URL = 'file:///home/user/Team-5-Circles-/appsscript/demo.html?fast';

let pass = 0, fail = 0;
const ok = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  cond ? pass++ : fail++;
};

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 } });
  const errors = [];
  const A = await ctx.newPage();
  A.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  A.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const outbox = () => A.evaluate(() => (JSON.parse(localStorage.getItem('5cp2_db')).outbox || []));
  const triggers = () => A.evaluate(() => (JSON.parse(localStorage.getItem('5cp2_db')).triggers || []));

  await A.goto(URL);
  await A.locator('#scrSetup:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#suName').fill('Rahul');
  await A.locator('#suGo').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#pvOk').click();
  await A.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });

  /* Dev is added with an email and never signs in — the "away" person */
  await A.locator('#tabs button[data-tab="team"]').click();
  await A.locator('#npName').fill('Dev');
  await A.locator('#npMail').fill('dev@example.com');
  await A.locator('#npAdd').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#pvOk').click();
  const devCard = A.locator('.pcard', { hasText: 'Dev' });
  await devCard.waitFor({ timeout: 8000 });
  ok('email stored and shown on the card', (await devCard.locator('[data-mailin]').inputValue()) === 'dev@example.com');

  /* a ring to someone away lands in their inbox */
  await A.locator('#tabs button[data-tab="chat"]').click();
  await A.locator('#chatChips button', { hasText: 'Dev' }).click();
  await A.locator('#chatText').fill('Call me when you see this');
  await A.locator('#chatRing').click();
  await A.locator('#veilAsk:not(.hide)').waitFor({ timeout: 4000 });
  await A.locator('#askYes').click();
  await A.waitForTimeout(800);
  let mails = await outbox();
  ok('away ring sends exactly one email', mails.length === 1);
  ok('to the right inbox', mails[0] && mails[0].to === 'dev@example.com');
  ok('subject names who is ringing', /Rahul needs you/.test(mails[0] && mails[0].subject));
  ok('body carries the message and the app link',
    /Call me when you see this/.test(mails[0] && mails[0].body) && /demo\.html/.test(mails[0] && mails[0].body));

  /* a second ring straight after is throttled — the first email said it all */
  await A.locator('#chatText').fill('Second ring right away');
  await A.locator('#chatRing').click();
  await A.locator('#veilAsk:not(.hide)').waitFor({ timeout: 4000 });
  await A.locator('#askYes').click();
  await A.waitForTimeout(800);
  mails = await outbox();
  ok('second ring within minutes sends no second email', mails.length === 1);

  /* a nudge is a ring too — same inbox rule, same throttle */
  await A.locator('#tabs button[data-tab="updates"]').click();
  await A.locator('.pendchip', { hasText: 'Dev' }).locator('[data-nud]').click();
  await A.locator('#veilAsk:not(.hide)').waitFor({ timeout: 4000 });
  await A.locator('#askYes').click();
  await A.waitForTimeout(800);
  mails = await outbox();
  ok('nudge respects the same throttle', mails.length === 1);

  /* a bad email is refused, kindly */
  await A.locator('#tabs button[data-tab="team"]').click();
  await devCard.locator('[data-mailin]').fill('not-an-email');
  await devCard.locator('[data-act="mailsave"]').click();
  await A.locator('#toast:not(.hide)').waitFor({ timeout: 4000 });
  ok('bad email is refused', /doesn’t look right/.test(await A.locator('#toast').textContent()));

  /* the evening chaser: set, fire, respect who has filed */
  await A.locator('#chTime').fill('19:30');
  await A.locator('#chSave').click();
  await A.waitForTimeout(800);
  let trs = await triggers();
  ok('reminder creates one clock trigger', trs.length === 1 && trs[0].handler === 'eveningChase');
  ok('turn-off button appears', await A.locator('#chOff').isVisible());
  ok('the row says when it runs', /19:30/.test(await A.locator('#chInfo').textContent()));

  await A.evaluate(() => { eveningChase(); });
  mails = await outbox();
  ok('chaser emails the one pending person with an email', mails.length === 2);
  ok('chaser email says the update is waiting', /update is waiting/.test(mails[1] && mails[1].subject) && mails[1].to === 'dev@example.com');

  /* someone who filed is left alone — Rahul gets an email address, files, fires again */
  const meCard = A.locator('.pcard', { hasText: 'Rahul' });
  await meCard.locator('[data-mailin]').fill('rahul@example.com');
  await meCard.locator('[data-act="mailsave"]').click();
  await A.waitForTimeout(600);
  await A.locator('#tabs button[data-tab="updates"]').click();
  await A.locator('#myUpdate button[data-mood="ok"]').click();
  await A.locator('#updShare').click();
  await A.locator('#updChange').waitFor({ timeout: 8000 });
  await A.evaluate(() => { eveningChase(); });
  mails = await outbox();
  const toRahul = mails.filter(m => m.to === 'rahul@example.com').length;
  ok('chaser skips whoever already filed', toRahul === 0 && mails.length === 3);

  /* off means off */
  await A.locator('#tabs button[data-tab="team"]').click();
  await A.locator('#chOff').click();
  await A.waitForTimeout(800);
  trs = await triggers();
  ok('turning the reminder off deletes the trigger', trs.length === 0);

  /* adding someone with a bad email never creates them */
  await A.locator('#npName').fill('Typo');
  await A.locator('#npMail').fill('typo@nowhere');
  await A.locator('#npAdd').click();
  await A.locator('#toast:not(.hide)').waitFor({ timeout: 4000 });
  ok('add-someone refuses a bad email', /doesn’t look right/.test(await A.locator('#toast').textContent()));
  ok('and the person is not created', (await A.locator('.pcard').count()) === 2);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log('  ' + e)); }
  else console.log('No console/page errors.');
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

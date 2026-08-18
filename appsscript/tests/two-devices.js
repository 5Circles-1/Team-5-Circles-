/**
 * 5C Pulse (Apps Script rebuild) — two-device integration test.
 * Runs the REAL Code.gs server + REAL index.html client via demo.html,
 * with two tabs acting as two people's devices (shared fake DB in
 * localStorage, per-tab tokens in sessionStorage).
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
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const errors = [];
  const wire = (page, tag) => {
    page.on('pageerror', e => errors.push(tag + ' PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(tag + ' CONSOLE: ' + m.text()); });
  };

  /* ════ Tab A — the admin ════ */
  const A = await ctx.newPage(); wire(A, 'A');
  await A.goto(URL);

  // sha256 fake sanity (known answer for "abc")
  const digest = await A.evaluate(() =>
    window.__sha256('abc').map(b => (b < 16 ? '0' : '') + b.toString(16)).join(''));
  ok('fake sha256 matches known vector', digest === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  ok('demo bar shows', await A.locator('#demobar').isVisible());
  await A.locator('#scrSetup:not(.hide)').waitFor({ timeout: 8000 });
  ok('first run shows the welcome screen', true);
  ok('company prefilled "5 Circles"', await A.locator('#suCompany').inputValue() === '5 Circles');

  await A.locator('#suName').fill('Aisha Verma');
  await A.locator('#suGo').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  const adminPin = (await A.locator('#pvPin').textContent()).trim();
  ok('admin gets a 4-digit PIN once (' + adminPin + ')', /^\d{4}$/.test(adminPin));
  await A.locator('#pvOk').click();

  await A.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  ok('app opens after setup', true);
  ok('header shows company', (await A.locator('#hdCo').textContent()) === '5 Circles');
  const logoBox = await A.locator('header.top img.logo').boundingBox();
  ok('5 Circles logo renders (' + Math.round(logoBox ? logoBox.width : 0) + 'px)', !!logoBox && logoBox.width > 20);
  ok('empty state invites the first task', await A.getByText('No tasks yet').isVisible());

  /* add Sanya */
  await A.locator('#tabs button[data-tab="team"]').click();
  await A.locator('#npName').fill('Sanya');
  await A.locator('#npDept').fill('Sales');
  await A.locator('#npAdd').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  const sanyaPin = (await A.locator('#pvPin').textContent()).trim();
  ok('Sanya added, PIN shown once (' + sanyaPin + ')', /^\d{4}$/.test(sanyaPin));
  await A.locator('#pvOk').click();
  await A.waitForTimeout(300);
  ok('team list shows 2 people', (await A.locator('.pcard').count()) === 2);

  /* give Sanya a task, with a ring */
  await A.locator('#fabTask').click();
  await A.locator('#tkWho .face', { hasText: 'Sanya' }).click();
  await A.locator('#tkTitle').fill('Call the Mehta family back');
  await A.locator('#tkRing').check();
  await A.locator('#tkGo').click();
  await A.waitForTimeout(500);
  await A.locator('#tabs button[data-tab="tasks"]').click();
  ok('task listed under "What I’ve given out"', await A.getByText('Call the Mehta family back').first().isVisible());

  /* ════ Tab B — Sanya's device ════ */
  const B = await ctx.newPage(); wire(B, 'B');
  await B.goto(URL);
  await B.locator('#scrLogin:not(.hide)').waitFor({ timeout: 8000 });
  ok('B: login screen with face grid', true);
  ok('B: two faces to pick from', (await B.locator('#loginFaces .face').count()) === 2);

  await B.locator('#loginFaces .face', { hasText: 'Sanya' }).click();
  for (const d of sanyaPin) await B.locator('#pinPad button[data-k="' + d + '"]').click();
  await B.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  ok('B: Sanya signs in with her PIN', true);

  /* the ring that came with the task takes over her screen */
  await B.locator('#alarm:not(.hide)').waitFor({ timeout: 8000 });
  ok('B: ring takes over the screen on login', true);
  const alText = await B.locator('#alText').textContent();
  ok('B: alarm carries the task ("' + alText.slice(0, 40) + '…")', /Call the Mehta/.test(alText));
  ok('B: alarm names the sender', /Aisha/.test(await B.locator('#alFrom').textContent()));
  await B.screenshot({ path: '/tmp/5cpg/shots2/alarm.png' });
  await B.locator('#alarm .ans button[data-ans="On it 👍"]').click();
  await B.waitForTimeout(400);
  ok('B: answering clears the alarm', await B.locator('#alarm').isHidden());

  ok('B: task shows under "My work"', await B.getByText('Call the Mehta family back').first().isVisible());
  const bdg = await B.locator('#bdgTasks').textContent();
  ok('B: tasks badge shows 1 open (' + bdg + ')', bdg.trim() === '1');

  /* A sees the answer in the task's comment thread */
  await A.locator('.task .linkbtn[data-act="cmt"]').first().click();
  await A.locator('.ackline').first().waitFor({ timeout: 8000 });
  ok('A: sees "Sanya: On it 👍" on the task', /Sanya: On it/.test(await A.locator('.ackline').first().textContent()));

  /* status flows across devices */
  await B.locator('.task .seg button[data-st="Doing"]').first().click();
  await A.locator('.task.s-doing').first().waitFor({ timeout: 10000 });
  ok('A: sees the task move to Doing', true);

  /* stuck rings the giver */
  await B.locator('.task .linkbtn[data-act="stuck"]').first().click();
  await A.locator('#alarm:not(.hide)').waitFor({ timeout: 10000 });
  ok('A: stuck rings the giver’s screen', /STUCK on: Call the Mehta/.test(await A.locator('#alText').textContent()));
  await A.locator('#alarm .ans button[data-ans="Give me 10 minutes"]').click();
  await A.waitForTimeout(400);
  ok('A: alarm answered and cleared', await A.locator('#alarm').isHidden());

  /* comment thread on the task */
  await B.locator('.task .linkbtn[data-act="cmt"]').first().click();
  await B.locator('[data-cmtin]').first().fill('The number was busy, trying again at 4');
  await B.locator('.task .linkbtn[data-act="cmtsend"], .task button[data-act="cmtsend"]').first().click();
  await A.getByText('The number was busy').first().waitFor({ timeout: 10000 });
  ok('A: task comment arrives on record', true);

  /* team chat */
  await B.locator('#tabs button[data-tab="chat"]').click();
  await B.locator('#chatText').fill('Good morning team');
  await B.locator('#chatSend').click();
  await B.waitForTimeout(400);
  ok('B: message appears in Everyone', await B.locator('#chatLog .msg .bub', { hasText: 'Good morning team' }).isVisible());

  await A.locator('#bdgChat:not(.hide)').waitFor({ timeout: 10000 });
  ok('A: chat badge lights up', true);
  await A.locator('#tabs button[data-tab="chat"]').click();
  ok('A: sees the message with Sanya’s name', await A.locator('#chatLog .msg', { hasText: 'Good morning team' }).isVisible());
  await A.waitForTimeout(300);
  ok('A: opening chat clears the badge', await A.locator('#bdgChat').isHidden());

  /* ring through chat, admin → Sanya */
  await A.locator('#chatChips button', { hasText: 'Sanya' }).click();
  await A.locator('#chatText').fill('Need you at the front desk');
  await A.locator('#chatRing').click();
  await A.locator('#veilAsk:not(.hide)').waitFor({ timeout: 4000 });
  ok('A: ring asks for confirmation first', /keeps ringing until they answer/.test(await A.locator('#askText').textContent()));
  await A.locator('#askYes').click();
  await B.locator('#alarm:not(.hide)').waitFor({ timeout: 10000 });
  ok('B: chat ring takes over Sanya’s screen', /front desk/.test(await B.locator('#alText').textContent()));
  await B.locator('#alarm .ans button[data-ans="On it 👍"]').click();
  await B.waitForTimeout(400);

  /* B reload keeps the session (per-tab token) */
  await B.reload();
  await B.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  ok('B: reload keeps Sanya signed in', true);

  /* screenshots while everything is lively */
  await A.locator('#tabs button[data-tab="tasks"]').click();
  await A.waitForTimeout(300);
  await A.screenshot({ path: '/tmp/5cpg/shots2/admin-tasks.png' });
  await B.setViewportSize({ width: 375, height: 780 });
  await B.waitForTimeout(400);
  const overflow = await B.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('B: no horizontal scroll at 375px (overflow ' + overflow + 'px)', overflow <= 1);
  await B.screenshot({ path: '/tmp/5cpg/shots2/mobile-tasks.png' });
  await B.locator('#tabs button[data-tab="chat"]').click();
  await B.waitForTimeout(300);
  await B.screenshot({ path: '/tmp/5cpg/shots2/mobile-chat.png' });
  await B.setViewportSize({ width: 1180, height: 900 });

  /* PIN reset signs the old device out */
  await A.locator('#tabs button[data-tab="team"]').click();
  await A.locator('.pcard', { hasText: 'Sanya' }).locator('[data-act="pin"]').click();
  await A.locator('#askYes').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  const sanyaPin2 = (await A.locator('#pvPin').textContent()).trim();
  ok('A: reset gives a fresh PIN (' + sanyaPin2 + ')', /^\d{4}$/.test(sanyaPin2) );
  await A.locator('#pvOk').click();

  await B.locator('#scrLogin:not(.hide)').waitFor({ timeout: 15000 });
  ok('B: old device is signed out after the reset', true);
  await B.locator('#loginFaces .face', { hasText: 'Sanya' }).click();
  for (const d of sanyaPin2) await B.locator('#pinPad button[data-k="' + d + '"]').click();
  await B.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  ok('B: new PIN signs her back in', true);

  /* company rename reaches everyone */
  await A.locator('#coEdit').fill('Five Circles');
  await A.locator('#coSave').click();
  await B.waitForFunction(() => document.getElementById('hdCo').textContent === 'Five Circles', null, { timeout: 10000 });
  ok('B: company rename reaches the other device', true);

  /* remove a person — their open tasks come to the admin */
  await A.locator('#npName').fill('Ravi');
  await A.locator('#npAdd').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#pvOk').click();
  await A.locator('#fabTask').click();
  await A.locator('#tkWho .face', { hasText: 'Ravi' }).click();
  await A.locator('#tkTitle').fill('Order new banners');
  await A.locator('#tkGo').click();
  await A.waitForTimeout(500);
  await A.locator('#tabs button[data-tab="team"]').click();
  await A.locator('.pcard', { hasText: 'Ravi' }).locator('[data-act="rm"]').click();
  ok('A: remove asks first, mentions the tasks', /open tasks move to you/.test(await A.locator('#askText').textContent()));
  await A.locator('#askYes').click();
  await A.waitForTimeout(600);
  ok('A: team back to 2 cards', (await A.locator('.pcard').count()) === 2);
  await A.locator('#tabs button[data-tab="tasks"]').click();
  await A.getByText('Order new banners').first().waitFor({ timeout: 8000 });
  const myWork = await A.locator('#taskSections').textContent();
  ok('A: Ravi’s open task moved to the admin', /Order new banners/.test(myWork));

  /* data level: soft delete + reassignment really hit the "sheet" */
  const db = await A.evaluate(() => JSON.parse(localStorage.getItem('5cp2_db')));
  const people = db.sheets.People.slice(1);
  const tasks = db.sheets.Tasks.slice(1);
  ok('sheet keeps all 3 people (soft delete)', people.length === 3);
  const ravi = people.find(r => r[1] === 'Ravi');
  ok('sheet marks Ravi inactive, history kept', ravi && String(ravi[7]) === 'false');
  const banners = tasks.find(r => r[1] === 'Order new banners');
  const aisha = people.find(r => r[1] === 'Aisha Verma');
  ok('sheet shows the task now owned by the admin', banners && banners[3] === aisha[0]);
  ok('sheet stores no plain PINs anywhere',
    !JSON.stringify(db.sheets.People).includes(adminPin) || /^\d{4}$/.test('x'));

  /* five wrong PINs lock the login */
  const C = await ctx.newPage(); wire(C, 'C');
  await C.goto(URL);
  await C.locator('#scrLogin:not(.hide)').waitFor({ timeout: 8000 });
  await C.locator('#loginFaces .face', { hasText: 'Sanya' }).click();
  for (let i = 0; i < 5; i++) {
    for (const d of '9999') await C.locator('#pinPad button[data-k="' + d + '"]').click();
    await C.waitForTimeout(250);
  }
  ok('C: wrong PIN says so kindly', /Wrong PIN/.test(await C.locator('#pinErr').textContent()));
  for (const d of '9999') await C.locator('#pinPad button[data-k="' + d + '"]').click();
  await C.waitForTimeout(300);
  ok('C: sixth try is locked out', /Too many wrong tries/.test(await C.locator('#pinErr').textContent()));

  /* demo reset returns to first-run */
  await C.locator('#demoReset').click();
  await C.locator('#scrSetup:not(.hide)').waitFor({ timeout: 8000 });
  ok('C: demo reset returns to the welcome screen', true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (errors.length) console.log('\nERRORS:\n' + errors.slice(0, 10).join('\n'));
  else console.log('No console/page errors.');
  await browser.close();
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error('SUITE CRASH: ' + (e && e.message ? e.message : e)); process.exit(2); });

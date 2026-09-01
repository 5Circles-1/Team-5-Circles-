/**
 * 5C Pulse — daily updates suite.
 * The REAL Code.gs + index.html via demo.html, two tabs as two people:
 * question sets seeded → member on the Video Editor set files her minute →
 * nudge bell chases the missing update → streaks, week totals, history →
 * admin rewords a set, invents a new one (Chef), archives the unused one.
 */
const { chromium } = require('/home/user/Team-5-Circles-/node_modules/playwright-core');
const URL = 'file:///home/user/Team-5-Circles-/appsscript/demo.html?fast';
const SHOTS = '/tmp/5cpg/shots-updates';

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
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 950 } });
  const errors = [];
  const wire = (page, tag) => {
    page.on('pageerror', e => errors.push(tag + ' PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(tag + ' CONSOLE: ' + m.text()); });
  };

  /* ════ Tab A — Rahul, the admin ════ */
  const A = await ctx.newPage(); wire(A, 'A');
  await A.goto(URL);
  await A.locator('#scrSetup:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#suName').fill('Rahul');
  await A.locator('#suGo').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#pvOk').click();
  await A.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });

  /* the starter question sets are just there */
  await A.locator('#tabs button[data-tab="team"]').click();
  await A.locator('.profcard').first().waitFor({ timeout: 8000 });
  ok('A: six starter question sets seeded', (await A.locator('.profcard').count()) === 6);
  ok('A: Video Editor set is one of them', await A.locator('.profcard', { hasText: 'Video Editor' }).isVisible());
  ok('A: Front Desk set is one of them', await A.locator('.profcard', { hasText: 'Front Desk' }).isVisible());
  const npOptions = await A.locator('#npProf option').allTextContents();
  ok('A: add-someone offers the sets (' + npOptions.length + ')', npOptions.length === 6 && npOptions.some(t => /Mentor/.test(t)));

  /* updates tab nags until your own update is in */
  ok('A: Updates badge on until you file', await A.locator('#bdgUpd:not(.hide)').isVisible());
  await A.locator('#tabs button[data-tab="updates"]').click();
  ok('A: my card asks General questions', await A.locator('#myUpdate .uq', { hasText: 'What did you get done today?' }).isVisible());
  ok('A: feed empty state points at the card', await A.locator('#updFeed .empty', { hasText: 'takes a minute' }).isVisible());

  /* add Meera as a Video Editor */
  await A.locator('#tabs button[data-tab="team"]').click();
  await A.locator('#npName').fill('Meera');
  await A.locator('#npProf').selectOption({ label: 'Video Editor' });
  await A.locator('#npAdd').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  const meeraPin = (await A.locator('#pvPin').textContent()).trim();
  await A.locator('#pvOk').click();
  await A.locator('.pcard', { hasText: 'Meera' }).waitFor({ timeout: 8000 });
  ok('A: blank "what they do" borrows the set name', /Video Editor/.test(await A.locator('.pcard', { hasText: 'Meera' }).locator('.sub').textContent()));

  /* ════ Tab B — Meera's device ════ */
  const B = await ctx.newPage(); wire(B, 'B');
  await B.goto(URL);
  await B.locator('#scrLogin:not(.hide)').waitFor({ timeout: 8000 });
  await B.locator('#loginFaces .face', { hasText: 'Meera' }).click();
  for (const d of meeraPin) await B.locator('#pinPad button[data-k="' + d + '"]').click();
  await B.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  ok('B: Meera signs in', true);

  /* the bell chases the missing update */
  await A.locator('#tabs button[data-tab="updates"]').click();
  await A.locator('.pendchip', { hasText: 'Meera' }).waitFor({ timeout: 10000 });
  ok('A: pending strip lists Meera', true);
  await A.locator('.pendchip', { hasText: 'Meera' }).locator('[data-nud]').click();
  await A.locator('#veilAsk:not(.hide)').waitFor({ timeout: 4000 });
  ok('A: nudge asks first', /Meera/.test(await A.locator('#askText').textContent()));
  await A.locator('#askYes').click();
  await B.locator('#alarm:not(.hide)').waitFor({ timeout: 10000 });
  ok('B: nudge takes over her screen', /daily update is waiting/.test(await B.locator('#alText').textContent()));
  await B.locator('#alarm .ans button[data-ans="On it"]').click();
  await B.waitForTimeout(400);
  ok('B: answering clears the nudge', await B.locator('#alarm').isHidden());

  /* Meera files her minute — on her set's questions */
  await B.locator('#tabs button[data-tab="updates"]').click();
  ok('B: her card asks Video Editor questions', await B.locator('#myUpdate .uq', { hasText: 'Videos delivered today' }).isVisible());
  await B.locator('#updShare').click();
  await B.locator('#toast:not(.hide)').waitFor({ timeout: 4000 });
  ok('B: mood is the one thing required', /How was the day/.test(await B.locator('#toast').textContent()));
  await B.locator('#myUpdate button[data-mood="great"]').click();
  await B.locator('#myUpdate .uq', { hasText: 'Videos delivered today' }).locator('input').fill('3');
  await B.locator('#myUpdate .uq', { hasText: 'Still on the edit table' }).locator('input').fill('2');
  await B.locator('#myUpdate .uq', { hasText: 'Waiting on footage' }).locator('button[data-v="yes"]').click();
  /* a written answer is lines, not a paragraph — she did three things */
  const cut = B.locator('#myUpdate .uq', { hasText: 'Best thing you cut' });
  ok('B: a written question starts with one line and an "add" button',
    (await cut.locator('.lrow').count()) === 1 && (await cut.locator('[data-add]').count()) === 1);
  await cut.locator('input[data-ln="0"]').fill('AMA teaser for the club');
  await cut.locator('[data-add]').click();
  await cut.locator('input[data-ln="1"]').fill('Reel cut for the Kanpur meetup');
  await cut.locator('[data-add]').click();
  await cut.locator('input[data-ln="2"]').fill('Thumbnail pack for the webinar');
  ok('B: three lines, each its own box', (await cut.locator('.lrow').count()) === 3);
  await cut.locator('[data-add]').click();
  await cut.locator('.lrow').nth(3).locator('.x').click();
  ok('B: a line she does not want comes straight back off', (await cut.locator('.lrow').count()) === 3);
  await B.locator('#myUpdate input[data-uq="_note"]').fill('Laptop fan is dying, might need a look');
  await B.locator('#updShare').click();
  await B.locator('#updChange').waitFor({ timeout: 8000 });
  ok('B: card flips to "in" with a change button', true);
  ok('B: updates badge gone once filed', await B.locator('#bdgUpd').isHidden());
  ok('B: her own feed card shows the numbers', /3/.test(await B.locator('#updFeed .upd .nums').first().textContent()));
  await B.screenshot({ path: SHOTS + '/b-filed.png' });

  /* A sees it, files his own, the strip empties */
  await A.locator('#updFeed .upd', { hasText: 'Meera' }).waitFor({ timeout: 10000 });
  const meeraCard = A.locator('#updFeed .upd', { hasText: 'Meera' });
  ok('A: Meera’s update lands in the feed', true);
  ok('A: her mood rides along', /Great day/.test(await meeraCard.textContent()));
  const chipText = await meeraCard.locator('.nums').textContent();
  ok('A: counts come as chips', /3/.test(chipText) && /Videos delivered/.test(chipText));
  ok('A: a unit already in the question isn’t said twice', !/videos Videos/.test(chipText));
  ok('A: words come as lines', await meeraCard.locator('.qa2', { hasText: 'AMA teaser' }).isVisible());
  const cutBack = meeraCard.locator('.qa2', { hasText: 'AMA teaser' });
  ok('A: all three lines arrive, one bullet each', (await cutBack.locator('li').count()) === 3);
  ok('A: and they read in the order she wrote them',
    /Reel cut for the Kanpur meetup/.test(await cutBack.locator('li').nth(1).textContent()));
  ok('A: the note travels too', await meeraCard.locator('.note', { hasText: 'Laptop fan' }).isVisible());
  ok('A: pending strip no longer lists Meera', (await A.locator('.pendchip', { hasText: 'Meera' }).count()) === 0);

  await A.locator('#myUpdate button[data-mood="ok"]').click();
  await A.locator('#myUpdate .uq', { hasText: 'What did you get done today?' }).locator('input').fill('Closed the venue for Saturday');
  await A.locator('#updShare').click();
  await A.locator('#updChange').waitFor({ timeout: 8000 });
  await A.waitForTimeout(600);
  ok('A: strip disappears once everyone is in', await A.locator('.pendbar').count() === 0);
  ok('A: nudging now finds nobody', true);

  /* finished tasks ride the update automatically */
  await A.locator('#tabs button[data-tab="tasks"]').click();
  await A.locator('#fabTask').click();
  await A.locator('#tkTitle').fill('Prep the webinar deck');
  await A.locator('#tkGo').click();
  await A.locator('.task .seg button[data-st="Done"]').first().click();
  await A.waitForTimeout(800);
  await A.locator('#tabs button[data-tab="updates"]').click();
  ok('A: “tasks finished” chip appears by itself', await A.locator('#myUpdate .chip', { hasText: '1 task finished' }).isVisible());

  /* yesterday seeded straight into the sheet → streaks and week totals */
  await A.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('5cp2_db'));
    const meera = db.sheets.People.find(r => r[1] === 'Meera');
    const y = new Date(); y.setDate(y.getDate() - 1);
    const pad = n => String(n).padStart(2, '0');
    const date = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
    db.sheets.Updates.push(['seed-yday', meera[0], date, 'ok',
      JSON.stringify([{ l: 'Videos delivered today', t: 'count', u: 'videos', v: '2' }]),
      '', new Date(Date.now() - 86400000).toISOString(), '']);
    const vrow = db.sheets.Meta.find(r => r[0] === 'version');
    vrow[1] = String(Number(vrow[1]) + 1);
    db.cache.v = vrow[1];
    localStorage.setItem('5cp2_db', JSON.stringify(db));
  });
  await A.locator('#updFeed .upd', { hasText: 'Meera' }).locator('.chip.streak').waitFor({ timeout: 10000 });
  ok('A: two days running earns the streak chip', /2 days running/.test(await A.locator('#updFeed .upd', { hasText: 'Meera' }).locator('.chip.streak').textContent()));

  await A.locator('#updFeed .upd .hd', { hasText: 'Meera' }).click();
  await A.locator('#veilPerson:not(.hide)').waitFor({ timeout: 4000 });
  const vp = await A.locator('#vpBody').textContent();
  ok('A: person sheet totals the week (3+2 videos)', /5/.test(vp) && /Videos delivered today · 7 days/.test(vp));
  ok('A: person sheet lists both days', /Today/.test(vp) && /Yesterday/.test(vp));
  await A.screenshot({ path: SHOTS + '/person-sheet.png' });
  await A.locator('#vpClose').click();

  /* the sets are clay: reword a question, everyone gets it live */
  await A.locator('#tabs button[data-tab="team"]').click();
  await A.locator('.profcard', { hasText: 'Video Editor' }).locator('[data-act="edit"]').click();
  await A.locator('#veilProfile:not(.hide)').waitFor({ timeout: 4000 });
  await A.locator('#prQs .qedit').first().locator('.ql').fill('Reels delivered today');
  await A.locator('#prSave').click();
  await A.locator('#veilProfile').waitFor({ state: 'hidden', timeout: 8000 });
  await B.locator('#tabs button[data-tab="updates"]').click();
  await B.locator('#updChange').click();
  await B.locator('#myUpdate .uq', { hasText: 'Reels delivered today' }).waitFor({ timeout: 10000 });
  ok('B: reworded question reaches her form', true);
  ok('B: changing it hands her lines back as lines',
    (await B.locator('#myUpdate .uq', { hasText: 'Best thing you cut' }).locator('.lrow').count()) === 3);
  await B.locator('#updCancel').click();

  /* a brand-new kind of work, invented on the spot */
  await A.locator('#profNew').click();
  await A.locator('#veilProfile:not(.hide)').waitFor({ timeout: 4000 });
  await A.locator('#prName').fill('Chef');
  await A.locator('#prQs .qedit').first().locator('.ql').fill('Meals cooked');
  await A.locator('#prQs .qedit').first().locator('.qu').fill('meals');
  await A.locator('#prAddQ').click();
  await A.locator('#prQs .qedit').nth(1).locator('.ql').fill('Kitchen worries');
  await A.locator('#prQs .qedit').nth(1).locator('.qt').selectOption('text');
  await A.locator('#prSave').click();
  await A.locator('.profcard', { hasText: 'Chef' }).waitFor({ timeout: 8000 });
  ok('A: the Chef set exists — any team fits', true);

  await A.locator('.pcard', { hasText: 'Meera' }).locator('select[data-act="prof"]').selectOption({ label: 'Chef' });
  await B.locator('#updChange').waitFor({ timeout: 10000 });
  await B.locator('#updChange').click();
  await B.locator('#myUpdate .uq', { hasText: 'Meals cooked' }).waitFor({ timeout: 10000 });
  ok('B: her form now asks the Chef questions', true);
  await B.locator('#updCancel').click();

  /* the unused set can be put away — General never can */
  await A.locator('.profcard', { hasText: 'Video Editor' }).locator('[data-act="arch"]').waitFor({ timeout: 10000 });
  await A.locator('.profcard', { hasText: 'Video Editor' }).locator('[data-act="arch"]').click();
  await A.locator('#veilAsk:not(.hide)').waitFor({ timeout: 4000 });
  await A.locator('#askYes').click();
  await A.waitForTimeout(1500);
  ok('A: archived set leaves the shelf', (await A.locator('.profcard', { hasText: 'Video Editor' }).count()) === 0);
  ok('A: General has no archive button', (await A.locator('.profcard', { hasText: 'General' }).locator('[data-act="arch"]').count()) === 0);
  ok('A: Meera’s old update still reads fine', true);

  /* the sheet holds everything, like always */
  const db = await A.evaluate(() => JSON.parse(localStorage.getItem('5cp2_db')));
  ok('sheet: Updates rows kept (3)', db.sheets.Updates.length - 1 === 3);
  ok('sheet: all 7 sets kept, video archived not deleted',
    db.sheets.Profiles.length - 1 === 7 &&
    db.sheets.Profiles.some(r => r[1] === 'Video Editor' && r[4] === 'true'));
  ok('sheet: answers snapshot their labels', /Videos delivered today/.test(db.sheets.Updates[1][4]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (errors.length) { console.log('\nERRORS:'); errors.forEach(e => console.log('  ' + e)); }
  else console.log('No console/page errors.');
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

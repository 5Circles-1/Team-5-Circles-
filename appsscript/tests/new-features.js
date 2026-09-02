/**
 * 5C Pulse — feature tests for the team's requested changes:
 * light/dark toggle · faster bell polling · profile photos · admin-only
 * team management · visible designations · instant chat sends · Updates tab
 * with attachments + review · daily duties (receptionist/GMB) · direct
 * emails (with offline-ring fallback) · mobile numbers.
 */
const { chromium } = require('/home/user/Team-5-Circles-/node_modules/playwright-core');
const URL = 'file:///home/user/Team-5-Circles-/appsscript/demo.html?fast';
const URL_SLOW = 'file:///home/user/Team-5-Circles-/appsscript/demo.html';

let pass = 0, fail = 0;
const ok = (label, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); cond ? pass++ : fail++; };

// 1×1 red PNG — enough to exercise the whole image-attachment pipeline
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const errors = [];
  const wire = (p, tag) => {
    p.on('pageerror', e => errors.push(tag + ' PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(tag + ' CONSOLE: ' + m.text()); });
  };
  const call = (page, token, action, data) =>
    page.evaluate(([t, a, d]) => window.FAKE_API(t, a, d), [token, action, data || {}]);
  const tokenOf = page => page.evaluate(() => sessionStorage.getItem('5cp2_token'));
  const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('5cp2_db')));

  /* ══ set up: Aisha (admin) via the UI ══ */
  const A = await ctx.newPage(); wire(A, 'A');
  await A.goto(URL);
  await A.locator('#scrSetup:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#suName').fill('Aisha Verma');
  await A.locator('#suGo').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#pvOk').click();
  await A.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  const aToken = await tokenOf(A);

  /* ══ 1. light/dark: two options, sticky per device ══ */
  ok('theme switch offers exactly two options', await A.locator('#themeSeg button').count() === 2);
  ok('starts in light mode', await A.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
  await A.locator('#themeSeg button[data-mode="dark"]').click();
  ok('dark option turns the lights off', await A.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
  await A.reload();
  await A.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  ok('dark mode survives a reload', await A.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark');
  await A.locator('#themeSeg button[data-mode="light"]').click();
  ok('light option brings it back', await A.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');

  /* ══ 2. the bell rings sooner: polling is 5s/20s, not 12s/45s ══ */
  const P = await ctx.newPage(); wire(P, 'P');
  await P.goto(URL_SLOW);
  const polls = await P.evaluate(() => [POLL_VISIBLE, POLL_HIDDEN]);
  ok('visible poll is 5s (was 12s) → a ring lands in seconds', polls[0] === 5000);
  ok('hidden-tab poll is 20s (was 45s)', polls[1] === 20000);
  await P.close();

  /* ══ team for the rest: Bina the receptionist, Dev who never signs in ══ */
  const binaRes = await call(A, aToken, 'addPerson',
    { name: 'Bina', dept: 'Front Office', designation: 'Receptionist', role: 'Member' });
  ok('adding a person stores their designation', binaRes.ok && binaRes.person.designation === 'Receptionist');
  const bina = { id: binaRes.person.id, pin: binaRes.pin };
  const devRes = await call(A, aToken, 'addPerson', { name: 'Dev', dept: 'Design', role: 'Member' });
  const dev = { id: devRes.person.id };
  const binaLogin = await call(A, '', 'login', { personId: bina.id, pin: bina.pin });

  /* ══ 3. only admins manage the team ══ */
  const mAdd = await call(A, binaLogin.token, 'addPerson', { name: 'Sneaky' });
  const mRm = await call(A, binaLogin.token, 'removePerson', { personId: dev.id });
  const mEdit = await call(A, binaLogin.token, 'editPerson', { personId: dev.id, designation: 'Boss' });
  ok('a member cannot add people: "' + (mAdd.error || '') + '"', mAdd.ok === false && /Only an admin/.test(mAdd.error || ''));
  ok('a member cannot remove people', mRm.ok === false && /Only an admin/.test(mRm.error || ''));
  ok('a member cannot edit profiles', mEdit.ok === false && /Only an admin/.test(mEdit.error || ''));

  const B = await ctx.newPage(); wire(B, 'B');
  await B.goto(URL);
  await B.locator('#loginFaces .face', { hasText: 'Bina' }).click();
  for (const d of bina.pin) await B.locator('#pinPad button[data-k="' + d + '"]').click();
  await B.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  await B.locator('#tabs button[data-tab="team"]').click();
  ok('members see no add-person box', await B.locator('#teamAdd').isHidden());
  ok('members are told team changes are admin-only', await B.locator('#teamNote').isVisible());

  /* ══ 4. designation shows on the card and in the profile ══ */
  ok('designation shows on the team card', await B.locator('.pcard', { hasText: 'Bina' }).locator('.sub').first().textContent().then(t => /Receptionist/.test(t)));
  await B.locator('.pcard', { hasText: 'Bina' }).click();
  await B.locator('#veilPerson:not(.hide)').waitFor({ timeout: 5000 });
  ok('profile sheet leads with the designation', await B.locator('#ppDesig').isVisible() &&
    /Receptionist/.test(await B.locator('#ppDesig').textContent()));
  ok('members get no edit fields on a profile', await B.locator('#ppAdminBox').isHidden());
  await B.locator('#ppClose').click();

  /* ══ 5. profile photo: set, shown, guarded ══ */
  const photo = 'data:image/png;base64,' + PNG_B64;
  const setPhoto = await call(A, aToken, 'setProfile', { photo });
  ok('a person can set their own photo', setPhoto.ok && setPhoto.me.photo === photo);
  const notImage = await call(A, aToken, 'setProfile', { photo: 'data:text/html;base64,PGI+' });
  ok('a non-image is refused', notImage.ok === false);
  const huge = await call(A, aToken, 'setProfile', { photo: 'data:image/png;base64,' + 'A'.repeat(46000) });
  ok('an oversized photo is refused', huge.ok === false);
  const stateNow = await call(A, '', 'state', {});
  ok('the login faces carry the photo', stateNow.people.some(p => p.photo === photo));
  await B.waitForTimeout(2600);
  ok('teammates see the photo on the team list', await B.locator('#teamList .ava img').count() >= 1);

  /* ══ 6. chat: the message shows the instant Send is tapped ══ */
  await B.locator('#tabs button[data-tab="chat"]').click();
  await B.locator('#chatText').fill('Front desk is covered');
  await B.locator('#chatSend').click();
  ok('the bubble is on screen immediately (no round-trip wait)',
    await B.locator('#chatLog .msg.mine', { hasText: 'Front desk is covered' }).count() === 1);
  await B.waitForTimeout(3000);
  ok('and stays a single bubble once the server confirms',
    await B.locator('#chatLog .msg.mine', { hasText: 'Front desk is covered' }).count() === 1);

  /* ══ 7. updates: post → needs review → reviewed, with a screenshot ══ */
  await B.locator('#tabs button[data-tab="updates"]').click();
  await B.evaluate(() => { pickFor = 'updates'; });
  await B.locator('#filePick').setInputFiles({
    name: 'banner.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64'),
  });
  await B.locator('#updAttPrev .attprev').waitFor({ timeout: 5000 });
  ok('picked screenshot previews before posting', true);
  await B.locator('#updText').fill('Banner v2 ready');
  await B.locator('#updReview').check();
  await B.locator('#updPost').click();
  await B.locator('#updFeed .upd', { hasText: 'Banner v2 ready' }).waitFor({ timeout: 8000 });
  ok('the update lands in the feed', true);
  ok('with its screenshot attached', await B.locator('#updFeed .upd .att img').count() >= 1);
  ok('flagged as needing review', /Needs review/.test(await B.locator('#updFeed').textContent()));
  const updMsg = (await db(B)).sheets.Messages.slice(1).find(r => r[3] === 'Banner v2 ready');
  ok('the attachment is stored with the message', !!updMsg && /^data:image\/jpeg/.test(updMsg[11]));

  await A.waitForTimeout(2600);
  ok('the Updates badge lights up for the rest of the team', await A.locator('#bdgUpd').isVisible());
  await A.locator('#tabs button[data-tab="updates"]').click();
  await A.locator('#updFeed [data-rev]').first().click();
  await A.locator('#updFeed .upd', { hasText: 'Reviewed' }).waitFor({ timeout: 8000 });
  ok('a teammate can mark it reviewed', /✔ Reviewed/.test(await A.locator('#updFeed').textContent()));
  await B.waitForTimeout(2600);
  ok('the poster sees who reviewed it', /Aisha.*Reviewed/.test(await B.locator('#updFeed').textContent()));

  /* ══ 8. the receptionist's standing duty: GMB reviews, every day ══ */
  const setDuty = await call(A, aToken, 'editPerson', { personId: bina.id, duty: 'Get GMB profile reviews' });
  ok('an admin can set a daily duty', setDuty.ok);
  let dutyTasks = (await db(A)).sheets.Tasks.slice(1).filter(r => r[1] === 'Get GMB profile reviews');
  ok('the duty task appears on her list the same day', dutyTasks.length === 1 && dutyTasks[0][3] === bina.id);
  // fast-forward to "next morning": yesterday's stamp, empty cache
  await A.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('5cp2_db'));
    d.sheets.Meta = d.sheets.Meta.map(r => (r[0] === 'duty_day' ? ['duty_day', '2020-01-01'] : r));
    delete d.cache.duty_day;
    localStorage.setItem('5cp2_db', JSON.stringify(d));
  });
  await call(A, aToken, 'pull', {});
  dutyTasks = (await db(A)).sheets.Tasks.slice(1).filter(r => r[1] === 'Get GMB profile reviews');
  ok('the next morning spawns it again — every day, automatically', dutyTasks.length === 2);
  const again = await call(A, aToken, 'pull', {});
  dutyTasks = (await db(A)).sheets.Tasks.slice(1).filter(r => r[1] === 'Get GMB profile reviews');
  ok('but only once per day', again.ok && dutyTasks.length === 2);

  /* ══ 9. email: for people not in the tool, and beyond office hours ══ */
  const noMail = await call(A, aToken, 'sendEmail', { personId: bina.id, subject: 'Hi', message: 'Hello' });
  ok('emailing someone with no address on file explains itself', noMail.ok === false && /no email/.test(noMail.error || ''));
  await call(A, aToken, 'editPerson', { personId: dev.id, email: 'dev@example.com', mobile: '+91 91234 56789' });
  const ringAway = await call(A, aToken, 'send', { toId: dev.id, text: 'Need the poster tonight', kind: 'ring' });
  ok('ringing someone who is away also emails them', ringAway.ok && ringAway.emailed === true);
  let mails = (await db(A)).emails || [];
  ok('the ring email carries the message', mails.length === 1 &&
    mails[0].to === 'dev@example.com' && /poster tonight/.test(mails[0].body));
  const ringHere = await call(A, aToken, 'send', { toId: bina.id, text: 'quick one', kind: 'ring' });
  ok('ringing someone who is IN the tool sends no email', ringHere.ok && ringHere.emailed === false);
  await B.locator('#alarm:not(.hide)').waitFor({ timeout: 10000 });
  await B.locator('#alarm .ans button[data-ans="On it 👍"]').click();   // answer it so her screen is free again
  const direct = await call(A, aToken, 'sendEmail', { personId: dev.id, subject: 'Rota for next week', message: 'Sharing after hours — see the sheet.' });
  mails = (await db(A)).emails || [];
  ok('a direct email goes out from the tool', direct.ok && mails.length === 2 && mails[1].subject === 'Rota for next week');
  ok('and is noted on record', (await db(A)).sheets.Messages.slice(1).some(r => /📧 Emailed Dev/.test(r[3])));
  const badMail = await call(A, aToken, 'setProfile', { email: 'not-an-email' });
  ok('a bad email address is refused', badMail.ok === false);

  /* ══ 10. mobile numbers on every profile ══ */
  const setMob = await call(A, aToken, 'setProfile', { mobile: '+91 98765 43210' });
  ok('a person can save their own mobile number', setMob.ok && setMob.me.mobile === '+91 98765 43210');
  await B.locator('#tabs button[data-tab="team"]').click();
  await B.waitForTimeout(2600);
  await B.locator('.pcard', { hasText: 'Aisha' }).click();
  await B.locator('#veilPerson:not(.hide)').waitFor({ timeout: 5000 });
  ok('teammates see it as a tap-to-call link',
    await B.locator('#ppRows a[href^="tel:"]').count() === 1 &&
    /98765/.test(await B.locator('#ppRows').textContent()));
  await B.locator('#ppClose').click();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 8).join('\n') : 'No console/page errors.');
  await browser.close();
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error('CRASH: ' + (e && e.message ? e.message : e)); process.exit(2); });

/**
 * 5C Pulse — regression tests for the defects found by the adversarial review.
 * Each check fails against the pre-fix code.
 */
const { chromium } = require('/home/user/Team-5-Circles-/node_modules/playwright-core');
const URL = 'file:///home/user/Team-5-Circles-/appsscript/demo.html?fast';

let pass = 0, fail = 0;
const ok = (label, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); cond ? pass++ : fail++; };

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

  // direct server call, as any client would make it
  const call = (page, token, action, data) =>
    page.evaluate(([t, a, d]) => window.FAKE_API(t, a, d), [token, action, data || {}]);
  const tokenOf = page => page.evaluate(() => sessionStorage.getItem('5cp2_token'));
  const db = page => page.evaluate(() => JSON.parse(localStorage.getItem('5cp2_db')));

  /* ── set up a team: Aisha (admin), Bina (admin), Chetan (member) ── */
  const A = await ctx.newPage(); wire(A, 'A');
  await A.goto(URL);
  await A.locator('#scrSetup:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#suName').fill('Aisha Verma');
  await A.locator('#suGo').click();
  await A.locator('#veilPin:not(.hide)').waitFor({ timeout: 8000 });
  await A.locator('#pvOk').click();
  await A.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  const aToken = await tokenOf(A);

  const add = async (name, role) => {
    const res = await call(A, aToken, 'addPerson', { name, dept: 'Sales', role });
    return { id: res.person.id, pin: res.pin };
  };
  const bina = await add('Bina', 'Admin');
  const chetan = await add('Chetan', 'Member');
  const binaLogin = await call(A, '', 'login', { personId: bina.id, pin: bina.pin });
  const chetanLogin = await call(A, '', 'login', { personId: chetan.id, pin: chetan.pin });
  ok('two extra people signed in for the test', binaLogin.ok && chetanLogin.ok);

  /* ── 1. the login screen must not reveal who the admins are ── */
  const state = await call(A, '', 'state', {});
  const leaks = JSON.stringify(state.people);
  ok('login screen sends names only, never roles (' + leaks.slice(0, 44) + '…)',
    !/role|dept|Admin/.test(leaks));

  /* ── 2. a demoted admin's still-open session loses admin power at once ── */
  await call(A, aToken, 'editPerson', { personId: bina.id, role: 'Member' });
  const afterDemote = await call(A, binaLogin.token, 'addPerson', { name: 'Should Not Exist' });
  ok('demoted admin cannot still add people with their old session',
    afterDemote.ok === false && /Only an admin/.test(afterDemote.error || ''));
  await call(A, aToken, 'editPerson', { personId: bina.id, role: 'Admin' });   // restore

  /* ── 3. the team can never be left with no admin ── */
  const strip = await call(A, binaLogin.token, 'editPerson', { personId: (await db(A)).sheets.People.slice(1).find(r => r[1] === 'Aisha Verma')[0], role: 'Member' });
  ok('one admin may be demoted while another remains', strip.ok);
  const meId = await A.evaluate(() => Auth.me.id);
  const lastOne = await call(A, binaLogin.token, 'removePerson', { personId: bina.id });
  ok('an admin still cannot remove themselves', lastOne.ok === false);
  const demoteLast = await call(A, binaLogin.token, 'editPerson', { personId: bina.id, role: 'Member' });
  ok('the last admin cannot be demoted away: "' + (demoteLast.error || '') + '"', demoteLast.ok === false);
  const adminsLeft = (await db(A)).sheets.People.slice(1)
    .filter(r => String(r[7]) !== 'false' && r[3] === 'Admin').length;
  ok('the team always still has an admin (' + adminsLeft + ')', adminsLeft >= 1);
  await call(A, binaLogin.token, 'editPerson', { personId: meId, role: 'Admin' });   // restore Aisha

  /* ── 4. comments belong to the task's people, not to anyone who asks ── */
  const task = await call(A, aToken, 'createTask', { ownerId: bina.id, title: 'Quarterly deck' });
  const outsider = await call(A, chetanLogin.token, 'send',
    { toId: bina.id, text: 'butting in', taskId: task.taskId });
  ok('an unrelated member cannot comment on someone else’s task',
    outsider.ok === false && /Only the person doing it/.test(outsider.error || ''));
  const insider = await call(A, binaLogin.token, 'send', { toId: 'ALL', text: 'on it', taskId: task.taskId });
  ok('the person doing it still can', insider.ok);

  /* ── 5. work of someone who left stays editable and commentable ── */
  const gone = await add('Dev', 'Member');
  const t2 = await call(A, aToken, 'createTask', { ownerId: gone.id, title: 'Old banner order' });
  await call(A, aToken, 'setStatus', { taskId: t2.taskId, status: 'Done' });
  await call(A, aToken, 'removePerson', { personId: gone.id });
  const rename = await call(A, aToken, 'editTask', { taskId: t2.taskId, title: 'Old banner order (2024)' });
  ok('a finished task whose owner left can still be corrected', rename.ok);
  const noteIt = await call(A, aToken, 'send', { toId: gone.id, text: 'paid in cash', taskId: t2.taskId });
  ok('and still commented on, on record', noteIt.ok);

  /* ── 6. a Sheets hiccup must never orphan the data ── */
  const idBefore = (await db(A)).props.SS_ID;
  const peopleBefore = (await db(A)).sheets.People.length;
  await A.evaluate(() => { window.FAKE_OPEN_FAILS = true; });
  const duringOutage = await call(A, '', 'state', {});
  ok('a Sheets outage reports an error instead of pretending to be a new team',
    duringOutage.ok === false && !duringOutage.setupNeeded);
  await A.evaluate(() => { window.FAKE_OPEN_FAILS = false; });
  const after = await db(A);
  ok('the data sheet is untouched afterwards',
    after.props.SS_ID === idBefore && after.sheets.People.length === peopleBefore);
  const backUp = await call(A, '', 'state', {});
  ok('and the team is back to normal once Google recovers', backUp.ok && !backUp.setupNeeded);

  /* ── 7. answering a ring sticks, even if a poll lands mid-alarm ── */
  const E = await ctx.newPage(); wire(E, 'E');
  await E.goto(URL);
  await E.locator('#scrLogin:not(.hide)').waitFor({ timeout: 8000 });
  await E.locator('#loginFaces .face', { hasText: 'Chetan' }).click();
  const chetanPin2 = (await call(A, aToken, 'resetPin', { personId: chetan.id })).pin;
  await E.reload();
  await E.locator('#loginFaces .face', { hasText: 'Chetan' }).click();
  for (const d of chetanPin2) await E.locator('#pinPad button[data-k="' + d + '"]').click();
  await E.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });

  await call(A, aToken, 'send', { toId: chetan.id, text: 'Come to the front desk', kind: 'ring' });
  await E.locator('#alarm:not(.hide)').waitFor({ timeout: 10000 });
  // a normal team message arrives while the alarm is on screen — this refreshes
  // the client's copy of every message, which used to strand the answer
  await call(A, aToken, 'send', { toId: 'ALL', text: 'morning all' });
  await E.waitForTimeout(2500);
  await E.locator('#alarm .ans button[data-ans="On it 👍"]').click();
  await E.waitForTimeout(3000);
  ok('the answer sticks after one press even when messages refreshed underneath',
    await E.locator('#alarm').isHidden());
  const acks = await E.evaluate(() =>
    (S.messages.filter(m => /front desk/.test(m.text))[0] || {}).acks || []);
  ok('and the sender sees the answer on record', acks.length === 1 && /On it/.test(acks[0].answer));

  /* ── 8. a double-tap must not post the same message twice ── */
  await E.locator('#tabs button[data-tab="chat"]').click();
  await E.locator('#chatText').fill('Please confirm the venue');
  await E.locator('#chatSend').click();
  await E.locator('#chatSend').click({ force: true }).catch(() => {});
  await E.waitForTimeout(2500);
  const dupes = await E.evaluate(() => S.messages.filter(m => m.text === 'Please confirm the venue').length);
  ok('double-tapping Send posts one message, not two (' + dupes + ')', dupes === 1);

  /* ── 9. read marks belong to the person, not the laptop ── */
  await E.locator('#meChip').click();
  await E.locator('#askYes').click();
  await E.locator('#scrLogin:not(.hide)').waitFor({ timeout: 10000 });
  const binaPin2 = (await call(A, aToken, 'resetPin', { personId: bina.id })).pin;
  await E.reload();
  await E.locator('#loginFaces .face', { hasText: 'Bina' }).click();
  for (const d of binaPin2) await E.locator('#pinPad button[data-k="' + d + '"]').click();
  await E.locator('#scrApp:not(.hide)').waitFor({ timeout: 8000 });
  await E.waitForTimeout(1200);
  ok('the next person on the same laptop still sees their unread chat',
    await E.locator('#bdgChat').isVisible());

  /* ── 10. presence keeps ticking while the team is idle ── */
  const seenPull = await call(A, aToken, 'pull', { since: await A.evaluate(() => lastV) });
  ok('an idle poll still carries who is around', seenPull.unchanged === true && !!seenPull.seen);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 8).join('\n') : 'No console/page errors.');
  await browser.close();
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})().catch(e => { console.error('CRASH: ' + (e && e.message ? e.message : e)); process.exit(2); });

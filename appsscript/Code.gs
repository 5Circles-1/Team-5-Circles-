/* ═══════════════════════════════════════════════════════════════════════════
   5C PULSE · server  (File 1 of 2 — paste this into Code.gs)

   What this is
   ────────────
   The whole backend for the 5 Circles team tool, running on Google's servers
   through Apps Script. On first use it creates a Google Sheet called
   "5C Pulse — Team Data" in the owner's Drive and stores everything there:
   people, tasks, and every message, on record.

   Login is a name + 4-digit PIN. PINs are salted-and-hashed; a signed-in
   device holds a random token. Five wrong PIN tries locks that person's
   login for five minutes.

   Nothing is ever hard-deleted: people are deactivated, tasks and messages
   stay in the sheet forever. The sheet itself is the audit trail the admin
   can open any day.

   Deploy as a Web App:  Execute as: Me · Who has access: Anyone
   (The URL is unguessable and every action beyond the login screen needs a
   PIN-backed token, so "Anyone" only exposes the login screen itself.)
   ═══════════════════════════════════════════════════════════════════════════ */

var SHEETS = {
  META:     'Meta',
  PEOPLE:   'People',
  TASKS:    'Tasks',
  MESSAGES: 'Messages'
};

var PEOPLE_COLS   = ['id','name','dept','role','pin_hash','salt','token','active','created','last_seen','failed_tries','locked_until','photo','designation','mobile','email','duty'];
var TASKS_COLS    = ['id','title','note','owner_id','by_id','due','status','stuck','created','updated','done_at'];
var MESSAGES_COLS = ['id','from_id','to_id','text','kind','task_id','created','acks','file_id','file_name','file_mime','file_url','review'];

var MSG_PULL_LIMIT = 400;   // the sheet keeps everything; a pull sends the recent slice
var PIN_TRIES = 5;
var PIN_LOCK_MS = 5 * 60 * 1000;
var TIMEZONE = 'Asia/Kolkata';        // "today" for due dates and daily duties
var SCHEMA_V = '2';                   // bumped when columns are added
var MAX_FILE_B64 = 6 * 1024 * 1024;   // ~4.5 MB of file, base64-encoded
var MAX_PHOTO_CHARS = 45000;          // a Sheets cell holds 50k characters
var AWAY_MS = 5 * 60 * 1000;          // not seen for this long = "away" → email

/* ── entry points ─────────────────────────────────────────────────────────── */

/** RUN ME ONCE from the editor after pasting a new version: pick
 *  "authorizeMe" in the toolbar's function dropdown, press ▶ Run, and click
 *  Allow. That grants the Drive (attachments) and Mail (email) permissions —
 *  the web app itself is never allowed to show that screen, so without this
 *  run those features fail with "You do not have permission…". */
function authorizeMe() {
  attachmentsFolder();                       // proves Drive, creates the files folder
  MailApp.getRemainingDailyQuota();          // proves Mail
  return 'All set — attachments and email are authorized.';
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('5C Pulse')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** The single RPC the client calls via google.script.run. */
function api(token, action, data) {
  data = data || {};
  try {
    // Reads that must work before anyone is signed in
    if (action === 'state')  return jok(publicState());
    if (action === 'setup')  return jok(setupTeam(data));
    if (action === 'login')  return jok(login(data));

    var me = personByToken(token);
    if (!me) return { ok: false, auth: false, error: 'Please sign in again.' };

    switch (action) {
      case 'pull':        return jok(pull(me, data));
      case 'createTask':  return jok(withLock(function () { return createTask(me, data); }));
      case 'setStatus':   return jok(withLock(function () { return setStatus(me, data); }));
      case 'toggleStuck': return jok(withLock(function () { return toggleStuck(me, data); }));
      case 'editTask':    return jok(withLock(function () { return editTask(me, data); }));
      case 'send':        return jok(withLock(function () { return sendMessage(me, data); }));
      case 'ack':         return jok(withLock(function () { return ackMessage(me, data); }));
      case 'setProfile':  return jok(withLock(function () { return setProfile(me, data); }));
      case 'sendEmail':   return jok(withLock(function () { return sendEmailToPerson(me, data); }));
      case 'addPerson':   return jok(withLock(function () { return addPerson(me, data); }));
      case 'editPerson':  return jok(withLock(function () { return editPerson(me, data); }));
      case 'resetPin':    return jok(withLock(function () { return resetPin(me, data); }));
      case 'removePerson':return jok(withLock(function () { return removePerson(me, data); }));
      case 'setCompany':  return jok(withLock(function () { return setCompany(me, data); }));
      case 'logout':      return jok(withLock(function () { return logout(me); }));
      default:            return { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function jok(payload) {
  payload = payload || {};
  payload.ok = true;
  return payload;
}

/* ── storage bootstrap ────────────────────────────────────────────────────── */

function ss() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SS_ID');
  var book;
  if (id) {
    // Never create a replacement here. openById also throws on a passing
    // Drive/Sheets hiccup, and creating a fresh book would silently orphan
    // the team's real data and show everyone the first-run setup screen.
    book = SpreadsheetApp.openById(id);
  } else {
    book = SpreadsheetApp.create('5C Pulse — Team Data');
    props.setProperty('SS_ID', book.getId());
  }
  ensureSheets(book);
  return book;
}

function ensureSheets(book) {
  var props = PropertiesService.getScriptProperties();
  var upToDate = props.getProperty('SCHEMA') === SCHEMA_V;
  var wanted = [
    [SHEETS.META,     ['key', 'value']],
    [SHEETS.PEOPLE,   PEOPLE_COLS],
    [SHEETS.TASKS,    TASKS_COLS],
    [SHEETS.MESSAGES, MESSAGES_COLS]
  ];
  for (var i = 0; i < wanted.length; i++) {
    var name = wanted[i][0], cols = wanted[i][1];
    var sh = book.getSheetByName(name);
    if (!sh) {
      sh = book.insertSheet(name);
      // Plain-text columns: stops Sheets turning "2026-08-19" into a Date,
      // "true" into a checkbox value, or a name starting with "=" into a formula.
      try {
        var lastCol = String.fromCharCode(64 + cols.length);
        sh.getRange('A:' + lastCol).setNumberFormat('@');
      } catch (e) {}
      sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    } else if (!upToDate) {
      // A team upgrading from an older Code.gs: widen the header row so the
      // new columns (photo, designation, mobile, email, duty, attachments)
      // exist. Old rows simply read as blanks there. Runs once, then the
      // SCHEMA property short-circuits it forever.
      try {
        var lc = String.fromCharCode(64 + cols.length);
        sh.getRange('A:' + lc).setNumberFormat('@');
        sh.getRange(1, 1, 1, cols.length).setValues([cols]);
      } catch (e2) {}
    }
  }
  if (!upToDate) props.setProperty('SCHEMA', SCHEMA_V);
  var def = book.getSheetByName('Sheet1');
  if (def && book.getSheets().length > 4) book.deleteSheet(def);
}

function sheet(name) { return ss().getSheetByName(name); }

/** All rows of a sheet as objects, with their 1-based row numbers. */
function readAll(name, cols) {
  var sh = sheet(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var obj = { _row: i + 2 };
    for (var c = 0; c < cols.length; c++) {
      var v = values[i][c];
      if (v instanceof Date) {
        // Safety net for rows written before the text format existed
        v = cols[c] === 'due'
          ? v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2)
          : v.toISOString();
      }
      obj[cols[c]] = v;
    }
    out.push(obj);
  }
  return out;
}

function appendRowFor(name, cols, obj) {
  var row = [];
  for (var c = 0; c < cols.length; c++) row.push(obj[cols[c]] === undefined ? '' : obj[cols[c]]);
  sheet(name).appendRow(row);
}

function updateRow(name, cols, obj) {
  var row = [];
  for (var c = 0; c < cols.length; c++) row.push(obj[cols[c]] === undefined ? '' : obj[cols[c]]);
  sheet(name).getRange(obj._row, 1, 1, cols.length).setValues([row]);
}

/** One cell only — for writes that must not carry a stale snapshot of the rest
 *  of the row back to the sheet (see pull's presence touch). */
function updateCell(name, cols, obj, col, value) {
  var idx = cols.indexOf(col);
  if (idx < 0) throw new Error('Unknown column: ' + col);
  sheet(name).getRange(obj._row, idx + 1).setValue(value);
  obj[col] = value;
}

/* ── meta / version (cheap polling) ───────────────────────────────────────── */

function metaGet(key) {
  var rows = readAll(SHEETS.META, ['key', 'value']);
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i].value;
  return '';
}

function metaSet(key, value) {
  var rows = readAll(SHEETS.META, ['key', 'value']);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) {
      sheet(SHEETS.META).getRange(rows[i]._row, 2).setValue(value);
      return;
    }
  }
  sheet(SHEETS.META).appendRow([key, value]);
}

function bumpVersion() {
  var v = Number(metaGet('version') || 0) + 1;
  metaSet('version', v);
  try {
    CacheService.getScriptCache().put('v', String(v), 21600);
  } catch (e) {
    // A cache that kept the OLD number would tell every client "nothing new"
    // for hours. Drop the key instead so reads fall back to the sheet.
    try { CacheService.getScriptCache().remove('v'); } catch (e2) {}
  }
  return v;
}

function currentVersion() {
  try {
    var cached = CacheService.getScriptCache().get('v');
    if (cached !== null && cached !== undefined && cached !== '') return Number(cached);
  } catch (e) {}
  var v = Number(metaGet('version') || 0);
  try { CacheService.getScriptCache().put('v', String(v), 21600); } catch (e) {}
  return v;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/* ── auth ─────────────────────────────────────────────────────────────────── */

function hashPin(pin, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pin);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function makePin() {
  // 4 digits, never starting with 0 so it reads naturally aloud
  return String(1000 + Math.floor(Math.random() * 9000));
}

function personByToken(token) {
  if (!token) return null;
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
  for (var i = 0; i < people.length; i++) {
    if (people[i].token && people[i].token === token && String(people[i].active) !== 'false') {
      return people[i];
    }
  }
  return null;
}

function publicPerson(p) {
  return {
    id: p.id, name: p.name, dept: p.dept, role: p.role, active: String(p.active) !== 'false',
    photo: p.photo || '', designation: p.designation || '', mobile: p.mobile || '',
    email: p.email || '', duty: p.duty || ''
  };
}

/** The caller's row as the sheet sees it RIGHT NOW, inside the lock — the copy
 *  the request arrived with was read before the lock and may be stale. */
function freshMe(me) {
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
  for (var i = 0; i < people.length; i++) {
    if (people[i].id === me.id && String(people[i].active) !== 'false') return people[i];
  }
  throw new Error('Your access has changed. Please sign in again.');
}

function cleanMobile(v) {
  return String(v == null ? '' : v).replace(/[^\d+\-() ]/g, '').trim().slice(0, 20);
}
function cleanEmail(v) {
  var e = String(v == null ? '' : v).trim().slice(0, 120);
  if (e && !/^\S+@\S+\.\S+$/.test(e)) throw new Error('That email doesn’t look right.');
  return e;
}

/** Today in the company's timezone — client clocks render, never decide. */
function localToday() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

/** What the login screen may know: company, names and faces, and nothing else —
 *  not who the admins are, which would tell a stranger exactly which PIN to
 *  guess at, and none of the contact details. */
function publicState() {
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS).filter(function (p) { return String(p.active) !== 'false'; });
  if (people.length === 0) return { setupNeeded: true };
  return {
    setupNeeded: false,
    company: metaGet('company') || '5 Circles',
    people: people.map(function (p) { return { id: p.id, name: p.name, photo: p.photo || '' }; })
  };
}

/** First run only: whoever opens the empty app becomes the admin. */
function setupTeam(data) {
  return withLock(function () {
    var existing = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
    if (existing.length > 0) throw new Error('Already set up. Sign in instead.');
    var name = String(data.name || '').trim();
    if (!name) throw new Error('Tell us your name first.');

    metaSet('company', String(data.company || '5 Circles').trim() || '5 Circles');
    metaSet('created', new Date().toISOString());

    var pin = makePin();
    var salt = Utilities.getUuid();
    var admin = {
      id: Utilities.getUuid(),
      name: name,
      dept: String(data.dept || 'Management').trim() || 'Management',
      role: 'Admin',
      pin_hash: hashPin(pin, salt),
      salt: salt,
      token: Utilities.getUuid(),
      active: 'true',
      created: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      failed_tries: 0,
      locked_until: '',
      photo: '',
      designation: String(data.designation || '').trim().slice(0, 60),
      mobile: cleanMobile(data.mobile),
      email: cleanEmail(data.email),
      duty: ''
    };
    appendRowFor(SHEETS.PEOPLE, PEOPLE_COLS, admin);
    bumpVersion();
    return { token: admin.token, pin: pin, me: publicPerson(admin) };
  });
}

function login(data) {
  return withLock(function () {
    var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
    var p = null;
    for (var i = 0; i < people.length; i++) {
      if (people[i].id === data.personId && String(people[i].active) !== 'false') { p = people[i]; break; }
    }
    if (!p) throw new Error('That person is not on the team.');

    var now = Date.now();
    if (p.locked_until && now < Number(p.locked_until)) {
      var mins = Math.ceil((Number(p.locked_until) - now) / 60000);
      throw new Error('Too many wrong tries. Wait ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.');
    }

    if (hashPin(String(data.pin || ''), p.salt) !== p.pin_hash) {
      p.failed_tries = Number(p.failed_tries || 0) + 1;
      if (p.failed_tries >= PIN_TRIES) {
        p.locked_until = String(now + PIN_LOCK_MS);
        p.failed_tries = 0;
      }
      updateRow(SHEETS.PEOPLE, PEOPLE_COLS, p);
      throw new Error('Wrong PIN. Ask your admin if you forgot it.');
    }

    p.failed_tries = 0;
    p.locked_until = '';
    p.token = Utilities.getUuid();   // one active device per person keeps it simple
    p.last_seen = new Date().toISOString();
    updateRow(SHEETS.PEOPLE, PEOPLE_COLS, p);
    return { token: p.token, me: publicPerson(p) };
  });
}

function logout(me) {
  updateCell(SHEETS.PEOPLE, PEOPLE_COLS, me, 'token', '');
  return {};
}

/* ── presence ─────────────────────────────────────────────────────────────
   Who is around right now. Kept in the cache so an idle poll costs no sheet
   reads, and written to the sheet at most once a minute per person. */

function presenceMap() {
  try {
    var raw = CacheService.getScriptCache().get('seen');
    if (raw) return JSON.parse(raw) || {};
  } catch (e) {}
  return {};
}

function touchPresence(me) {
  var now = new Date().toISOString();
  var last = new Date(me.last_seen || 0).getTime();
  if (isNaN(last) || Date.now() - last > 60000) {
    // ONE cell. Writing the whole row here would carry this request's
    // pre-lock snapshot back over a PIN reset or sign-out that landed in
    // between, undoing it.
    updateCell(SHEETS.PEOPLE, PEOPLE_COLS, me, 'last_seen', now);
  }
  try {
    var cache = CacheService.getScriptCache();
    var map = presenceMap();
    map[me.id] = now;
    cache.put('seen', JSON.stringify(map), 3600);
  } catch (e) {}
  return now;
}

/* ── the one read the app lives on ────────────────────────────────────────── */

function pull(me, data) {
  maybeSpawnDuties();
  var v = currentVersion();
  touchPresence(me);
  var seen = presenceMap();

  // Nothing new to send, but presence still travels — otherwise everyone
  // "goes offline" the moment the team stops typing.
  if (data && Number(data.since) === v) return { v: v, unchanged: true, seen: seen };

  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
  var tasks = readAll(SHEETS.TASKS, TASKS_COLS);
  var messages = readAll(SHEETS.MESSAGES, MESSAGES_COLS);
  if (messages.length > MSG_PULL_LIMIT) messages = messages.slice(messages.length - MSG_PULL_LIMIT);

  var appUrl = '';
  try { appUrl = ScriptApp.getService().getUrl() || ''; } catch (e) {}

  return {
    v: v,
    company: metaGet('company') || '5 Circles',
    me: publicPerson(me),
    appUrl: appUrl,
    sheetUrl: me.role === 'Admin' ? ss().getUrl() : '',
    people: people.map(function (p) {
      var pub = publicPerson(p);
      var cached = seen[p.id] || '';
      pub.last_seen = cached > (p.last_seen || '') ? cached : (p.last_seen || '');
      return pub;
    }),
    tasks: tasks.map(function (t) {
      return {
        id: t.id, title: t.title, note: t.note, owner_id: t.owner_id, by_id: t.by_id,
        due: t.due, status: t.status, stuck: String(t.stuck) === 'true',
        created: t.created, updated: t.updated, done_at: t.done_at
      };
    }),
    messages: messages.map(function (m) {
      var acks = [];
      try { acks = m.acks ? JSON.parse(m.acks) : []; } catch (e) { acks = []; }
      return {
        id: m.id, from_id: m.from_id, to_id: m.to_id, text: m.text,
        kind: m.kind, task_id: m.task_id, created: m.created, acks: acks,
        file_id: m.file_id || '', file_name: m.file_name || '',
        file_mime: m.file_mime || '', file_url: m.file_url || '',
        review: String(m.review) === 'true'
      };
    })
  };
}

/* ── daily duties ─────────────────────────────────────────────────────────
   A person can carry one standing daily responsibility (e.g. the
   receptionist's "Get GMB profile reviews"). Every morning — on the first
   pull of the local day — a To-do task for it lands on their list, due
   today. The cache short-circuits this to nothing on every later pull. */

function maybeSpawnDuties() {
  var today = localToday();
  try { if (CacheService.getScriptCache().get('duty_day') === today) return; } catch (e) {}
  try {
    withLock(function () {
      if (metaGet('duty_day') === today) return;
      var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
      var made = 0;
      for (var i = 0; i < people.length; i++) {
        var p = people[i];
        var duty = String(p.duty || '').trim();
        if (String(p.active) === 'false' || !duty) continue;
        spawnDutyTask(p, duty, today);
        made++;
      }
      metaSet('duty_day', today);
      if (made > 0) bumpVersion();
    });
  } catch (e) {
    // A busy lock must never fail the pull — the next poll will try again.
    return;
  }
  try { CacheService.getScriptCache().put('duty_day', today, 21600); } catch (e2) {}
}

function spawnDutyTask(p, duty, today) {
  appendRowFor(SHEETS.TASKS, TASKS_COLS, {
    id: Utilities.getUuid(),
    title: duty.slice(0, 300),
    note: 'Daily duty — this task is created automatically every morning.',
    owner_id: p.id,
    by_id: p.id,
    due: today,
    status: 'To do',
    stuck: 'false',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    done_at: ''
  });
}

/* ── tasks ────────────────────────────────────────────────────────────────── */

function taskById(id) {
  var tasks = readAll(SHEETS.TASKS, TASKS_COLS);
  for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
  return null;
}

function activePersonById(id) {
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
  for (var i = 0; i < people.length; i++) {
    if (people[i].id === id && String(people[i].active) !== 'false') return people[i];
  }
  return null;
}

function createTask(me, data) {
  var title = String(data.title || '').trim();
  if (!title) throw new Error('Say what needs doing.');
  var owner = activePersonById(data.ownerId || me.id);
  if (!owner) throw new Error('Pick who is doing it.');

  var task = {
    id: Utilities.getUuid(),
    title: title.slice(0, 300),
    note: String(data.note || '').trim().slice(0, 2000),
    owner_id: owner.id,
    by_id: me.id,
    due: /^\d{4}-\d{2}-\d{2}$/.test(String(data.due || '')) ? data.due : '',
    status: 'To do',
    stuck: 'false',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    done_at: ''
  };
  appendRowFor(SHEETS.TASKS, TASKS_COLS, task);

  // The record + the doorbell in one place: a message with the task attached
  if (owner.id !== me.id) {
    var line = 'New task for you: ' + task.title + (task.due ? ' (due ' + task.due + ')' : '');
    postMessage(me.id, owner.id, line, data.ring ? 'ring' : 'notice', task.id);
    if (data.ring) emailIfAway(me, owner.id, line);
  }
  bumpVersion();
  return { taskId: task.id };
}

function assertTaskParty(me, task) {
  if (me.role === 'Admin') return;
  if (task.owner_id !== me.id && task.by_id !== me.id) {
    throw new Error('Only the person doing it, the person who asked, or an admin can change this task.');
  }
}

function setStatus(me, data) {
  var task = taskById(data.taskId);
  if (!task) throw new Error('Task not found.');
  assertTaskParty(me, task);
  var status = String(data.status || '');
  if (['To do', 'Doing', 'Done'].indexOf(status) < 0) throw new Error('Unknown status.');

  task.status = status;
  task.updated = new Date().toISOString();
  task.done_at = status === 'Done' ? new Date().toISOString() : '';
  if (status === 'Done') task.stuck = 'false';
  updateRow(SHEETS.TASKS, TASKS_COLS, task);

  if (status === 'Done' && task.by_id !== me.id) {
    postMessage(me.id, task.by_id, 'Done: ' + task.title, 'notice', task.id);
  }
  bumpVersion();
  return {};
}

function toggleStuck(me, data) {
  var task = taskById(data.taskId);
  if (!task) throw new Error('Task not found.');
  assertTaskParty(me, task);
  var nowStuck = String(task.stuck) !== 'true';
  task.stuck = nowStuck ? 'true' : 'false';
  task.updated = new Date().toISOString();
  updateRow(SHEETS.TASKS, TASKS_COLS, task);

  if (nowStuck && task.by_id !== me.id) {
    // Being stuck should never be silent: the giver's screen rings. If the
    // giver has left the team, the whole team hears it instead.
    var to = activePersonById(task.by_id) ? task.by_id : 'ALL';
    postMessage(me.id, to, 'STUCK on: ' + task.title, 'ring', task.id);
    emailIfAway(me, to, 'STUCK on: ' + task.title);
  }
  bumpVersion();
  return {};
}

function editTask(me, data) {
  var task = taskById(data.taskId);
  if (!task) throw new Error('Task not found.');
  assertTaskParty(me, task);
  if (data.title !== undefined) {
    var title = String(data.title).trim();
    if (!title) throw new Error('A task needs a title.');
    task.title = title.slice(0, 300);
  }
  if (data.note !== undefined) task.note = String(data.note).trim().slice(0, 2000);
  if (data.due !== undefined) task.due = /^\d{4}-\d{2}-\d{2}$/.test(String(data.due)) ? data.due : '';
  // An unchanged owner needs no check — otherwise a task whose owner has since
  // left the team could never be edited again, not even to fix a typo.
  if (data.ownerId !== undefined && data.ownerId !== task.owner_id) {
    var owner = activePersonById(data.ownerId);
    if (!owner) throw new Error('Pick who is doing it.');
    task.owner_id = owner.id;
    if (owner.id !== me.id) {
      postMessage(me.id, owner.id, 'This task is now with you: ' + task.title, 'ring', task.id);
      emailIfAway(me, owner.id, 'This task is now with you: ' + task.title);
    }
  }
  task.updated = new Date().toISOString();
  updateRow(SHEETS.TASKS, TASKS_COLS, task);
  bumpVersion();
  return {};
}

/* ── messages: team chat, updates, task comments, and pings — one record ── */

function postMessage(fromId, toId, text, kind, taskId, extra) {
  extra = extra || {};
  var file = extra.file || null;
  var msg = {
    id: Utilities.getUuid(),
    from_id: fromId,
    to_id: toId || 'ALL',
    text: String(text || '').trim().slice(0, 2000),
    kind: kind || 'chat',           // chat | notice | ring | update
    task_id: taskId || '',
    created: new Date().toISOString(),
    acks: '[]',
    file_id: file ? file.id : '',
    file_name: file ? file.name : '',
    file_mime: file ? file.mime : '',
    file_url: file ? file.url : '',
    review: extra.review ? 'true' : ''
  };
  appendRowFor(SHEETS.MESSAGES, MESSAGES_COLS, msg);
  return msg;
}

/* Attachments live as real files in a Drive folder next to the data sheet;
   the message row carries only the link. Shared read-only by link, so the
   team can open them without a Google sign-in. */
function attachmentsFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FILES_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var folder = DriveApp.createFolder('5C Pulse — Files');
  props.setProperty('FILES_ID', folder.getId());
  return folder;
}

function missingApproval(err, what) {
  // Google's raw scope error means the owner never saw the Allow screen for
  // the newer permissions. Turn it into the actual fix.
  if (/permission|authoriz/i.test(String(err && err.message ? err.message : err))) {
    return new Error('One approval is missing: the OWNER opens the Apps Script editor, ' +
      'picks "authorizeMe" in the function dropdown, presses Run, and clicks Allow. ' +
      'Then ' + what + ' work — no redeploy needed.');
  }
  return err;
}

function saveAttachment(file) {
  if (!file || !file.dataB64) return null;
  var b64 = String(file.dataB64);
  if (b64.length > MAX_FILE_B64) throw new Error('That file is too big — keep it under 4 MB.');
  var name = String(file.name || 'file').trim().slice(0, 120) || 'file';
  var mime = String(file.mime || 'application/octet-stream').slice(0, 80);
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, name);
  var f;
  try {
    f = attachmentsFolder().createFile(blob);
  } catch (e) {
    throw missingApproval(e, 'attachments');
  }
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {}
  return { id: f.getId(), name: name, mime: mime, url: f.getUrl() };
}

/** The bell only helps while the tool is open. When a ring goes to someone
 *  who hasn't been seen for a few minutes and we know their email, the same
 *  message lands in their inbox too — for teammates away from the tool, or
 *  anything sent beyond office hours. */
function emailIfAway(fromPerson, toId, text) {
  try {
    if (!toId || toId === 'ALL') return false;
    var p = activePersonById(toId);
    if (!p || !String(p.email || '').trim()) return false;
    var cached = presenceMap()[p.id] || '';
    var seen = cached > (p.last_seen || '') ? cached : (p.last_seen || '');
    if (seen && Date.now() - new Date(seen).getTime() < AWAY_MS) return false;
    var url = '';
    try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
    MailApp.sendEmail({
      to: p.email,
      name: (metaGet('company') || '5 Circles') + ' · 5C Pulse',
      subject: '🔔 ' + fromPerson.name + ' is ringing you',
      body: fromPerson.name + ' rang your screen on 5C Pulse:\n\n“' + text + '”\n\n' +
        'Open the tool to answer: ' + (url || '(ask your admin for the link)') + '\n'
    });
    return true;
  } catch (e) {
    return false;   // a mail hiccup must never block the ring itself
  }
}

function sendMessage(me, data) {
  var text = String(data.text || '').trim();
  if (!text && !data.file) throw new Error('Write something first.');
  var to = data.toId || 'ALL';
  var kind = data.kind === 'ring' ? 'ring' : (data.kind === 'update' ? 'update' : 'chat');
  if (kind === 'update') to = 'ALL';   // updates are for the whole team, on record
  if (to !== 'ALL' && !activePersonById(to)) {
    // The other party has left. A comment on the task still belongs on record,
    // so it goes to the team rather than failing in the person's face.
    if (data.taskId) to = 'ALL';
    else throw new Error('That person is not on the team.');
  }
  if (kind === 'ring' && to === 'ALL' && me.role !== 'Admin') {
    throw new Error('Only an admin can ring the whole team at once.');
  }
  if (data.taskId) {
    // Comments live under the same rule as the rest of the task
    var t = taskById(data.taskId);
    if (!t) throw new Error('Task not found.');
    assertTaskParty(me, t);
  }
  var att = data.file ? saveAttachment(data.file) : null;
  var msg = postMessage(me.id, to, text, kind, data.taskId || '', {
    file: att,
    review: kind === 'update' && data.review === true
  });
  var emailed = kind === 'ring' ? emailIfAway(me, to, text) : false;
  bumpVersion();
  return { messageId: msg.id, emailed: emailed };
}

/** A one-off, deliberate email to a teammate — for someone who isn't active
 *  in the tool, or for sharing something outside office hours. Sent from the
 *  owner's account, clearly attributed to the sender, and noted on record. */
function sendEmailToPerson(me, data) {
  var p = activePersonById(data.personId);
  if (!p) throw new Error('Person not found.');
  var to = String(p.email || '').trim();
  if (!to) throw new Error(p.name + ' has no email on file yet — add it on their profile first.');
  var body = String(data.message || '').trim().slice(0, 5000);
  if (!body) throw new Error('Write the message first.');
  var subject = String(data.subject || '').trim().slice(0, 150) || ('Message from ' + me.name);
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  var opts = { name: me.name + ' · ' + (metaGet('company') || '5 Circles') };
  if (String(me.email || '').trim()) opts.replyTo = me.email;
  try {
    MailApp.sendEmail(to, subject,
      body + '\n\n—\nSent by ' + me.name + ' via 5C Pulse' + (url ? '\n' + url : ''), opts);
  } catch (e) {
    throw missingApproval(e, 'emails');
  }
  postMessage(me.id, p.id, '📧 Emailed ' + p.name + ': ' + subject, 'notice', '');
  bumpVersion();
  return { sent: true };
}

function ackMessage(me, data) {
  var messages = readAll(SHEETS.MESSAGES, MESSAGES_COLS);
  var msg = null;
  for (var i = 0; i < messages.length; i++) if (messages[i].id === data.messageId) { msg = messages[i]; break; }
  if (!msg) throw new Error('Message not found.');
  if (msg.to_id !== 'ALL' && msg.to_id !== me.id) throw new Error('This was not sent to you.');

  var acks = [];
  try { acks = msg.acks ? JSON.parse(msg.acks) : []; } catch (e) { acks = []; }
  for (var a = 0; a < acks.length; a++) if (acks[a].who === me.id) return {};
  acks.push({ who: me.id, answer: String(data.answer || 'Seen').slice(0, 300), at: new Date().toISOString() });
  msg.acks = JSON.stringify(acks);
  updateRow(SHEETS.MESSAGES, MESSAGES_COLS, msg);
  bumpVersion();
  return {};
}

/* ── my profile (anyone, self only) ───────────────────────────────────────── */

/** Everyone keeps their own photo and contact details up to date. Name,
 *  designation, role and duty stay with the admins (editPerson). Writes go
 *  cell by cell to the caller's FRESH row — a whole-row write from the
 *  pre-lock snapshot could quietly undo a PIN reset landing in between. */
function setProfile(me, data) {
  me = freshMe(me);
  if (data.photo !== undefined) {
    var photo = String(data.photo || '');
    if (photo && !/^data:image\//.test(photo)) throw new Error('That doesn’t look like a picture.');
    if (photo.length > MAX_PHOTO_CHARS) throw new Error('That picture is too big — try a smaller one.');
    updateCell(SHEETS.PEOPLE, PEOPLE_COLS, me, 'photo', photo);
  }
  if (data.mobile !== undefined) updateCell(SHEETS.PEOPLE, PEOPLE_COLS, me, 'mobile', cleanMobile(data.mobile));
  if (data.email !== undefined) updateCell(SHEETS.PEOPLE, PEOPLE_COLS, me, 'email', cleanEmail(data.email));
  bumpVersion();
  return { me: publicPerson(me) };
}

/* ── people (admin) ───────────────────────────────────────────────────────── */

/** The caller as the sheet sees them RIGHT NOW, inside the lock. The copy the
 *  request arrived with was read before waiting for the lock, so another admin
 *  may have changed this person's role — or removed them — in between. */
function admin(me) {
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
  var fresh = null;
  for (var i = 0; i < people.length; i++) if (people[i].id === me.id) { fresh = people[i]; break; }
  if (!fresh || String(fresh.active) === 'false') throw new Error('Your access has changed. Please sign in again.');
  if (fresh.role !== 'Admin') throw new Error('Only an admin can do that.');
  return fresh;
}

function activeAdminCount() {
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS), n = 0;
  for (var i = 0; i < people.length; i++) {
    if (String(people[i].active) !== 'false' && people[i].role === 'Admin') n++;
  }
  return n;
}

function addPerson(me, data) {
  me = admin(me);
  var name = String(data.name || '').trim();
  if (!name) throw new Error('Type their name.');
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
  for (var i = 0; i < people.length; i++) {
    if (String(people[i].active) !== 'false' &&
        String(people[i].name).toLowerCase() === name.toLowerCase()) {
      throw new Error(name + ' is already on the team.');
    }
  }
  var pin = makePin();
  var salt = Utilities.getUuid();
  var person = {
    id: Utilities.getUuid(),
    name: name,
    dept: String(data.dept || 'Sales').trim() || 'Sales',
    role: data.role === 'Admin' ? 'Admin' : 'Member',
    pin_hash: hashPin(pin, salt),
    salt: salt,
    token: '',
    active: 'true',
    created: new Date().toISOString(),
    last_seen: '',
    failed_tries: 0,
    locked_until: '',
    photo: '',
    designation: String(data.designation || '').trim().slice(0, 60),
    mobile: cleanMobile(data.mobile),
    email: cleanEmail(data.email),
    duty: ''
  };
  appendRowFor(SHEETS.PEOPLE, PEOPLE_COLS, person);
  bumpVersion();
  // The PIN comes back exactly once, to the admin, to hand to that person.
  return { person: publicPerson(person), pin: pin };
}

function editPerson(me, data) {
  me = admin(me);
  var p = activePersonById(data.personId);
  if (!p) throw new Error('Person not found.');
  if (data.name !== undefined) {
    var name = String(data.name).trim();
    if (!name) throw new Error('A person needs a name.');
    p.name = name;
  }
  if (data.dept !== undefined) p.dept = String(data.dept).trim() || p.dept;
  if (data.designation !== undefined) p.designation = String(data.designation).trim().slice(0, 60);
  if (data.mobile !== undefined) p.mobile = cleanMobile(data.mobile);
  if (data.email !== undefined) p.email = cleanEmail(data.email);
  var newDuty = null;
  if (data.duty !== undefined) {
    newDuty = String(data.duty).trim().slice(0, 200);
    if (newDuty !== String(p.duty || '').trim()) p.duty = newDuty; else newDuty = null;
  }
  if (data.role !== undefined && (data.role === 'Admin' || data.role === 'Member')) {
    if (p.id === me.id && data.role !== 'Admin') throw new Error('You cannot remove your own admin access.');
    if (p.role === 'Admin' && data.role !== 'Admin' && activeAdminCount() <= 1) {
      throw new Error('Someone has to stay admin. Make another person an admin first.');
    }
    p.role = data.role;
  }
  updateRow(SHEETS.PEOPLE, PEOPLE_COLS, p);
  // A duty set today starts today — not tomorrow morning. Skip it only if an
  // open task with the same title is already on their list.
  if (newDuty) {
    var tasks = readAll(SHEETS.TASKS, TASKS_COLS);
    var open = false;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].owner_id === p.id && tasks[i].title === newDuty && tasks[i].status !== 'Done') { open = true; break; }
    }
    if (!open) spawnDutyTask(p, newDuty, localToday());
  }
  bumpVersion();
  return {};
}

function resetPin(me, data) {
  me = admin(me);
  var p = activePersonById(data.personId);
  if (!p) throw new Error('Person not found.');
  var pin = makePin();
  p.salt = Utilities.getUuid();
  p.pin_hash = hashPin(pin, p.salt);
  p.token = '';            // their old device signs out
  p.failed_tries = 0;
  p.locked_until = '';
  updateRow(SHEETS.PEOPLE, PEOPLE_COLS, p);
  bumpVersion();
  return { pin: pin };
}

function removePerson(me, data) {
  me = admin(me);
  var p = activePersonById(data.personId);
  if (!p) throw new Error('Person not found.');
  if (p.id === me.id) throw new Error('You cannot remove yourself.');
  if (p.role === 'Admin' && activeAdminCount() <= 1) {
    throw new Error('Someone has to stay admin. Make another person an admin first.');
  }

  // Zero orphaned work: their open tasks move to the admin doing the removal
  var tasks = readAll(SHEETS.TASKS, TASKS_COLS);
  var moved = 0;
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (t.owner_id === p.id && t.status !== 'Done') {
      t.owner_id = me.id;
      t.updated = new Date().toISOString();
      updateRow(SHEETS.TASKS, TASKS_COLS, t);
      moved++;
    }
  }
  p.active = 'false';
  p.token = '';
  updateRow(SHEETS.PEOPLE, PEOPLE_COLS, p);
  if (moved > 0) {
    postMessage(me.id, 'ALL', p.name + ' has left the team. ' + moved +
      ' open task' + (moved === 1 ? '' : 's') + ' moved to ' + me.name + ' to be re-given.', 'notice', '');
  }
  bumpVersion();
  return { movedTasks: moved };
}

function setCompany(me, data) {
  me = admin(me);
  var name = String(data.company || '').trim();
  if (!name) throw new Error('Type the company name.');
  metaSet('company', name);
  bumpVersion();
  return {};
}

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

var PEOPLE_COLS   = ['id','name','dept','role','pin_hash','salt','token','active','created','last_seen','failed_tries','locked_until'];
var TASKS_COLS    = ['id','title','note','owner_id','by_id','due','status','stuck','created','updated','done_at'];
var MESSAGES_COLS = ['id','from_id','to_id','text','kind','task_id','created','acks'];

var MSG_PULL_LIMIT = 400;   // the sheet keeps everything; a pull sends the recent slice
var PIN_TRIES = 5;
var PIN_LOCK_MS = 5 * 60 * 1000;

/* ── entry points ─────────────────────────────────────────────────────────── */

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
  var book = null;
  if (id) {
    try { book = SpreadsheetApp.openById(id); } catch (e) { book = null; }
  }
  if (!book) {
    book = SpreadsheetApp.create('5C Pulse — Team Data');
    props.setProperty('SS_ID', book.getId());
  }
  ensureSheets(book);
  return book;
}

function ensureSheets(book) {
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
    }
  }
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
  try { CacheService.getScriptCache().put('v', String(v), 21600); } catch (e) {}
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
  return { id: p.id, name: p.name, dept: p.dept, role: p.role, active: String(p.active) !== 'false' };
}

/** What the login screen may know: company + names. Never PINs, never data. */
function publicState() {
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS).filter(function (p) { return String(p.active) !== 'false'; });
  if (people.length === 0) return { setupNeeded: true };
  return {
    setupNeeded: false,
    company: metaGet('company') || '5 Circles',
    people: people.map(publicPerson)
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
      locked_until: ''
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
  me.token = '';
  updateRow(SHEETS.PEOPLE, PEOPLE_COLS, me);
  return {};
}

/* ── the one read the app lives on ────────────────────────────────────────── */

function pull(me, data) {
  var v = currentVersion();
  if (data && Number(data.since) === v) return { v: v, unchanged: true };

  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS);
  var tasks = readAll(SHEETS.TASKS, TASKS_COLS);
  var messages = readAll(SHEETS.MESSAGES, MESSAGES_COLS);
  if (messages.length > MSG_PULL_LIMIT) messages = messages.slice(messages.length - MSG_PULL_LIMIT);

  // touch last_seen at most once a minute — presence without write-storms
  var seen = new Date(me.last_seen || 0).getTime();
  if (isNaN(seen) || Date.now() - seen > 60000) {
    me.last_seen = new Date().toISOString();
    updateRow(SHEETS.PEOPLE, PEOPLE_COLS, me);
  }

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
      pub.last_seen = p.last_seen || '';
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
        kind: m.kind, task_id: m.task_id, created: m.created, acks: acks
      };
    })
  };
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
    postMessage(me.id, owner.id,
      'New task for you: ' + task.title + (task.due ? ' (due ' + task.due + ')' : ''),
      data.ring ? 'ring' : 'notice', task.id);
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
    // Being stuck should never be silent: the giver's screen rings
    postMessage(me.id, task.by_id, 'STUCK on: ' + task.title +
      (data.why ? ' — ' + String(data.why).trim().slice(0, 300) : ''), 'ring', task.id);
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
  if (data.ownerId !== undefined) {
    var owner = activePersonById(data.ownerId);
    if (!owner) throw new Error('Pick who is doing it.');
    if (owner.id !== task.owner_id) {
      task.owner_id = owner.id;
      if (owner.id !== me.id) {
        postMessage(me.id, owner.id, 'This task is now with you: ' + task.title, 'ring', task.id);
      }
    }
  }
  task.updated = new Date().toISOString();
  updateRow(SHEETS.TASKS, TASKS_COLS, task);
  bumpVersion();
  return {};
}

/* ── messages: team chat, task comments, and pings — one record ──────────── */

function postMessage(fromId, toId, text, kind, taskId) {
  var msg = {
    id: Utilities.getUuid(),
    from_id: fromId,
    to_id: toId || 'ALL',
    text: String(text || '').trim().slice(0, 2000),
    kind: kind || 'chat',           // chat | notice | ring
    task_id: taskId || '',
    created: new Date().toISOString(),
    acks: '[]'
  };
  appendRowFor(SHEETS.MESSAGES, MESSAGES_COLS, msg);
  return msg;
}

function sendMessage(me, data) {
  var text = String(data.text || '').trim();
  if (!text) throw new Error('Write something first.');
  var to = data.toId || 'ALL';
  if (to !== 'ALL' && !activePersonById(to)) throw new Error('That person is not on the team.');
  var kind = data.kind === 'ring' ? 'ring' : 'chat';
  if (kind === 'ring' && to === 'ALL' && me.role !== 'Admin') {
    throw new Error('Only an admin can ring the whole team at once.');
  }
  if (data.taskId && !taskById(data.taskId)) throw new Error('Task not found.');
  var msg = postMessage(me.id, to, text, kind, data.taskId || '');
  bumpVersion();
  return { messageId: msg.id };
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

/* ── people (admin) ───────────────────────────────────────────────────────── */

function assertAdmin(me) {
  if (me.role !== 'Admin') throw new Error('Only an admin can do that.');
}

function addPerson(me, data) {
  assertAdmin(me);
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
    locked_until: ''
  };
  appendRowFor(SHEETS.PEOPLE, PEOPLE_COLS, person);
  bumpVersion();
  // The PIN comes back exactly once, to the admin, to hand to that person.
  return { person: publicPerson(person), pin: pin };
}

function editPerson(me, data) {
  assertAdmin(me);
  var p = activePersonById(data.personId);
  if (!p) throw new Error('Person not found.');
  if (data.name !== undefined) {
    var name = String(data.name).trim();
    if (!name) throw new Error('A person needs a name.');
    p.name = name;
  }
  if (data.dept !== undefined) p.dept = String(data.dept).trim() || p.dept;
  if (data.role !== undefined && (data.role === 'Admin' || data.role === 'Member')) {
    if (p.id === me.id && data.role !== 'Admin') throw new Error('You cannot remove your own admin access.');
    p.role = data.role;
  }
  updateRow(SHEETS.PEOPLE, PEOPLE_COLS, p);
  bumpVersion();
  return {};
}

function resetPin(me, data) {
  assertAdmin(me);
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
  assertAdmin(me);
  var p = activePersonById(data.personId);
  if (!p) throw new Error('Person not found.');
  if (p.id === me.id) throw new Error('You cannot remove yourself.');

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
  assertAdmin(me);
  var name = String(data.company || '').trim();
  if (!name) throw new Error('Type the company name.');
  metaSet('company', name);
  bumpVersion();
  return {};
}

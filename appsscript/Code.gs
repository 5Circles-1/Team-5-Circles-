/* ═══════════════════════════════════════════════════════════════════════════
   5C PULSE · server  (File 1 of 2 — paste this into Code.gs)

   What this is
   ────────────
   The whole backend for the 5 Circles team tool, running on Google's servers
   through Apps Script. On first use it creates a Google Sheet called
   "5C Pulse — Team Data" in the owner's Drive and stores everything there:
   people, tasks, every message, and everyone's daily updates, on record.

   The daily update is the heart of it: each person answers the few
   questions that fit THEIR kind of work — question sets an admin can
   reword or invent freely, so no role is hard-coded — plus how the day
   felt. Numbers roll up weekly per person; the bell chases missing updates.

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
  MESSAGES: 'Messages',
  PROFILES: 'Profiles',
  UPDATES:  'Updates'
};

var PEOPLE_COLS   = ['id','name','dept','role','pin_hash','salt','token','active','created','last_seen','failed_tries','locked_until','profile_id'];
var TASKS_COLS    = ['id','title','note','owner_id','by_id','due','status','stuck','created','updated','done_at'];
var MESSAGES_COLS = ['id','from_id','to_id','text','kind','task_id','created','acks'];
var PROFILES_COLS = ['id','name','emoji','questions','archived','created'];
var UPDATES_COLS  = ['id','person_id','date','mood','answers','note','created','updated'];

var MSG_PULL_LIMIT = 400;   // the sheet keeps everything; a pull sends the recent slice
var UPD_PULL_LIMIT = 600;   // ~2 months of daily updates for a 10-person team
var PIN_TRIES = 5;
var PIN_LOCK_MS = 5 * 60 * 1000;
var SCHEMA_VERSION = '2';

/* Starter question sets — one per kind of work 5 Circles runs on today, and a
   General one for everyone else. They are ROWS, not rules: admins can reword
   any question, add their own sets (a chef, a driver, a designer…), and
   archive what they don't use. 'general' is the fallback and cannot go. */
var Q = function (id, label, type, unit) { return { id: id, label: label, type: type, unit: unit || '' }; };
var PRESET_PROFILES = [
  { id: 'general', name: 'General', emoji: '📝', questions: [
    Q('g1', 'What did you get done today?', 'text'),
    Q('g2', 'What’s the plan for tomorrow?', 'text'),
    Q('g3', 'Anything in your way?', 'text')
  ]},
  { id: 'video', name: 'Video Editor', emoji: '🎬', questions: [
    Q('v1', 'Videos delivered today', 'count', 'videos'),
    Q('v2', 'Still on the edit table', 'count', 'videos'),
    Q('v3', 'Waiting on footage or approval from someone?', 'yesno'),
    Q('v4', 'Best thing you cut today', 'text')
  ]},
  { id: 'marketing', name: 'Performance Marketer', emoji: '📣', questions: [
    Q('m1', 'Leads that came in', 'count', 'leads'),
    Q('m2', 'Spent on ads today', 'count', '₹'),
    Q('m3', 'Best-performing ad right now', 'text'),
    Q('m4', 'Anything to pause or scale?', 'text')
  ]},
  { id: 'sales', name: 'Sales', emoji: '☎️', questions: [
    Q('s1', 'Calls made', 'count', 'calls'),
    Q('s2', 'Follow-ups done', 'count'),
    Q('s3', 'Closures today', 'count'),
    Q('s4', 'Hot leads for tomorrow', 'text')
  ]},
  { id: 'mentor', name: 'Mentor / Trainer', emoji: '🎓', questions: [
    Q('t1', 'Sessions taken', 'count'),
    Q('t2', 'Students showed up', 'count'),
    Q('t3', 'Doubts still open', 'count'),
    Q('t4', 'A student who needs attention', 'text')
  ]},
  { id: 'frontdesk', name: 'Front Desk', emoji: '🛎️', questions: [
    Q('f1', 'Walk-ins today', 'count'),
    Q('f2', 'Enquiries taken', 'count'),
    Q('f3', 'Fees collected', 'count', '₹'),
    Q('f4', 'Anything promised to a visitor?', 'text')
  ]}
];

var NUDGE_TEXT = 'Your daily update is waiting — open the Updates tab, it takes a minute.';

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
    ensureSchema();

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
      case 'saveUpdate':  return jok(withLock(function () { return saveUpdate(me, data); }));
      case 'nudgeUpdates':return jok(withLock(function () { return nudgeUpdates(me, data); }));
      case 'saveProfile': return jok(withLock(function () { return saveProfile(me, data); }));
      case 'archiveProfile': return jok(withLock(function () { return archiveProfile(me, data); }));
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

function allSheetDefs() {
  return [
    [SHEETS.META,     ['key', 'value']],
    [SHEETS.PEOPLE,   PEOPLE_COLS],
    [SHEETS.TASKS,    TASKS_COLS],
    [SHEETS.MESSAGES, MESSAGES_COLS],
    [SHEETS.PROFILES, PROFILES_COLS],
    [SHEETS.UPDATES,  UPDATES_COLS]
  ];
}

function ensureSheets(book) {
  var wanted = allSheetDefs();
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
  if (def && book.getSheets().length > wanted.length) book.deleteSheet(def);
}

/** One-time upgrade of a spreadsheet created by an older Code.gs: new sheets
 *  appear via ensureSheets, headers stretch to the new columns, and the
 *  starter question sets are seeded. Guarded by a script property so every
 *  other request costs one property read and nothing else. */
function ensureSchema() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCHEMA') === SCHEMA_VERSION) return;
  var lock = LockService.getScriptLock();
  // Another request migrating right now is fine — skip and serve; the guard
  // property is only written once the whole upgrade is done.
  var got = false;
  try { got = lock.tryLock(5000); } catch (e) {}
  if (!got) return;
  try {
    if (props.getProperty('SCHEMA') === SCHEMA_VERSION) return;
    var book = ss();
    var wanted = allSheetDefs();
    for (var i = 0; i < wanted.length; i++) {
      var name = wanted[i][0], cols = wanted[i][1];
      var sh = book.getSheetByName(name);
      try {
        var lastCol = String.fromCharCode(64 + cols.length);
        sh.getRange('A:' + lastCol).setNumberFormat('@');
      } catch (e) {}
      sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    }
    if (readAll(SHEETS.PROFILES, PROFILES_COLS).length === 0) {
      for (var p = 0; p < PRESET_PROFILES.length; p++) {
        var pre = PRESET_PROFILES[p];
        appendRowFor(SHEETS.PROFILES, PROFILES_COLS, {
          id: pre.id, name: pre.name, emoji: pre.emoji,
          questions: JSON.stringify(pre.questions),
          archived: 'false', created: new Date().toISOString()
        });
      }
    }
    props.setProperty('SCHEMA', SCHEMA_VERSION);
  } finally {
    lock.releaseLock();
  }
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
    id: p.id, name: p.name, dept: p.dept, role: p.role,
    active: String(p.active) !== 'false',
    profile_id: p.profile_id || 'general'   // people from before question sets existed
  };
}

/** What the login screen may know: company + names, and nothing else — not who
 *  the admins are, which would tell a stranger exactly which PIN to guess at. */
function publicState() {
  var people = readAll(SHEETS.PEOPLE, PEOPLE_COLS).filter(function (p) { return String(p.active) !== 'false'; });
  if (people.length === 0) return { setupNeeded: true };
  return {
    setupNeeded: false,
    company: metaGet('company') || '5 Circles',
    people: people.map(function (p) { return { id: p.id, name: p.name }; })
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
      profile_id: 'general'
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
  var updates = readAll(SHEETS.UPDATES, UPDATES_COLS);
  if (updates.length > UPD_PULL_LIMIT) updates = updates.slice(updates.length - UPD_PULL_LIMIT);

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
        kind: m.kind, task_id: m.task_id, created: m.created, acks: acks
      };
    }),
    profiles: readAll(SHEETS.PROFILES, PROFILES_COLS).map(function (pr) {
      var qs = [];
      try { qs = pr.questions ? JSON.parse(pr.questions) : []; } catch (e) { qs = []; }
      return {
        id: pr.id, name: pr.name, emoji: pr.emoji,
        questions: qs, archived: String(pr.archived) === 'true'
      };
    }),
    updates: updates.map(function (u) {
      var answers = [];
      try { answers = u.answers ? JSON.parse(u.answers) : []; } catch (e) { answers = []; }
      return {
        id: u.id, person_id: u.person_id, date: u.date, mood: u.mood,
        answers: answers, note: u.note, created: u.created, updated: u.updated
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
    // Being stuck should never be silent: the giver's screen rings. If the
    // giver has left the team, the whole team hears it instead.
    var to = activePersonById(task.by_id) ? task.by_id : 'ALL';
    postMessage(me.id, to, 'STUCK on: ' + task.title, 'ring', task.id);
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
  if (to !== 'ALL' && !activePersonById(to)) {
    // The other party has left. A comment on the task still belongs on record,
    // so it goes to the team rather than failing in the person's face.
    if (data.taskId) to = 'ALL';
    else throw new Error('That person is not on the team.');
  }
  var kind = data.kind === 'ring' ? 'ring' : 'chat';
  if (kind === 'ring' && to === 'ALL' && me.role !== 'Admin') {
    throw new Error('Only an admin can ring the whole team at once.');
  }
  if (data.taskId) {
    // Comments live under the same rule as the rest of the task
    var t = taskById(data.taskId);
    if (!t) throw new Error('Task not found.');
    assertTaskParty(me, t);
  }
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

/* ── daily updates: everyone's minute-long word on their day ──────────────
   Each person answers the questions of their QUESTION SET (their kind of
   work: editor, sales, front desk, or one the admin invents), picks how the
   day felt, and that's the update — one row per person per day, editable
   until midnight, kept forever like everything else. */

function profileRows() { return readAll(SHEETS.PROFILES, PROFILES_COLS); }

function profileRowById(id) {
  var rows = profileRows();
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

/** The questions a person answers today. A missing or archived set falls back
 *  to General, so nobody is ever left without an update form. */
function questionsFor(person) {
  var row = profileRowById(person.profile_id || 'general');
  if (!row || String(row.archived) === 'true') row = profileRowById('general');
  var qs = [];
  try { qs = row && row.questions ? JSON.parse(row.questions) : []; } catch (e) { qs = []; }
  return qs;
}

function validDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

function saveUpdate(me, data) {
  var date = String(data.date || '');
  if (!validDateStr(date)) throw new Error('That date doesn’t look right.');
  // The client's own calendar day decides where the update lands (clocks on
  // Google's side may sit in another timezone); anything far from now is junk.
  var drift = Math.abs(new Date(date + 'T12:00:00Z').getTime() - Date.now());
  if (isNaN(drift) || drift > 3 * 86400000) throw new Error('That date doesn’t look right.');

  var mood = String(data.mood || '');
  if (['great', 'ok', 'heavy'].indexOf(mood) < 0) throw new Error('Pick how the day felt first.');

  var vals = data.vals || {};
  var qs = questionsFor(me);
  var answers = [];
  for (var i = 0; i < qs.length; i++) {
    var q = qs[i];
    var v = vals[q.id];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    v = String(v).trim();
    if (q.type === 'count') {
      v = v.replace(/[,\s]/g, '');
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) {
        throw new Error('“' + q.label + '” needs a number.');
      }
    } else if (q.type === 'yesno') {
      if (v !== 'yes' && v !== 'no') continue;
    } else {
      v = v.slice(0, 300);
    }
    answers.push({ l: q.label, t: q.type, u: q.unit || '', v: v });
  }
  var note = String(data.note || '').trim().slice(0, 1000);

  var rows = readAll(SHEETS.UPDATES, UPDATES_COLS);
  var existing = null;
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].person_id === me.id && rows[r].date === date) { existing = rows[r]; break; }
  }
  if (existing) {
    existing.mood = mood;
    existing.answers = JSON.stringify(answers);
    existing.note = note;
    existing.updated = new Date().toISOString();
    updateRow(SHEETS.UPDATES, UPDATES_COLS, existing);
    bumpVersion();
    return { updateId: existing.id };
  }
  var upd = {
    id: Utilities.getUuid(),
    person_id: me.id,
    date: date,
    mood: mood,
    // Labels are copied INTO the row, so an update stays readable years later
    // even after the admin has reworded or replaced every question.
    answers: JSON.stringify(answers),
    note: note,
    created: new Date().toISOString(),
    updated: ''
  };
  appendRowFor(SHEETS.UPDATES, UPDATES_COLS, upd);
  bumpVersion();
  return { updateId: upd.id };
}

/** Ring everyone whose update for the day hasn't come in (or one person).
 *  An unanswered earlier nudge still ringing on their screen means a new one
 *  would add nothing, so those people are skipped. */
function nudgeUpdates(me, data) {
  me = admin(me);
  var date = String(data.date || '');
  if (!validDateStr(date)) throw new Error('That date doesn’t look right.');

  var updates = readAll(SHEETS.UPDATES, UPDATES_COLS);
  var filed = {};
  for (var i = 0; i < updates.length; i++) {
    if (updates[i].date === date) filed[updates[i].person_id] = true;
  }
  var ringing = {};
  var msgs = readAll(SHEETS.MESSAGES, MESSAGES_COLS);
  for (var m = 0; m < msgs.length; m++) {
    if (msgs[m].kind !== 'ring' || msgs[m].text !== NUDGE_TEXT) continue;
    var acks = [];
    try { acks = msgs[m].acks ? JSON.parse(msgs[m].acks) : []; } catch (e) {}
    var answered = false;
    for (var a = 0; a < acks.length; a++) if (acks[a].who === msgs[m].to_id) answered = true;
    if (!answered) ringing[msgs[m].to_id] = true;
  }

  var targets = readAll(SHEETS.PEOPLE, PEOPLE_COLS).filter(function (p) {
    if (String(p.active) === 'false' || p.id === me.id) return false;
    if (data.personId && p.id !== data.personId) return false;
    return true;
  });
  if (data.personId && !targets.length) throw new Error('Person not found.');
  if (data.personId && filed[data.personId]) throw new Error('Their update is already in.');

  var nudged = 0;
  for (var t = 0; t < targets.length; t++) {
    var p = targets[t];
    if (filed[p.id] || ringing[p.id]) continue;
    postMessage(me.id, p.id, NUDGE_TEXT, 'ring', '');
    nudged++;
  }
  if (nudged) bumpVersion();
  return { nudged: nudged };
}

/* ── question sets (admin) ────────────────────────────────────────────────── */

function cleanQuestions(raw) {
  if (!raw || !raw.length) throw new Error('A question set needs at least one question.');
  if (raw.length > 8) throw new Error('Eight questions is the most — a daily update has to stay quick.');
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var q = raw[i] || {};
    var label = String(q.label || '').trim().slice(0, 80);
    if (!label) throw new Error('Every question needs its words.');
    var type = ['count', 'text', 'yesno'].indexOf(q.type) >= 0 ? q.type : 'text';
    out.push({
      id: String(q.id || '').trim() || Utilities.getUuid().slice(0, 8),
      label: label,
      type: type,
      unit: type === 'count' ? String(q.unit || '').trim().slice(0, 12) : ''
    });
  }
  return out;
}

function saveProfile(me, data) {
  me = admin(me);
  var name = String(data.name || '').trim().slice(0, 40);
  if (!name) throw new Error('Name the kind of work first.');
  var emoji = String(data.emoji || '').trim().slice(0, 8) || '📝';
  var questions = cleanQuestions(data.questions);

  var rows = profileRows();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id !== data.profileId && String(rows[i].archived) !== 'true' &&
        String(rows[i].name).toLowerCase() === name.toLowerCase()) {
      throw new Error('There’s already a set called ' + rows[i].name + '.');
    }
  }

  if (data.profileId) {
    var row = profileRowById(data.profileId);
    if (!row) throw new Error('That question set is gone.');
    row.name = name;
    row.emoji = emoji;
    row.questions = JSON.stringify(questions);
    updateRow(SHEETS.PROFILES, PROFILES_COLS, row);
    bumpVersion();
    return { profileId: row.id };
  }
  var fresh = {
    id: Utilities.getUuid(),
    name: name,
    emoji: emoji,
    questions: JSON.stringify(questions),
    archived: 'false',
    created: new Date().toISOString()
  };
  appendRowFor(SHEETS.PROFILES, PROFILES_COLS, fresh);
  bumpVersion();
  return { profileId: fresh.id };
}

function archiveProfile(me, data) {
  me = admin(me);
  var row = profileRowById(data.profileId);
  if (!row) throw new Error('That question set is gone.');
  if (row.id === 'general') throw new Error('General stays — it’s the fallback for everyone new.');
  var users = readAll(SHEETS.PEOPLE, PEOPLE_COLS).filter(function (p) {
    return String(p.active) !== 'false' && (p.profile_id || 'general') === row.id;
  });
  if (users.length) {
    throw new Error(users[0].name + (users.length > 1 ? ' and others are' : ' is') +
      ' still on this set. Move them to another set first.');
  }
  row.archived = 'true';
  updateRow(SHEETS.PROFILES, PROFILES_COLS, row);
  bumpVersion();
  return {};
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
  var profile = profileRowById(String(data.profileId || 'general'));
  if (!profile || String(profile.archived) === 'true') profile = profileRowById('general');
  var pin = makePin();
  var salt = Utilities.getUuid();
  var person = {
    id: Utilities.getUuid(),
    name: name,
    // "What they do" is a free label; left blank it borrows the set's name,
    // so a Video Editor never reads as blank — or as somebody's department.
    dept: String(data.dept || '').trim() || (profile ? profile.name : 'Team'),
    role: data.role === 'Admin' ? 'Admin' : 'Member',
    pin_hash: hashPin(pin, salt),
    salt: salt,
    token: '',
    active: 'true',
    created: new Date().toISOString(),
    last_seen: '',
    failed_tries: 0,
    locked_until: '',
    profile_id: profile ? profile.id : 'general'
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
  if (data.profileId !== undefined) {
    var prof = profileRowById(String(data.profileId));
    if (!prof || String(prof.archived) === 'true') throw new Error('Pick a question set from the list.');
    p.profile_id = prof.id;
  }
  if (data.role !== undefined && (data.role === 'Admin' || data.role === 'Member')) {
    if (p.id === me.id && data.role !== 'Admin') throw new Error('You cannot remove your own admin access.');
    if (p.role === 'Admin' && data.role !== 'Admin' && activeAdminCount() <= 1) {
      throw new Error('Someone has to stay admin. Make another person an admin first.');
    }
    p.role = data.role;
  }
  updateRow(SHEETS.PEOPLE, PEOPLE_COLS, p);
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

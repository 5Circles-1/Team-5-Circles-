# 5C Pulse — Google Apps Script edition

The team tool 5 Circles actually runs on: daily updates from every role,
tasks, chat on record, and ring-until-answered alerts, backed by a Google
Sheet in the owner's Drive.

It is deliberately generic where the CRM is specific: the CRM knows the
customers; Pulse knows the team. Each person files a one-minute **daily
update** whose questions come from their **question set** — six starter sets
ship (General, Video Editor, Performance Marketer, Sales, Mentor/Trainer,
Front Desk) and admins can reword any question, invent sets for new kinds of
work, and archive unused ones. Numeric answers roll up into per-person weekly
totals; consecutive days build a streak (a missing Sunday is forgiven); the
bell chases whoever's update hasn't come in.

## The two files that matter

| File | Where it goes |
| --- | --- |
| `Code.gs` | The whole server. Paste into the `Code.gs` file of a new Apps Script project. |
| `index.html` | The whole client. Paste into a new HTML file named exactly `index`. |

Deploy as a **Web app** with **Execute as: Me** and **Who has access: Anyone**.
The non-technical walkthrough (with copy buttons and a live demo) is
`../OPEN-ME.html` / `../standalone/5c-pulse.html`.

## Design notes

- **One RPC.** The client calls `google.script.run.api(token, action, data)`
  for everything. Responses are `{ok:true, ...}` or `{ok:false, error}`;
  an invalid token returns `{ok:false, auth:false}`.
- **Auth.** Name + 4-digit PIN (salted SHA-256 via `Utilities.computeDigest`).
  A login rotates a UUID token (one signed-in device per person). Five wrong
  PINs → 5-minute lockout. PINs are returned exactly once, to the admin.
- **Storage.** Six sheets — `Meta`, `People`, `Tasks`, `Messages`, `Profiles`
  (the question sets), `Updates` (one row per person per day) — created on
  first use in a spreadsheet named "5C Pulse — Team Data". Columns are
  text-formatted (`@`) so Sheets never coerces dates/booleans/formulas;
  `readAll()` also normalizes any `Date` back to strings (google.script.run
  cannot serialize Dates). Nothing is hard-deleted.
- **Updates snapshot their questions.** An update row stores
  `[{l,t,u,v}]` — label, type, unit, value — copied from the question set at
  submit time, so history stays readable after any set is reworded, replaced,
  or archived. One row per person per day; re-submitting the same day edits
  that row in place.
- **Upgrading an existing deployment** is just pasting the two new files over
  the old ones and re-deploying (Manage deployments → New version). On the
  next request `ensureSchema()` — guarded by a script property so it costs one
  property read afterwards — adds the two sheets, stretches `People`'s header
  to the new `profile_id` column, and seeds the starter sets once.
- **Polling.** `pull({since})` short-circuits with `{unchanged:true}` using a
  version counter mirrored in `CacheService`, so idle polls don't touch the
  spreadsheet. Client polls ~12 s visible / ~45 s hidden.
- **Messages** are one table wearing three hats: chat (`kind: chat`), system
  notices (`notice`), and rings (`ring`) that take over the recipient's screen
  until answered; `task_id` attaches any message to a task as its comment
  thread. Answers land in the `acks` column (JSON).
- **Writes** are serialized with `LockService.getScriptLock()`.

## Demo & tests without Google

- `fake-google.js` implements just enough of `SpreadsheetApp`, `LockService`,
  `CacheService`, `PropertiesService`, `Utilities`, `ScriptApp` on top of
  `localStorage` for the real `Code.gs` to run in a browser. Tokens go to
  `sessionStorage` in this mode, so every tab is its own "device".
- `node build-demo.js` → `demo.html` (client + server + fakes in one page).
- `node build-guide.js` → `../standalone/5c-pulse.html` (the setup guide with
  the demo embedded and copy buttons carrying the two files).
- Playwright suites (`tests/`) drive two tabs as two people:
  `two-devices.js` — setup → add member → task + ring → alarm answered →
  status → stuck → comments → chat → PIN reset forces sign-out → lockout;
  `review-fixes.js` — what an adversarial review turned up (below), with
  `FAKE_OPEN_FAILS` injecting a Sheets outage; `updates.js` — seeded question
  sets → a Video Editor files her minute → nudge bell → streaks, week totals,
  history → rewording a set live → inventing a Chef set → archiving; and
  `guide.js` over the built guide page.

## What the review changed

An adversarial pass over both files found these, each now fixed and covered
by a test:

- **A Sheets hiccup could orphan the team's data.** `ss()` treated any
  `openById` failure as "the sheet is gone" and created a fresh empty one,
  repointing `SS_ID`. It now only creates when no `SS_ID` exists and otherwise
  lets the error surface, so a transient outage looks like an outage.
- **A poll could undo a PIN reset.** `pull()` wrote the whole People row from
  a snapshot taken before the request's lock, so a reset (or sign-out) landing
  in between was reverted — the new PIN silently wouldn't work. Presence now
  writes one cell.
- **Answering a ring could fail to stick.** The optimistic ack mutated a
  message object that the next poll had already replaced, so the alarm came
  straight back. Answers are tracked by message id.
- **A transient error signed everyone out.** `boot()` discarded the saved
  token on any `{ok:false}`; only `auth:false` does that now.
- **Stale admin rights.** Admin actions trusted the role read before the lock;
  they now re-read the caller inside it, and the team can never be left with
  zero admins.
- Comments on a task now follow the same owner/giver/admin rule as the rest of
  the task; the login screen no longer reveals who the admins are; tasks whose
  owner has left stay editable; double-taps can't post twice; chat read marks
  are per person; presence and "due today" keep up with the clock.

# 5C Pulse — Google Apps Script edition

The team tool 5 Circles actually runs on: tasks, updates with attachments,
chat on record, and ring-until-answered alerts, backed by a Google Sheet in
the owner's Drive (attachments live in a Drive folder next to it).

## The two files that matter

| File | Where it goes |
| --- | --- |
| `Code.gs` | The whole server. Paste into the `Code.gs` file of a new Apps Script project. |
| `index.html` | The whole client. Paste into a new HTML file named exactly `index`. |

Deploy as a **Web app** with **Execute as: Me** and **Who has access: Anyone**.
The non-technical walkthrough (with copy buttons and a live demo) is
`../OPEN-ME.html` / `../standalone/5c-pulse.html`.

**Upgrading an existing deployment**: paste the new files over the old ones,
then *Deploy → Manage deployments → edit → New version*. The first run asks
the owner to authorize again (the app now also touches Drive, for attachments,
and Mail, for the email features) and widens the sheet's columns by itself —
existing people, tasks and messages are untouched.

## What the tool does now

- **Light & dark mode** — a two-option ☀️/🌙 switch in the header; the choice
  sticks per device (`localStorage`), applies to the login screen too.
- **A faster bell** — clients poll every 5 s while visible (20 s hidden), so a
  ring lands in seconds. The unchanged-poll path is still just a cache read.
- **Profile photos** — everyone uploads their own from *My profile* (the chip
  in the header). Photos are square-cropped and shrunk to ~8 KB on the phone
  itself and shown everywhere a face appears, the login screen included.
- **Designations** — "Receptionist", "Video Editor"… set by an admin, shown on
  the team card, the profile sheet, and stored with the person.
- **Updates tab** — post what got done, attach files/screenshots (stored in
  Drive, link-shared), tick **Needs review** to ask for eyes; anyone else can
  **Mark reviewed ✔**, visibly. Chat accepts the same attachments.
- **Instant chat** — messages render optimistically the moment Send is
  tapped and reconcile with the server's copy on the next pull.
- **Daily duties** — one standing responsibility per person (the
  receptionist's "Get GMB profile reviews"): a To-do for it is created
  automatically every morning (first pull of the local day, Asia/Kolkata),
  and immediately on the day the duty is first set.
- **Email** — each person can carry an email address; *Send email* on their
  profile emails them from the tool (noted on record), and a **ring to
  someone not seen for 5+ minutes automatically lands in their inbox too** —
  for people away from the tool or anything beyond office hours.
- **Mobile numbers** — on every profile, tap-to-call and WhatsApp links.
  People edit their own number/email/photo; everything else stays admin-only.
- **Admin-only team management** — unchanged and now stated in the UI:
  adding, removing, roles and profile edits are refused server-side for
  members regardless of what a client sends.

## Design notes

- **One RPC.** The client calls `google.script.run.api(token, action, data)`
  for everything. Responses are `{ok:true, ...}` or `{ok:false, error}`;
  an invalid token returns `{ok:false, auth:false}`.
- **Auth.** Name + 4-digit PIN (salted SHA-256 via `Utilities.computeDigest`).
  A login rotates a UUID token (one signed-in device per person). Five wrong
  PINs → 5-minute lockout. PINs are returned exactly once, to the admin.
- **Storage.** Four sheets — `Meta`, `People`, `Tasks`, `Messages` — created on
  first use in a spreadsheet named "5C Pulse — Team Data". Columns are
  text-formatted (`@`) so Sheets never coerces dates/booleans/formulas;
  `readAll()` also normalizes any `Date` back to strings (google.script.run
  cannot serialize Dates). Nothing is hard-deleted. People also carry
  `photo` (a tiny data-URL), `designation`, `mobile`, `email`, `duty`;
  messages carry `file_id/file_name/file_mime/file_url` and `review`.
  A `SCHEMA` script property gates a one-time header migration for sheets
  created by older versions.
- **Attachments** go to a Drive folder ("5C Pulse — Files"), shared
  read-by-link so teammates can open them without a Google sign-in; the
  message row stores only the link. Images are downscaled client-side, other
  files are capped at 4 MB.
- **Polling.** `pull({since})` short-circuits with `{unchanged:true}` using a
  version counter mirrored in `CacheService`, so idle polls don't touch the
  spreadsheet. Client polls ~5 s visible / ~20 s hidden — quick enough that
  the bell rings in seconds.
- **Messages** are one table wearing four hats: chat (`kind: chat`), system
  notices (`notice`), team updates (`update`, always to ALL, optionally
  flagged for review), and rings (`ring`) that take over the recipient's
  screen until answered; `task_id` attaches any message to a task as its
  comment thread. Answers — and "Reviewed ✔" marks — land in the `acks`
  column (JSON).
- **Email** goes out through `MailApp` as the owner, name-tagged with the
  sender and reply-to'd to the sender's address when known. Rings to someone
  not seen for 5+ minutes email automatically; `sendEmail` is the deliberate
  kind. Both are wrapped so a mail hiccup never blocks the message itself.
- **Daily duties** spawn inside `pull` behind a per-day cache/meta guard
  (`duty_day`), computed in the company timezone (`Asia/Kolkata`).
- **Writes** are serialized with `LockService.getScriptLock()`; self-profile
  writes go cell-by-cell to the caller's fresh row so a concurrent PIN reset
  is never overwritten.

## Demo & tests without Google

- `fake-google.js` implements just enough of `SpreadsheetApp`, `LockService`,
  `CacheService`, `PropertiesService`, `Utilities`, `ScriptApp`, `DriveApp`
  (attachments become data-URLs in the fake DB) and `MailApp` (emails are
  recorded, never sent) on top of `localStorage` for the real `Code.gs` to
  run in a browser. Tokens go to `sessionStorage` in this mode, so every tab
  is its own "device".
- `node build-demo.js` → `demo.html` (client + server + fakes in one page).
- `node build-guide.js` → `../standalone/5c-pulse.html` (the setup guide with
  the demo embedded and copy buttons carrying the two files).
- Playwright suites in `tests/` drive two tabs as two people
  (`node appsscript/tests/<name>.js`, needs `playwright-core`):
  `two-devices.js` covers setup → add member → task + ring → alarm answered →
  status → stuck → comments → chat → PIN reset forces sign-out → lockout;
  `review-fixes.js` covers what an adversarial review turned up (below), with
  `FAKE_OPEN_FAILS` injecting a Sheets outage; `guide.js` checks the built
  guide page; `new-features.js` covers the dark mode, poll cadence, photos,
  admin-only management, designations, instant chat, the Updates tab with
  attachments and review marks, daily duties, email, and mobile numbers.

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

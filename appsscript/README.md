# 5C Pulse — Google Apps Script edition

The team tool 5 Circles actually runs on: tasks, chat on record, and
ring-until-answered alerts, backed by a Google Sheet in the owner's Drive.

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
- **Storage.** Four sheets — `Meta`, `People`, `Tasks`, `Messages` — created on
  first use in a spreadsheet named "5C Pulse — Team Data". Columns are
  text-formatted (`@`) so Sheets never coerces dates/booleans/formulas;
  `readAll()` also normalizes any `Date` back to strings (google.script.run
  cannot serialize Dates). Nothing is hard-deleted.
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
- Playwright suites (kept outside the repo during development) drive two tabs
  as two people: setup → add member → task + ring → alarm answered → status →
  stuck → comments → chat → PIN reset forces sign-out → lockout.

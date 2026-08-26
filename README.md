# 5 Circles HQ

One Google Sheet that runs the company. No app, no server, no logins to build,
no code to paste, nothing to maintain — and nothing that can quietly die.

This repository holds the **builder** for that sheet and the built file:

```
build_sheet.py            # generates the workbook (python3 build_sheet.py)
dist/5-circles-hq.xlsx    # the built workbook — upload this to Google Drive
```

## Why this, after three apps

Three earlier versions of "the 5 Circles tool" live in this repo's git history
(and on the `claude/5c-pulse-operating-system-35n8y0` branch):

1. A Next.js + Supabase + Vercel app — required a database, env vars, cron
   secrets and a deploy pipeline. Never deployable by a non-technical team.
2. A single offline HTML file — deployable, but single-computer and
   single-user, so it was a demo, not a tool.
3. A Google Apps Script web app — closer, but still demanded a paste-code,
   deploy-as-web-app, approve-scary-warnings ceremony, and produced a custom
   thing someone has to maintain forever.

All three died at the same wall: **someone non-technical has to deploy and
adopt them.** The only shape that clears that wall completely is a Google
Sheet — already multi-user, realtime, permissioned, free, on every phone via
an app the team uses anyway, with the data visible and owned by the company.
So this iteration makes the spreadsheet *itself* the product, engineered
properly, instead of building an app whose storage was a spreadsheet anyway
(which is literally what attempt 3 was).

## What the sheet is

Seven tabs, in the 5 Circles design language (paper / navy / Varsity blue /
teal / clay, per the brand system):

| Tab | Job |
| --- | --- |
| 📌 Today | Fills itself. Overdue + stuck tasks, due today, leads to call, content running late, who filed day-close yesterday. Sheet-protected so nobody breaks it. |
| ✅ Tasks | One row per job: who, due, status (`To do / Doing / Done / Stuck`). Overdue rows go red, today's go blue, done go green. `Stuck` is a flare — it jumps to the top of Today. |
| 🎬 Content | The production line across all three Instagram accounts (5 Circles / Rahul / Traders Club): post date, format, hook, stage `Idea → Script → Shoot → Edit → Ready → Posted`. |
| 📞 Leads | Every enquiry, same day: source, program, status, **next follow-up date** — which surfaces on Today when it arrives. |
| 🌙 Day Close | Four cells per person per day: what I finished, stuck on, tomorrow's #1. Under a minute on a phone. |
| 👥 Team | Names feed every "Who" dropdown; shows who filed day-close yesterday. |
| 📖 Read me | The manual, in plain language: the daily loop, the rules, 2-minute setup. |

Everything is formulas, dropdowns and conditional formatting. **If it needs a
script, it's out of scope** — that rule is what keeps this deployable and
immortal. The Today lists are native spill formulas (`FILTER`/`SORT`/`TAKE`/
`HSTACK`, stored under their Excel `_xlfn` names for the Drive converter);
the counters are plain `COUNTIFS`. The counter and list logic was first proven
in a classic INDEX/MATCH build that passed a full LibreOffice recalculation —
0 errors across 4,147 formulas, 22/22 seeded expectations correct (see git
history). Seed rows are dated relative to the build date so the dashboard
demonstrates itself on first open.

## Deploying (60 seconds, once)

1. Rebuild if you want today-relative sample rows: `python3 build_sheet.py`
   (needs `openpyxl`). Otherwise use the committed `dist/5-circles-hq.xlsx`.
2. Drag the file into [drive.google.com](https://drive.google.com) of the
   company account.
3. Right-click it → **Open with → Google Sheets**. Google creates the native
   Sheet; you can delete the uploaded .xlsx afterwards.
4. In the Sheet: **👥 Team** → add everyone, then **Share** → add the team as
   Editors. That is the entire deployment.

(An automated push straight into Drive via the connected Google Drive tools
also works — the connector converts uploads to native Sheets; the file just
has to travel as one base64 payload.)

## The daily loop the sheet enforces

- **Morning** — open 📌 Today, fix that list first.
- **During the day** — move Status dropdowns; mark real blockers `Stuck`.
- **Evening** — one 🌙 Day Close row per person, then a ✅ in the WhatsApp
  group. WhatsApp stays for talking; the sheet is for remembering.

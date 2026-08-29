# 5 Circles HQ — putting it online

Ten minutes, once. After this your team just opens a web address.

## What you need
The company Google account (`webinars5circles@gmail.com`) signed in on a laptop.

## Steps

**1.** Go to **script.google.com** → **New project**.

**2.** Rename it (top-left) to `5 Circles HQ`.

**3.** Delete everything in the `Code.gs` editor. Open **`Code.gs`** from this
folder, copy all of it, paste it in. Press **Ctrl/Cmd + S**.

**4.** Click the **+** next to *Files* → **HTML**. Name it exactly `index`
(no `.html`). Delete the sample content, then copy all of **`index.html`**
from this folder and paste it in. **Ctrl/Cmd + S**.

**5.** Click **Deploy** → **New deployment** → gear icon → **Web app**, then set:
- *Execute as:* **Me**
- *Who has access:* **Anyone**

Click **Deploy**. Google will ask you to authorise it — choose your account,
click **Advanced** → *Go to 5 Circles HQ (unsafe)* → **Allow**. That warning is
Google saying "this script was written by you, not by Google"; it is your own
project, and it only ever touches its own spreadsheet.

**6.** Copy the **Web app URL**. That is your app. Open it, type your name, and
you become the admin. Write down the PIN it shows you — it appears once.

## Then
- **Team tab → add each person.** Each gets a 4-digit PIN, shown once. Send it
  to them privately on WhatsApp.
- **Send everyone the URL.** On a phone: open it → browser menu → *Add to Home
  Screen*. It then behaves like an installed app.
- On first open they tap their name and type their PIN.

## Good to know
- **Anyone with the link only sees a login screen.** Every action needs a PIN.
- **Your data** lives in a Google Sheet called *5C Pulse — Team Data* in that
  account's Drive. The team never opens it; the Team tab has a link if you ever
  want it. You own it, it is free, and it cannot expire.
- **Changing the app later:** paste the new code, then **Deploy → Manage
  deployments → edit (pencil) → Version: New version → Deploy.** Keeping the same
  deployment keeps the same URL, so nobody has to re-bookmark anything.
- **Someone forgets a PIN:** Team tab → Reset PIN. The new one stays on screen
  until you tap *Got it*, so you can pass it on before it disappears.
- **You forget YOUR OWN PIN,** and there is no second admin to reset you: open
  the project at script.google.com, pick `recoverPin` from the function list at
  the top, change the name inside it to yours, press **Run**, and read the new
  PIN under *Execution log*. Only the owner of the script can do this, so it is
  not a way in for anyone else. (Worth adding a second Admin on day one so you
  never need it.)
- **Someone leaves:** Team tab → Remove. Their open work moves to you, and their
  day closes stay on the record.

# Task2Day — Task, Study, Steady growth

A daily task and study planner built around one idea: **you should be able to see yourself falling behind.**
Give a task its completion date and say whether it belongs only on that date or
needs regular contribution before it. Break contribution targets down by their
available dates, then open Today and order the untimed work you will actually do.

Single self-contained page. No build step, no dependencies, no server.

## Deploy

Everything is static — drop this folder on any host. HTTPS is required for
install-to-home-screen and for notifications; all of these give you that.

**Vercel** — what this repo is set up for. `vercel.json` carries the cache
headers; there is no build step, so Vercel just serves the folder.

```
npm i -g vercel
vercel login
vercel link            # once, from this folder
vercel deploy --prod
```

Or connect the repo at vercel.com/new and it redeploys on every push to `main`.
A private repo is fine — Vercel does not need it public.

Those cache headers matter more than they look. `index.html` **is** the app and
its name never changes, so it is sent `max-age=0, must-revalidate`: Vercel
answers 304 from the ETag when nothing changed, which costs one round trip
instead of 0.6 MB. `sw.js` gets the same treatment, because a cached service
worker is one that never updates. The worker is network-first for the document,
so a stale copy must not keep serving an old build to installed clients. Icons and the
manifest get a day with `stale-while-revalidate`, not `immutable`, since their
names are not content-hashed.

Do not put `"//"` comment keys in `vercel.json`. Vercel validates it strictly and
a header route accepts only `source`, `headers`, `has` and `missing` — anything
else fails the deploy with *"should NOT have additional property"*. The reasoning
lives here in the README instead.

**A CLI `vercel deploy --prod` is a one-shot upload — it does not watch GitHub.**
Pushing to `main` deploys nothing until the repository is connected under
**Project → Settings → Git**. Connecting it is a dashboard action; no property in
`vercel.json` can do it.

**Firebase Hosting** — same origin as the database, if you prefer that.
```
firebase init hosting     # public directory: .   (this folder)
firebase deploy
```

**GitHub Pages** — only for a public repo, or a private one on a paid plan;
Pages is not available for private repos on GitHub Free. There is no workflow in
this repo (it would fail on every push while the repo is private). To use Pages,
make the repo public and add `.github/workflows/pages.yml` running
`actions/configure-pages` → `upload-pages-artifact` (path `.`) →
`deploy-pages`, with `pages: write` and `id-token: write` permissions, plus an
empty `.nojekyll` at the root.

Redeploying? Bump `CACHE` in `sw.js` and `BUILD` in the template — `BUILD` is
printed in Settings, so you can tell at a glance whether the thing in your hand
is the thing you deployed.

### Why the worker is network-first for the page

The app **is** `index.html` and its name never changes, so a cache-first rule
for it is a trap: the page is served from cache forever, and the only thing
that can break the loop is a new service worker — which the stale page has no
reason to go looking for. That is how a device ends up pinned to a build from
weeks ago with no way to refresh out of it, which is exactly what happened.

So the document is **network-first**, with the cache as the offline fallback;
icons and the manifest stay cache-first with a background refresh, since they
are what make an offline open fast. The page also watches for a new worker,
sends it `SKIP_WAITING` rather than waiting for every tab to close, and
reloads once on `controllerchange`. Settings carries a **Refresh** button that
unregisters every worker, deletes every cache and reloads — the escape hatch
for a device already stuck.

Measured: from the old cache-first worker, an ordinary reload swaps the worker
and the next one serves the new page — two reloads, no devtools. On the
network-first worker a single reload is enough.

### Offline use and sync

After one successful online sign-in and load, Task2Day is fully usable without a
connection. The service worker provides the app shell; an IndexedDB record
provides the signed-in account and every key in `PERSIST_KEYS`. Changes are
written to the device first, marked pending, and uploaded to
`users/<uid>` automatically when the connection returns. Settings shows the
current device/cloud status, and the Dashboard only adds a status chip when
something is offline, preparing, or waiting.

The device copy wins when it has pending edits, so reconnecting cannot replace
offline work with an older Firebase snapshot. A different Google account never
inherits that copy: changing accounts clears the prior account's device state
before loading the new one, and signing out clears it too. The first ever use
still needs a connection because the browser has no authenticated account or
cached shell yet.

Card images keep their fast `localStorage` cache and use a compact IndexedDB
operation queue while offline. On reconnect each queued image add or deletion
is applied to the `cardImages` sibling after the main state update.

### Firebase authorized domains

Every domain the app is served from must be listed under **Firebase console →
Authentication → Settings → Authorized domains**, or `signInWithPopup` rejects
with `auth/unauthorized-domain`. Since the whole app sits behind the sign-in
gate, an unlisted domain means a deployment that loads and then does nothing.

**Add the production hostname of every deployment you create.** A new Vercel
project means a new hostname, and the old entry does not cover it — the app will
load and the sign-in button will simply fail. Vercel also mints a unique preview
URL per deployment; those are not covered by the production entry either.

### The firebase namespace is not stable

`firebase-app-compat` can be evaluated **twice** in this bundle — the loader
re-creates and re-runs every script tag after it swaps the document, and the
compat build announces it ("Firebase is already defined in the global scope").
The second evaluation replaces `window.firebase` with a *bare* namespace: no
`auth`, no `database` (those components registered against the previous one),
and an empty app list. Measured, after it happens `window.firebase.database` is
not even a function, and anything going through the global throws
**"No Firebase App '[DEFAULT]' has been created"**.

Re-initialising does not fix that, because the components are gone. So the first
complete namespace is pinned on `window.__fb`, and **every** use site goes
through `window.__firebaseApp()` — never `window.firebase` directly. If you add
a Firebase call, use the helper, or it will work until the day the double
evaluation happens and then fail in a way that looks like a config problem.

## Database rules

The client holds the Firebase config, as every Firebase web app does — the API
key is an identifier, not a secret. What actually guards the data is the
Realtime Database ruleset, which must stay deny-by-default with per-user grants:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read":  "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

The root denial is the floor and the `$uid` grants open exactly one subtree per
signed-in user; RTDB rules cascade permissively, so a deeper `true` overrides the
root `false` for that path and nothing else. `users` itself stays unreadable, so
no one can enumerate accounts.

## Working on it

`index.html` is **not hand-editable** — it is a self-contained bundle with
base64 islands. Unpack it, edit the template, pack it back:

```bash
python3 tools/bundle.py unpack     # -> build/template.html   (edit this)
python3 tools/bundle.py pack       # -> writes index.html
python3 tools/bundle.py assets     # manifest contents by size
python3 tools/preview.py           # -> build/preview.html, sign-in stubbed
```

`pack` round-trips byte-identically, so unpack/pack with no edits is a no-op.
`build/` is gitignored. See `HANDOFF.md` for current state and the traps this
codebase has already produced.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app — markup, logic, styles and fonts inlined |
| `manifest.webmanifest` | Makes it installable; name, icons, standalone display |
| `sw.js` | Service worker — caches the shell so it opens offline |
| `icon-192.png` / `icon-512.png` | Standard Task2Day app icons |
| `icon-maskable-512.png` | Padded Task2Day icon for Android maskable shapes |
| `apple-touch-icon.png` / `favicon-32.png` | Apple home-screen and browser-tab icons |
| `vercel.json` | Cache and security headers for the Vercel deploy |
| `tools/bundle.py` | Unpack/pack the islands inside `index.html` |
| `tools/preview.py` | Build a sign-in-stubbed copy for testing |
| `HANDOFF.md` | Current state, outstanding actions, known traps |

## Date format

Every displayed date is **DD/MM/YYYY**, and every one of them goes through
`prettyDate` — that function is the only place to change it. It used to render
"26 Jul", with the year appearing only when it was not the current one: compact,
but two formats to read and ambiguous the moment a year rolls over.

The one thing `prettyDate` does **not** control is `<input type="date">`.
Browsers render those in the device's own locale and no CSS or script can
override it. A phone set to India or the UK already shows DD/MM/YYYY there; the
only way to force it everywhere would be to replace the native pickers with
text fields, which costs the mobile date wheel and is not worth it.

## Dates

`day` used to be a counter and there was no calendar, which made every dated
thing impossible. Everything is real dates now, local-time and keyed
`YYYY-MM-DD`. **Never use `Date.toISOString()`** for a day key — it converts to
UTC and lands on the wrong day for anyone not on Greenwich; `iso()` formats from
the local parts instead. Weeks are Monday-based to match the day strip.

At midnight — and on load, and after a cloud read, since the stored `lastRoll`
may be days old — `rollForward()` runs: every past day still holding work is
written into `history`, unfinished dated tasks move to today and are marked
`carried`. This includes ordinary tasks, automatically split parts and
fixed-time tasks. **Routines are deliberately not carried.** A routine is a
rhythm, not a debt; yesterday's missed gym session is not owed today.

A rolled day is marked as awaiting review, including a genuine zero-task rest
day. The Dashboard points to the newest unreviewed past day so its missing
reasons and 0–10 satisfaction score can be filled later; completing that review
updates the existing history record without carrying the tasks a second time.

## A skipped task reads like a finished one

Skipping used to leave the row upright with a small tag on it, so a list you
had already ruled on looked exactly like work still waiting. A skipped task is
now **struck through and dimmed**, the same as a completed one, and **every
struck row sinks to the bottom** — on Today within its session, and in Plan
across the whole list.

One predicate decides both, so a row can never look settled and sort as open,
or the reverse:

```
settledOn(t, date) = t.done || (t.skipReason && t.skippedOn === date)
```

The date matters. A skip belongs to the day it was made for, so it counts on
Today against the day being viewed and in Plan against the day the task sits
on — reading both against the viewed date was why a task skipped for a future
date looked ordinary in Plan. Unskipping reverses all of it: the strike clears
and the row climbs back to its place.

## Deleting asks first

Every destructive action goes through one dialog: tasks and their breakdowns,
badges, repeat rules, routines, goals, subjects and cards. It names the thing
and says **what goes with it** — the count of children under a task, the tasks
a badge will be unfiled from, the unfinished occurrences a repeat takes — since
"Delete?" answered honestly needs the consequence, not just the verb.

Undo stays where it already was. The two answer different mistakes: the dialog
catches the tap you did not mean, undo catches the decision you regret ten
seconds later. An undo you never noticed is no protection at all, which is why
it was not enough on its own.

The one thing that does **not** go through it is *Erase everything* in Settings,
which has always had its own inline confirmation, and skip/complete actions,
which are reversible in place.

## The daily log

The Dashboard answers *how am I doing*. The log answers *what actually
happened on the 14th*, which is a different question and the one you ask when
a figure surprises you.

It is written from two sources, because neither is complete alone: the day's
**history record** holds the counts, the skip reasons and the satisfaction
score, while the **live task list** is the only place the titles survive —
completed tasks stay on their own date for exactly this reason. Nothing in it
is inferred; every line is something the app was told.

Each day collapses to a headline (finished of planned, hours, how it felt) and
opens into three parts: what was **finished**, with the time it really took
against the estimate; **routines kept**, with their recorded minutes; and what
**did not happen and why**, quoting the reason in the words it was written in.
A day that asked nothing of you says so rather than counting as a failure.
120 days are kept in view. Reachable from the Dashboard, from Settings, and
each entry can open that day for review.

## Skip reasons in your own words

The chips are the common cases, not the only ones. Both the skip sheet and the
evening review take free text, and a chip now **fills the box** rather than
closing the sheet, so it can be used as a starting point and edited. A list
that cannot hold "power cut on site" collects "Something came up", which tells
you nothing three weeks later — and the reason is what the whole
weakness analysis is built on.

Nothing downstream needed changing: `pickReason` and `skipTask` have always
stored a plain string, and the Dashboard counts reasons by value, so a typed
reason groups with itself across days exactly as a chip does.

## Where the app opens, and where you add from

**Task2Day opens on Today.** The app is for doing the day's work; the Dashboard
is a thing you go and look at when you want to know how it is going. The bottom
nav reads `Today · Dashboard · Plan · Revise` for the same reason, and the back
button walks to Today before a second press offers to leave.

The **+ button sits on both the Dashboard and Plan**. The add sheet settles
everything itself — date first, then whether the task is a single day or a
breakable target — so it does not matter which screen it is opened from; Plan is
where work is organised, and the Dashboard is where you most often think of
something. Today keeps its own **+** in the header, which arrives pre-dated to
whichever day you are looking at.

## The model

The user never selects Month, Week or Day. Every new task starts with one date
and one intent:

- **Only on this date** creates one `day` task. It appears in Today on that date.
- **Needs regular contribution** creates a neutral `target`. Its available dates
  determine the month, week and day parts when the user breaks it down.

Generated parts carry a `parent` link. Final day parts also carry a `block` —
the session where their equal daily contribution belongs. Plan is one unified,
date-ordered list; Month, Week and Day are properties of the generated hierarchy,
not tabs or choices. Deleting a parent takes its entire subtree with it.

Goals sit alongside, not above: a goal is a name and a deadline, and any task at
any scope can be tagged to one. Progress is just the share of its tagged tasks
that are done.

Breakdown uses every available date continuously, starting tomorrow and ending
on the selected completion date. Four weeks form one 28-day planning month;
complete seven-day weeks come next; remaining dates become day parts. A target
38 days away therefore becomes **1 month + 1 week + 3 days**. Breaking the month
creates four equal seven-day weeks; breaking a week creates its consecutive day
tasks. Every final day receives the same estimated contribution minutes and
session, so both the dates and daily effort are even and gap-free.

Day tasks carry a **description** as well as a name: the title is what it is, the
description is what to actually do.

**Durations are never invented.** The minutes field starts empty and the sheet
refuses to save without a real figure, or without *Instant* — which is the
honest way to say "this takes no time". A pre-filled 45 was a number nobody
chose, and it went straight into session capacity, the progress percentage and
the estimate-accuracy figures as though someone had.

## Badges

The label answering "which part of my life is this?" — your own work, the
office, a course, a client. Goals are a horizon you are aiming at and most
tasks have none; a badge is a filing cabinet and most tasks want one, which is
why the picker sits at the **top** of the add sheet rather than the bottom.

`state.badges` is `{id, name, tone}`. Colour is stored as an **index into
`BADGE_TONES`, never as a hex value**: the light and dark themes need different
inks for the same badge, and a token resolves per theme while a stored colour
cannot. Tasks and repeat rules carry `badgeId`.

- New badges can be added **from the add sheet itself** — a category you think
  of while filing a task should not cost a trip to Settings. Settings → Badges
  is where they are removed, and shows how many tasks and repeats use each.
- **Deleting a badge unfiles its tasks; it never deletes them.** A label is not
  the work.
- Plan has a chip row that **filters** by badge, each chip carrying the number
  still open under it. A parent whose own badge is unset still shows when one of
  its generated parts carries the badge — filtering a tree on its root alone
  would hide work that does match.
- A new task **inherits the badge Plan is currently filtered to**, so filing
  five office tasks in a row asks the question once.
- Three badges (Personal, Office, Study) ship with a new account so the picker
  is never an empty row. They are ordinary badges and can be deleted — but note
  that emptying the list completely restores them on the next load, because
  Firebase deletes an empty array and `freshState()` refills it.

## Repeating tasks

The other kind of repetition, and the one with a deadline attached: *file GST-1
before the 11th, every month; GSTR-3B before the 20th*. A routine cannot express
this — a routine never carries, and a missed statutory return is exactly the
thing that must.

A **series** is the rule, held in `state.series`. It does not render anywhere in
Today: it **files ordinary dated day tasks ahead of time** and then stays out of
the way. Each filed task carries `seriesId` and the `dueDate` the rule aimed at,
and is otherwise a normal task — it can be skipped, timed, edited, carried,
completed and counted like any other.

Adding one is the ordinary add-a-task flow plus one question — *Does it come
back?* — answered with **Just once · Every day · Every week · Every month**. The
date already chosen is the first deadline, so **the rule reads itself off it**:
11 August with *Every month* becomes "the 11th of every month"; a Friday with
*Every week* becomes "every Friday". Three fields refine it:

- **every N days / weeks / months** — every third day, every other Monday, every
  quarter;
- **days of notice** — how "before the 11th" is said: with two days' notice the
  work lands on your 9th and the row still reads *due 11/08/2026*;
- **repeat until** — the date the rule stops. Empty means no end, which is what
  every rule written before the field existed meant, so it stays the default. A
  rule past its end date says *Finished* in Plan rather than disappearing.

**A daily repeat is not a routine.** They look alike and are opposites: a
routine is a rhythm that never carries and owes you nothing when missed; a daily
repeat is work with a deadline, so a missed one carries and counts. The sheet
says so when *Every day* is picked, because choosing wrong is how you end up
with a fortnight of unfinished gym sessions on one Tuesday.

```
series  { id, title, note, minutes, instant, block, at, priority, goalId,
          unit:'month'|'week', day, days[], every, lead, anchor, until,
          paused, made:{ '2026-08-11': true, … } }
task    { …, seriesId, dueDate }
```

Things worth knowing before changing any of it:

- **`until` is enforced in `seriesDueDates`, and must not be blanked anywhere
  else.** It shipped as a model-only field, so `createSeries` used to overwrite
  it with `''` after building the rule — a rule with a stop date ran forever and
  the only visible symptom was work that would not stop arriving.
- **`made` is what stops resurrection.** It records every due date the rule has
  ever filed. Delete an occurrence you do not need and it stays deleted, because
  the rule already considers that date handled. A second guard scans the tasks
  actually on the board, because Firebase drops an empty map and a rule that has
  filed nothing yet comes back with no `made` at all.
- **Filing runs on every launch and again at midnight**, from `rollForward`.
  There is no scheduler; the horizon (`HORIZON_DAYS`, 70) simply slides forward
  whenever the app is opened, so a phone left closed for a month catches up in
  one pass.
- **The deadline does not move when the task carries.** A missed occurrence
  carries like anything else, but `dueDate` stays put, so the row turns from
  *due 11/08/2026* into *overdue · was due 11/08/2026* rather than quietly
  redating itself.
- **Day 31 in a 30-day month is that month's last day**, never the 1st of the
  next: a monthly deadline never leaves its own month.
- **Notice never files into the past.** A rule added on the 10th with three
  days' notice still puts this month's work on today, not on the 8th.
- **Editing the rule** rewrites every occurrence still open, including one
  already carrying — a renamed task should not keep its old name because it is
  late. Changing the *shape* (unit, day, every, lead) withdraws the unfinished
  occurrences ahead and refiles them from the new rule. **Deleting** the rule
  takes all its unfinished work with it, late ones included; completed
  occurrences stay, because they happened.
- Editing a single filed task from Today or Plan changes **that occurrence
  only**. The rule lives under **Plan → Repeating**, which lists each rule, its
  next few dates, and Edit / Pause / Delete.

## Routines

Kept apart from tasks on purpose. A routine repeats by weekday, is ticked per
date rather than once, never carries over, and is stored with a `done` map keyed
by date. They appear inside the Today sessions alongside tasks and count against
that session's capacity, because an hour of badminton occupies the evening
whether or not it is "work".
Done and skipped routines are mutually exclusive per date. A skipped or simply
missed routine appears in that day's review and its reason is retained in day
history.

A routine with a duration is **measured like anything else with one**: ticking
it opens the same "how long did it take?" sheet a task does, and the answer is
stored in `actual`, a date-keyed map beside `done`. Un-ticking clears that
date's record with it. Those minutes reach the Dashboard through
`routineDoneMinutes` in day history, and each recorded date also counts toward
the estimate-accuracy figure — an hour at the gym that always runs to ninety is
exactly what that number is for.

## Screens

- **Dashboard** — a real month calendar marking targets falling
  due (magenta), days with work on them (blue) and days finished clean (ring);
  what is coming up in the next fortnight; progress at all three zooms — today,
  this week, this month — each over its own real window; a weekly planned vs
  done vs skipped comparison, where postponement clusters and why; **Growth**,
  and out of it *what is working* and *what is holding you back*; then what to
  improve, the week bars, streak and freezes, and weakest recall. A visible
  prompt opens the newest previous-day review still waiting. Every line of
  advice is derived from data you actually entered.
- **Daily routine** — a **section of Settings**, not a screen. It describes
  your week rather than your day: name, description, session, minutes and which
  weekdays. Today only points at it — *Add a daily routine* while none is set,
  a quieter *Edit daily routine* once one is.
- **Today** — that day's tasks only, grouped into Morning / Busy Hours / Evening.
  Under the day's two tiles sits **time used against planned, for every
  session** — including the ones with nothing in them. The tiles are the whole
  day and the session cards below only appear where there is work, so a day
  whose only work is in the morning used to show one card and read as if the
  day figure *were* the morning's. "Used" is real time: the recorded actual
  where there is one, the estimate where the work is done but was never timed.
  Capacity sits beside it, because being under your plan and over your hours
  are different problems.
  timed tasks in clock order and **press and hold to order untimed tasks**.
  Marking a task done asks for actual minutes; the capacity bar then uses actual
  time instead of deleting the completed work. Tasks and routines can be
  skipped with a reason. Review records reasons, a 0–10 satisfaction score, and
  offers carry destinations only when unfinished tasks exist.
- **Plan** — one task list, **unfinished first and date-ordered**, with
  completed work sunk to the bottom in its own date order. Badge chips filter
  it. Add a date-first task, choose due-date only or regular contribution, and
  expand the generated hierarchy inline.
- **Revise** — **subjects** (Computer networks, Structural analysis), each
  holding image cards under a **formula or heading**.
  *Revise all* walks a whole group in one pass rather than interrupting one card
  at a time. Intervals stretch 1 → 3 → 7 → 21 → 45 days.
- **Log** — the day-by-day account, reached from the Dashboard or Settings.
- **Settings** — a **bottom-nav destination**, not a gear on one screen: your
  available hours per session (capacity is the span between them), office days,
  badges, the daily routine, notifications, recall frequency, theme, erase
  everything.

Plan includes one search field above the unified list. It searches root tasks,
their generated month/week/day parts, notes and linked goals. Clearing it restores
the complete date-ordered list.

## Reaching a particular date

Three ways in, in increasing reach:

1. **Today's day strip** — three days back, eleven forward. For "what's on
   tomorrow".
2. **The dashboard calendar** — every cell is a button carrying the **number of
   tasks** on that day, and tapping one opens Today on that date. Routines are
   **not** counted: they repeat by weekday and are a rhythm, not that day's work.
3. **The calendar's ‹ › arrows** walk months, so nothing is out of reach. The
   grid used to be pinned to the current month, which made any date outside it
   unreachable entirely. `monthOffset` browses; `pMonth` still measures the
   real month, so the progress figures do not follow the browsing. Leaving the
   dashboard resets it — coming back to find yourself in March would be a bug.

`openDay` is the whole mechanism: Today is a window on one date and `dayOffset`
is how far it has slid, so opening an arbitrary day is just `daysBetween`.

## Where tasks are added, and what Today is

Every task with a target above it is added on **Plan**, at whichever of the
three zooms is showing — the floating `+` is rendered only on that screen.

Today carries a second, smaller `+` beside its heading for the other case: you
have tapped a date on the calendar and want something on **that** day. It opens
the sheet already dated to the day you are looking at, so the date is never
picked twice, and it is the only thing Today creates. Today is a *view*: it shows one date's
work and lets you tick, focus, reorder and review it, but never creates it. A
task that appears on Today with no target above it is exactly the orphan this
app exists to prevent.

Today's window is `dayOffset`, and it is view state — not persisted, reset on
leaving the screen. `viewDate` follows it; `today` does not, because the
dashboard's rings and block stats must not move when you glance at tomorrow.
Undated legacy rows count as today's, never as whatever day you shifted to, and
*Review the day* is hidden anywhere but today.

Carrying over is `rollForward`, which runs at midnight, on load, and after a
cloud read — the stored `lastRoll` can be days old. Every unfinished dated task
moves to today marked `carried`, including fixed-time tasks and automatically
split parts; only finished tasks stay on their original date. Today counts what
came over and says so above the sessions.

## Notifications will not fire from `new Notification()`

Android Chrome forbids the constructor outright — *"Illegal constructor. Use
ServiceWorkerRegistration.showNotification instead"* — so the permission could
be granted, the switch on, and every alert still fail with nothing in the UI
to explain it. `notify()` goes through `navigator.serviceWorker.ready` and
`showNotification`, keeps the constructor as a desktop fallback, and returns a
promise so the test button can report what actually happened.

## The back button, and leaving

Screens are state, not URLs, so a browser back press would otherwise walk
straight out of the app. `setupBack` keeps **one sentinel history entry** in
front of the entry the app loaded on; back pops it, the handler pushes it
straight back, and the press is spent unwinding the UI instead — deepest
overlay first (cropper, recall, review, then any open sheet), then any screen
back to the **dashboard**. Only from the dashboard does it ask *Leave
Task2Day?*, and a second back press there is read as *stay*.

The sentinel is laid down on sign-in, not on mount. Laid down earlier it
swallows the first back press on the sign-in screen, where back should just be
back — and the gate is `z-index:50`, so a dialog raised behind it would look
like a dead button. For the same reason the `beforeunload` warning, which is
what covers closing the tab outright rather than only going back, is armed on
sign-in and disarmed on the way out so *Leave* does not prompt twice.

## The install banner

It rides in at the top for eight seconds on the way in, then gets out of the
way. `offerInstall` is called when auth resolves to signed-in, **not** from
`componentDidMount`: mounting happens while the sign-in gate still covers the
app, so a banner started there spent its whole life behind the gate and was
gone by the time anyone got in. Dismissing it with the × is a **snooze**, not a burial: it sets
`sp.installSnooze` a week ahead and the banner is back after that. The old
`sp.installDismissed` flag suppressed it permanently, so a single stray tap
meant it never appeared again — that key is now deleted on sight.

## Sessions and days

The three sessions are `morning` / `noon` / `evening` as **keys**, labelled
Morning / **Busy Hours** / Evening in `BLOCKS`. Keys are what stored tasks and
hours are filed under, so a label can be reworded without touching anyone's
data — reword the label, never the key.

Office-day chips are built from `DAYS`, **not** `Object.keys(state.office)`.
Firebase hands an object's keys back in lexicographic order, so after one cloud
round trip that rendered the week as Fri Mon Sat Sun Thu Tue Wed. They carry
two-letter labels for the same reason: a row of M T W T F S S is two Ts and two
Ss you have to count positions to tell apart.

## Installing, and why a button cannot do it

No script can put an app on a home screen. Chrome hands over a
`beforeinstallprompt` event, which is captured and replayed when **Install** is
tapped; without it — Safari always, Chrome until the page qualifies — the
button opens a short **instructions sheet** keyed to the browser instead.

Naming the right menu item is the whole point of that sheet. Chrome's *Add to
Home screen* **shortcut** and an *Add to Home Screen* done from a non-Safari
browser on iPhone both drop a **bookmark that reopens in a browser tab** — the
exact thing installing is meant to avoid. The sheet says *Install app* on
Android, and sends iPhone users to Safari first.

The manifest carries `"display": "standalone"`, a stable `"id"`, and
`start_url` `"./"` so the installed icon opens the app full screen rather than
in a tab. Install also requires **HTTPS** — over plain HTTP no browser offers
it at all.

## Recall frequency

Six chips (5m → 4h) for the common intervals, plus a free minutes field taking
anything from **5 minutes to 12 hours**, a per-day cap, and a window recalls
are allowed in at all. The window may wrap past midnight — `21:00 → 07:00` is
read as the two ends of the day. Outside it the timer keeps ticking and simply
does not pop, which is one more entry in the `blocked` list in `schedule`
alongside an open overlay, a running timer, the daily cap and a fixed
appointment.

## Ordering

Plan is always sorted by its real date (`targetDate` for month/week and `date`
for day). It is not draggable. On Today, timed tasks stay first in clock order.
`order` ranks only the remaining untimed, unfinished tasks and long-press is the
only thing that writes it; priority is a fallback for legacy rows with no order.
Timed and finished tasks are not draggable.

The drag is delegated from the document and keyed on `data-list` / `data-id`, so
it survives re-renders without per-row refs, and it never calls `setState` until
the finger lifts — a render mid-gesture would rebuild the rows and strip the
transforms it is driving. `_dragging` holds the clock and recall timers still
while it runs.

## Images

Attaching a formula opens a cropper: pan and pinch under a fixed square frame,
and only the framed region is drawn to a canvas on save, so what is stored is
the crop you chose rather than the whole photo. Two things there are easy to
get wrong and are deliberate:

1. The `<img>` is `pointer-events:none`. Dragging an image starts Chrome's
   native image drag, which fires `pointercancel` and kills the gesture after
   two moves.
2. The gesture handlers are on the document, not the frame. Bound to the frame
   they are lost after one move — every move sets state, and the re-render can
   hand back a different DOM node.

**A data URL cannot go through an inline style string.** It carries a
semicolon — `data:image/jpeg;base64,…` — and the runtime splits a `style`
attribute on `;` before React sees it, so `background-image:url(data:image/jpeg
;base64,…)` arrived truncated at `data:image/jpeg` and resolved to nothing.
Every card image was cropped, stored, synced to the account **and never once
painted**. Card images are `<img>` elements whose `src` is assigned in
`syncCardImages` from `componentDidUpdate`, out of the style string entirely —
the same reason the cropper assigns its own `src` imperatively.

It is worth saying how this survived: the earlier fix verified state, bindings
and the account round trip, all of which were correct. Nothing checked the
painted result. `naturalWidth > 0` on the rendered `<img>` is the only
assertion that would have caught it.

Images are keyed by card id and stored twice: in `localStorage` under
`sp.cardImages`, for an instant first paint, and in Realtime Database under
`users/<uid>/cardImages/<cardId>`. They are still **stripped from the
`PERSIST_KEYS` payload** before every save — megabytes of base64 have no
business in a debounced whole-state write — but `storeImage` writes the one
image that changed to its own key, so an image survives a cleared cache and
follows the account to another device. Offline image changes add a compact
operation to the IndexedDB record; the data URL remains only in the existing
image cache and is uploaded when the connection returns.

Because the images sit in a sibling of the synced keys, `saveCloud` uses
`update()` rather than `set()`. `set()` replaces the entire user node, which
deleted `cardImages` on the very next save and made an added image disappear
the next time the app was opened. On sign-in `loadCloudImages` merges the
account copy over the device cache and lifts anything device-only up into the
account, which migrates images added before they were synced.

## The bottom nav

The ordinary bottom bar every phone app has: a 22px stroke icon over an 11px
label, with **colour alone** saying which tab you are on — accent for the
current one, 55% text for the rest. A hairline top border because content
scrolls under it.

Borders around each tab and filled pills behind the labels were both tried and
both read as clutter. A tab bar is chrome; chrome should be quiet.

Icons are single `d` strings in `NAV_ICONS` so the whole set rides in one
template binding, drawn `fill:none, stroke:currentColor` — nothing but colour
changes between states. The spacer that clears the add button is only present
on Plan, since that is the only screen the add button is on; a permanent gap
with nothing in it is the sort of thing you notice and cannot explain.

## The nav's height, and the phone's own bar

The nav box was **84px tall with its buttons pinned to `flex-start`**, so
roughly 26px of it was dead space sitting directly above the phone's
home/back/recents bar — read as a gap, because it was one. It is **46px** with
the items centred — label to screen edge went from ~50px to 16px — and every offset coupled to it moved with it: the FAB, the
timer bar, the toasts and `.scr`'s bottom padding. Change one of those and you
must change all five, or something ends up floating.

`env(safe-area-inset-bottom)` is added on top of that height on phones, never
baked into it — the inset is the hardware's home indicator, not padding of
ours.

## Layout — phone, tablet, desktop

One markup tree, three shapes, decided by two media queries in the `<helmet>`
style block:

| Width | Shape |
| --- | --- |
| ≤ 560px, or any installed PWA | Edge to edge. The real phone. |
| 561–899px | The drawn 390×844 frame — a presentation device, not the app. |
| ≥ 900px | Desktop: full window, nav rail down the left, centred dialogs. |

```
@media (max-width: 560px), (display-mode: standalone) { ... }
@media (min-width: 900px) { ... }
```

### Desktop

At 900px the frame stops reading as a deliberate presentation and starts
reading as a small picture of an app in a large empty room, so:

- the shell goes edge to edge and the drawn notch is hidden;
- the **bottom nav stands up into a 232px left rail** — same buttons, same
  order, laid horizontally with room for their labels, with hover and a filled
  current item;
- content sits beside the rail in a centred **860px column**, which keeps a
  line of prose one line of prose however wide the window is. The month grid
  caps at 520px inside it, because square day cells stretched across the full
  column turn the month into a wall of 140px tiles;
- **bottom sheets become centred dialogs.** A sheet rising from the bottom edge
  is a thumb affordance and means nothing under a mouse. `align-self:center`
  is what overrules the overlay's inline `place-items:end center`;
- **row actions lie down.** Skip / Focus / Edit / Delete stack vertically to
  stay narrow under a thumb; with a desktop row to spend, stacking them made
  every task 150px tall for nothing;
- the **+** moves to the bottom-right corner, and **Escape closes** whatever is
  open — routed through the same handler the phone's back button uses, but only
  while something *is* open, so Escape on a bare screen never raises "leave the
  app?" out of nowhere.

Everything above is CSS over the same DOM. The layout is written in inline
styles, so these rules carry `!important` where they must beat one: a deliberate
cost, paid once, rather than a second markup tree to keep in step with the
first. The classes they hang on — `.month-grid`, `.row-actions`, `.sheet-panel`
— exist only for this; if you add a sheet or a row, give it the matching class
or it will keep its phone shape on a 27-inch monitor.

Under it the shell drops its padding, `.app` goes `100dvh` with no radius or
shadow, and `.device-chrome` — the drawn notch, clock, "5G" and battery — is
hidden, because on a real phone the device already has those. Above it, the
390×844 frame stays: it is a **presentation device** for showing the design on a
desktop, not part of the app.

Anything pinned to the bottom (`.bottom-nav`, `.fab-add`, `.timer-bar`,
`.toast`, `.review-sheet`) offsets itself by `env(safe-area-inset-bottom)`, and
`.scr` clears the notch with `env(safe-area-inset-top)`, so nothing lands under
the home indicator or the camera cutout. `viewport-fit=cover` on the viewport
meta is what makes those insets non-zero — do not drop it.

Touch targets are held at 44px on phones. Controls whose drawn size is smaller
(the 22px done-toggle, the 12px ghost buttons) keep their size and grow only the
area that answers a finger, via the transparent `.tap::after` overlay — changing
the real boxes would reflow rows tuned to the type scale. `.input` is forced to
16px there too, because iOS Safari zooms the page in on focus for anything
smaller and never zooms back out.

## Type — and why it changed

The app was **Source Serif 4 for everything**. A serif at 12–15px on a phone
reads bookish rather than professional, and every button, tag, numeral and nav
label was wearing it. **Source Sans 3** (variable, 200–900, one file per subset)
now carries all of that; the serif is kept for `h1`/`h2` display headings, where
it still earns its keep and gives the app a voice.

The display rule is declared **after** the reset's own `h1..h6` block. That
block sets `font-family` at the same specificity, so declared before it the
serif silently lost on source order and every heading came out sans.

## Old type notes

Source Serif 4, and it really is loaded now. The `@font-face` block used to sit
inside `<style media="print">` with nothing to promote it back to screen — that
technique needs `<link rel=stylesheet media=print onload="this.media='all'">`,
and an inline `<style media=print>` simply never applies. The app had been
rendering in the Georgia fallback with every heading weight faked by the
browser's synthetic bold. The faces are inline base64 in the same document, so
there was never a network fetch to keep off the critical path; the guard is gone.

The roman is a **variable** face with a 200–900 weight axis, previously served
twice pinned to static 400 and 600. The `@font-face` now declares
`font-weight: 200 900`, so real 700/800 costs no extra bytes. Headings are 700,
display figures 800 with tabular lining numerals, and display sizes are fluid
(`clamp()`) so a 320px phone and a 430px phone each get a headline in proportion
to its column. Tracking tightens as size grows.

Only **latin** and **latin-ext** subsets ship. Cyrillic, Greek and Vietnamese
were dropped (161 KB) and fall back to Georgia, which covers them. Restore those
`@font-face` blocks and their assets if the app ever needs those scripts.

## Text size

Settings → Appearance carries five steps, S to XXL. Every size in this app is
a hard px value in an inline style — there is no root font-size to turn — so
the control sets `zoom` on `.scr`, which scales the scroll area whole: text,
spacing and cards together, which is what "bigger text" means on a phone. The
fixed chrome is deliberately left out of it: the nav, toasts and sheets stay at
their designed size so the tap targets do not move under your thumb.

Five steps rather than a slider. A slider invites hunting for a value that does
not exist; each of these is legible and the jump between them is visible.

## An undefined token is not an error — it is just gone

The spacing scale ran 1, 2, 3, 4, **6**, 8. Nine call sites had been written
against `--space-5`, and every one of them resolved to nothing: `padding:
var(--space-5)` computed to `0px`, silently. That is how a dialog ends up with
its text flush against a rounded corner and looking cropped. CSS does not warn,
the style attribute still reads correctly in devtools, and only
`getComputedStyle` tells the truth — which is what caught it.

`--space-5: 25px` now exists. When adding a token-based style, check the token
is real: a quick sweep is
`getComputedStyle(document.querySelector('.app')).getPropertyValue('--name')`.

## Colour and shape

The system was a hard-edged broadsheet: radii of 1/2/4px, one accent, no fills.
It is card-based now, on a lightly tinted ground.

- **Radii** 8/14/22px plus `--radius-pill`. Cards need room to read as cards
  rather than boxes ruled on a page.
- **`--card-*` / `--ink-*`** — six pale card fills, each paired with an ink of
  the same hue driven dark, so a heading on a card never falls back to plain
  black. Both sets are redefined for the dark theme; the pale fills would blow
  out otherwise.
- **`.card-panel`** — the white panel the layout is built from.
- **`BLOCK_SKIN`** gives each session its own colour, so a glance at Today says
  which part of the day you are looking at before you have read a word.
- The Today **day strip** runs three days back and eleven forward, dot-marked
  where there is work, and is the same `dayOffset` the arrows drove.

Done on Dashboard and Today. Plan, Revise and Settings still wear the older
flat treatment inside the new tokens — they inherit the radii, type and ground,
but not the cards.

## Motion

`.scr` scrolls smoothly, and section blocks tagged `.reveal` fade up as they
enter the viewport. The reveal runs on a CSS **scroll timeline**
(`animation-timeline: view()`), wrapped in `@supports` — where the engine lacks
it the animation never applies and content is simply visible, so it decorates
and never gates. Everything stands down under `prefers-reduced-motion: reduce`.

## Weight

`index.html` is one blocking document, so every byte is on the critical path.

| | before | after |
| --- | --- | --- |
| `index.html` | 2.20 MB | 0.79 MB |
| gzipped | 1642 KB | 463 KB |
| DOMContentLoaded, Fast 3G | 11.8 s | 3.2 s |

The previous mark was embedded in the bundle. Task2Day now uses the supplied
brand artwork as shared external icon assets for the loading screen, sign-in,
header, Settings, browser tab and installed PWA. This avoids shipping a second,
stale logo inside the base64 bundle and keeps every visible surface on the same
artwork. The connected outer background is removed with an edge flood-fill,
then the alpha contour is supersampled before each icon size is rendered, so
the rounded silhouette stays smooth without changing the lettering or calendar.

Assets are referenced from **two** islands: `__bundler/template` and
`__bundler/ext_resources`. React and ReactDOM appear only in the latter — prune
by the template alone and the app boots blank trying to reach unpkg.com.

## Schema migrations — never bump without one

`loadCloud` used to discard anything not on the current `SCHEMA` and drop the
user into `freshState()`. That is a **silent wipe of a real account** every
time the state shape changes, and it is the single most dangerous thing this
codebase has done. There is a `MIGRATIONS` ladder now: one function per
version, run in order, so an account three versions behind arrives intact.
**Add a step whenever you bump `SCHEMA`.**

What cannot be migrated — a version from the future, or a blob with no version
at all — is no longer thrown away either. It is held on `this._orphan`, the
dashboard says so in a card that cannot be missed, and the user can download
it as JSON before anything writes over the top.

One trap, found by measuring: `const data = snap.val()` cannot be reassigned,
so `data = migrate(data)` threw a `TypeError` that the promise's own `.catch`
swallowed — the account loaded as empty with no error anywhere. It is `let`.

## The streak measures days, not paperwork

It used to advance only through *Review the day*. Finish a full week and
forget to tap it once and the counter read zero — a streak that punishes you
for not filing paperwork measures nothing. `rollForward` settles every day it
closes on that day's own evidence: work finished holds it, a day with nothing
planned is a rest day and holds it too, a day with work left untouched breaks
it. `streakSettled` marks the last day ruled on, so a day Review already
judged is not counted a second time.

## Growth — strengths, weak spots, and what to do about them

The Dashboard's analysis reads four weeks back and never invents a number.

Each of the last 28 days resolves to one record: its **history** entry if the
day is closed, or the same record derived from its live tasks if it is not, so
today counts once and is not counted twice. A date nothing was ever asked of
returns nothing at all and is left out — a rest day is not a failure, and
averaging it in would say it was.

From those days:

- **Four bars, seven days each, counting back from today.** Bar height is hours
  of work actually finished; the figure above it is the share of that stretch's
  tasks completed. Two different questions on purpose — a good percentage on a
  nearly empty week is not a good week, and the pair shows which one you had.
- **Sessions and weekdays** are scored from `byBlock` and the day-of-week, and
  reported only once at least four planned tasks sit behind the number.
- **Estimation bias** compares recorded actual minutes against the estimate over
  completed tasks. Five timed tasks minimum; under ±15% is a strength, over +20%
  or under −25% is a weak spot with a specific correction.
- **Consistency** is the share of days that asked for something and got
  something.
- **Carry debt** is read off live tasks: how many are carrying, how long that
  is in minutes, and which single task has moved the most times.
- **Reasons** are counted across the whole four weeks, not this week alone. A
  pattern needs more than five days to be one.

The same measurements feed *what is working*, *what is holding you back* and
*what to improve*; a measurement earns a place in one list or the other, never
both, and only when it is decisively good or bad. The advice lines are
instructions rather than observations — they name the thing to change and where.

## Known limits — read before building on this

1. **Offline use starts after the first successful online sign-in.** Google sign-in still
   establishes the account. From then on, `PERSIST_KEYS` are saved device-first in IndexedDB
   and debounced to Realtime Database under `users/<uid>`; pending device edits win on reconnect.
   Signing out intentionally clears the device record. `SCHEMA` guards the shape and the
   `MIGRATIONS` ladder upgrades older snapshots. Note Firebase stores no empty arrays or objects
   at all (it deletes the key), so anything the user has legitimately emptied comes back missing
   and is refilled from `freshState()` on load.
   Nothing in the payload may be `undefined`: `update()` rejects the whole write when any value
   in the tree is, so a single stray property stops every later save with nothing but a console
   error to show for it. `persistedPayload` runs `stripUndefined` over the payload as the last
   gate, and code that builds a task should set a key only when it has a value — `{...x,
   actual:x.actual}` on a task with no `actual` is exactly the shape that broke it in the wild.
   *(Note: `componentDidUpdate` is called by the DC runtime with `prevProps` only — there is no
   `prevState` argument. Comparing against one throws inside a runtime `try/catch`, which
   silently disables the save. Track previous values yourself; see the comment on that method.)*
2. **Notifications cannot fire when the browser is closed.** The page's timers only run while it
   is alive. An installed PWA can notify while backgrounded on Android; iOS is stricter. Real
   scheduled alarms need a server pushing to a native app or Web Push with a subscription —
   `sw.js` already handles `notificationclick`, so the client half is ready.
3. **There is no seed data.** A new account starts genuinely empty and every screen has an
   empty state. Nothing in the render path may assume a non-empty array — that was the whole
   class of crash when the demo data came out.
4. **The exam pace figure** assumes goal progress is measured in hours. Adjust if you track
   topics or chapters instead.
5. **A repeat files 70 days ahead and no further.** That is two or three monthly
   occurrences, enough for the calendar's next month without burying Plan under
   a year of identical rows. Anything beyond that arrives the next time the app
   is opened, so a device left closed for months catches up rather than losing
   dates — but a rule cannot be used as a long-range archive of future work.
6. **A daily rule fills its 24-occurrence budget in 24 days**, not 70, because
   `MAX_OCCURRENCES` bites long before `HORIZON_DAYS`. That is the intended
   brake — filing seventy identical rows would bury Plan — but it means a daily
   repeat needs the app opened at least monthly to keep its horizon ahead.

## If you're picking this up in Claude Code

The prototype is the spec — behaviour, copy and visual language are all decided. What it needs:

- A persistence layer (tasks, goals, cards, day history, streak state) and accounts.
- Real dates: a scheduler that rolls unfinished work forward at local midnight instead of on a
  button, and computes pace from actual elapsed days.
- Web Push with a backend so reminders and recalls arrive when the app is closed.
- The auto-split that turns "600 hours before 11 Feb" into weekly and daily targets — the UI
  shows the result, the arithmetic is stubbed.

**Visual system:** Broadsheet — Source Serif 4 throughout, paper `#f3f2f2`, ink `#201e1d`,
cyan `#0088b0` for anything interactive, magenta `#d6006c` reserved for pressure (over capacity,
backlog, weak subjects, free days). No boxes or cards; hierarchy comes from the serif scale,
whitespace and rules. Radii are 1/2/4px. Small accent text uses the 700 ramp step, not base
accent — base is only 3.65:1 on paper. Keep it that way and it stays coherent.

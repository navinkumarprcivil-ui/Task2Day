# Handoff — where Task2Day stands

Updated for build `2026-08-10.1`. Read this first in a new session; the README has
the architecture, this has the state and the traps.

**New in `2026-08-10.1`:** a **skipped task is struck through and sinks**, like
a finished one, on Today and in Plan — one `settledOn(t,date)` predicate drives
both the strike and the ordering, so the two can never disagree. No schema
change.

**In `2026-08-09.2`:** **every deletion asks first** — tasks, badges,
repeat rules, routines, goals, subjects and cards all route through one
`confirmDelete` dialog that names the thing and states what goes with it.
Existing undo stays. No schema change.

**In `2026-08-09.1`:** repeats gained **Every day** (with every-N-days) and
a **Repeat until** date, and one bug went with them — `createSeries` overwrote
`until` with `''` after building the rule, so a stop date was thrown away and
the rule ran forever. No schema change; `until` and the unit have been in the
model since `SCHEMA` 6.

**In `2026-08-08.2`:** **skip reasons in your own words** (free text in the
skip sheet and the evening review; a chip fills the box instead of closing the
sheet); a **daily log** screen — the day-by-day account of what was finished,
what was kept and what did not happen with the reason quoted, from the
Dashboard or Settings; **Settings is a bottom-nav destination** rather than a
gear on the Dashboard; and Today gained **time used against planned for every
session**, including empty ones. No schema change — the log is a view over
records the app already kept.

**In `2026-08-08.1`:** a live crash fixed — ticking a month/week target
straight off Plan wrote `actual: undefined` onto the task, and one undefined
anywhere in the tree makes Firebase reject the **entire** update, so every
later change stopped syncing. Fixed at the source and again at the wire:
`persistedPayload` now runs `stripUndefined` over the whole payload.

**In `2026-08-07.2`:** a real **desktop layout** at ≥900px — full-window
shell, the bottom nav stood up into a left rail, bottom sheets as centred
dialogs, row actions laid horizontally, Escape to close. No schema change; it
is CSS over the same DOM, hanging on three new classes (`.month-grid`,
`.row-actions`, `.sheet-panel`). Add a sheet or a row without its class and it
keeps its phone shape on a monitor.

**In `2026-08-07.1`** (`SCHEMA` 7): badges (`state.badges`, a `badgeId` on
tasks and repeat rules, chips that filter Plan); the app now **opens on Today**
with the nav reading `Today · Dashboard · Plan · Revise`; a **+ on the
Dashboard** as well as Plan; **durations are no longer invented** — the minutes
field starts empty and the sheet refuses to save without one or without
*Instant*; **routines with a duration ask how long they took**, stored in a
date-keyed `actual` map and fed into the Dashboard's hours and estimate-accuracy
figures; and Plan now **sinks completed work to the bottom**.

**In `2026-08-05.1`** (`SCHEMA` 6): repeating tasks (`state.series`), the
Dashboard's Growth / strengths / weak-spots analysis, and one fix — Plan's
date-ordered list was printing no dates at all.

---

## 1. Blocked on you, not on code

Everything below is committed to `main` and verified locally. The previous
Vercel project has been **deleted and is being recreated**, so there is no live
deployment right now. Three actions, all dashboard-only — no agent can do any
of them:

1. **Import the repo at vercel.com/new** — not `vercel deploy` from the CLI.
   Importing wires the Git connection at the same time, so every push to `main`
   deploys itself; a CLI deploy is a one-shot upload that never watches GitHub,
   which is what left the last project stuck on a stale build for days.
   Settings for this repo: Framework Preset **Other**, no build command, no
   output directory, root directory `./`. There is no build step.
2. **Add the new hostname to Firebase** — console → Authentication → Settings →
   Authorized domains. A new project means a new hostname and the old entry
   does not cover it. Miss this and the app loads to a sign-in screen whose
   button fails with `auth/unauthorized-domain`; since the gate covers
   everything, it looks completely broken.
3. **Hard-refresh after deploying**, or close every tab and reopen. Cache is at
   `task2day-v31`. The worker is **network-first for the page**, so an
   ordinary reload picks a new build up; a device stuck on an older
   cache-first worker needs two reloads, or Settings → App version → Refresh.

Then record the new URL in this file and in the README.

**It has landed when:** the app opens on **Today**, the bottom nav reads
`Today · Dashboard · Plan · Revise`, the add sheet asks for a **Badge** and
leaves the minutes box empty, and Plan carries a **Repeating** section under its
list.

`SCHEMA` is 7 and old data goes through the `MIGRATIONS` ladder. Never bump it
without adding the next migration. An unreadable/future snapshot is held for
download instead of silently replaced.

> The sandbox these sessions run in **cannot reach `vercel.app` or `github.io`**
> (network policy answers 403 to CONNECT). No agent can verify the live site for
> you. Verification here is always against a local server.

---

## 2. How to change the app

`index.html`'s app content is **not hand-editable** — it is a ~0.86 MB
self-contained bundle with base64 islands. (The loading shell before those
islands is the one exception — see the traps table.) Use the committed
tooling:

```bash
python3 tools/bundle.py unpack     # -> build/template.html  (edit THIS)
#   ... edit build/template.html ...
python3 tools/bundle.py pack       # -> writes index.html
python3 tools/bundle.py assets     # what is in the manifest, by size
```

`pack` round-trips byte-identically, so an unpack/pack with no edits is a no-op.
`build/` is gitignored; `index.html` is the artefact that ships.

To test in a browser, the sign-in gate has to be stubbed or you see nothing:

```bash
python3 tools/bundle.py pack && python3 tools/preview.py
python3 -m http.server 8000 --directory build     # then load /preview.html
```

Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`;
`pip install playwright` and drive it — do not trust reading the code, this
codebase has produced several bugs that only appear when something is actually
clicked.

---

## 3. Traps that have already cost real debugging

Each of these was found by measuring, not reading. They are in the README too;
they are here because they will bite again.

| Trap | What happens |
| --- | --- |
| `componentDidUpdate(prevProps)` — **no prevState** | The DC runtime passes one argument. Comparing against a second throws inside a runtime `try/catch`, so the symptom is silent: the debounced cloud save simply never fires. Track previous values yourself. |
| `window.firebase` is **not stable** | `firebase-app-compat` gets evaluated twice; the second evaluation installs a *bare* namespace with no `auth`, no `database` and an empty app list. Re-initialising does not fix it — the components are gone. Always go through `window.__firebaseApp()`, never the global. |
| Assets live in **two** islands | React and ReactDOM are named only in `ext_resources`. Prune against the template alone and the app boots blank reaching for unpkg.com. |
| `<textarea>{{ x }}</textarea>` | Renders `[object Object]`, and the broken element then swallows clicks on everything beneath it. React drives a textarea through `value`. |
| Dragging an `<img>` | Starts Chrome's native image drag, which fires `pointercancel` and kills a pointer gesture after exactly two moves. The cropper image is `pointer-events:none`. |
| Gesture handlers bound to an element | Lost after one move — every move sets state and the re-render can hand back a different DOM node. Both the drag and the cropper delegate from `document`. |
| `setState` mid-drag | Rebuilds the rows and strips the transforms the gesture is driving. The drag writes styles directly and commits only on release; `_dragging` holds the clock and recall timers still. |
| `Date.toISOString()` | Converts to UTC and lands on the wrong day outside Greenwich. Use `iso()`, which formats from local parts. |
| `"//"` keys in `vercel.json` | Vercel validates strictly; a header route takes only `source`, `headers`, `has`, `missing`. Anything else fails the deploy. |
| Firebase drops empty arrays/objects | A key the user has legitimately emptied comes back **missing**. `loadCloud` refills from `freshState()`. |
| Firebase authorized domains | Every host the app is served from must be listed, or `signInWithPopup` rejects and the whole app is a dead sign-in screen. Vercel preview URLs are not covered by the production entry. |
| `index.html`'s outer shell (everything before `<script type="__bundler/manifest">`) | Not part of `build/template.html` — `unpack`/`pack` never touch it. It is the loading screen shown while the ~0.9 MB bundle downloads and unpacks, and it is hand-edited directly in `index.html`; a `pack()` afterwards leaves it alone since `pack()` starts from the on-disk `index.html` and only replaces the `template` island. On a throttled connection it is on screen for 10+ seconds, so what it shows matters — see below. |
| `undefined` anywhere in the state tree | Firebase's `update()` rejects the **whole** write, not the offending key, so one stray property stops every later save — silently, with only a console error. `{...x, actual:x.actual}` is enough to cause it when `x` has no `actual`: in JS an absent key and an undefined one are the same thing, to Firebase they are not. Set the key only when there is a value, and `stripUndefined` in `persistedPayload` catches whatever slips past. |
| A new sheet or row that keeps its phone shape on a desktop | The desktop rules hang on `.review-sheet` / `.sheet-panel`, `.row-actions` and `.month-grid`. Markup added without the matching class is not styled by them — it will look right on a phone and wrong on a monitor, which is the order nobody checks in. |
| A badge colour stored as a hex value | It cannot be: the same badge needs a different ink in light and dark. `tone` is an index into `BADGE_TONES` and resolves to `--card-*` / `--ink-*` tokens at render time. |
| Deleting a badge, group or label taking the work with it | `deleteBadge` unfiles its tasks (`badgeId:''`) and keeps every one of them. A label is not the work. Deleting a *parent task* is the one place a subtree is genuinely removed. |
| A pre-filled duration | The minutes field starts empty and the save is refused without one. A default 45 flowed into capacity, progress percentages and estimate accuracy as though the user had chosen it, which made the accuracy figure measure its own input. For the same reason the completion sheet no longer pre-fills the actual with the estimate. |
| A field that exists in the model before it exists in the UI | `until` was honoured by `seriesDueDates` from the start, and `createSeries` blanked it immediately after building the rule — harmless while nothing could set it, a silent data loss the day the input appeared. When you give a stored field a control, grep for every place that writes the field, not just the place that reads it. |
| A repeat rule that forgets what it has filed | `series.made` is a due-date map, and it is the only thing standing between "I deleted that occurrence" and it reappearing on the next launch. Firebase deletes an empty map entirely, so a brand-new rule comes back with no `made` at all — `syncSeries` therefore also scans the tasks on the board (`seriesId@dueDate`) before filing. Remove either guard and repeats duplicate. |
| Filing occurrences outside `rollForward` | There is no scheduler in this app. `syncSeries` runs from `rollForward`, which runs on mount, after a cloud load, and whenever the clock crosses midnight with the app open. Put filing anywhere else and a device that is merely opened stops catching up. |
| Auto-split's day formula used to spread points across the *whole* span with rounding | A week task's own span (once dated by the month split) is 8 inclusive calendar days, not 7, because only the month split's non-first parts get their start pushed a day late to stay contiguous — the first part keeps the extra day. Splitting that first part into 7 days with `round(span*i/(n-1))` then skips one real calendar day in the middle (Wed, between Tue and Thu). Fixed by anchoring day parts to the end date and walking back one day at a time (`addDays(end, i-(n-1))`, clamped so it never passes the start) — gap-free by construction, identical output to the old formula whenever the span was already exact. |

---

## 4. What exists now

**Model.** Adding a task is date-first; the user never chooses a scope. A
due-date-only task is `day`. A regular-contribution task is a neutral `target`,
which derives `month | week | day` descendants through `parent` links. A final
day task has a `block` (keys `morning` / `noon` / `evening`, labelled Morning /
Busy Hours / Evening), a `date`, and a `note`. Goals remain optional task tags.
Routines repeat by weekday, are ticked per date, and never carry.

**Badges** (`state.badges`) are the cross-cutting label — Personal, Office,
Study, a client — carried by tasks and repeat rules as `badgeId`, added from the
add sheet itself, removed in Settings, and used as Plan's filter chips. Colour
is an index into `BADGE_TONES`, never a stored hex, so both themes resolve it
themselves. A new task inherits whichever badge Plan is filtered to.

**Repeats** offer **Just once · Every day · Every week · Every month**, each
with every-N, days of notice, and an optional end date. A daily repeat is
deliberately not a routine: it carries when missed, and the sheet says so.

**Repeats** are the other axis, and the one with a deadline: `state.series`
holds rules ("the 11th of every month, two days' notice"), and `syncSeries`
files them as ordinary day tasks carrying `seriesId` and `dueDate` up to
`HORIZON_DAYS` (70) ahead. The rule reads itself off the date already on the
sheet, so adding one is the normal add-task flow plus one pill row. An
occurrence carries, skips, times and completes like any other task while its
`dueDate` stays fixed, which is what turns "due 11/08/2026" into "overdue ·
was due 11/08/2026" instead of a silently redated task. Rules are managed at
Plan → Repeating (edit / pause / delete). Full rules in the README.

A day task also carries `carried` (bool) and `carryCount` (number, the row
reads "carried" at 1 and "carried ×N" above that, with a title tooltip
spelling it out). `rollForward` — the silent midnight/reopen catch-up — bumps
`carryCount` by however many calendar days the task actually sat stale
(`daysBetween(t.date, now)`), not by a flat 1, so a device closed for a week
and reopened once still reads "carried ×7" rather than under-reporting it as
once. The evening review's "Carry to tomorrow" / "Batch onto the weekend" and
the backlog's "Move to tonight" / "Move to Saturday" are each a single
deliberate user action, so those bump it by a flat +1 instead.

**Opening screen is Today**, not the Dashboard — the app is for doing the day's
work, and the analysis is something you go and look at. Back walks to Today
before offering to leave, and the add button lives on the Dashboard and Plan.

**Screens.** Log (every day, newest first: finished with real times, routines
kept, and what slipped with the reason as written) · Dashboard (month calendar, coming-up, progress at three zooms,
weekly planned/done/skipped, session/reason procrastination patterns, the
four-week Growth chart with its strengths and weak spots, pending
past-review prompt, week bars, streak, weakest recall) · Today (routines +
tasks per session, clock-ordered timed work, long-press order for untimed work,
actual-minutes completion, task/routine skips, backlog, review with a 0–10
satisfaction score) · Plan (one date-ordered list, date-first task form,
intent-driven guided breakdown, tree search and the Repeating rules) · Daily routine · Revise (topic
groups, image cards with a pan-and-pinch cropper, "revise all") · Settings
(editable hours per session — capacity is the span between them — office days,
notifications, recall frequency, theme, erase everything) · Goals.

**Flow the app is built around:** add a task → pick its completion date → choose
"Only on this date" or "Needs regular contribution". The former remains one day
task. The latter stays a neutral target until its Break action derives continuous
28-day months, seven-day weeks and remainder days. Thus 38 days becomes 1 month
+ 1 week + 3 days; the month becomes four equal weeks and each week becomes its
consecutive day tasks with the same daily estimate.

**Offline-first.** After one online sign-in, the app restores the account and
all `PERSIST_KEYS` from IndexedDB, lets every ordinary task and split-task flow
continue offline, and moves pending work to Firebase automatically on
reconnect. Pending device data wins over an older cloud read. Card-image
adds/deletions have their own compact retry queue; the data URLs remain in
`sp.cardImages`. Signing out or changing Google accounts clears the previous
account's device record. The Dashboard status chip appears only when useful;
Settings always explains the current device/cloud state.

**Opening.** There is one startup stage. `index.html`'s outer shell (not part of
the template island — see traps) shows the supplied Task2Day logo and wordmark
with a slow breathing pulse and a soft blue-violet gradient while the ~0.9 MB
bundle downloads and unpacks. Its status moves from "Loading Task2Day…" to
"Almost there…", waits only when a very fast launch would otherwise flash, and
then fades directly into the mounted app. The former second 2.4-second in-app
intro has been removed, so the logo sequence cannot restart after the bundle
mounts. A service worker's first installation also claims the open page without
reloading it; only replacement of an existing worker triggers the guarded
one-time reload. Real errors keep the loader visible with their diagnostic text.
`prefers-reduced-motion` removes both the pulse and the minimum/fade delay.

**Earlier builds were verified in-browser at 320/390/412px, and via a real
Playwright run against `build/preview.html` with a `Date` override to cross
simulated midnights:** descriptions surviving into nested rows, Today drag reorder,
routines appearing on Today and never carrying, carry-forward marking a stale
task `carried` with an accurate `carryCount` on both the Today row and the
Plan nested drilldown, a completed task staying put on its own date, split
day-parts carrying independently of their siblings, crop-and-save, hour
editing, erase, calendar highlighting today, and the loading placeholder
above. No page errors, on a fast connection or a throttled one (confirmed it
completes rather than hangs — just proportionally slower).

**Verified in the source harness at build `2026-08-03.1`:** unified date-ordered
Plan without scope selectors; due-date-only task creation; a 38-day target
becoming 1 month + 1 week + 3 days; a month becoming four equal weeks; each week
becoming seven consecutive equal-minute day tasks; clock ordering plus manual
untimed ordering on Today with Plan drag disabled; actual-minutes completion
and capacity retention; direct task/routine
skip reasons; weekly planned/done/skipped aggregation; satisfaction review;
zero-task reviews bypassing carry options; and every previous day, including an
empty rest day, remaining reviewable from the Dashboard after rollover. Rollover,
offline and image-queue harness coverage remains intact.

---

## 5. Known limits and likely next steps

- **Weekly/monthly progress is task-count based**, not effort-weighted. Fine
  now, will feel wrong once tasks vary a lot in size. (The Dashboard's Growth
  section is the exception — its bars are minutes.)
- **A repeat has no end date in the UI.** `until` exists in the model and
  `seriesDueDates` honours it; nothing sets it. Pause is the way to stop a rule
  without losing it.
- **Repeats do not notify.** A deadline lands on the right day in the app and
  nowhere else, for the same reason nothing else here can: no push server.
- **Notifications cannot fire while the app is closed.** Real alarms need Web
  Push and a server; `sw.js` already handles `notificationclick`, so the client
  half is done.
- **Card images now sync.** They stay out of the debounced `PERSIST_KEYS`
  payload — megabytes of base64 have no business in a realtime sync — and are
  written one key at a time to `users/<uid>/cardImages/<cardId>`, with
  `localStorage` kept as a fast local cache. `saveCloud` must therefore stay on
  `update()`; going back to `set()` wipes that sibling on the next save and the
  image vanishes on reopen.
- **One open question for the owner:** daily targets filled in for a *future*
  week are filed on those future dates, so they do not appear on Today until
  that day arrives. That is the intended reading of "assigned on a daily basis"
  — confirm, or change it so they all land on today.
- **`state.backlog` is still dead.** The Today screen has a whole "Backlog" card
  gated on `hasBacklog`/`backlogCount`, reasons, "move to tonight" / "move to
  Saturday" — but nothing in the current code ever pushes an item into it.
  The evening review's two destinations (`applyReview('tomorrow' | 'weekend')`)
  write straight back into `tasks`, so the card still never renders. Review
  reasons no longer depend on backlog: they are preserved in `history` and
  drive the Dashboard's planned/done/skipped, session and reason analysis.
  Reviving backlog remains a separate product decision.

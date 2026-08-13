/* Task2Day reminders — the half of notifications that a browser cannot do.

   Nothing in index.html runs once the tab is closed, so every alert the app
   sends itself can only reach you while you are already looking at it. Web
   Push is the way out of that, and Web Push needs a server holding a private
   key. This is that server: a scheduled function that reads each account, works
   out whether it is that account's reminder time in its own timezone, and sends
   one notification per device.

   Deploy notes are in ../README.md. In short: this needs the Blaze plan (a
   scheduled function does), a VAPID key pair set as secrets, and one
   `firebase deploy --only functions`. Nothing here runs, or costs anything,
   until that happens — the app checks for the published public key and says so
   plainly while it is absent.

   Design decisions worth keeping:

   * The public key is written to `config/vapidPublicKey` on every run rather
     than compiled into the client. The client is a single 0.9 MB self-contained
     bundle; rotating a key must not mean rebuilding and redeploying it.
   * A device's timezone lives on the device's own subscription row, not on the
     account. The same account on a laptop in Chennai and a phone in Berlin is
     two different "07:00".
   * Every run is idempotent per device per day. The scheduler fires on a fixed
     cadence and a retry is normal; `sentOn` is what stops the retry becoming a
     second notification.
   * A 404 or 410 from the push service means that endpoint is gone for good.
     It is deleted, not retried — a list of dead endpoints is how a project
     ends up burning its quota on nobody.
*/
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const webpush = require('web-push');

const VAPID_PUBLIC = defineSecret('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE = defineSecret('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = defineSecret('VAPID_SUBJECT');

admin.initializeApp();

/* How often the scheduler runs. Every fifteen minutes means a reminder set for
   07:05 arrives at 07:15 at the latest, which is close enough for a morning
   nudge and a twentieth of the invocations of a per-minute schedule. */
const EVERY = 'every 15 minutes';
const WINDOW_MIN = 15;

/* ── dates, in the user's own zone ─────────────────────────────────────
   The app stores every date as a local YYYY-MM-DD, deliberately never as a
   UTC instant — `toISOString()` lands on the wrong day outside Greenwich, and
   that trap is documented on the client side too. The server has to speak the
   same language or it will send Tuesday's list on Monday night. */
function partsIn(tz, offsetMinutes) {
  const now = new Date();
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const got = {};
    fmt.formatToParts(now).forEach(p => { got[p.type] = p.value; });
    return {
      date: got.year + '-' + got.month + '-' + got.day,
      minutes: Number(got.hour) * 60 + Number(got.minute),
    };
  } catch (e) {
    // An unknown zone name is not a reason to go silent: the device also sent
    // the offset it had when it registered, which is wrong at most by a
    // daylight-saving hour.
    const shifted = new Date(now.getTime() + (Number(offsetMinutes) || 0) * 60000);
    const iso = shifted.toISOString();
    return {
      date: iso.slice(0, 10),
      minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    };
  }
}

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

/* ── what today actually asks of you ───────────────────────────────────
   Built from the same shapes the client uses: a day task carries `scope:'day'`
   and a `date`, an occurrence of a repeat also carries `dueDate`, and a
   routine repeats by weekday index with Monday at 0. A task with no date is
   legacy and belongs to today, exactly as the client reads it. */
function dayIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function briefFor(user, date) {
  const tasks = Object.values(user.tasks || {});
  const routines = Object.values(user.routines || {});

  const onToday = tasks.filter(t =>
    t && t.scope === 'day' && !t.done && (t.date || date) === date);
  const overdue = tasks.filter(t =>
    t && t.scope === 'day' && !t.done && t.date && t.date < date);
  const dueToday = onToday.filter(t => t.dueDate === date);
  const dueTomorrow = tasks.filter(t =>
    t && t.scope === 'day' && !t.done && t.dueDate === addDays(date, 1));
  const routinesToday = routines.filter(r => {
    if (!r || (r.days || []).indexOf(dayIndex(date)) === -1) return false;
    if (r.from && date < r.from) return false;
    if (r.to && date > r.to) return false;
    return !(r.done || {})[date];
  });

  const minutes = onToday.reduce((a, t) => a + (Number(t.minutes) || 0), 0);
  if (!onToday.length && !routinesToday.length && !overdue.length) return null;

  // The deadline is the thing worth waking a phone for, so it leads.
  const lead = dueToday.length
    ? plural(dueToday.length, 'deadline', 'deadlines') + ' today'
    : overdue.length
      ? plural(overdue.length, 'task is', 'tasks are') + ' overdue'
      : onToday.length
        ? plural(onToday.length, 'task', 'tasks') + ' planned'
        : plural(routinesToday.length, 'routine', 'routines');

  const bits = [];
  if (onToday.length) {
    bits.push(plural(onToday.length, 'task', 'tasks')
      + (minutes ? ' · ' + (minutes >= 60
        ? (Math.round(minutes / 60 * 10) / 10) + 'h' : minutes + 'm') : ''));
  }
  if (routinesToday.length) bits.push(plural(routinesToday.length, 'routine', 'routines'));
  if (overdue.length && !dueToday.length) bits.push(overdue.length + ' carried over');
  if (dueTomorrow.length) bits.push(plural(dueTomorrow.length, 'deadline', 'deadlines') + ' tomorrow');

  const named = (dueToday[0] || overdue[0] || onToday[0] || routinesToday[0] || {}).title;
  return {
    title: 'Task2Day · ' + lead,
    body: bits.join(' · ') + (named ? ('\nFirst up: ' + named) : ''),
    tag: 'task2day-daily',
  };
}

/* ── sending ───────────────────────────────────────────────────────── */
async function sendTo(db, uid, key, row, payload) {
  const subscription = {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return 'sent';
  } catch (err) {
    const code = err && err.statusCode;
    if (code === 404 || code === 410) {
      // Gone for good — the browser dropped it or the app was uninstalled.
      await db.ref(`users/${uid}/push/${key}`).remove().catch(() => {});
      return 'expired';
    }
    logger.warn('push failed', { uid, key, code, message: err && err.message });
    return 'failed';
  }
}

exports.sendReminders = onSchedule(
  {
    schedule: EVERY,
    timeZone: 'UTC',
    secrets: [VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT],
    retryCount: 1,
    memory: '256MiB',
  },
  async () => {
    const publicKey = VAPID_PUBLIC.value();
    const privateKey = VAPID_PRIVATE.value();
    if (!publicKey || !privateKey) {
      logger.error('VAPID keys are not set; see README deploy notes');
      return;
    }
    webpush.setVapidDetails(
      VAPID_SUBJECT.value() || 'mailto:hello@example.com',
      publicKey, privateKey);

    const db = admin.database();

    /* Publish the public key where the client reads it. Written every run
       rather than once, so a rotated key reaches every device without anybody
       rebuilding the bundle, and so a restored database heals itself. */
    await db.ref('config/vapidPublicKey').set(publicKey).catch(
      err => logger.warn('could not publish the public key', err));

    const snap = await db.ref('users').get();
    if (!snap.exists()) return;

    const tally = { users: 0, sent: 0, expired: 0, failed: 0, skipped: 0 };

    for (const [uid, user] of Object.entries(snap.val() || {})) {
      const devices = user && user.push;
      if (!devices) continue;
      tally.users += 1;

      // The account's own switch. A user who turned reminders off keeps their
      // registration — turning it back on should not mean permission again.
      if (user.notifyOn === false) { tally.skipped += Object.keys(devices).length; continue; }
      const wanted = toMinutes(user.reminderTime) ;
      if (wanted === null) { tally.skipped += Object.keys(devices).length; continue; }

      for (const [key, row] of Object.entries(devices)) {
        if (!row || !row.endpoint || !row.p256dh || !row.auth) continue;

        const { date, minutes } = partsIn(row.tz, row.tzOffset);
        // The window is [reminder, reminder + cadence): a schedule that fires
        // at :00/:15/:30/:45 must catch a 07:05 reminder exactly once.
        const due = minutes >= wanted && minutes < wanted + WINDOW_MIN;
        if (!due) continue;
        // Idempotent per device per local day: a scheduler retry is normal and
        // must not become a second buzz.
        if (row.sentOn === date) continue;

        const payload = briefFor(user, date);
        if (!payload) {
          // Nothing to say. Still stamp the day, or every run until midnight
          // re-checks an account that has already been decided about.
          await db.ref(`users/${uid}/push/${key}/sentOn`).set(date).catch(() => {});
          tally.skipped += 1;
          continue;
        }

        const result = await sendTo(db, uid, key, row, payload);
        tally[result === 'sent' ? 'sent' : result === 'expired' ? 'expired' : 'failed'] += 1;
        if (result === 'sent') {
          await db.ref(`users/${uid}/push/${key}/sentOn`).set(date).catch(() => {});
        }
      }
    }

    logger.info('reminder run complete', tally);
  });

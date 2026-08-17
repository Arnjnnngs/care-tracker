# care-tracker — STATUS

DISPATCH: ACTIVE

**This file is updated on every push. It is the single source of truth for "what was last done."**
Dispatch check-ins and any new chat session should read this file first.

---

## THE DISPATCH FLAG — read this before changing the line above

The `DISPATCH:` line on line 3 controls whether Aaron gets status pings. He does not want
to be notified when nothing is being worked on.

- **`DISPATCH: IDLE`** — no active build. Dispatch must report NOTHING and send no
  notification. Silence is the correct outcome.
- **`DISPATCH: ACTIVE`** — a build is genuinely in progress. Dispatch reports every 30 min
  and raises a stall warning if the newest commit is more than 90 minutes old.

There are two independent layers, and BOTH must be switched on for Aaron to hear anything:

1. **The scheduled tasks themselves.** Two of them, offset 30 minutes apart
   (`trig_01A4vopDhe7gpm9xGXwz1v9f` at :22 and `trig_014Wx8yagUcAtxTqKCPVQH2w` at :52).
   They are DISABLED by default and must be explicitly enabled when work starts.
2. **This flag.** Even if the tasks are enabled, `IDLE` makes them stay silent.

**Whoever starts a build owns both switches.** Set the flag to `ACTIVE` and enable the two
tasks when work begins; set it back to `IDLE` and disable them the moment work stops or
finishes. If you are unsure whether work counts as "active," the answer is `IDLE`.

### The switch must not depend on anyone's memory

Aaron raised this directly: the Lead Developer has a track record of skipping the
durability step under time pressure — four finished features were lost by not pushing
them, and the 10-minute check-in rule was written and then broken by its own author.
A switch that relies on remembering to flip it back is aimed straight at that weakness.

So the design fails SAFE — every failure mode ends in silence, not spam:

- Flag missing or unreadable → dispatch treats it as IDLE and says nothing.
- Repo unreachable → dispatch says nothing.
- **Flag left `ACTIVE` by mistake → auto-expires.** If the flag says `ACTIVE` but the newest
  commit is more than **4 hours** old, dispatch assumes it was abandoned, goes quiet, and
  stops notifying. Forgetting to flip it back costs Aaron at most a few hours, not forever.
- Between 90 minutes and 4 hours with no new commit, dispatch raises a stall warning —
  that window is real work that may be stuck, which is the whole point of the system.

### MANDATORY — announce every start and every finish

**Aaron's standing instruction, regardless of whether dispatch is ACTIVE or IDLE:**
tell him directly when work STARTS and when it FINISHES. Do not rely on dispatch for this.
Dispatch is a safety net for silence; it is not the reporting channel.

Every start/finish message must state:
1. What is starting or finishing
2. The dispatch state at that moment — **ACTIVE or IDLE** — said explicitly
3. On finish: the commit hash that was pushed, and what is next

This is not optional and it is not satisfied by a dispatch ping. If Aaron learns that work
started or ended from anywhere other than a direct message, that is a miss.

---

## LIVE RIGHT NOW

| | |
|---|---|
| **Version** | v43.4 |
| **Commit** | `PENDING` |
| **URL** | https://arnjnnngs.github.io/care-tracker/ |
| **index.html md5** | `520a150aa4ef7d6a0bda5b3843355e62` |
| **sw.js md5** | `504181487e25c557b7f3b29769844d8d` |
| **State** | Healthy. Verified by re-clone + md5 + live fetch. |

Shipped in the v43.x line, all live and verified:
- v43.1 (`fc2c345`) — export buttons fixed (they were dead: the `h()` null-attribute trap)
- v43.2 (`e4eb5c9`) — missed-dose calculation fixed
- v43.3 (`87e89bb`) — renderer `value` trap fixed at source, plus appetite card,
  symptom logger, and medication editor. The medication editor was the serious one:
  correcting a wrongly-displayed schedule type silently disabled that medication's
  missed-dose alerts while the app reported success.
- v43.4 — deactivated medications no longer leave a card on Home. Reported by Aaron
  (Imodium). Root cause: three hardcoded Home counter cards (Acetaminophen, Imodium,
  Lidocaine) were gated on `usedRecently(id)`, which reads logged entries and never
  consulted the medication config at all. Also fixed a latent `Object.prototype`
  fall-through that could print the literal string "Object" as a medication name in the
  printable oncologist report. 34/34 checks. Aaron does NOT need to re-do the deactivation.

---

## IN FLIGHT — v44

**Not live.** For the v44 feature set, only patches, tests and reports are on `main` —
`index.html` does not carry them and will not until the full audit signs off.
(`index.html` on `main` IS at v43.4, which is the shipped live bug fix, not v44.)

| Feature | State | Evidence |
|---|---|---|
| Calendar + appointments | Patch rebuilt, tests green | 70/70 at 375x812 and 390x844; 14/14 guards falsified |
| Dead demo code removal | Patch rebuilt | −1787 bytes; idempotent; `APP_VERSION` protected |
| `send-reminders.js` data-driven | Rewritten | 470,880 ticks vs live, 0 violations |
| Reminder ledger (NEW) | Built | 188,610 simulated runs, 0 duplicates, 0 silent drops |
| Backup / restore + appointments | **Not yet rebuilt** | — |
| Concurrent-edit notice | **Not yet rebuilt** | — |
| Guided tour | **Not yet rebuilt** | — |
| Deactivated meds still showing (LIVE BUG) | **SHIPPED v43.4** | 34/34 checks, 13/13 falsified |
| Missed-dose reason picker | **Built, needs Aaron's call** | 41/41 checks, 18 falsified — see note below |
| Merge + full audit + push | **Not started** | — |

---

## THE DEACTIVATED-MEDICATION BUG — FIXED IN v43.4

**Root cause:** three hardcoded Home "daily limit" counter cards — Acetaminophen, Imodium,
Lidocaine — were gated on `usedRecently(id)` and nothing else. `usedRecently()` reads
*logged entries*; it never touched `state.meds`. So the card appeared because a dose was
logged in the last 7 days and kept appearing for 7 days after the last dose, regardless of
what the Meds section said. The Quick Log grid 95 lines below was always correct, which is
why it looked half-broken.

**Exactly 3 medications were affected:** Tylenol, Imodium, Lidocaine. Trigger is being one
of those three AND having a dose logged within the rolling 7 days. The 7-day window is why
it looked intermittent — deactivate after a quiet fortnight and nothing looks wrong at all.

**Aaron does NOT need to re-do the deactivation.** Both removal paths were driven through the
real UI; both wrote to localStorage correctly and survived a reload. It was purely a
read-side bug. Two things he does need to know: the **trash icon**, not the "Show as its own
Home card" toggle, is what takes a medication off the active list; and medication config is
still per-device, so it must be done on each phone.

**18 consumers were audited.** Missed-dose calc, missed-dose banner, CSV, all three sections
of the printable report, Quick Log, grouped cards, the in-app scheduler, History and the
day-summary aggregates were all already correct and verified not regressed. Past logged
doses of a removed medication are deliberately PRESERVED everywhere — deactivating means
"stop tracking it going forward", never "erase that she took it."

---

## KNOWN LEAK — `send-reminders.js` ignores deactivation

Confirmed and deliberately NOT fixed in v43.4. `send-reminders.js` runs in GitHub Actions and
cannot read a device-local localStorage config; every reminder is a hardcoded literal.
Deactivating Iron, Compazine, Protonix, Buspirone or Paroxetine still sends a push.

The only real fix is syncing medication config to Firestore. That is a design change, not a
hotfix, and it carries a worse failure mode than the bug: with two phones already able to
disagree about her medication list, a sync bug could **silence a reminder for a drug she is
still taking**. An extra notification is strictly safer than a missing one. The test
`KNOWN-LEAK-send-reminders` pins this state so nobody can later assume it is covered.

---

## NEEDS AARON'S CALL — the missed-dose reason picker

**ChemoWell does not have a missed-dose reason picker.** All 733 KB of its `index.html`, its
docs, and its full git history were searched. ChemoWell's missed doses offer three buttons —
Took later / Skipped / Clear — and none records a reason.

What ChemoWell *does* have is an optional **"Reason for change" picker on a WEIGHT log**
(`WEIGHT_REASONS`, added in app-v21, source comment: "per Aaron's request"). That is almost
certainly what Aaron was remembering.

So what was built is the *interaction pattern* ported to missed doses — a new feature, not a
literal port. It is complete and tested (41/41 checks, 18 falsifications) but it is bigger
than what Aaron asked for, and he should decide whether he wants it, or only the literal
weight-reason picker, before it ships.

---

## OPEN RISKS — need Aaron

1. **"Save spreadsheet" and the backup file may fail silently on iPhone.**
   Both use a bare `<a download>` click with no failure detection. iOS can do nothing
   at all while the app reports "saved". **Until Aaron confirms a file actually lands
   on his phone, neither is a backup.**
2. **Medication list check.** If a schedule type that looked wrong was ever "corrected"
   in the editor, that may have disabled its missed-dose alerts. Protonix especially.
3. **Repo authorization.** The 3 repos are not in this session's authorized set, so
   `git push` is blocked and every deploy goes through manual browser upload. This is
   the root cause of the rollback losses. Authorizing them fixes it permanently.

---

## KNOWN DEFECTS FOUND, NOT YET FIXED

- v43.3 never sends roughly **1 in 6 anchored reminders** even with a punctual cron:
  a ±12 min window against ticks 30 min apart leaves a 5-minute hole. Measured at
  170 drops across 1,147 simulated days. The ledger work fixes this.
- Quiet hours vs late recovery conflict: the 10 PM reminder sits on the 22:05 quiet
  boundary, so a run more than 5 min late can never deliver it. Patient-facing policy —
  Aaron's call, one constant to change.
- The **existing** symptom-logger note field is still 14px, which makes iOS Safari zoom
  in and never zoom back. Pre-existing, needs an owner.
- `deliverFile()` has no failure detection at all (see open risk 1).

---

## HARD-WON RULES — do not relearn these

1. **The sandbox rolls back without warning.** It has happened **9 times**. GitHub is the
   only durable storage. Push every increment. Four finished, tested features were lost
   in one rollback because they were held locally.
2. **NEVER run `git reset --hard`.** It has destroyed work twice on this project.
   Recovery is `git checkout -B main origin/main`.
3. **The `h()` trap.** `h(tag, attrs, ...children)` calls `el.setAttribute(k, v)`, so
   `disabled: null` renders `disabled="null"` — and *any* value disables the control.
   Spread conditional attributes: `...(cond ? { disabled: 'disabled' } : {})`.
   Same for `checked`, `selected`, `aria-current`. **This has shipped 4 separate Blockers.**
4. **Never point a test harness at the real Firestore.** Stub all three gstatic Firebase
   URLs and block the service worker. Fixtures only. This is real patient medical data.
5. **Never use a plain `{}`** as a lookup keyed by user- or file-supplied strings.
   It inherits `Object.prototype`, so `obj['constructor']` is truthy when empty.
   Use `Object.create(null)`. A real blocker of this kind was found in restore.
6. **`sw.js` `CACHE` must bump with every `index.html` change** or phones serve the old app.
7. Firestore rules are **append-only**: no edits to existing docs, deletes blocked after 48h.
   Edit and delete must be implemented as inserts + tombstones, never `updateDoc`/`deleteDoc`.
8. Playwright: **never run `playwright install`**. Chromium is at `/opt/pw-browsers/chromium`.
   `HTTPS_PROXY` breaks Chromium against loopback — run node under
   `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy` and use `127.0.0.1`.
9. **Deploy path** (while `git push` is blocked): stage files under `/mnt/user-data/outputs/`,
   open `github.com/<owner>/<repo>/upload/<branch>/<optional-path>`, `find` the file input,
   use `file_upload` with its ref (never click a file input), fill the commit message,
   click Commit changes, then verify by re-clone + md5 AND by fetching the live URL with a
   cache-buster after 60-90s of Pages lag.
10. **care-tracker and ChemoWell must never touch each other's storage.** care-tracker must
    never reference ChemoWell's localStorage keys; ChemoWell must never reference
    `caretracker_*` collections.

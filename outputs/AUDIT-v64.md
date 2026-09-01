AUDITED-COMMIT: e4a7336
VERDICT: SHIP

# Zero Day Audit — care-tracker v64 (the once-a-second repaint gate)

Audited in `/home/user/care-tracker` against the working tree at that commit. All sabotage was
applied to scratch copies outside the repo; the working tree was verified clean at the end
(`git status --porcelain` empty, and no sabotage marker string anywhere under the repo).
Firestore was stubbed in every run — the three gstatic modules faked, every other request aborted.
Brandi's real record was never reachable.

## The headline

**I could not make the screen go stale.** That was the whole assignment and it is the answer.
The clock keeps time, a medication unlocks at the exact second it is due, a dose logged on the
other phone paints without a tap, a user action paints immediately, and the seconds countdown on
the override prompt keeps counting. Every one of those was measured, not reasoned about.

**Two real defects, neither of them staleness, neither ship-blocking.** One is a branch that works
but is guarded by no test at all. The other is a one-line robustness hole where the gate can wedge
itself on for about a second. Details below, with numbers.

## What I ran

| Run | Result |
|---|---|
| `harness/repaint-test.mjs` on the working tree | **11/11** |
| `harness/tour-test.mjs --file <v64 index.html>` | **58/68**, ten failures |
| `harness/tour-test.mjs --file outputs/rollback-v63/index.html` | **58/68**, the *identical* ten failures |
| `python3 pm.py` | exit **2** — one warning, nine pinned version literals, all in suites this release did not touch |
| my own probe suite (outside the repo) | 3 sections, 10 checks |

## Claims in the release notes I checked rather than believed

**All three claimed falsifications reproduce exactly.** Each was applied to a scratch copy of
`index.html` and re-run through `harness/repaint-test.mjs --file`:

- gate removed → **4 idle rebuilds** in four idle seconds, and 7 rather than 2 across the clock
  jumps. Two checks red. (The notes say "4 idle rebuilds". Correct.)
- signature frozen → the clock **sticks at 10:00 AM** across a minute boundary *and* across an
  hour, and the medication never unlocks. Three checks red. (Correct.)
- minute-only → the medication **stays locked** past the second it was due. One check red.
  (Correct.)

**The README's `tour-test` claim is true.** It says the suite is unrunnable here because
`harness/work/` was wiped, but that run against the live file with `--file` it gives identical
results on the shipped v63 build and on this one. I ran both. Both are 58/68, and the ten failing
check names are byte-identical between them (`diff` of the two failure lists is empty). Nothing in
this release regressed `tour-test`. The failures are the pre-existing `--file` mode artefacts
(APP_VERSION differs from base, sw.js differs from base, drawer holds 9 rows not 6, and the tour
steps that depend on the rebuilt copy).

**"`fmtCountdown` has exactly one caller" is true.** One definition, one call site, and that call
site's output is only ever rendered inside the `isOverriding` branch of a medication card. Nothing
else on the resting screen is seconds-granular. `state.override` is the correct state key — it is
the same key the override prompt is opened and cancelled with.

**A dose logged on the other phone still paints (attack b).** Verified two ways. Statically:
`syncFlushPending()` runs at the *top* of the tick, before `tickRepaint` is ever set true, so a
held snapshot lands through `setState()` → `render()` with the gate inactive; and the snapshot
handler's own direct `setState()` path never touches the flag either. Measured: pushing a new
entry through the stubbed `onSnapshot` listener put its text on screen within 1.5 seconds with no
tap, inside the same minute. **PASS.**

**The signature's failure direction is right (attack d).** `paintSignature()` wraps the per-med
`status()` loop in a try/catch that returns `String(state.now)`. That value changes every tick, can
never collide with the `minute|locks|secs` shape (no pipes), and therefore repaints on every tick.
If `status()` starts throwing, the app degrades to the *old* behaviour — flicker — not to a frozen
screen. That is the correct direction. The lock bitmap is positional over `state.meds`, so a
reorder, an addition or a removal changes it; and any of those only happens through a state change,
which repaints unconditionally anyway.

## Defect 1 — the one seconds-level display in the app has no test (MEDIUM, test integrity)

`paintSignature()`'s third term is what keeps *"Closed — opens in 35s. Log it early anyway?"*
counting down. It is load-bearing and it is guarded by nothing.

Measured. I replaced

    const secs = state.override ? Math.floor(state.now / 1000) : 0;

with `const secs = 0;` in a scratch copy and re-ran the repo's own new suite:

- `harness/repaint-test.mjs --file <sabotaged>` → **11/11, fully green.**
- My probe on the same sabotaged file → the countdown **froze at `35s` → `35s`** across three
  seconds inside one minute. On the real build the same probe reads **`35s` → `32s`**.

So the branch does real work, and deleting it is invisible to every check in `harness/`. This is
the release that added a suite whose stated purpose is catching staleness, and the app's only
seconds-granular display is the one thing it does not cover. Nothing is wrong on screen today; the
exposure is the next person who renames `state.override` or refactors the prompt and sees green.

**Fix:** one section in `repaint-test.mjs` — open the override prompt on a locked medication, hold
the clock inside one minute, assert the countdown text changes. My probe does exactly this in about
fifteen lines and it goes red on the sabotage and green on the build.

## Defect 2 — `tickRepaint` is not reset in a `finally` (LOW/MEDIUM, robustness)

The flag is set true, `render()` is called, and the flag is set false — with nothing in between to
survive a throw:

    tickRepaint = true;
    if (!state.timeModal && ...) render();
    else if (state.tour) positionTour(false);
    tickRepaint = false;

If `render()` (or `positionTour()`) throws, the exception escapes the `setInterval` callback and
the flag stays **true**. Until the next tick completes, *every* render is subject to the signature
gate — including a caregiver's tap.

Measured. I forced exactly one throw inside `render()` (a one-shot setter on `#root.innerHTML`, so
the DOM was otherwise untouched), confirmed it actually fired, then tapped the menu button inside
the same minute:

- tap immediately after the throw → **0 root rebuilds**. The tap was silently dropped.
- the next tap, one tick later → 1 rebuild. It self-heals within about a second.

Severity is bounded by two things: it needs `render()` to throw, which I did not find a reachable
way to do in this build, and the window is under one second. But the pre-v64 cost of a `render()`
throw was one lost frame; the post-v64 cost is one lost frame *plus* a silently ignored tap. That
is a strictly worse failure mode in the exact direction this audit was told to fear.

**Fix, one line, no behaviour change otherwise:**

    tickRepaint = true;
    try {
      if (!state.timeModal && ...) render();
      else if (state.tour) positionTour(false);
    } finally { tickRepaint = false; }

That does not touch the pinned tick line — it only wraps it — so `pm.py` and the three suites that
assert it byte-for-byte stay green. I would fold this into this commit before it is pushed. I am
not conditioning the verdict on it.

## Defect 3 — three "survives the tick" checks are now vacuous, and only `cal-test` was fixed (LOW, test integrity)

The release rewrote `cal-test`'s `TICK-positive-control` because the app no longer repaints every
second. The same reasoning applies to `tour-test`, and it was not applied there.

Measured. I removed the `!state.drawerOpen` term from the tick guard in scratch copies of both
builds, opened the drawer, and counted rebuilds of `#root` over 2.6 seconds inside one minute:

- v63 build, guard term removed → **3 rebuilds**. `tour-test`'s `TICK-drawer-survives` goes red,
  as designed.
- v64 build, guard term removed → **0 rebuilds**. The same check passes with the guard gone.

`TICK-drawer-survives`, `TYPE-appt-sheet-survives` and `TICK-no-repaint-under-tour` in `tour-test`
can no longer fail on an idle screen, and `tour-test`'s own sabotage table names them as expected
casualties:

    expect: ['FILE-tick-guard-composed', 'TICK-drawer-survives']

Half of each of those expectations is now unsatisfiable, so `tour-test`'s falsify mode will
mis-report once `harness/work/` is rebuilt.

**The behaviour is still protected**, which is why this is LOW and not a blocker: the static
`FILE-tick-guard-composed` assertion and `pm.py` both pin that line byte-for-byte and go red on
every one of those sabotages. The composed guard cannot be quietly broken. What is lost is the
runtime half of the evidence — and, more practically, a future reader will trust three checks that
cannot fail.

**Fix:** give `tour-test` the same treatment `cal-test` got — either a clock-advancing positive
control, or drive those three checks across a minute boundary so a repaint is genuinely expected.
Until then, note in the suite header that the runtime half is now vacuous.

## Known and not fixed (informational, no action asked)

A rolling-window ceiling display (Morphine's "15 mg reached in the last 4h", and the *"N mg left"*
in the over-limit button label) is computed from `state.now` and changes at the exact second an old
dose ages out of the window. When that ageing-out does **not** flip the medication's locked bit —
i.e. the total was already under the ceiling — the displayed figure can be up to 60 seconds stale
before the minute turns. The **lock itself is exact**, because `status().locked` is in the
signature; it is only the mg counter that lags, and only downward, and only below the ceiling. Not
worth a release on its own, but it is the one thing I found that `minute | locks | override-seconds`
genuinely does not cover.

Second, a cost note rather than a defect: the rewritten `cal-test` positive control waits to the
next real minute boundary, up to ~61 seconds, and `cal-test` runs two viewports. That adds up to
about two minutes to every full `cal-test` run from now on. Worth knowing before somebody thinks
the suite has hung.

## What I did not do

I did not re-run `cal-test` end to end (70 checks across two viewports, plus the two new
minute-boundary waits) — it did not fit the time box. I checked its rewritten control by reading it
and by verifying the equivalent mechanism separately: on the frozen-signature sabotage the header
clock provably does not advance across a minute boundary (`repaint-test` section 2 went red on
exactly that), which is the assertion `cal-test` now makes. The control reads the clock text out of
`<header>`, never `document.body.textContent`, and fails closed if no clock is found. I am
satisfied it is honest; I have not watched it go red in its own suite.

I did not run `medsync-test`. `tour-test` on both builds was the stronger evidence for the same
README claim and it held.

## Bottom line

The fix does what it says and does not do the thing it was most likely to do. Ten idle rebuilds
per ten seconds becomes zero, and nothing on screen went stale under any probe I could build:
clock, unlock timing, missed-dose windows, cross-phone sync, user taps, and the seconds countdown
all still keep up. The three defects above are a missing test, a one-line `finally`, and some test
bookkeeping — none of them touch what a caregiver sees today.

Ship it. Add the `try/finally` first if it is free to do so, and put the countdown check and the
`tour-test` note on the next release.

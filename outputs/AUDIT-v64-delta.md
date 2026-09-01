AUDITED-COMMIT: 2b077ab00c11cb9477e1558a50d24c7f4cee3bc1
VERDICT: SHIP

# Zero Day Audit — v64 DELTA re-verify (`e4a7336..2b077ab`)

Scope: only what changed after the SHIP verdict. The v64 repaint gate itself was audited at
`e4a7336` and is not re-litigated here. Every sabotage below was applied to scratch copies outside
the repo; `git status --porcelain` was empty before and after, and no sabotage marker string exists
anywhere under the repo. Firestore was stubbed in every run — the three gstatic modules faked, every
other request aborted. Brandi's record was never reachable.

## Headline

**Nothing in the delta blocks. Every number in the docs reproduced exactly.** The pinned tick line
is byte-for-byte intact with its `else if` branch attached, the `try/finally` does precisely what
the commit claims, and all three new checks go red when the thing they guard is broken — including
the stranded-flag check, whose earlier `__throwOnce` hole I reproduced and confirmed closed.

**Two findings, neither ship-blocking, one of them a claim in the shipped code that is false.**

## 1. The pinned tick line — INTACT

    grep -c : exactly one occurrence, at byte offset 527104, two-space indent unchanged:
      "  if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();\n"

`else if (state.tour) positionTour(false);` is still attached to it (only comments intervene, which
do not sever an if/else chain), and the whole thing now sits inside `try { … }`. Proven by execution,
not by reading: every suite boots and the app runs.

- `pm.py` → exit **2**, "index.html parses as valid JavaScript" ok, composed tick guard ok. The only
  warning is the nine pre-existing pinned version literals in suites this release never touched.
- `tour-test --only FILE-tick-guard-composed` → **PASS** on HEAD, and **FAIL** on a scratch copy with
  one term removed ("the composed tick guard is not present verbatim"). The assertion is live and
  can go red.

## 2. The try/finally does what the commit claims — CONFIRMED, and the 15/16 is real

| Build | `repaint-test.mjs` | section 5 detail |
|---|---|---|
| HEAD (shipped) | **16/16** | `a tap still paints after a repaint threw · 0 -> 1` |
| HEAD with the `try/finally` taken back out | **15/16** | `FAIL · 0 -> 0` — the tap was silently dropped |

I did not take the commit's word for 15/16; I removed the wrapper on a scratch copy and measured it.
The failing line is the right one, and the failure detail (`0 -> 0`) is the defect itself: with the
flag stranded, a caregiver's tap inside the same minute paints nothing at all.

## 3. Can the new checks fail? — ALL THREE, YES

**(a) Seconds countdown (`repaint-test` §4).** Two independent sabotages, both red:

- signature's seconds term frozen (`const secs = 0;`) → `FAIL · 35s -> 35s`, suite **15/16**.
  This is the exact pair of numbers the docs print. Reproduced.
- the countdown text made non-seconds (`fmtCountdown`'s final return) → `FAIL · (no countdown on
  screen)`, suite **14/16**. This is the half a presence check usually misses: the selector is
  specific enough that nothing else in `<main>` satisfies it.

Also confirmed by reading: `countdownLabel` has exactly one use in the file, inside the
`isOverriding` branch, so the signature's `state.override` gate is the correct key.

**(b) Stranded flag (`repaint-test` §5), and the `__throwOnce` hole — GENUINELY CLOSED.**
I rebuilt the historical hole to see it bite: a one-shot throw hook, with the wait before the tap
lengthened from 1.5s to 4s, gives **16/16 fully green against the build with the `try/finally`
removed** — a total false pass. The shipped hook throws for as long as the flag is set, so the flag
can never heal and the result does not depend on how long the suite waits. The hole is closed, and
no variant of it survives: with the shipped hook, the broken build fails at 1.5s and would fail at
any wait.

**(c) `tour-test`'s new `TICK-positive-control`.** On HEAD: **2/2 PASS** (both viewports). On a
scratch copy whose `paintSignature()` returns a constant — a permanently frozen screen — **0/2**,
with the message "the displayed clock did not move across a minute boundary (4:07 AM -> 4:07 AM)".
This is the failure mode the equivalent `cal-test` control was first written blind to, and this one
sees it.

## 4. Does the try/finally introduce anything new? — NO, measured

Instrumented `checkNotifications()` with a counter and ran the same probe on both builds:

| | HEAD (with try/finally) | same file, wrapper removed |
|---|---|---|
| `checkNotifications()` in 3 idle seconds | 3 | 3 |
| `checkNotifications()` in 3s while every tick's render throws | **0** | **0** |
| page errors during that window | **3** | **3** |

Identical. The throw still escapes the interval callback — `finally` does not catch, and the three
`pageerror`s prove it reached the page. `checkNotifications()` was unreachable after a throw before
this change and is unreachable after it; nothing was swallowed and nothing new was skipped. The only
behavioural difference is the one intended: the flag is cleared on the way out.

## 5. Are the docs true? — every number reproduced

| Claim | Where | Measured |
|---|---|---|
| `repaint-test` 16/16 | README, STATUS, RENDER | **16/16** |
| taking the try/finally out → 15/16 | README, RENDER | **15/16** |
| `35s -> 32s` real build | README, STATUS, RENDER | **35s -> 32s** |
| `35s -> 35s` frozen signature | README, RENDER | **35s -> 35s** |
| `tour-test --file` 60/70 | README, STATUS, RENDER | **60/70** |
| same ten failures as shipped v63 | README, STATUS | **identical** — `diff` of the two failure lists is empty, and `SPOT-follows-reflow` fails with the same `getBoundingClientRect` error on both |
| index.html md5 `8b3076…` / sw.js md5 `f7291b…` | STATUS | both match the files |
| tap after a forced throw painted "nothing at all" | README, RENDER | **0 -> 0** |

`APP_VERSION` is `v64` and `sw.js` CACHE is `caretracker-v64`; they agree, and v64 has not reached
`origin/main` yet (it is still on the working branch), so leaving them unbumped across this fold-in
is correct — the release lands on Pages once, with the wrapper in it.

**In-app changelog (`CHANGELOG`, v64 entry): fit for a caregiver.** "The app was throwing the whole
screen away and redrawing it once a second… It now redraws only when something would actually look
different." No jargon, no file paths, and it correctly does not mention `try/finally`, which is
invisible to a caregiver. Not changed by this delta, and it did not need to be.

## FINDING 1 (MEDIUM, test integrity) — `repaint-test` §5 cannot tell a live hook from a dead one

The check depends entirely on an injected throw hook, and never asserts that the throw actually
happened. Measured: rename the injected flag so the app never throws, then run against the build
with the `try/finally` **removed** — **16/16, fully green**. The one check in the suite that exists
to prove the fix does something passes on a build without the fix, as soon as its own hook goes
quiet. The suite's `REFUSING:` guard catches a renamed `paintSignature`, but not a hook that is
injected and inert.

Fix, one line, proven both ways — the suite already collects page errors:

    t('the forced throw actually fired', a.errs.some(e => /forced for the repaint suite/.test(e)), …)

With it: HEAD **17/17** ("1 page error(s)"); dead hook against the broken build **16/17**, red on
exactly that line. Next release, not this one.

## FINDING 2 (LOW/MEDIUM, a false measured claim in a shipped file) — the new `tour-test` comment is wrong, and it was my error first

The comment block added above `TICK-positive-control` states as measured fact:

> deleting `!state.drawerOpen` from the tick guard gives 3 rebuilds in 2.6s on the previous build
> (check goes red, as designed) and 0 on this one (check passes with the guard gone)

and concludes that the three "survives the tick" checks now "pass on their own for the wrong reason".
**That is false in the suite where the comment lives.** I removed each guard term in turn from
scratch copies of the shipped build and ran the check it is supposed to protect:

| Sabotage on the v64 build | Check | Result |
|---|---|---|
| `!state.drawerOpen` removed | `TICK-drawer-survives` | **0/2 — RED**, "the tick rebuilt the drawer" (both viewports, reproduced across four runs) |
| `!state.apptSheet` removed | `TYPE-appt-sheet-survives` | **RED** |
| `!state.tour` removed | `TICK-no-repaint-under-tour` | **RED** |

All three still work. The "0 rebuilds" number is mine, from the earlier audit, and it does not
generalize: I reproduced it only under a **frozen clock** (my `repaint-test`-based probe with
`__clock` pinned gives 0 with the guard gone). `tour-test` runs on the real clock and its own
fixture, where one repaint lands inside the 2.3s window and the canary dies. My earlier finding was
overstated; the commit faithfully copied the overstatement into the file.

Nothing breaks today — the added positive control is harmless, itself falsifiable, and worth
keeping. The hazard is the next reader: a comment saying three checks "can no longer fail" is an
invitation to delete three checks that do. This project has already paid for a stale note that
outlived the thing it described by ten releases. Correct the comment to say the control was added
for the reason `cal-test`'s was — the app must be proved to repaint at all — and drop the claim
about the three checks.

## Cost note

`tour-test` now waits to a real minute boundary once per viewport: up to ~62s × 2 added to every
full run. Same tax `cal-test` took in v64. Worth knowing before somebody thinks the suite has hung.

## Bottom line

The delta is one structural change to the app, and it is the right one, wrapped the only way that
leaves the pinned line untouched. It was falsified in both directions and it changes nothing else
that I could measure. The two new `repaint-test` checks and the new `tour-test` control all go red
on the defect they name. Two follow-ups: a one-line positive control on the throw hook, and a
comment that says something untrue about three checks that still work.

**SHIP.**

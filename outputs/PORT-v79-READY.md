# care-tracker v79 — the weight chart's x-axis. BUILT, VERIFIED, NOT APPLIED.

**Status: waiting on Aaron's go-ahead, and nothing else.** `index.html` in this repo is untouched.
Everything needed to apply the change is committed here, and the verification was done against a
patched COPY of live v78 rather than against the file itself.

## What is wrong with the live app right now

Her Weight report draws an x-axis with both halves of the defect Aaron reported against ChemoWell:

1. **It runs into the future.** `index.html:7799` floors the right-hand edge at `tMin + DAY`, so a
   day holding a single weight reading draws an axis 24 hours wide and labels the far end with
   **tomorrow's date**.
2. **It repeats dates.** `index.html:7832-7840` builds every label as `M/D` at even fractions of
   the span, so a span of hours prints one calendar date under five ticks — `11/1 11/1 11/1 11/2
   11/2`.

One chart, both halves, the same six lines that were fixed in `chemowell-app-beta` app-v90 and
then in `chemowell-beta` beta-v67.

## What applying it does

`python3 harness/axis-patch.py --file index.html` — seven anchored edits, each refusing unless its
anchor matches exactly once, and the whole thing a no-op if already applied:

| # | Change |
|---|---|
| 1 | `timeAxisLabels()` and `chartTimeMax()` at module scope, above the chart that calls them |
| 2 | the right edge clamped to the caregiver's `now` (`Math.max(lastTs, …)` kept, so a reading later than now still fits rather than being cropped out) |
| 3 | the label format chosen from the span: times inside one day, dates across days, and the **year** too past ~300 days, which `weightEntries.slice(-2)` makes reachable with no bound |
| 4 | `pad.right` 20 → 34, so the rightmost time label is not clipped |
| 5 | `data-xaxis` on every x label |
| 6 | `data-report` on each report card |
| 7 | `data-weight-range` on both toggle buttons |

It deliberately does **not** touch `APP_VERSION` or the `sw.js` cache: Rule 5 forbids pinning a
version literal in a patch, and three patches here have broken on exactly that.

`--check` against live v78 predicts md5 `0bbf3f60ac8e731d14a21635ebd2d32c`, and applying it to a
copy produces that md5 exactly, so the patch is deterministic.

## How it was verified before being offered

* **`chemowell-app-beta` app-v90** — `test/v90-chart-axes.mjs` **162 checks**, three independent
  Zero Day Audit passes (the first two refused it), and twenty mutants killed.
* **`chemowell-beta` beta-v67** (staging, which is this app's own test bed) —
  `harness/weight-axis-test.mjs` **69/69** under `TZ=America/Chicago` and `TZ=Etc/UTC`, five
  mutants all dead.
* **This repo, twice, and this is the part worth reading.**

  **(a) The defect reproduced on the bytes that are serving to her phone.** Live `v78` with
  **nothing changed but the three test hooks** — the two defective sites left exactly as they are
  (md5 `d60facfbc132dd533a6b0ea91ce517dc`, against the live file's `80ba7549395c78e216f2d4f919239630`):

  ```
  69 checks: 61 passed, 8 failed   (TZ=America/Chicago)
    FAIL 1.1  the labels are TIMES, not one date printed five times
              ["11/2","11/2","11/2","11/3","11/3"]
    FAIL 1.3  nothing on the axis is later than the frozen now
              ["11/2","11/2","11/2","11/3","11/3"]
    FAIL 2.1  a span inside one hour is labelled with minutes, not bare hours
              ["11/2","11/3","11/3","11/3","11/3"]
    FAIL 3.2  and no date is printed twice   ["11/1","11/1","11/1","11/2","11/2"]
    FAIL 7.2  and no date is printed twice   ["11/1","11/2","11/2","11/2","11/2"]
    FAIL 8.1  every label carries a two-digit year   ["9/28","12/22","3/17","6/10","9/3"]
  ```

  `["11/2","11/2","11/2","11/3","11/3"]` is one reading logged this morning: **the same date three
  times, and then tomorrow.** Both halves of Aaron's report in a single axis, measured rather than
  argued.

  **(b) The fix verified on the same bytes.** Live `v78` + `axis-patch.py` (md5
  `0bbf3f60ac8e731d14a21635ebd2d32c`, exactly what `--check` predicts, so the patch is
  deterministic): **69 checks: 69 passed, 0 failed.**

The suite **freezes the clock** (`window.Date` overridden, the technique
`harness/warning-priority-test.mjs` already uses here) rather than running against the wall clock.
That is not a convenience: the product app's suite runs on the real clock, and it cost three audit
rounds because one section was true only after 09:00 local — it went red on correct code for nine
hours of every day, and it was the only section that killed one of the mutants.

## The remaining steps, once Aaron says go

1. `python3 harness/axis-patch.py --file index.html`
2. Bump `APP_VERSION` v78 → v79 and `sw.js` CACHE `caretracker-v78` → `caretracker-v79` together.
3. `node harness/weight-axis-test.mjs` (plus a regression pass over the suites that touch Reports).
4. `README.md` version-history row and `CARETRACKER_HANDOFF.md`, in the same commit.
5. Push to `main`; GitHub Pages serves it in about a minute; verify the live `APP_VERSION` and
   `sw.js` CACHE with a cache-buster before calling it done.

## What is deliberately exempt

Chromium only — no iPhone and nothing on her actual phone, which is where the chart will be read.
Every width figure in this port is Chromium's. No screenshots: nothing here changes a layout a
finger touches except the chart's own right margin, and that is asserted by measurement rather
than by eye.

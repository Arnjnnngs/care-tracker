VERDICT: SHIP

**The seed repair works and the check is now hour-independent — I could not find a wall-clock time,
timezone or midnight crossing at which the bare-`Date.now()` bug passes — but one word of the
rewritten copy went backwards: "Remove also works on older readings" is true of weight and NOT of
paracentesis, which the draft it replaced said correctly ("older weights").**

Scope of this pass: the three changes since my BLOCK — the `AHEAD` seed, the new direct stamp
assertion, and the twice-rewritten changelog. Everything else in `outputs/AUDIT-v73.md` stands.

---

## 1. Is the check genuinely hour-independent? YES — proved by argument and by 27 runs

**The argument first, because it is what makes the measurement mean something.**

    AHEAD          = Math.max(NOW, Date.now()_at_seed) + 6h      >=  Date.now()_at_seed + 6h
    broken stamp   = Date.now()_at_removal                       ~=  Date.now()_at_seed + 15s

The removal happens about fifteen seconds after the seed is computed, so the broken tombstone is
about **six hours short** of the record it must outrank, always. This is pure epoch-millisecond
arithmetic: `setHours(15,0,0,0)` only feeds `NOW`, and `NOW` enters only through `Math.max`, which
can never *lower* `AHEAD`. So no timezone, no DST transition and no midnight crossing can move the
inequality — a shifted clock moves `Date.now()` and `NOW` together, and `AHEAD` moves with them.

**The one theoretical hole, stated so nobody has to rediscover it:** if a single run ever took more
than six hours between seeding and the paracentesis removal, the margin would close. Runs take ~16
seconds. Not a live risk; if the suite ever grows a long wait, the 6h constant is the thing to raise.

I also confirmed the app stamps its tombstone from the **real** `Date.now()` (index.html lines 5230
and 5244), not from the frozen `simNow()`. That is why deriving the seed from the real clock is the
right repair. Had it used `simNow()`, `Math.max` would still have covered it — the seed is ahead of
*both* clocks, which is what the builder's second attempt fixed and what makes it robust either way.

### The matrix — 9 clock shifts x 3 builds, including four the builder did not try

Method: `scratchpad/suite-shift.mjs` is a byte copy of the shipped suite with `Date.now()` and the
`Date` constructor shifted by `SHIFT_MS` in BOTH node and the page, and nothing else changed.
Mutants are `index.html` with **exactly one line** altered back to a bare `Date.now()` — line 5244
for paracentesis, line 5230 for weight (verified: one changed line each).

| clock shift | SHIPPED | para-stamp mutant | weight-stamp mutant |
|---|---|---|---|
| 0h  | 21/21 | **19/21** | **20/21** |
| +6h | 21/21 | **19/21** | **20/21** |
| +9h (the boundary the builder's first attempt broke at) | 21/21 | **19/21** | **20/21** |
| +11h | 21/21 | **19/21** | **20/21** |
| +13h | 21/21 | **19/21** | **20/21** |
| +21h (crosses midnight forward — `setHours(15)` lands on the NEXT day) | 21/21 | **19/21** | **20/21** |
| +23h | 21/21 | **19/21** | **20/21** |
| -4h (crosses midnight backward) | 21/21 | **19/21** | **20/21** |
| -10h | 21/21 | **19/21** | **20/21** |

Every mutant row is red at every hour, and always on the same named checks. The builder's numbers
reproduce exactly, and the four shifts they did not try — +11h, +23h and the two negative,
midnight-crossing ones — behave identically.

## 2. Does the new direct assertion have teeth? YES

`t('the tombstone is stamped strictly newer than the record it removes', tomb.loggedAt > AHEAD)`

- On the shipped build the tombstone is `Math.max(Date.now(), AHEAD + 1)` = `AHEAD + 1`. It passes
  by exactly one millisecond, which is the tightest possible margin and the correct one.
- On the para mutant it is `Date.now()` ~= `AHEAD - 6h`, and it goes **red at all nine shifts**.
  It is one of the two failures in every 19/21 above.

It is asserted against `AHEAD` — the actual stamp of the record being removed — not against a
constant or the clock, so it cannot drift green. **Its one limit, stated:** it watches the
paracentesis tombstone only, so the weight stamp is still covered only through its effect on the
Weight report. That is why the weight mutant scores 20/21 rather than 19/21. Acceptable — the
screen-level check for weight is red at every shift — but a second one-line assertion on the weight
tombstone would cost nothing and close the asymmetry. Not a condition of shipping.

## 3. Are the 21 the right 21? YES — nothing passes for a new reason

The seed change altered exactly one thing: the two corrections' `loggedAt` went from `NOW - 3h`
(2 hours ahead of the originals) to `AHEAD` (at least 11 hours ahead). The *relationship* every
other check depends on — correction newer than original — is unchanged in direction and only wider
in margin. Concretely:

- **The future-dating risk, checked and clear.** I grepped every read of `loggedAt` in index.html.
  It is used only as an ordering / tie-break key (`weightSupersedes`, `paraSupersedes`,
  `markerSupersedes`, `dailyStamp`, journal sort). The only place it feeds a date is line 5786, and
  only for a `chemo_date` with no `ts`. So a correction stamped six hours into the future cannot be
  bucketed onto the wrong day or filtered out of a screen — which was the way this seed could have
  quietly changed what the other checks mean.
- **The 48-hour gate is unaffected** — `removeBtn` tests `state.now - e.ts`, and `ts` is untouched.
- Section 2's "the superseded original offers NO Remove" passes for the same reason it did before
  (`weightSuperseded` is true because the correction outranks it), not a new one.
- Section 5's ordinary-dose delete and the "exactly one delete in the whole run" tally are
  independent of the seed and unchanged.

The 20 -> 9 -> 21 path is explained and benign: the builder's intermediate `Date.now() + 6h` seed
put the *original* ahead of the correction before 09:00, which broke sections 1-4 wholesale. The
`Math.max` restores the ordering while keeping the real-clock margin.

## 4. The copy — one clause is now wrong, and it used to be right

Measured, not read: History after both removals renders (probe `scratchpad/probe-copy.mjs`)

    4.0 L                  SUPERSEDED   (no Remove)
    4.5 L                  SUPERSEDED   (no Remove)
    "Paracentesis removed" REMOVED      (no Remove)
    156.2 lbs              SUPERSEDED   (no Remove)
    142 lbs (corrected)    SUPERSEDED   (no Remove)
    "Weight removed"       REMOVED      (no Remove)

**Bullet 2 — "Remove also works on older readings" — FIX THIS BEFORE SHIP. One word.**
Weight is in `BYPASS_48H_IDS`, so Remove is offered on a five-day-old weigh-in and now works.
**Paracentesis is not**, so past 48 hours no Remove button is drawn at all. The bullet's own second
half names paracentesis, so a tired reader takes "older readings" to cover both, hunts for a control
on a three-day-old procedure and finds nothing. The draft this replaced said **"older weights"** —
precise. The rewrite lost the word while fixing a different problem. Recommended edit, copy only, no
code, no re-audit needed: *"Remove also works on older weights, and on paracentesis entries that
sometimes did not take."* If it ships unchanged, that is a knowing exemption and must be named in
the release message rather than left silent.

**Bullet 1 — "the number you had fixed could come back in its place" — ambiguous, recommend a fix.**
What came back was 156.2, the number she had *replaced*, not 142, the number she had *fixed*. Both
readings of "fixed" are available and the wrong one is the more natural. *"the old number you had
replaced could come back"* is unambiguous and the same length. Not blocking.

**Bullet 3 — "History still shows what was recorded, marked Removed" — defensible, disclose it.**
True in the weak sense: the recorded numbers are still listed, and there is a row marked REMOVED.
But the rows carrying the numbers are marked **SUPERSEDED**, and the row marked REMOVED carries no
number. She may read the two 142/156.2 rows as "it didn't work". `outputs/RENDER-v73.md` already
records this as seen-and-left-alone with a reason I accept (a group-is-cancelled helper across four
record types is a wider change than this release). Name it in the release message as an exemption.

**"Now clears it properly" without the connection caveat — acceptable.** My previous flag was the
absolute *"It always takes effect now"*. That is gone. Offline the toast still says
*"Could not remove — check connection and try again"*, verified last pass, so nothing promises a
result the app will silently fail to deliver.

**The rewrite's stated purpose was not achieved, and should not be claimed.** At 320px
(`outputs/render-v73/320-whatsnew-popup.png`, read with my own eyes) bullet 1 alone runs **six**
lines — the first draft's complaint was five — and the note now overflows the card: the third bullet
is clipped mid-word and **"Got it" / "See all updates" are below the fold**. It is not a defect: the
panel is `maxHeight:80vh; overflowY:auto`, tapping the scrim closes it, and `whatsNewOpen` is in the
scroll-lock set (line 2977), so it scrolls and is dismissible. But "it is three short bullets now"
describes the shape, not the length. Non-blocking; worth one honest line in the record.

## 5. Other checks this pass

- **Reproducibility (Rule 0), verified after two copy rewrites — clean.**
  `python3 harness/remove-tombstone-patch.py --base outputs/rollback-v72/index.html` reproduces the
  shipped `index.html` and `sw.js` **byte for byte** (md5 `0e3b7c6c...` / `08af1a19...`). The patch
  carries the new copy, so the repo alone still rebuilds the release. This was worth re-checking:
  hand-edited copy is exactly how a file and its patch drift apart.
- No `index.html`, patch or doc other than this report was touched, and nothing was committed.
- No network at any point; every run used `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u
  http_proxy`.
- **Exempt, said out loud:** Chromium only. Nothing here is evidence about Safari or the iPhone's
  rendering, and no claim in the note has been confirmed on the patient's own phone.

## Artifacts (scratchpad — messages, not files, are the durable record)

`suite-shift.mjs` (shifted copy of the suite), `mut-para.html` / `mut-weight.html` (one-line
mutants), `matrix.sh` / `matrix.log` (the 27 runs), `probe-copy.mjs` (History rendering after
removal).

**Baseline re-confirmed:** the shifted suite scores **10/21 on `outputs/rollback-v72/index.html`**,
matching the builder's figure — the seed change did not weaken the v72 falsification.

**Housekeeping:** this report is untracked, so it will trip `pm.py`'s unpushed-work blocker until it
is committed. I committed nothing, per the brief.

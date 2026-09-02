AUDITED-COMMIT: 0f4d83f
VERDICT: SHIP

# Zero Day Audit — care-tracker v65

Adversarial audit of `0f4d83f` on `main`, run against the shipped file and against
`outputs/rollback-v64/` as the baseline. The brief was to try to STOP this release.
I could not. Every headline number reproduces, the transform is mechanically clean,
all seven new checks can be made to go red, and the app is visually itself on every
screen I could reach — including the four the builder never opened.

Three follow-up items are recorded below. None of them justifies rolling back a live
patient's app to a build with a confirmed flicker.

---

## 1. Did anything other than blur and those opacities change? — NO

The transform was a regex sweep over 56 lines, which is exactly where a stray character
lands. I checked it mechanically rather than by reading: paired every changed line
between the two builds, deleted only the two blur properties from each side, and
compared what was left.

**Result: 45 of the changed lines are byte-identical once the blur properties are removed.**
The remaining differences are exactly this closed list, and nothing else:

| change | count |
|---|---|
| `APP_VERSION` `v64` → `v65` | 1 |
| in-app CHANGELOG entry inserted | 6 lines |
| opacity edits | 11 |

The eleven opacity edits in full:

| surface | v64 | v65 | in the docs? |
|---|---|---|---|
| header | 0.88 | **1** | yes |
| bottom nav | 0.92 | **1** | yes |
| toast | 0.88 | 0.96 | **no** |
| loading overlay | 0.95 | **1** | **no** |
| time-modal scrim | 0.4 | 0.42 | yes |
| reason-sheet scrim / panel | 0.4 / 0.97 | 0.42 / **1** | yes |
| drawer scrim / panel | 0.4 / 0.98 | 0.42 / **1** | yes |
| appointment-sheet scrim / panel | 0.4 / 0.97 | 0.42 / **1** | yes |

**Blur count: 56 → 4, exactly 52 removed.** All four survivors are the scrims, all at
`blur(8px)`, as intended.

Specifically hunted for and **not** found: a lost or duplicated CSS property, a broken
style object, a stray comma or quote, an empty `backdropFilter: ''`. The one line where
the background is a ternary — `st.chemoBlock ? 'rgba(192,69,59,0.09)' : 'rgba(255,255,255,0.55)'`
at `index.html:3887` — came through intact, including its second ternary on `border`.
`pm.py` independently confirms `index.html` still parses as valid JavaScript.

## 2. The headline numbers — reproduced independently

I did not take the builder's figures.

| | Home layers | Home scroll | drawer non-scrim layers | drawer scroll | score |
|---|---|---|---|---|---|
| **v64** (claimed) | 18 | — | 19 | 134 frames / 47–48 janky | 4/7 |
| **v64** (mine) | **18** | 182 / 0 | **19** | **139 frames / 41 janky** | **4/7** |
| **v65** (claimed) | 0 | — | 0 | 181 / 0 | 7/7 |
| **v65** (mine) | **0** | 182 / 0 | **0** | **182 / 0** | **7/7** |

The layer counts and the pass/fail scores reproduce exactly. The frame counts reproduce
in magnitude but not to the digit — 139/41 where the docs say 134/47, and the commit
message itself says 48 for the same run it elsewhere calls 47. **These are not
deterministic figures and the docs present them as if they were.** See §5.

`outputs/rollback-v64/index.html` and `sw.js` are byte-identical to the parent commit.
**The rollback bundle is genuine and usable.**

## 3. Can every check fail? — Yes. All seven.

Sabotage applied to scratch copies outside the repo; the repo was never modified.

| # | check | how I made it red | result |
|---|---|---|---|
| 1 | no blurred layer on resting Home | run against v64 | RED (18) |
| 2 | scrolling Home drops no frames | see below | RED |
| 3 | the drawer actually opened | changed the menu button's `aria-label` | RED |
| 4 | the scrim keeps its blur | removed blur from the drawer scrim only | RED |
| 5 | nothing else on the drawer is blurred | run against v64 | RED (19) |
| 6 | drawer scroll drops no frames | run against v64 | RED (41 janky) |
| 7 | no page errors | injected a `ReferenceError` | RED |

**On the one you flagged — confirmed, and better than you thought.** Check 2 does pass
against v64 (182 frames, 0 janky); that limit is real and honestly documented. But it is
**not a check that cannot fail.** I made it fire twice:

- a 45ms-per-50ms main-thread stall → **122 frames, 60 janky** (proves the frame counter is live)
- v64's blurs cranked from 16/24px to **60px** → **160 frames, 21 janky**

So it is *insensitive*, not *dead*: it will not catch the regression v64 actually had, but
it will catch a worse one. That is a materially better position than "a check that cannot
fail", and the docs slightly undersell it.

**No other check has this problem.**

### Two coverage gaps in `glass-test.mjs` (not blockers, worth closing)

- **Only two of the four scrims are recognised.** The classifier keys on
  `data-cal-drawer-overlay` and `data-mr-overlay`. The time-modal scrim (`index.html:2877`)
  and the appointment-sheet scrim (`index.html:5162`) carry **no data attribute at all**.
  Nothing in the suite opens them, so if a future release stripped their blur no check
  would notice — and if one were ever open during a scan it would be miscounted as a
  non-scrim and fail check 5 spuriously.
- **Only Home and the drawer are visited.** Reports, Meds, In-Patient, Symptoms, Calendar,
  the modals and the tour are unguarded by the layer-count check.

## 4. Is the app still visually itself? — Yes, on every screen

Screenshotted both builds at 360×780 @3× and diffed pixel-for-pixel: Home, Meds,
**Reports**, In-Patient, Symptoms, the drawer, the **guided tour card**, Calendar, and the
**Add-appointment modal**. The last four were never opened by the builder.

| screen | mean difference | pixels differing by >8 |
|---|---|---|
| Home | 0.19 / 255 | 0.00% |
| Meds | 0.24 | 0.05% |
| Reports | 0.27 | 0.00% |
| In-Patient | 0.22 | 0.00% |
| Symptoms | 0.20 | 0.00% |
| Calendar | 0.28 | 0.00% |
| tour card | 0.20 | 0.00% |
| Add-appointment modal | 3.02 | 0.01% |
| drawer | 2.37 | 0.01% |

**Nothing unreadable, invisible or washed out.** No white-on-white text, no card that lost
its edge against the background, no panel you can now see through.

- **The drawer**: a uniform 1.6–3.1/255 shift across the whole screen (the 0.98→1 panel and
  the 0.40→0.42 scrim). The *only* region differing by more than 20 is the version label,
  reading `v64` in one and `v65` in the other. "Pixel-for-pixel what it was" is very nearly
  literally true.
- **The modal**: the scrim blur is plainly rendering, the panel is opaque and crisp with a
  clear edge against the blurred background. Strictly safer than v64 — 0.97→1.0 is *less*
  bleed-through and 0.40→0.42 is *more* contrast; both changes push the same direction.
- **An improvement nobody claimed**: in the v64 Reports shot, list text ghosts visibly
  through the bottom nav. In v65 the nav is clean.

### One candidate defect, chased down and disproved

The guided-tour card (`index.html:7535`) is the one floating surface left at alpha **0.985**
with its blur removed — the exact value the release itself blames for text bleeding through
the nav. It looked like the same defect, missed.

It is not. I built a controlled probe rather than trusting the screenshots:

- **This Chromium does composite `backdrop-filter`.** At alpha 0.30 a blurred panel shows
  3.4% strong edges against an unblurred panel's 10.7%. The screenshots are meaningful.
- **At alpha 0.985 the blurred and unblurred panels differ by ≤4/255** — imperceptible.
  The v64 and v65 tour cards differ by a mean of 0.20.

The reasoning still holds, and it is worth recording *why*: **v64's nav was at 0.92 (about 8%
bleed), not 0.985.** The README's "bottom nav, left at 0.985 ... list text bled through"
describes an intermediate build the author tried, not v64. At 0.985 there is nothing to see.

## 5. Are the docs true? — The numbers yes, the caregiver-facing copy no

Reproduced myself: `glass-test` 7/7 and 4/7 on v64; 18 and 19 blurred elements;
`whatsnew-test` 30/30; `repaint-test` 17/17; `takeall-test` 29/29; `overflow-scan` 80/80
CLEAN; `APP_VERSION` and the `sw.js` CACHE both moved to v65; the STATUS.md md5s match the
files on disk. `pm.py` exits 2 — warnings only, and all nine pinned version literals it
names are pre-existing in older harness files. `glass-test.mjs` correctly reads
`APP_VERSION` out of the file under test and pins nothing.

**FINDING A — the in-app CHANGELOG is written for a developer, and one line is wrong.**
This entry is read by a non-technical caregiver.

> "the menu now draws every frame instead of dropping a quarter of them"

"Draws every frame" and "dropping frames" are developer language. She does not know what a
frame is.

> "The frosted glass is gone."

**It is not gone.** The four scrims keep `blur(8px)`, and the blur behind an open menu or
dialog is the most visible frosted glass in the entire app — the modal screenshot shows it
strongly. The one piece of frosted glass a caregiver would actually notice is precisely the
piece that stayed.

> title: "The flickering is actually fixed now"

This promises a fix that **has not been confirmed on Aaron's Galaxy**. v64 told her the same
thing and was wrong. Saying "actually fixed" twice in two days, unverified on the device, is
a credibility risk with the one person who has to trust this app.

**FINDING B — two changes are in the file but in no document.** The toast (0.88 → 0.96) and
the loading overlay (0.95 → 1) were changed. The commit message, README, STATUS and
RENDER-v65 all say only "header and nav opaque, dialog panels to 1, scrims to 0.42". Both
edits are benign and both improve bleed-through, but the record is incomplete.

**FINDING C — the frame counts are stated as exact and are not.** README and STATUS both
give "134 frames / 47 janky"; the commit message says 48 for the same run; I measured
139/41. Same magnitude, different digits every run. They should read "~135 frames, ~45 of
them dropped".

**Open item, not a defect:** STATUS.md's v65 row records only that v65 was *built*. v64's row
recorded its Pages build and matching blob SHAs. Because Aaron ordered v65 shipped without
delay, **there is no recorded confirmation that the live site is serving v65** — and this
sandbox cannot reach `arnjnnngs.github.io` (403 on CONNECT) to check. Step 5 of the project's
own deploy workflow is undischarged and should be closed the moment anything can reach the URL.

---

## Verdict

**SHIP.** The transform is clean, the measurements are real, the gate has teeth, and the app
looks like itself everywhere I could point a camera. Rolling back to v64 would restore a
flicker Aaron reported from his own phone in exchange for fixing nothing.

Recommended fast follow-up, all small:

1. Rewrite the three CHANGELOG bullets in plain words, drop "draws every frame", and correct
   "the frosted glass is gone" — the blur behind menus and dialogs stayed on purpose.
   Soften the title until the fix is confirmed on his phone.
2. Give the time-modal and appointment-sheet scrims `data-` hooks and teach `glass-test` to
   open them, so all four scrims are actually guarded.
3. Record the toast and loading-overlay changes, and restate the frame counts as approximate.

Nothing above needs to hold up the release.

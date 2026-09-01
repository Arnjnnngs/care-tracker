AUDITED-COMMIT: 4f0bf43
VERDICT: SHIP

# Zero-day audit — care-tracker v62 ("the update notice actually appears")

**Plain-language summary.** I tried hard to break this release and could not break the thing a
patient sees. The pop-up now appears on a phone that has been here before, stays away on a brand
new phone, and the medication list comes up intact even when the phone's storage is broken,
blocked, or stuffed with junk. Everything the release notes claim about test results is true — I
re-ran all of them and got the same numbers.

The two real findings are about the **test**, not the app. The new test would still pass green if
someone later broke the fix in a particular way. That is a risk for the next change, not a fault in
this one. Nothing here should hold the release.

---

## What I actually ran

Every run below was done on a scratch copy outside the repo (`--file <path>`), every sabotaged copy
was parse-checked before it was run, and the working tree is unmodified.

| Run | Result |
|---|---|
| `whatsnew-test` on the shipped file | **28/28** |
| `missed-banner-test` | **16/16** |
| `settings-test` | **11/11** |
| `para-test` | **16/16** |
| `eod-test` | **11/11** |
| `logger-test` | **19/19** |
| `overflow-scan` | **80 of 80 combinations, 0 overflowing elements, CLEAN** (exit 0) |
| `pm.py` | exit 2 — clear, one pre-existing warning (pinned version literals in six OLD suites, none of them touched by this release) |
| working tree | clean, nothing uncommitted |
| `APP_VERSION` / `sw.js` CACHE | agree (pm.py confirms) |

Those match the README row and the commit message exactly. No claimed number was wrong.

---

## (a) The start-up path — I could not damage it

The snapshot runs at module init on a live patient's phone, so the thing to fear is a throw that
gets swallowed and leaves the app looking almost right while something is silently empty. I ran the
app in a real browser under eight hostile storage conditions and counted the medication cards that
rendered each time.

| Phone state | Medication cards | Home rendered | Page errors |
|---|---|---|---|
| normal, empty storage | 8 | yes | none |
| `localStorage.key()` throws SecurityError | 8 | yes | none |
| `localStorage` itself throws on access (cookies blocked) | 8 | yes | none |
| 5,000 unrelated keys | 8 | yes | none |
| hostile key names (`__proto__`, `constructor`, bare `caretracker-`, unicode) | 8 | yes | none |
| `getItem` throws, `length`/`key` work | 8 | yes | none |
| `setItem` throws (read-only / quota-full storage) | 8 | yes | none |

**Nothing went empty and nothing threw.** The whole snapshot sits inside one `try`, including the
`typeof localStorage` probe, which is the line that actually throws in a cookies-blocked browser.
There is no temporal-dead-zone hazard: the constant is defined at the top and first read ~1,200
lines later, and it is read only from inside a function that is called after it exists.

One probe of mine did not apply (`length` cannot be redefined as an accessor on `Storage`) — I am
recording that rather than counting it, because a sabotage that did not apply is a green that
proves nothing. The "storage access throws entirely" case covers the same ground and passed.

### One narrow new behaviour, LOW severity

On a phone where storage can be **read but not written** (quota full, or read-only storage), v62
shows the update notice on **every single open, forever** — it can never be stamped as seen. I
verified this is genuinely new by running the identical probe against the saved v61 bundle
(`outputs/rollback-v61/index.html`), where the same phone gets no notice at all.

No data is at risk, the medication list still renders, and the notice is dismissible each time. It
also needs an unusual phone state. Worth a line in STATUS.md, not worth stopping the release.

---

## (b) The placement claim — sound in substance, unguarded in the suite

The code says the snapshot must be at the very top because later start-up code writes
`caretracker-*` keys. I measured that directly rather than taking it on trust, by recording every
`localStorage.setItem` during a real start-up:

- fresh phone, keys written during start-up, in order: `caretracker-seen-version`, then
  `caretracker-device-id-v1`.

So **the rationale is true**: `caretracker-device-id-v1` really is written on every start-up, and a
snapshot taken after it would tell every brand-new phone "you have been here before". Good reason,
correctly identified.

But the *position* is not pinned by anything:

- I moved the whole snapshot ~1,200 lines down, to sit immediately above the line that uses it.
  **28/28, still green.** Anywhere before the decision line is equivalent today, so "the very top"
  is belt-and-braces rather than a load-bearing constraint.

The ordering hazard itself *is* half-guarded, which is better than I expected:

- forcing the snapshot to always answer "no" (what a too-late snapshot looks like): **27/28, RED**,
  on "a returning phone with no seen-version record IS shown the notice".
- injecting a `caretracker-device-id-v1` write *before* the snapshot (what a too-early pollution
  looks like): **26/28, RED**, on "a genuinely new phone is still NOT greeted".

Both directions fail for the right reason. Only the literal line number is unguarded.

---

## (c) The decision — I could not find a real phone state it gets wrong

I opened the app in a browser with each of these storage states and read the rendered DOM:

| Phone | Notice shown? | Right answer? |
|---|---|---|
| nothing at all — genuinely new phone | silent | yes |
| only `caretracker-device-id-v1` (ran for weeks, never edited the med list) | SHOWN | yes |
| only `caretracker-log-v1` | SHOWN | yes |
| only `caretracker-medication-config-prechoice-v1` | SHOWN | yes |
| a ChemoWell-style key on the same `github.io` origin | silent | yes |
| `caretracker-seen-version` present but empty, with history | SHOWN | yes |

Two cases from the brief turned out not to exist:

- **`caretracker-report-*` is not a storage key.** It is the filename of a downloaded report. It
  can never influence this decision.
- **`reset.html` does not clear localStorage.** It only unregisters the service worker and deletes
  caches. So the "send the patient to reset.html for a blank screen" path does not erase the
  evidence and does not silence the notice. Good.

**Shared-origin note, no action needed now.** All of Aaron's GitHub Pages apps live on one origin
(`arnjnnngs.github.io`), so CareTracker and ChemoWell share one localStorage. Today the
`caretracker-` prefix is the only thing keeping them apart, and ChemoWell uses its own prefix, so
nothing collides. If a sibling app ever writes a `caretracker-`-prefixed key, every new phone with
that app installed would wrongly be told "you have been here before". Cheap to remember, nothing to
fix.

**A genuinely cleared phone** (Safari "Clear History and Website Data") is read as brand new and
gets no notice on the next update. That is the same trade v61 made deliberately and is the safe
side of the choice — it cannot be distinguished from a new install without a server-side record.

---

## (d) The new test — FINDING: it does not pin the key that matters

This is the most important thing in this report.

The suite seeds `caretracker-medication-config-v1` as the "returning phone" evidence, and its
comment says *"a saved medication list is the one every returning phone realistically has."*

**That comment is not true, and I measured it.** A fresh start-up writes only
`caretracker-seen-version` and `caretracker-device-id-v1`. The medication-config key is written
only when someone edits the medication list, or when the shared-list sync adopts a list. A phone
that has run CareTracker for weeks on the default medications has **no** medication-config key. The
key every returning phone really has is `caretracker-device-id-v1`.

Two sabotages that **break the fix and stay 28/28 green**:

1. Stop counting `caretracker-device-id-v1` as evidence. **28/28 green.** This re-creates the exact
   v61 miss — silence on the release that matters — for every phone that never edited its
   medication list, and the suite says nothing.
2. Narrow the check to exactly `caretracker-medication-config-v1`. **28/28 green.** Same class: the
   test only ever proves the one key it seeds.

Neither is a defect in the shipped code — I confirmed by direct browser probe that the real code
gives the right answer for a device-id-only phone (table in section c). It is a hole in the guard
for the *next* person who touches this. **Suggested one-line fix for a follow-up: add a second
returning-phone case to section 9 seeded with `caretracker-device-id-v1` and nothing else.**

### Sabotages that behaved correctly

| Sabotage | Result |
|---|---|
| revert to the old rule (`return false`) | **27/28 RED**, right assertion |
| snapshot always answers "no" | **27/28 RED**, right assertion |
| snapshot always answers "yes" | **26/28 RED** on the new-phone side — so "just always show it" is caught too |
| a `caretracker-*` write injected before the snapshot | **26/28 RED**, right assertion |
| drop the stamp on the no-record branch (notice would return on every open) | **26/28 RED** on "the version is stamped so it is asked once" |

### The author's honest note is correct

The commit says removing the `caretracker-seen-version` exclusion leaves 28/28 and proves nothing.
**I reproduced it: 28/28.** And the reasoning holds — the only path that reads
`DEVICE_HAS_PRIOR_DATA` is the branch where the seen-version record is absent, so excluding it
changes nothing there. Recording it as defensive rather than counting it as a passing check was the
right call.

---

## (e) The prose

**The changelog entry a patient reads is true and readable.** All three sentences check out against
the code and against the v61 history. It fits a 320px screen without scrolling (suite section 6,
plus the screenshots in `outputs/RENDER-v62.md`).

**The README row is accurate.** Every suite number in it I re-ran and matched. The claim that the
old suite "passed 23/23 throughout" is consistent — stripping the new section from the suite gives
exactly 23/23.

**One labelling defect, cosmetic.** There is no section 8 in `harness/whatsnew-test.mjs`. The
sections run 1–7, then jump to 9. The new block is the eighth section but is called "section 9" in
the code comment, the commit message and the README. Anyone told to "go read section 9" will count
eight sections and wonder what they missed. This project shipped a commit three days ago about test
labels that say one thing and assert another; this is the same small family. Renumber it to 8, or
say "the last section".

---

## Other checks

- **No new `h()` calls in this diff at all**, so the null-attribute renderer trap is not in play.
  The changelog addition is plain data.
- **No version literal is pinned by anything I wrote**; every run read `APP_VERSION` out of the file
  under test.
- **Nothing was asserted against `document.body.textContent`**; every element check used the
  `data-whatsnew-modal` / `data-tour-quicklog` hooks.
- **No writes to the real Firestore.** Every run used the harness's stubbed Firebase modules with
  all other network aborted.
- **Sabotage containment verified**: all sabotaged copies live under the scratchpad, and a grep of
  the working tree for every sabotage string finds nothing.

---

## Verdict

**SHIP.**

I found no defect in this build that a patient would experience. The fix does what it says, the
start-up path survives every broken-storage state I could construct, and every number in the
release notes is real.

Stating it plainly as the brief asks: **the two findings above are a coverage gap and a labelling
slip, not defects in this build.** The coverage gap (section d) is the one that will cost something
later, and it is a one-line addition to the suite. It should be picked up in the next release, not
used to hold this one.

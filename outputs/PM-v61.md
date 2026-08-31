# PM gate — v61 ("What's new")
AUDITED-COMMIT: f2f24f8d05c248b1ec685b354141d1d33e5ca97f
VERDICT: SHIP

> **Read this first — this report changed its mind, and the reason matters.**
> It first returned **DO NOT SHIP** against `67ef9cb`, for five wrong history entries, a gate v61
> broke, and a live 30px control. While it was being written, the builder session picked those
> findings up and fixed every one of them in `535e05a`. I have re-checked each fix myself against
> the sources and with the suites, and they hold. **Sections 1–9 below are the original findings
> against `67ef9cb` and are left exactly as written** — they are the record of what was wrong.
> **Section 0, immediately below, is the re-check.**
>
> Nobody has approved anything. No human has been asked or has answered. The fixes were made by
> another Claude session working in this same directory, and this verdict is my own re-verification
> of them, not anyone's sign-off.

---

## 0. Re-check at `535e05a` — every blocker cleared, verified, with one new blemish

All six things I blocked on are fixed. I did not take that on trust; here is each one and how I
checked it.

| What I blocked on | Fixed? | How I verified it |
|---|---|---|
| **v52** — "the weight chart no longer jumps because of a drain" | **Yes** | Now reads *"The weight chart shows readings exactly as recorded, with drains marked on it rather than subtracted from it."* That is the app's own Weight-report sentence, near enough word for word. The two screens now agree. |
| **v49** — "so the alert never appeared" | **Yes** | Now reads *"The missed-dose alert was right, but the medication's own card still said 'Waiting' for the same dose."* That is exactly what STATUS's v49 section says. |
| **v54** — "records which phone it came from" | **Yes** | Device claim gone. Now describes what v54 actually did: it used to say how many records were saved but never where the file went. Matches STATUS. |
| **v23** — Senokot "with its own card" | **Yes** | Now names the 8 AM / 10 PM windows, as-needed, and the Take-all default dose — README's v23 row, precisely. The card claim (which was v24's) is gone. |
| **v28** — "could have written fake entries" | **Yes** | Now: *"had written sample entries into the real record … those entries were deleted."* Matches README, and stops understating a real data incident. |
| **v50 title** — "Exports reach the iPhone" | **Yes** | Retitled *"A different way of handing over the saved file."* It no longer asserts the thing Rule 7 says must not be asserted until Aaron confirms it on his phone. The honest bullet is unchanged. |
| **`para-test` PARA-0 regression** | **Yes** | The v59 entry was reworded so it no longer needs to print the British spelling. `grep -ci litre index.html` → **0**. **`para-test` 16/16**, back to its pre-v61 score. |
| **The 30px Clear button** on the missed-dose banner | **Yes** | Raised to the 44px floor. I measured it in a browser: **59.6 × 44.0 at 320, 375 and 390px**. It was 59.6 × 30.0 before. |
| **`cal-test`'s dark drawer gate** (my "next release" item) | **Yes, early** | The count is now derived from the app source instead of pinned at six. **`cal-test` 67/70 → 69/70**: both `TAP-drawer-items` checks now run and pass, so the tap-target gate is alive for the first time in three releases — including on the row v61 added. |

**Re-run numbers at `535e05a`:** `para-test` **16/16** (was 15/16) · `whatsnew-test` **23/23** ·
`cal-test` **69/70** (was 67/70) · `missed-banner-test` **16/16** · `missedcard-test` **7/7** ·
`python3 pm.py` **exit 2 — clear, warnings only**, no blockers, and the working tree is clean.
`cal-test`'s single remaining red is `FILE-app-version`, still pinned to the literal `v43.3` — a
stale patch precondition, unrelated to v61 and unchanged by it.

### One new error came in with the fixes, and it is small

The reworded **v59** entry now says the two spellings appeared in *"the input box, a warning
message, the Reports empty state and **a Help page**."* I checked the actual v59 commit (`7f269a2`).
Three of those four are right. The fourth was not a Help page — it was the label *"Litres drained,
recorded separately"* on the paracentesis record. **CareTracker has no Help page at all**; the
drawer has eight `view` rows plus What's new, and none of them is Help. (That screen is ChemoWell's.)

I am **not** holding the release for this, and I want to be consistent about why. Everything I
blocked on was either untrue about Brandi's care — her weight chart, her missed-dose alerts, whether
her backup works — or a gate that went red. This is a wrong detail about which screen once showed a
misspelling of "liter" a week ago. Nobody is misled about their medication by it. It is a one-clause
correction that should be made on the way out; if it is not, it goes first next.

But it is worth saying plainly what it demonstrates: **a fresh factual error was introduced in the
very entry being corrected, by writing a specific detail without checking it against the source.**
That is the same failure mode for the third time. Which is why the last item below still stands.

### The one thing I asked for that was not done

**There is still no pairing record.** No file in `outputs/` lists each of the 51 entries against the
README or STATUS line it came from. That was item 6 of my original list and it is the item that
actually ends this loop — twice now, "all 51 were re-checked" has been followed by someone finding
more errors in half an hour. It does not block the release. It should exist before the next one.

---

## 0b. Third round, at `f2f24f8` — the last blemish fixed, and the pairing record exists

After I reversed to SHIP, the builder took the two things I left open and closed them both. I
re-checked both rather than accept them.

**The v59 "Help page" clause is gone.** It now reads *"the input box on Today, the warning if you
type too large a number, the line on the card itself, and the Reports empty state."* I checked all
four against the real v59 commit (`7f269a2`), which changed exactly four strings: the `Litres`
input placeholder, the `Enter the litres drained (up to …)` toast, the `Litres drained, recorded
separately` line on the paracentesis card, and the Reports empty state. **All four now correct.**

**The pairing record now exists — `outputs/CHANGELOG-SOURCES.md` — and it holds up.** I asked for
it twice; it would have been a poor joke to accept it on trust, so I verified it mechanically:

- **51 rows for 51 entries.** Nothing in the app is missing from it; nothing in it is absent from
  the app.
- **Every app title in the record matches the app's actual `CHANGELOG` title** — 0 mismatches.
- **Every quoted source snippet genuinely appears in the document it names** — 0 rows where the
  quote could not be found in `README.md` or `STATUS.md`. (My first pass flagged 7; all 7 were my
  own regex tripping over escaped table pipes, not defects in the record.)

It also earned its keep on contact: it found that **v61 itself had no source row** — the release
notes had been added as prose and no version-history row was ever written, so the newest entry in
the patient's history was the one with nothing behind it. `README.md` now has a `v61` row; I
confirmed it is there.

**Final gate numbers at `f2f24f8`:** `whatsnew-test` **23/23** · `para-test` **16/16** ·
`cal-test` **69/70** · `grep -ci litre index.html` → **0** · `python3 pm.py` **exit 2 — clear,
warnings only, no blockers** · working tree clean.

`cal-test`'s single red remains `FILE-app-version`, pinned to the literal `v43.3`. It is a stale
patch precondition, it fails on every release since v43.3, and it is not v61's. Unpinning it is
worth doing, but not by this release.

**Twelve wrong entries were found across three review rounds, and the twelfth was introduced while
fixing the eleventh.** That is the number worth remembering, not the ones that were fixed. The
pairing record is the thing that makes the thirteenth findable by someone other than a reviewer
with half an hour, and it should be regenerated and checked whenever an entry is added or changed.

---

*Everything below this line is the original report against `67ef9cb`, unedited.*

---

**I am holding this release for two reasons: the words are still wrong, and it breaks a test that
was passing.** The audit fixed the six entries it found and those fixes are good — but the commit
message also claimed all 51 entries were re-paired against README and STATUS, and when I checked
about thirty of them myself I found five more errors, including one where the What's new page tells
Brandi something the app's own Weight report says is not true. Separately, v61 turns `para-test`
from 16/16 to 15/16; I confirmed that by running every failing suite against the pre-v61 build, and
it is the only one of the six reds that v61 actually caused.

This is not a code problem. I re-confirmed the audit's central proof: this feature cannot touch a
dose, a medication, a record or a missed-dose alert. The machinery is genuinely good and the new
test added this morning is the best piece of work in the release. The product here **is the text**,
and the text is not finished. The fix is small — five sentences and one reworded line — and it
should take under an hour.

---

## 1. Every Zero Day Audit finding, checked against the current head

| # | What the audit found | Status now |
|---|---|---|
| A | v37 described v36's change; the real v37 (missed-dose **Clear** button) was missing | **FIXED.** New text matches README's v37 row — the Clear button, both phones, stays cleared, a new miss still alerts. |
| B | v39 called a repair; it was the release that *broke* two files | **FIXED.** v39 now owns the damage, v40 now owns the repair. Matches README. |
| C | v44 said "nothing you would notice" | **FIXED.** Now names the calendar, appointments, the menu, backup & restore, and missed-dose reasons. Matches STATUS's own v44 section. |
| D | v50 told the patient the iPhone backup works | **PARTLY FIXED — see below.** The bullet is now honest. The **title still is not**. |
| E | v41 titled "Evening", the change was to the Morning window | **FIXED.** Retitled "Morning window timing corrected". |
| F | v33 implied Senokot had been raising false alerts | **FIXED.** Now matches README exactly. |
| G | No gate checks whether an entry is TRUE | **NOT FIXED.** Still nothing. My spot-check below is the proof this gap costs something real. |
| H | The "never covers Connecting…" claim had no test that could fail | **FIXED, and I proved it.** See section 3. |
| I | The drawer's tap-target gate has not run for three releases | **NOT FIXED.** Still dark. I measured the menu myself instead — it is fine. See section 5. |
| J | The notice reappears on every open if storage can be read but not written | **NOT FIXED / accepted.** One extra tap on a phone with full storage. No record at risk. |
| K | 115 meaningless `key` attributes on the history screen | **FIXED in the What's new code.** The audit's claim that it was "the only place in the file" was wrong — the missed-dose banner does the same thing (index.html lines 3278 and 3280). Cosmetic. |
| L | The "works offline" code comment was false | **FIXED.** The comment now says what actually happens. |
| M | 51 entries, not 50 | **Correct — 51.** The suite reads the count from the file and reports "51 shown, 51 in the file". |
| N | STATUS.md contradicts itself two lines apart | **NOT FIXED.** The Version row still says "v60 — BUILT, NOT DEPLOYED, v59 is live" while the row below says v60 is live and v61 is built. `pm.py` still warns. |

Ten of fourteen are resolved. The three that are not (G, I, N) are all housekeeping. **D is the one
that is half-done, and it matters.**

## 2. The v50 entry — does it comply with Rule 7?

Rule 7 is verbatim: *"Until confirmed, the backup is NOT called a backup."* I searched STATUS.md
and found no record of Aaron ever confirming a file lands on the iPhone. STATUS's own Open Risks
list still says, today: *"Until Aaron confirms a file actually lands on his phone, neither is a
backup."*

The **bullet** now reads: *"Saving a copy used to fail on iPhone with no message at all. This
release changed how the file is handed over — but it has not been confirmed on an iPhone since, so
check the file really arrives before relying on it."* That is exactly right. It avoids the word
"backup", it says what changed, and it says plainly that nobody has checked. **That half complies.**

The **title still reads "Exports reach the iPhone."** That is a flat statement that the thing
nobody has confirmed did in fact happen. The title is the bigger, bolder text on the card; the
caveat is the small text underneath. Somebody skimming fifty entries reads titles.

**Verdict on D: does not comply.** The fix is three words — "Exports on the iPhone", or "A
different way to save on iPhone". It costs nothing and it removes the one claim in this feature
with a route to real harm.

## 3. The new "never covers Connecting…" test — verified, and it is good work

I ran the suite: **23/23**. Then I broke things, twice.

- **Sabotage 1 — deleted `|| !state.loaded` from `renderWhatsNewModal()` (line 2603).**
  Result: **22/23, exit 1.** The check that fired was exactly the named one — *"the update notice
  is NOT on top of it."* The other two checks in that section stayed green, which is correct.
  I restored the file and confirmed the md5 matches the original byte for byte.
- **Sabotage 2 — made the new slow stub answer immediately**, i.e. broke the test's own setup
  rather than the app. Result: **21/23**, and the first thing to go red was *"the app really is on
  the Connecting screen."* That is the important one. It means this test cannot quietly rot into a
  vacuous pass: if the stub ever stops holding the snapshot back, the test says so out loud instead
  of reporting green against a state it never reached.

**Does the new stub weaken anything else?** No. `STUB_FS_SLOW` is a second constant used at exactly
one place (line 246, section 7). Sections 1–6 still use the original `STUB_FS` at lines 92 and 110,
unchanged. I checked this by hand, not by assumption.

This is the one finding the release closed properly, and the reasoning in the commit message —
that an untestable claim was a stub problem, not a missing assertion — is worth keeping.

## 4. My own spot-check of the history — the reason I am holding this

The audit found 4 errors in 10 entries and said the other 41 were untrusted. The fix commit says
every entry was re-paired against the sources. **I checked roughly thirty of them myself, against
README.md, STATUS.md and in two cases the app's own code. I found five more errors.** I did not
re-use the audit's sample; most of these are entries it never looked at.

**Wrong, and it matters:**

1. **v52 (paracentesis) — "The weight chart no longer jumps because of a drain."**
   This is false, and the app says so itself. STATUS is explicit that the Weight report gained
   *"annotation, not adjustment"*, and the shipping code at index.html line 6955 prints, on that
   very screen: *"Weight readings are shown exactly as recorded and are not adjusted for
   drainage."* So the What's new page and the Weight report contradict each other about the same
   chart. A drain of several litres genuinely moves her weight, and the chart genuinely shows it.
   Telling her it does not is the one error in this set that could change how somebody reads a
   clinical number.

2. **v49 — "A card could show 'Waiting' over a dose that had actually been missed, so the alert
   never appeared."**
   The last clause inverts what happened. Aaron's own report, quoted in STATUS: *"I have a missed
   alert for protonix for morning. the protonix card shows waiting."* The alert **did** appear.
   STATUS says in bold that every individual state was correct and that the defect was the card and
   the banner telling different stories. As written, the entry tells Brandi that missed-dose alerts
   used to fail silently. They did not. (I will grant one ambiguity: "the alert" could be read as
   "the alert on the card". Everywhere else in this same history, "the alert" means the red banner.)

3. **v54 — "A saved copy now records which phone and which day it came from."**
   The day, yes. The **phone, no.** I read the function that builds the file (`bkBuildPayload`): it
   writes format, format version, app version, patient name, created-at, and the records. There is
   no device field anywhere in it, and the filename is patient + kind + date. The entry also misses
   what v54 actually did, which was to make the app tell you *where* the file went.

**Wrong, but minor:**

4. **v23 — "Senokot added … with its own card."** Its own card came in **v24**. README's v23 row
   puts it on the shared scheduled card; README's v24 row is the one that says "Protonix and
   Senokot get individual cards", and the history's own v24 entry says so too. So the history
   credits the same change to two releases — the identical mistake that produced the v37 defect.

5. **v28 — "A leftover demo function that *could have* written fake entries into the real record."**
   It did not "could have". README's v28 row says it **had silently written** fake entries into
   `caretracker_entries` — her real medical data — and that all of them had to be identified and
   deleted from Firestore. Softening a real data-integrity incident to a hypothetical is the wrong
   direction to be wrong in, on the one subject where this app has to be straight with her.

**Checked, ambiguous, worth tightening but I am not counting it as an error:**

- **v55** — *"Restoring … used to bring back the entries but silently skip the medication list. It
  no longer does, and it tells you what it restored."* A restore on a phone that already has a
  medication list **still** skips the incoming one — deliberately, and correctly, because a restore
  must not wipe a list someone maintains. What v55 fixed was the silence, not the skipping. Read as
  "it no longer does *that silently*", the sentence is right, and the clause that follows supports
  that reading. Read the other way it promises something the app does not do. One word would settle
  it.

**Checked and correct** (this is the good news, and it is most of the list): v13, v14, v15, v16,
v17, v18, v19, v20, v21, v22, v24, v25, v26, v27, v29, v30, v31, v32, v34, v35, v36, v38, v42,
v43.1, v43.2, v43.3, v45, v46, v47, v48, v51, v53, v55, v56, v57, v58, v59, v60, v61 — plus the six
the audit had already corrected. Several omit things (v30 leaves out the Cycle tab and In-Patient
tracking; v35 leaves out the banner becoming persistent), but leaving something out is not the same
as saying something untrue, and for a patient-facing summary that is a fair trade.

I also ran a mechanical check the project does not have: **every version named in the history
exists in README or STATUS, there are no duplicates, and no release in the docs is missing from the
history.** 51 entries, all accounted for. So the *structure* is sound. It is the sentences.

**The rate is better — about five in thirty rather than four in ten — but "better" is not the
standard for a document that describes a patient's own medication record.**

## 5. Numbers — what actually ran

- **`python3 pm.py`, run twice as Rule 2.5 requires.**
  **Before starting: exit 2 — clear, with warnings, no blockers.** Version v61 and cache
  `caretracker-v61` agree; index.html parses; both md5s in STATUS match the files; the render audit
  is recorded; the dispatch flag is ACTIVE and matches STATUS; notes moved with the code. Two
  warnings, both already known: the stale STATUS version row (finding N), and nine pinned version
  literals in older harness suites — one of which is the `cal-test` problem in finding I.
  **Before writing this up: exit 1 — one blocker, and it is mine**, `?? outputs/PM-v61.md`, this
  report sitting untracked. I was told not to commit or push, so I am disclosing it rather than
  clearing it. Nothing else about the release blocks.
- **`harness/whatsnew-test.mjs` — 23/23**, and falsified twice (section 3).
- **`harness/overflow-scan.mjs` — 80 of 80 screen/width combinations, 0 overflowing elements,
  CLEAN.** Reproduces RENDER-v61.md exactly. Note for whoever runs it next: it refuses to start if
  a proxy is set, so it must be run as `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u
  http_proxy node harness/overflow-scan.mjs`. My first attempt exited 3 and printed one line — a
  gate that refuses to start looks nothing like a gate that passed, which is the right design.
- **Full sweep via `./run-all-tests.sh`** — results in the table below. Every suite named actually
  started and printed a real assertion count; none were silently skipped.

### Every suite in `harness/`, run via `./run-all-tests.sh`

**Runner summary: PASS 21 · FAIL 6 · COULD-NOT-START 0.** Every suite started and printed a real
assertion count — nothing was silently skipped. The runner's own last line reads *"NOT GREEN — do
not report this work as done."*

Six suites are red. To find out which of them v61 actually caused, I re-ran **every one of them
against the pre-v61 build** (`663c5dc`, the commit v61 was built on) and compared the counts.

| Suite | On v61 | On the pre-v61 build | Caused by v61? |
|---|---|---|---|
| cal-test | 67/70 | 67/70 | No — identical |
| chemo-offset-test | 17/17 | — | Green |
| deactivate-test | 20 pass, 14 fail (34) | 20 pass, 14 fail (34) | No — identical |
| encbackup-test | 16/16 | — | Green |
| eod-test | 11/11 | — | Green |
| export-test | 49/49 | — | Green |
| inpatient-window-test | 10/10 | — | Green |
| iosshare-test | 7/7 | — | Green |
| ledger-test | pass | — | Green |
| logger-test | 19/19 | — | Green |
| medflag-backfill-test | 9/9 | — | Green |
| medskip-test | 10/10 | — | Green |
| medsync-test | 90/99 | 90/99 | No — identical |
| missed-banner-test | 16/16 | — | Green |
| missedcard-test | 7/7 | — | Green |
| overflow-scan | 80/80 combinations, 0 overflowing | — | Green |
| **para-test** | **15/16** | **16/16** | **YES — v61 broke this one** |
| reason-test | 37/41 | 37/41 | No — identical |
| reminder-equivalence | pass | — | Green |
| settings-test | 11/11 | — | Green |
| share-test | 9/9 | — | Green |
| sim-firestore | pass | — | Green |
| swfresh-test | 7/7 | — | Green |
| syncguard-test | 5/5 | — | Green |
| tour-test | 58/68 | 58/68 | No — identical |
| treatment-window-test | 32/32 | — | Green |
| whatsnew-test | **23/23** | — | Green, and falsified twice |

**Five of the six reds are pre-existing and byte-for-byte unchanged by v61.** They are stale
assertions of the kind this project has paid for before: `cal-test`, `reason-test` and `tour-test`
pin `APP_VERSION` to the literal `v43.3`; `medsync-test` and `tour-test` assert the shipped file is
"byte-identical to the base build"; and `cal-test` and `tour-test` both hard-code the menu at six
rows. They are worth fixing, but not by this release and not as a condition of it.

### The one real regression: `para-test` PARA-0

`PARA-0-one-spelling-only` greps the whole shipped file for `[Ll]itre` and requires **zero hits**.
It is v59's gate — the release whose entire point was that the app must not spell "liter" two ways.
It passed on the pre-v61 build and fails on v61.

The cause is v61's own changelog. The v59 entry reads: *'The app used both "liters" and "litres" in
different places. It now uses one, everywhere.'* To explain the fix, it quotes the word the fix
removed — and it is the only occurrence in the file, so the app now **displays** "litres" on the
What's new page, inside the sentence claiming it does not.

This is a small thing with a clean answer, and it must be settled before shipping rather than
ignored: reword the entry so it does not need the British spelling (*'The app spelled "liter" two
different ways. It now uses one spelling everywhere.'*), or deliberately amend PARA-0 to allow the
changelog and say why. What is not acceptable is shipping with the gate red, because a red gate
everybody has learned to scroll past is how the eight-release blind spot in `run-all-tests.sh`'s
own header comment happened.

**`cal-test` is the one red, it is pre-existing, and v61 did not cause it.** Two of its three
failures are stale assertions, not defects: `FILE-app-version` asserts APP_VERSION is literally
`v43.3` (it fails on every release since), and `TAP-drawer-items` asserts `boxes.length === 6` when
the menu has had more rows since v58. That count assertion throws first, so **the 44px tap-target
loop it is named after has not run since the menu grew** — and v61 adds a row to exactly that menu.

Because that gate is dark, I measured the menu myself rather than trust it: at 320, 375, 390 and
412px, all **nine** rows — including the new "What's new" row — are **58px tall** and at least
250px wide, comfortably over the 44px floor. The audit's hand measurement was right.

## 6. A separate defect I found, which is not v61's fault

**The Clear button on the missed-dose banner is 30px tall — under the project's own 44px tap
floor — at both 320px and 390px.** I measured it in a browser, twice. It came in with the v60
banner redesign (commit `663c5dc`), which is the base v61 was built on and is already on `main`, so
this is live, not pending. It is a small control on the missed-dose alert, and `pm.py`'s 16px text
check does not cover buttons. Flagging it now rather than saving it, per the rules.

## 7. What has to change before this ships

Five things. All of them are text — none need a code change or a new test.

1. **v52** — remove or correct "The weight chart no longer jumps because of a drain." The app's own
   Weight report says the opposite on screen. **This one cannot wait**, because it is the only
   entry that could change how a clinical number is read.
2. **v49** — drop "so the alert never appeared." The alert appeared; the card disagreed with it.
   **This one cannot wait either**, because it tells her the missed-dose alert used to fail.
3. **v50 title** — "Exports reach the iPhone" states as fact the one thing Rule 7 says must not be
   stated until Aaron confirms it on his phone. Three words.
4. **v54, v23, v28** — the phone-of-origin claim, the Senokot card, and the softened demo-data
   incident. Minor individually; together they are the same failure mode still running.
5. **The `para-test` PARA-0 regression.** v61 takes a green gate red by printing "litres" in the
   v59 entry. Reword the entry, or amend the gate on purpose and record why. **This one is not a
   judgement call** — it is a suite that passed before this release and does not now.

And one process item, which is the real reason I am not waving this through on a promise:

6. **Record the pairing.** The last commit said all 51 entries were re-checked against the sources,
   and thirty minutes of independent checking found five errors. I am not accusing anyone of
   anything — I think the entries were re-read rather than re-paired line by line. So before the
   next attempt, write down the source line for each of the 51 entries, in a file, so the next
   reviewer can audit the claim instead of trusting it. That is a text file, not a gate, and it is
   an hour of work that ends this loop permanently.

## 8. What I accept as known-imperfect, and would ship over

- **Nobody has opened v61 on a real iPhone.** Everything anyone has run — mine, the audit's, the
  render scan — is Chromium at Apple viewport sizes. This stays true until Aaron spends ten seconds
  on it, and it is not a reason to hold the release.
- **The update notice reappears on every open if the phone's storage is full** (finding J). One
  extra tap. No record at risk. Fine.
- **The dark `cal-test` drawer gate** (finding I). The thing it would have checked, I checked by
  hand and it passes. Fix the assertion next release, do not hold this one for it.
- **The stale STATUS version row** (finding N) and the leftover `key` attributes on the missed-dose
  banner (finding K). Housekeeping.
- **Entries that leave things out** — v30 and v35 especially. A patient-facing history is allowed to
  be a summary. It is not allowed to be wrong.
- **No gate can check whether an entry is true** (finding G). A machine cannot do this. The pairing
  record in item 5 is the honest substitute.

## 9. What goes first in the next release

1. The text fixes and the PARA-0 regression above, then the pairing record.
2. **The 30px Clear button on the missed-dose banner** — it is live now, it is a control on the
   safety alert, and it is a one-line change.
3. **Make `cal-test`'s drawer assertion version-agnostic** (`>= 6`, not `=== 6`) and unpin
   `FILE-app-version`, so the tap-target gate starts running again after three releases dark. This
   is the "gate that goes red for a legitimate change" pattern this project has already paid for
   three times.
4. **The v50 iPhone confirmation itself.** Ten seconds of Aaron's time on his phone closes a
   standing exception that has been open since v44 and unlocks honest wording for the entry.

---

## The bottom line, plainly

The code is safe and I am confident of that — the audit proved it mechanically, and I re-checked the
proof myself: v61 removes exactly two lines from index.html, the version constant and the state
line. Everything else it does to that file is additive. The new "Connecting…" test is the best piece
of work in the release.

But this feature's entire product is a document about Brandi's own care, and that document still
contains statements her own app contradicts on another screen. And the release currently leaves the
test suite less green than it found it, which is a line this project has decided not to cross.

A false "do not ship" has a real cost and I have weighed it. Aaron asked for this, it is finished,
and holding it for a week would be wrong. Holding it for an hour is not — that is what this is:
five sentences and one reworded line. **Fix the words, fix the gate, keep the code, and it ships.**
I would expect to approve the next attempt.

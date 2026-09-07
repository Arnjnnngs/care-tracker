# Team review — 2026-09-07, new lead's first job

Aaron: *"Your first job is the team, and I want you to actually think about it rather than accept it."*

**Nothing here is in effect until Aaron approves it.** Hires, fires and merges need his word.
Evidence is from `README.md` WORKING RELATIONSHIP, `outputs/AUDIT-*.md`, `outputs/ENHANCER-PASS-*.md`,
and the v71 `index.html`.

## 1. Who is earning their keep

| Role | Record | Verdict |
|---|---|---|
| **Zero Day Auditor** | BLOCKED v61, v66, v69 (twice), v70. Every block was correct and would have reached the patient: a weigh-in becoming two rows forever, an oncologist report saying +35 lb while the screen said −10, a period vanishing on one tap. | **Earning it. The strongest seat on the board.** |
| **pm.py** | Blocked its own release on unpushed work; found the dispatch flag defined so IDLE meant two things; catches version/cache drift every release. Free. | **Earning it** — for release mechanics only. It has never looked at code and is not meant to. |
| **Enhancer** | Pass 03 found the bowel/appetite defects (identical-timestamp coin flip, delete-before-add) — the top open item — plus the two report screens with no controls. | **Earning it**, after one honest miss (the average). |
| **The Voice** | Hired 2026-09-06. Zero catches. Missed the average within hours of being created. | **Not yet earning it** — and structurally it is the builder reading the builder's own copy, the same hole Rule 2.2 closed for code. |
| **Falsification** (a practice, not a role) | Caught something real on every release it was applied to. | Keep, mandatory. |

## 2. Where the gaps still are

1. **The same data bug is on its fifth instance and every role found it after the fact.** Delete-based
   correction: paracentesis (v52), cycle (v66), weight (v69), cycle move (v70), now bowel + appetite —
   three `removeEntryDB` correction paths still in v71 (lines ~2351, ~2369, ~2406). A role is the wrong
   tool for a class of bug. It needs a **mechanical rule in pm.py**: `removeEntryDB` may be called from the
   History Remove button and nowhere else; falsified once. Zero tokens per release.
2. **Suites rot and nobody owns running them.** `export-test` was dead from v64 to v70; `overflow-scan`
   was blindfolded for three releases. ChemoWell has `run-all-tests.sh` and `release_check.sh`;
   care-tracker has neither. pm.py should run every harness suite and fail on any that errors out.
3. **The open list has no owner.** The task list is empty. Open items live inside a 1,400-line
   STATUS.md. The "nothing waiting on you" failure (README 1a) came directly from not having the list in
   front of us. ChemoWell has the Scribe for exactly this; care-tracker does not. Process drift, again.
4. **The phone.** Nothing here can load the live site or hold a device; `deliverFile()` on iOS is still
   unconfirmed after 20 releases. This is Aaron's and only Aaron's. It must be named as an exemption in
   every release message ("needs your phone: X"), not silently skipped.
5. **The auditor is expensive because it runs after the build.** v69 was built three times. A five-line
   "write model" statement from the builder BEFORE coding — what this release appends, what it deletes,
   how it tie-breaks — would have stopped v69 and v70 before a line existed (v52 did exactly this and
   caught two traps). Cost: one paragraph in the START message.

## 3. Hire / fire / merge / re-brief

| Action | Who | One-line reason | Recommend |
|---|---|---|---|
| **Keep + re-brief** | Zero Day Auditor | Five correct blocks. Add mandatory probes: identical-timestamp tie-breaks, any `removeEntryDB` on a correction path, and the Voice's three copy questions. | Yes |
| **Keep + extend** | pm.py | Two new falsifiable rules: no `removeEntryDB` outside History Remove; every harness suite runs and none errors. | Yes (S, ~40 min) |
| **Keep** | Enhancer | Earned its seat with pass 03; output already goes in the release message. | Yes |
| **Merge** | The Voice → into the Auditor's brief on audited releases; stays an inline pass on copy-only releases | Same eyes wrote the copy and reviewed it; ChemoWell already runs copy review through the Auditor. | Yes |
| **Hire** | Scribe (from ChemoWell; inline step, no agent) | A `REQUESTS.md` open list, shown done/outstanding in every reply; the task list is empty today. | Yes (S) |
| **Re-brief** | Builder | Write model stated before coding; exemption list in every release message. | Yes |
| **Do not hire** | a coder, a device tester, a second auditor | Rule 2.2's reasoning holds; the device is Aaron; the Lead Auditor stays retired unless dose logic or storage format changes. | — |

## 4. How it runs in sequence without going silent

1. **Before** — `pm.py`; cost line (S / M / L; M and L wait); Scribe shows the open list; builder states the
   write model. Dispatch flips ACTIVE at the first commit, not before.
2. **Build inline.** WIP push at least every 30 minutes, a message at every push.
3. **Inline passes, in order, no agents:** Voice (copy), Enhancer (controls table per touched screen),
   falsify every new check, look at the screenshots. Each is one line in a progress message, never a stop.
4. **Zero Day Auditor — one agent, only if the release writes, edits or deletes a record, or is big.**
   Before launch: dispatch is ACTIVE, a message says it is running and for how long (cap 30 min), the
   brief carries the progress rule and the Firestore facts. It runs in the background and the harness
   wakes the session — the one legitimate silence. Verdict pushed to `outputs/`, headline first in the
   next message. BLOCK → back to step 2; the re-audit is a delta pass.
5. **`pm.py` again.** Exit 1 means it is not done.
6. **Release message:** what shipped; Enhancer list with sizes; auditor verdict; what is deliberately
   exempt and why; what needs Aaron's phone; Scribe's done / outstanding list. Dispatch back to IDLE.

Never two agents. Never an agent while dispatch is IDLE. Never an inline pass promoted to an agent
"to be thorough".

## 5. The top open item, confirmed on v71

Bowel and appetite both delete before they add, in three places, and both readers pick an arbitrary
winner on an identical timestamp. Fifth instance of the root cause fixed in v52/v69/v70. The fix is the
same append-and-supersede model: group by day, newest `loggedAt` wins, no delete. **Size M** (three write
paths, two readers, a new suite, an audited release). Waits for Aaron's go per Rule 3.

---

## Addendum, same day — Aaron's two questions

### "Are the agents in the right order for working efficiently?"

Not quite. Two moves, both about putting cheap checks before expensive ones and design-time checks
before build-time ones:

- **The Enhancer moves BEFORE the build**, on the screens the release will touch. Run after the build, its
  proposals can only go into the *next* release; run before, Aaron picks from the list and the build
  carries what he picked. Same cost, one release earlier.
- **`pm.py` runs BEFORE the auditor as well as after.** It is free and takes seconds; the auditor is the
  only expensive step. Spending an agent on a build that pm.py would have bounced for mechanics is
  the v69 pattern (built three times).

Revised order: pm.py → cost line → open list → write model → Enhancer table → **build** (push every 30
min) → suites + falsify + Voice + screenshots → pm.py → **auditor, once, last** → pm.py → release message.

### "Who is checking the actual screens on Android and iPhone?"

**Nobody owns it. Honest answer.** What exists today:

| What | Covers | Does not cover |
|---|---|---|
| `harness/overflow-scan.mjs` | 11 emulated sizes, 5 iPhone + 6 Android widths, every screen incl. report details since v70. Asks: does it **fit** (clipping, sideways scroll, 16px floor). | Whether it **looks right**. It is Chromium pretending to be a phone — it cannot render like Safari. It was blindfolded for three releases and nobody noticed. |
| "Look at the screenshots" | The builder's own eyes, one size (390×844), after the build. Caught 4 defects in v66 and the unreadable v70 refusal. | A practice, not a role. One size. The builder checking the builder. |
| Aaron's Galaxy, Brandi's iPhone | Everything real. Every iOS-specific bug on the record (scroll behind overlays, zoom on small inputs, the silent file save) was found here. | Only Aaron can do it, and nothing tells him which screens a release changed so he knows where to look. |

**This sandbox has only Chromium.** No WebKit engine is installed, so an iPhone's rendering cannot be
reproduced here at all; Android's can be approximated (Chrome is Chrome). That is a hard limit and it
goes on the exemption list of every release: *"iPhone appearance: needs Brandi's phone; screens to
look at: X, Y."*

**Proposed hire: the Designer** — ChemoWell has had this stage since app-v25 and care-tracker never
did. Inline on any release that changes layout; an agent only for a big visual release. Its checklist:
every touched screen at three sizes (320 iPhone SE, 360 Galaxy, 390 iPhone 13), light and dark if the
app has both, the screenshots **sent to Aaron as they are produced** rather than filed, and a named
list of what he should open on the two real phones. Cost S per release.

**Possible but bigger (M, Aaron's call):** an Android emulator smoke job in GitHub Actions, as
ChemoWell already runs — opens the live PWA in real Chrome on a real Android image and captures
screenshots. Real Android, still not iPhone.

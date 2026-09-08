VERDICT: BLOCK

**Headline: the placeholder fix is right — I walked all six purpose states end to end and every one
of them stores, shows and reverses correctly, and the builder's three falsification numbers
reproduce exactly. The block is one line somewhere else: `purposeOf()` indexes `MED_PURPOSE` bare,
so adding a medication named "Constructor" now throws inside the Meds list render, and after a
reload the Meds screen comes up with ZERO medication cards — no list, no edit, no delete, no way
back from inside the app, and the broken config publishes to the other phone. I reported this class
last pass as F7 and could not demonstrate it; I can now, and the consequence is far worse than the
cosmetic one I predicted. v73 is clean, v74 is not, and the one-line `hasOwnProperty` guard the file
already uses two lines below makes it clean again — verified, 28/28 on my probe and 25/25 on the
builder's suite.**

Delta audit 2026-09-08 against `index.html` (`APP_VERSION` read from the file under test: **v74**),
control `outputs/rollback-v73/index.html`. No network on any run
(`env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy`, and both suites refuse to start if
a proxy variable is set). Chromium at `/opt/pw-browsers/chromium`. **Nothing in the repo was edited
except this file, and nothing was committed.** Broken builds and my probes live in the scratchpad.

---

# BLOCK — a medication named "Constructor" permanently empties the Meds screen

This is not the fix under review. It is the finding I filed last pass as **F7, explicitly labelled
"NOT DEMONSTRATED"**, in a build that then shipped it unchanged. It is demonstrated now.

```js
function purposeOf(med) {
  ...
  return MED_PURPOSE[med.id] || '';     // bare index on an object literal
}
```

`MED_PURPOSE` is a `{...}` literal, so it inherits `Object.prototype`. `MED_PURPOSE['constructor']`
is the `Object` **function**, which is truthy, so `purposeOf()` returns a function instead of a
string. The v74 render passes that straight into `h()` as a child:

```
index.html:4593   purposeOf(med) ? h('div', { 'data-med-purpose': med.id, ... }, purposeOf(med)) : null
index.html:2681   el.appendChild(...)   ->  TypeError: parameter 1 is not of type 'Node'
```

**Measured, in a browser, on all three builds — same script, same steps: open Meds, tap Add, type a
name, tap Add medication, then reload the page.**

| build | errors on add | card appears | after reload: medication cards on Meds |
|---|---|---|---|
| **v73** (control) | 0 | yes | **14** |
| **v74 as it stands** | **2** | **no** | **0 — the list is gone** |
| v74 + the one-line guard | 0 | yes | **14** |
| v74, control name "Toaster" | 0 | yes | 14 |

The reload row is the damage. After the crash the medication is **still in
`caretracker-medication-config-v1`** (`storedIds` ends `... "imodium", "constructor"`), so every
subsequent render of the Meds screen throws on it forever. The Meds screen is the only place the
edit and delete buttons exist, so **there is no way to remove the medication that is breaking the
screen from inside the app.** Home still renders, so nothing announces that anything is wrong.
And `persistMedicationConfig` publishes the config over medsync, so the second phone inherits it.

**Reachability is genuinely low, and I will not overstate it.** `safeMedicationId` lowercases and
slugifies to `[a-z0-9-]`, and I enumerated `Object.getOwnPropertyNames(Object.prototype)` against
that transform: **`constructor` is the only key that survives it.** `toString`, `valueOf`,
`hasOwnProperty` and `__proto__` all slug into harmless strings. So a caregiver must name a
medication literally "Constructor" (any casing), or a shared/imported config must carry that id.

**Why it blocks anyway.**

1. The fix is **one line**, it is the idiom already in this file, and I have verified it: my probe
   28/28 and the builder's suite 25/25 on the guarded build, with zero page errors.
2. This exact class has been fixed **twice** in this file already, and the comment recording one of
   those fixes — `archivedMeds['constructor']` returning the literal string `"Object"` — sits
   **thirteen lines below** the new code that reintroduces it.
3. It was in my last report, and unlike the other findings it was not taken. Shipping it now makes
   it a decision rather than an oversight, and the outcome of that decision is an unrecoverable
   screen on a live patient's app.

**The fix, verified as `G-guarded`:**

```js
  return (Object.prototype.hasOwnProperty.call(MED_PURPOSE, med.id) ? MED_PURPOSE[med.id] : '') || '';
```

The placeholder expression at `index.html:4522` is the **same bare index** and needs the same guard;
on a build where the card renders, `MED_PURPOSE['constructor']` would be handed to
`setAttribute('placeholder', ...)` and print `function Object() { [native code] }` into the box.
That half is cosmetic; fix both while the file is open.

**Add the case to the suite.** A medication whose name slugs onto a prototype key, added and then
**reloaded**, asserting the card count is unchanged and page errors are zero. Written for the class,
not for the word: it is the reload that turns this from a bad render into a dead screen.

---

# Q1 — the placeholder fix: every path, walked in a browser. It is right.

My own probe (`scratchpad/probe.mjs`, 28 checks) drives the real UI and reads the **saved value out
of `localStorage`**, not the screen. **28/28 on the guarded build.** On the build as it stands the
only red is the crash above.

| path | box value | box placeholder | stored `purpose` | on screen |
|---|---|---|---|---|
| default med, never edited | `""` | the built-in sentence, verbatim | absent | built-in line |
| default med, opened and saved untouched | `""` | built-in sentence | `""` | built-in line, **unchanged** |
| default med, given a typed line | typed line | built-in sentence behind it | the typed line | typed line |
| ...that typed line then cleared | `""` | built-in sentence | `""` | **built-in line returns** |
| user-added med, name not in the table | `""` | `For example: settles nausea` | absent | **no element at all** |
| user-added med, given a typed line, then cleared | `""` | generic example | `""` | line appears, then **no element** |

**Both halves of the block are gone.** Nothing is frozen: saving an untouched Dexamethasone,
Protonix, Morphine, Imodium or Iron no longer copies the built-in sentence into the patient's
config, so a later correction to a sentence that turns out to be clinically wrong still reaches
every phone. And clearing is no longer a no-op that reports success — the box is honestly empty
with grey text behind it, so there is nothing left for the app to lie about.

**No state is unreachable and no state is one-way.** Typed -> cleared -> typed again round-trips;
I asserted the box is empty again after the clear, not merely that the screen changed.

**The one residual, and it is now a decision rather than a defect.** A caregiver still cannot make a
default medication show **no** line at all — clearing returns the built-in sentence. Under the
blocked build that was a lie (the app said "updated" and nothing moved); under the placeholder it is
the visible, self-evident behaviour of a placeholder, and she can always override with her own
words. **I am not blocking on it, but Aaron should know it is true**: if a clinician says one of the
thirteen sentences is wrong for Brandi, the caregiver's only remedy in the app is to type something
over it, not to silence it. If that is not acceptable, the fix is a sentinel (`purpose: null` =
suppressed), which is a bigger change than this release should carry.

**One small new artefact.** `saveMedicationEditor` writes `purpose: ""` and `normalizeMedication`
spreads it through, so a medication that is opened and saved with **no changes at all** now differs
from an untouched phone's copy by `"purpose":""` in the medsync JSON. Harmless, but it is a
spurious "these lists differ". The file's own idiom fixes it in one line beside the existing
`if (!candidate.doses.length) delete candidate.doses;`:
`if (!candidate.purpose) delete candidate.purpose;`. Optional, not a blocker.

# Q2 — `MED_PURPOSE[null]` on the Add form, and the h() trap. Both clean.

`state.medEditor.sourceId` is `null` in add mode, so the expression is `MED_PURPOSE[null]` ->
`undefined` -> `|| 'For example: settles nausea'`. **The `||` is what saves it**: the attribute never
receives `undefined`, so the h() trap cannot fire here. Asserted on the rendered element rather than
reasoned:

```
<input value="" placeholder="For example: settles nausea" style="... font-size: 16px; ...">
```

Placeholder attribute present, not the literal string `undefined`, `null` or `[object Object]`; no
bare valueless attribute; the field is not `disabled` or `readOnly`; computed `font-size` is
**16px**, the iOS floor. The `state.medEditor &&` guard inside the index is dead code —
`renderMedicationEditor` returns early when `state.medEditor` is null — but harmless.

# Q3 — the builder's three numbers. All three reproduce. One suite gap found.

| build | what I broke | builder said | I measured |
|---|---|---|---|
| v73 control | — | 16/25 | **16/25** |
| B | `purpose: base.purpose \|\| ''` -> `purposeOf(base)` (the blocked bug, verbatim) | 23/25 | **23/25** |
| C | deleted `purpose: String(form.purpose \|\| '').trim(),` from the save path | 22/25 | **22/25** |

**Is 23/25 enough, and would a slightly different mistake still be caught?** Yes for this class. The
two checks that bite assert on the **value** and on the **stored string**, not on the expression, so
I broke it a second way — `purpose: base.purpose || MED_PURPOSE[base.id] || ''`, which is the same
bug written by someone who thought they were being careful — and it went red **identically at
23/25**, on the same two checks. Two checks is thin, but they are the right two and they are
value-based, so the class is covered.

**The gap is the other half of the fix.** I reverted the placeholder to the plain literal
`'For example: settles nausea'` and left everything else correct — a build where opening Zofran's
editor shows an empty box and no hint of what the sentence on screen says:

> **25/25. Fully green.**

The check named for it — *"the built-in sentence shows as the placeholder instead"* — tests
`/nausea/i` against the placeholder, and **the fallback string `'For example: settles nausea'`
contains the word "nausea"**. So the check passes on the build it exists to catch. This is F6 from
my last report, the same shape, in the replacement section: *the check that carries the name is not
the check doing the work.* Non-blocking — the product is correct — but a future release can silently
drop the placeholder and the suite will applaud. **Fix: compare the placeholder to the table entry
the suite already reads out of the file** (`state0.placeholder === TABLE['zofran']`), never to a
substring that both candidates share. I also broke `purposeOf`'s table fallback (build F) as a
sanity control: **22/25**, correctly red.

# Q4 — the copy. Four changes, three clean, one new ambiguity. The guard is loose AND tight.

All thirteen read; no digits, no doses, no advice, none over 110 characters.

- **Tylenol -> `'Eases pain.'`** — taken, and correct. The fever clause is gone.
- **Senokot -> `'A laxative for constipation.'`** — taken, and correct. "Gentle" is gone.
- **Dexamethasone -> `'A steroid that calms nausea, swelling and allergic reactions.'`** — taken.
  The schedule is gone and "allergic reactions" is more accurate than the bare "reactions" it
  replaced. Clean.
- **Tylenol Liquid -> `'Eases pain. The liquid form of the same medicine.'`** — this one introduced
  something. **"The same medicine" no longer has an antecedent.** The old wording named it ("the
  tablets"); the new one points at nothing on the card except the medication's own title. The whole
  reason this line exists is so a caregiver holding two Tylenol products at 2am knows they are the
  same drug and must not be doubled up, and that is precisely the reader who now has to infer the
  referent. It was reworded only because "tablets" tripped the new guard (below). Recommend
  **`'Eases pain. The liquid form of Tylenol.'`** — names the antecedent, no dose, no schedule, and I
  checked it passes the guard. Non-blocking; a one-word class of fix worth doing in the same edit as
  the block.

**The word-based schedule guard is wrong in both directions, and the tight direction already cost a
sentence.**

*Too tight, demonstrated:* it rejects `'Same medicine as the tablets, in liquid form.'` — a
description of the **form**, not a dose or a schedule — because `tablets` is on the banned list.
That rejection is what forced the reword above. A dosage form is not a dosage.

*Too loose, for its own subject:* the list hardcodes the literal phrase **`around chemo`** — the one
instance I found last pass — rather than the class. Run against plausible replacements:

```
accept  A steroid used with chemo to calm nausea, swelling and allergic reactions.
accept  A steroid given on chemo days to calm nausea.
accept  Taken at bedtime to help sleep.
accept  Used in the morning for reflux.
accept  A laxative taken when needed for constipation.
accept  Given before meals.
REJECT  Eases pain. Same medicine as the tablets, in liquid form.
```

Six schedules in words walk straight through; the one legitimate line is the one it stops. This is
Rule 5.5 exactly — *write it for the class, not the instance Aaron reported.* All thirteen current
entries are clean, so this does not block. Either drop `tablet(s)`/`capsule(s)` (forms, not doses)
and add the timing class (`\b(when|as)\s+(needed|required)\b`, `bedtime`, `at night`,
`in the morning`, `before meals`, `\bchemo\b` in any construction), **or** rename the check honestly
to what it is. A guard trusted for more than it does is the failure this project keeps buying.

# Q5 — the rest of the delta, and what carries over

- **No page errors** on any normal path — the only two in the whole audit are the "Constructor"
  crash. The add, edit, type, clear and save flows are silent.
- **v73 rollback is still safe.** `purpose: ""` is a spread-through unknown field to a v73 build,
  exactly as `purpose: "text"` was; nothing new to migrate.
- Copy got **shorter**, not longer, on all four changed entries, so the 320/360px overflow result
  from the first pass carries forward unchanged.
- Everything in the first pass's CLEAN list — the field-by-field editor round-trip, storage and
  medsync survival, the Home exemption, the disclaimer, the 16px floor, the table covering all 13
  shipped ids — was not re-litigated and nothing in this delta touches it.

# Deliberately exempt, said out loud

- **No real-device rendering. This sandbox has Chromium only; an iPhone cannot be reproduced here.**
  The Meds screen at iOS text sizes needs Brandi's or Aaron's phone.
- **No live two-phone medsync round trip.** The medsync statements above are from the code and from
  the stored JSON, not from two real devices.
- The caregiver's own typed text is not guarded for doses or schedules, and should not be — her
  words are her business. Only the thirteen built-in sentences are checked.

# To clear this block

1. `hasOwnProperty` guard on **both** bare `MED_PURPOSE[...]` indexes (`purposeOf` and the editor
   placeholder). Verified green: my probe 28/28, the builder's suite 25/25.
2. A suite case: add a medication named "Constructor", **reload**, assert the card count is
   unchanged and page errors are zero. Falsify it against the current build — it must go red.
3. While the file is open, non-blocking but cheap: the Tylenol Liquid antecedent; the placeholder
   check comparing to `TABLE['zofran']` instead of `/nausea/i`; and the guard's name matching what
   it actually does.

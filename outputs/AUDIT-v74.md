VERDICT: BLOCK

**Headline: clearing the "What it's for" box and tapping Save does nothing — the app says "Zofran
updated." and the built-in sentence is still on screen, because `purposeOf()` treats an empty saved
`purpose` as "not set" and falls back to the table. The caregiver can overwrite a line she thinks is
wrong, but she can never remove one. Everything else in v74 is clean: the editor round-trip is
byte-identical to v73 on every other field, nothing overflows at 320px, and the suite goes red on
all three broken builds I fed it.**

Audited 2026-09-08 against `index.html` (`APP_VERSION` read from the file under test, v74), base
`outputs/rollback-v73/index.html` (v73). No network. Chromium at `/opt/pw-browsers/chromium`.
Nothing in the repo was edited except this file.

---

## BLOCK 1 — a control that reports success and does nothing, on medical text

**Reproduced, not reasoned.** Meds -> Edit Zofran -> select all in "What it's for" -> delete ->
Save changes:

```
{ "seeded":              "Prevents and settles nausea and vomiting.",
  "shownAfterClearing":  "Prevents and settles nausea and vomiting.",
  "storedPurpose":       "" }
```

The empty string IS saved (`storedPurpose` is `""`, so the write happened and synced to the other
phone). The screen does not change, because:

```js
function purposeOf(med) {
  const typed = String(med.purpose || '').trim();
  if (typed) return typed;
  return MED_PURPOSE[med.id] || '';
}
```

`''` is falsy, so "the caregiver deliberately emptied this" and "nobody ever set this" are the same
state. The toast still reads `saved.name + ' updated.'`.

**Why this is a block and not a nit.**

1. It is the app-said-it-worked class this project keeps paying for — the same class the patch
   header itself invokes (v43.3, where correcting one field in *this editor* silently disabled a
   medication's missed-dose alerts while the app said "updated"). v74 correctly fixed the wipe
   direction of that bug and opened the mirror image of it.
2. The content is medical. The one realistic reason a caregiver opens that box and empties it is
   that someone told her the line is wrong or unhelpful for Brandi. That is precisely the case the
   app refuses to honour, silently. Her only workaround is to type something else over it — she
   cannot make the app stop saying it.
3. Rule 2.6 checklist item 3, verbatim: *"Can a mistake be corrected, or only deleted and redone?"*
   Here it cannot even be deleted.
4. The suite never tries it. 18/18 is green on a build where this control is inert.

**Root cause, and it is shared with Block 2:** the form has two states where it needs three. It
cannot distinguish *unset* (fall back to the table) from *deliberately blank* (show nothing).

**Cheapest honest fixes, in order of preference:**
- Seed the box as a **placeholder** rather than a value — `formInput({ value: base.purpose || '',
  placeholder: MED_PURPOSE[base.id] || 'For example: settles nausea' })`. Unset stays unset, typing
  overrides, clearing returns to the built-in line, and the box never lies about what is stored.
  This also fixes Block 2 completely and is the smallest diff.
- Or store an explicit sentinel (`purpose: null` = suppressed) and have `purposeOf` honour it.
- Whichever is chosen, **falsify it by clearing the box and watching the line disappear**, and add
  that case to `med-purpose-test.mjs` — it is the one case the suite does not cover.

## BLOCK 2 (same root cause, ship the fix together) — editing a medication freezes today's sentence into the patient's data forever

`medicationFormFrom` seeds `purpose: purposeOf(base)`, and `saveMedicationEditor` writes it back. So
**any** edit to a default medication — changing a gap hour, renaming it, nothing at all — converts
the built-in sentence into stored user data. Measured, v73 vs v74, saving each editor with no
changes and diffing the stored object field by field:

| medication | difference between v73 and v74 stored object |
|---|---|
| Dexamethasone | `purpose`: absent -> `"A steroid given around chemo to calm nausea, swelling and reactions."` |
| Protonix | `purpose`: absent -> `"Lowers stomach acid, which protects the stomach and eases reflux."` |
| Morphine | `purpose`: absent -> `"A strong pain reliever for moderate to severe pain."` |
| Imodium | `purpose`: absent -> `"Slows the gut down to control diarrhea."` |
| Iron | `purpose`: absent -> `"An iron supplement, for low iron levels."` |

**Everything else is identical** — see the CLEAN section below; that part of the release is good.

The consequence is the patch header's own stated future: *"If Aaron later wants the exact federal
label wording, that is a data refresh into the same table."* **A data refresh will not reach any
medication that has ever been edited**, on either phone, forever, with nothing on screen to say so
and no way to tell a frozen copy from a caregiver's own words. If the refresh happens *because a
sentence was clinically wrong*, the wrong sentence is the one that stays.

It also means `purpose` propagates through `persistMedicationConfig` -> `medsyncPublishLocalChange`
to the shared Firestore list on the first edit after v74 lands.

The placeholder fix above removes this entirely.

## Findings that do not block, ranked

**F3 — `'tylenol': 'Eases pain and brings down a fever.'` is the one sentence likely to change what
she does at 2am, and in the wrong direction.** It is not false. But this is an oncology app that
also tracks Temperature, and "brings down a fever" reads as a use, not a description. Masking a
fever is the single thing oncology teams tell families not to do without calling first. Voice
question 3 applied to prose rather than a number: *should this be on the screen at all?* Recommend
`'Eases pain.'` — the fever clause adds an indication nobody asked the app to suggest. Same reading
applies more weakly to `'morphine': '... for moderate to severe pain.'`, which is defensible because
it narrows rather than widens use.

**F4 — `'senokot': 'A gentle laxative for constipation.'`** Senna is a **stimulant** laxative;
"gentle" is the classification usually applied to the other kind (stool softeners). It is an
editorial claim, not a statement of purpose, and it is the sort of word a clinician would object to
on a patient on scheduled morphine. Recommend `'A laxative for constipation.'`

**F5 — the "no dose, no schedule" guard is weaker than its name, and one entry already slips past
it.** The suite's headline check is `!/\d/.test(...)`. `'dexamethasone': 'A steroid given around
chemo to calm nausea, swelling and reactions.'` states a **schedule** — "given around chemo" — in
words, with no digit, and passes. The other twelve are clean. Either accept it explicitly (it is
contextually true for this patient, and `chemoOnly` is already on that medication) or reword to
`'A steroid used with chemo to calm nausea, swelling and reactions.'`; either way the guard should
be documented as "no digits", not as "no schedule", so nobody trusts it for more than it does.

**F6 — one check in the new suite cannot fail for the thing it is named after.** Section 4 is
titled *"Editing a medication must not wipe its line (the v43.3 failure class)"* and asserts
`after === before`. For a default medication that assertion is unfalsifiable: if `purpose` were
dropped on save, `purposeOf` falls back to the table and the line is still there. Demonstrated — I
built `brokenA` by deleting `purpose: String(form.purpose || '').trim(),` from
`saveMedicationEditor` (the v43.3 failure exactly) and **section 4 stayed entirely green**; only
section 5 ("what the caregiver types wins") went red. Net coverage exists, but the check that
carries the name is not the check doing the work. There is also no case that edits a **user-added**
medication carrying a typed purpose — the only population with no table fallback, and therefore the
only one where a wipe is unrecoverable.

**F7 — `MED_PURPOSE[med.id]` is a bare index on an object literal. NOT DEMONSTRATED, reported for
the record.** `MED_PURPOSE` is `{...}`, so it inherits `Object.prototype`; `MED_PURPOSE['constructor']`
is the `Object` function, which is truthy (`node -e` confirms). This is the exact class already
fixed twice in this same file — `nameOf()` carries a comment about `archivedMeds['constructor']`
returning the literal string `"Object"`, and `medsyncOwn` exists because of it — and the new code
sits **two lines above that comment**. Reachability is genuinely low: `safeMedicationId` lowercases
and slugifies to `[a-z0-9-]`, so `toString`/`__proto__`/`hasOwnProperty` all become harmless
(`tostring`, `proto`, `hasownproperty`) and only a medication literally named "Constructor" reaches
it. **I tried to add one and my harness's add step did not complete, so I have no end-to-end proof
and am not claiming one.** One-line hygiene fix, consistent with the rest of the file:
`Object.prototype.hasOwnProperty.call(MED_PURPOSE, med.id) ? MED_PURPOSE[med.id] : ''`.

**F8 — the disclaimer's wording outruns the screen in one edge case.** *"The line under each
medication..."* is unconditional, but a user-added medication with no purpose has no line. Cosmetic;
noted so it is a decision rather than an oversight.

## What I attacked and found CLEAN — the parts that should not be re-litigated

1. **The editor, field by field, v73 vs v74.** Round-tripped Dexamethasone (windowed, `alerts`,
   `chemoOnly`, treatment-day span), Protonix (windowed, alerts, linked meds), Morphine (gap,
   rolling ceiling, painScale), Imodium (ceiling in pills), Iron (windowed, alerts, evening-linked)
   through open-and-save-with-no-changes, and diffed the stored objects. **`purpose` is the only
   key that differs on any of them.** Schedule type, windows, gap hours, daily limit and unit, dose
   options, alerts, grouping, chemo-day flags and treatment-day spans all survive. `...(original ||
   {})` in `saveMedicationEditor` and `...original` in `normalizeMedication` mean nothing is
   whitelisted away. No neighbouring field was dropped.
2. **Storage and cross-version.** `normalizeMedication` spreads the original, so `purpose` survives
   load, medsync parse and adopt. A **v73** build reading a v74-written config keeps the unknown
   field and republishes it intact — verified by reading v73's own `normalizeMedication` and
   `saveMedicationEditor`, which also spread the original. **A rollback to v73 is safe.** No new
   migration, no schema break.
3. **The medsync nag — specifically checked, and it does not happen.** Nothing writes `purpose`
   into `state.meds` at load or render; `purposeOf` is a read-only lookup used in exactly two
   places. So `medsyncCurrentJson()` for an untouched list is byte-identical on v73 and v74, and two
   phones on different versions do not read as "different" until a real edit occurs. (After an edit
   they legitimately differ, and the shared-list path converges them.)
4. **Layout at 320 and 360, plus the delete-confirmation state.** `documentElement.scrollWidth ===
   clientWidth` at both widths, on the list and with the Remove/Keep confirmation open. Zero
   purpose lines overflow, none is clipped (`scrollHeight <= clientHeight`), none is
   `nowrap+overflow:hidden`. The card's edit and delete buttons still fit. Screenshot of the 320px
   Meds screen reviewed by eye — the line sits between the generic name and "Doses:" and reads
   cleanly. Zero page errors at every width.
5. **The new editor field.** Rendered at **16px** (the iOS floor), full width via
   `gridColumn: '1 / -1'`, no overflow at 320px, label renders as "WHAT IT'S FOR" (uppercased by
   CSS, as the suite's comment says). No `h()` null-attribute trap: the only conditional is
   `purposeOf(med) ? h(...) : null` as a **child**, not an attribute.
6. **The disclaimer.** Exactly one element, `aboveList: true` (its bottom edge is above the card
   list's top edge) at both widths, on the Meds screen only, and honest about what the text is.
7. **The exemption is real.** Zero `[data-med-purpose]` elements on Home, confirmed independently
   of the suite. The 2am quick-log screen is untouched.
8. **The table covers the app.** All 13 shipped medication ids are keyed, no key is dead, none is a
   near-miss (`protonix` not `pantoprazole`), and `lidocaine`'s "numbing cream" matches its own
   `sub: 'Topical cream'`.

## Suite falsification — both numbers, as required

Baseline: **18/18 on v74**, and the brief's stated 13/18 on v73.

| broken build | what I broke | result |
|---|---|---|
| A | deleted `purpose: String(form.purpose \|\| '').trim(),` from `saveMedicationEditor` (the v43.3 failure itself) | **17/18 FAIL** — caught by section 5, *not* by section 4 (see F6) |
| B | deleted `purpose: purposeOf(base),` from `medicationFormFrom` (box opens blank under visible text) | **17/18 FAIL** — "the box is seeded with the line on screen" went red |
| C | renamed the `data-med-disclaimer` hook | **17/18 FAIL** — "appears exactly once: 0 found" |

The suite is real and it bites. Its gap is the one Block 1 lives in: nothing clears the box.

## What I could not do

- No real-device rendering. **This sandbox has Chromium only; an iPhone cannot be reproduced here**
  and the Meds screen at iOS text sizes is exempt from this audit and needs Brandi's or Aaron's
  phone.
- F7 is code-inspection only; my attempt at an end-to-end proof did not complete and I have not
  claimed one.
- I did not exercise a live two-phone medsync round trip; the reasoning in CLEAN item 3 is from the
  code and from the fact that no code path writes `purpose` without an edit.

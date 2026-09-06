# v69 — Enhancer and Voice passes

Run inline on the working tree while the Zero Day Audit was in flight. Both roles read the same
screen from opposite ends: the Enhancer asks what the caregiver cannot do here, the Voice asks
whether what is written and displayed is true and whether it belongs.

---

## The Voice — every caregiver-facing string this release touches

### 1. FALSE, and it would have shipped. The changelog's second clause.

Written:

> "Before this, a weight typed wrong could only be fixed from History."

**History cannot fix a weight.** It offers `Remove` and nothing else (`index.html`, the entry row's
Remove/Delete/Keep control). A weight typed wrong could only be **deleted and re-entered** — which
is the whole reason this release exists, and the note managed to describe it as the thing that was
already possible.

This is the fourth-plus release in a row where a copy claim was wrong about what the app does. It
is why the role exists. Corrected to name what History actually offered.

### 2. "Removing asks twice, like everywhere else in the app." — TRUE. Checked, not assumed.

History rows: Remove → Delete/Keep. Paracentesis rows: Remove → Delete/Keep. The calendar's
appointment sheet: Remove → Delete/Keep. Cycle History has no delete at all (withdrawn in v67).
The claim holds on every screen that can delete something.

### 3. The toast says "corrected" where the rest of the app says "updated".

The paracentesis edit toast reads `Paracentesis 7.5 L updated at 6:04 PM`. The new weight one read
`Weight 150.3 lbs corrected at 6:04 PM`. Neither word is wrong; **two words for one action in an app
a tired person uses at 2am is worse than either word.** Matched to the existing one.

### 4. The failure toast points somewhere the caregiver already is.

`"Weight corrected, but the old reading is still there — remove it from the Weight report"` fires
**while she is looking at the Weight report.** Same shape as the v67 finding where a failure toast
named a control that had been renamed: a sentence that sends someone to where they already stand
reads as though the app has lost track of them. Changed to point at the list below it.

### 5. Does every number on this screen belong? — Yes, and one nearly did not.

The v69 patch, as first written, **deleted the "Total drained" stat from the Paracentesis report**,
reasoning that a figure summarising volumes which each depend on elapsed time is the average's twin.
That reasoning is wrong, and STATUS.md says why: Aaron asked for exactly this figure —

> *"there can be notes for weight that can add the para together to see how much was drained."*

The average invited a **false comparison** ("she's averaging 5.6, this one was 3, she's improving")
when the interval carried the meaning. The total invites no comparison — it is the plain sum of what
came off, which is what was asked for. **The rule that retired the average is not a rule about
every aggregate.** Withdrawn from the patch, and `enhance-test.mjs` now guards the figure so nobody
re-derives the same wrong conclusion.

---

## The Enhancer — the Weight report against the checklist

| Check | Verdict |
|---|---|
| 1. Add / edit / remove symmetry | **Closed by this release.** Weight now has all three on its own screen. |
| 2. Empty states read as bug reports | *"No weight readings logged yet"* — no longer an accusation; the add row is right above it. |
| 3. Can a mistake be corrected, or only deleted and redone? | **This was the open one.** Now corrected in place. |
| 4. Dead ends | The paracentesis line on the Weight report is informational with no action — it points at the Paracentesis report, which now has every control. Acceptable. |
| 5. Where a sibling got it right, why not here? | This release IS that answer for Weight. |
| 6. Is everything already on the screen worth being there? | Yes — see Voice item 5. The chart, the range toggle, the paracentesis-in-range line and the readings list all carry something a clinician uses. |

### One finding, and it is not in the new code — it is in v66's and v68's

**The armed Delete never disarms itself.** History's Remove arms for **6 seconds** and then puts
itself away:

```
setTimeout(() => { if (state.confirmRemove === e.id) setState({ confirmRemove: null }); }, 6000);
```

The Paracentesis Remove (v68) and the new Weight Remove have no such timer. A red **Delete** sits
armed on a row indefinitely — through scrolling, through leaving the screen and coming back — and a
mis-tap on a medical record is exactly what two-step confirmation exists to prevent. The app already
decided what the right behaviour is; two screens just do not have it.

**Fixed in this release, on both screens.** It is a pre-existing defect rather than a new one, and
under the old wording of Rule 2 it would have been filed rather than fixed. Aaron, 2026-09-06:
*"if something is off, then we need it correct. I don't need to make that decision."*

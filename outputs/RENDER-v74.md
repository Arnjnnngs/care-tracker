# RENDER v74 — somebody looked at it

`harness/overflow-scan.mjs` on the FINAL build: **CLEAN**, every screen at all ten device widths
(320 to 428). Re-run from scratch after every audit round, because a record describing a file that is
not the one shipping is worse than no record — and this release went through six of them.

**The last round is why that matters.** Pass 6 found that a long pharmacy name pasted into a
medication's NAME pushed **Home** to 1019px on a 320px phone, and stretched the bottom tab bar off
the side with it — so the **Meds** tab a caregiver would use to go back and fix the name was no
longer on the screen. The overflow scan could not see it, and neither could the five new paste checks
that had just been added, because **the scan measures the app's OWN text and the new checks only ever
visited the Meds screen.** The wrapping rule had been put on three different containers in three
rounds, each time the one the last audit named. **Pass 7 then proved the fourth attempt wrong, and
this record is where that lesson belongs.** Putting `overflow-wrap: anywhere` on `*` in the CSS
reset broke two screens — it changes min-content sizing, so flex items shrank to about one
character, Home's hospital-stay banner went from four lines to thirty-two with words split
mid-syllable, and the In-Patient heading rendered as "IN-PATIEN / T / STATU / S".

**This scan reported CLEAN through all of it.** It measures WIDTH, and that damage is vertical.
A scan that says CLEAN is evidence that nothing overflows sideways and nothing else at all — it was
cited in the previous version of this file as evidence that "nothing else moved", and that was a
false claim about what this tool can see. The property is scoped to caregiver-entered text now, and
the two real causes on Home were fixed directly: the medication name sat under `white-space: nowrap`
with no truncation, and the dose buttons were `flex: 0 0 auto` with the name inside them.
Home measures 320px at a 320px viewport now, where it measured 829px.

**Pass 8 then found the check that proves this could not fail.** In the sibling app the seeded
medications are not on the Home screen at all, so the pasted name never rendered there and the case
was measuring an EMPTY Home: delete the one declaration holding that app's Home together and it
still printed PASS. And the *stretching ruler* came back inside the assertion written to fix the
previous round — the new "every bottom tab is still on the screen" check compared each tab to
`window.innerWidth`, which grows with the overflow, so it reported five of five tabs reachable when
one was. Both fixed, and both watched going red on the mutant before being believed.

Looked at with my own eyes (`outputs/v74-shots/`, taken by the suite that asserts on the same run):

- `1-meds-screen.png` — the medication cards with their new line: *Buspirone / BuSpar / "Eases
  anxiety."*, *Compazine / Prochlorperazine / "Settles nausea and vomiting."* The disclaimer sits
  once above the list, not repeated under thirteen cards. **The first version of this screenshot was
  worthless** — it captured the top of the screen, which is the reorder list, not the part that
  changed. The suite scrolls to the first card before it shoots now.
- `2-typed-purpose.png` — a caregiver-typed line replacing the built-in one.

**Deliberately exempt, said out loud:**
- **The Home quick-log cards carry none of this**, and the suite ASSERTS that rather than skipping
  it. Home is the screen she taps at 2am; every extra line there sits between her and the dose button.
- **iPhone rendering.** Chromium only in this sandbox, so the iOS rows are Chromium at Apple viewport
  sizes, not Safari. The Meds cards are taller now, which is exactly the kind of change a real phone
  should confirm.

**Seen and left alone:** the reorder list at the top of the Meds screen shows medication names with
no purpose line. That list is about ordering the Home cards, not about the medications themselves,
and adding thirteen more lines would make the thing it exists for harder to use.

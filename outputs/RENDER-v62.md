# Render check — care-tracker v62

`harness/overflow-scan.mjs --shots` — **80 of 80 screen/width combinations, 0 overflowing
elements, CLEAN**, across 10 phone widths (320 → 428) and 8 screens including the What's new
page and the What's new pop-up.

## Screenshots actually looked at, not just counted

pm.py demands this section because a passing scan number is not the same as a person having
seen the screen. Two were opened and read at 320px, the narrowest phone in the set:

- **`320-whatsnew-popup.png`** — the screen this release exists for. The whole notice fits on a
  320px screen with no scrolling: eyebrow "UPDATED · V62", the title, the date line, and all
  three bullets. Nothing is clipped and nothing overflows the card.
  **This is also where a real defect was caught that the scan could not see.** The first draft
  of the v62 changelog entry was written for a developer — *"the app decided a phone with no
  record of a last-seen version must be brand new"* — which is accurate, unreadable, and ran
  past the bottom of the screen. It is now three plain sentences that fit. A layout scan
  measures whether text fits its box; it has no opinion on whether the text is any good, and
  the person reading this notice is a patient, not an engineer.
- **`320-home.png`** — checked because this release changes start-up code, and the failure mode
  worth fearing is a start-up throw that silently empties something. Home renders complete: the
  in-patient banner, the missed-dose banner with its Clear button, temperature, weight,
  paracentesis, chemo schedule, all seven Quick Log cards with their dose buttons, the Morning
  and Evening group cards, and Today's Journal. Nothing missing, nothing collapsed.

The remaining 78 shots are in the session scratch directory; the scan asserts on rendered
geometry for every one of them.

## What was changed, and why the render was worth re-checking

`DEVICE_HAS_PRIOR_DATA` is a read-only snapshot taken at the very top of the module. It writes
nothing and cannot alter behaviour beyond the one `if` it feeds. It is wrapped in try/catch, and
it is deliberately placed above every other start-up statement — a snapshot taken after them
cannot tell "this phone has history" from "this phone made a key a moment ago".

The reason to re-render rather than trust that reasoning: a throw during module init on this
kind of app does not crash visibly. It is swallowed by whatever try/catch is nearest and the
screen comes up looking almost right — which is exactly how a temporal-dead-zone bug in the
sibling app silently emptied every saved medication while four unit suites stayed green.
`320-home.png` is the check that this did not happen here.

# Render audit — care-tracker v60

Run: `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/overflow-scan.mjs --shots outputs/render-v60`

**Result: CLEAN — 25 screen/width combinations, 0 overflowing elements.**

| width | device | result |
|---|---|---|
| 320 | iPhone SE (1st gen), iPhone mini | clean |
| 375 | iPhone SE 2/3, iPhone 8 | clean |
| 390 | iPhone 13 / 14 | clean |
| 393 | iPhone 15 Pro | clean |
| 428 | iPhone 14 / 15 Plus | clean |

Screens walked with Brandi's real medication names seeded: Home, Meds, Reports, In-Patient,
Symptoms. Navigation verified by confirming all five screenshots differ — an earlier version of
this scan reported "clean" while only ever looking at an empty Home screen.

## Fixed in this release, both found by this scan and by nothing else

- **In-patient banner at 320px** — the Log In-Patient End button ran 12px off the right edge and the
  text column was squeezed to ~100px, wrapping one or two words per line. Now a column with the
  button on its own full-width row.
- **Bottom nav labels at 320px** — "Symptoms" and "In-Patient" overflowed their 59px columns.
  Media query at 360px rather than shrinking type on every phone.

## What this does NOT cover — read before trusting it

**Chromium at iPhone viewport sizes is not Safari.** This catches a box too small for its content,
which is most "text spills out" bugs. It does not catch WebKit font metrics or text shaping. Aaron's
original report was specifically an iPhone; if spill remains after this ships, Safari is where to
look next.

It also checks **overflow only**. It does not judge whether a screen is *good* — the missed-dose
banner passes this scan and is still a wall of run-on text that nobody reads. That is a Designer
question and is logged in REQUESTS.md.

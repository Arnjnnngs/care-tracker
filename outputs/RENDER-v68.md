# Render check — care-tracker v68

`harness/overflow-scan.mjs` — **80 of 80 combinations, 0 overflowing, CLEAN**.

## What changed and what the screenshot shows

`outputs/v68-paracentesis.png` — the note under the stat cards now reads:

> *These are recorded separately from weight — the Weight report still shows what the scale actually
> said, with a marker on each drain date.*

The sentence that opened it — *"Averaging 5.6 L per procedure."* — is gone, on Aaron's report.
**A paracentesis drains what has accumulated**, so the volume depends on how long it has been. The
mean of those volumes describes nothing a clinician would use, and it invites the wrong reading:
*"she's averaging 5.6, this one was 3, she's improving."* The interval is what carries meaning and
was already on the screen as **Since last**.

The three stat cards — Total drained, Procedures, Since last — are unchanged. Only the average went.

## An honest note on the gates

`glass-test` reported **6/7 on the first run and 7/7 on a clean re-run**. Its frame-timing check is
load-sensitive, and a second browser suite was running in parallel at the time. That is a real
property of that check, recorded here rather than quietly re-run until green.

## Screenshots actually looked at

`v68-paracentesis.png`, `v68-weight.png`, `v68-cycle.png`, `v68-para-edit.png`.

# Render check — care-tracker v67

`harness/overflow-scan.mjs` — **80 of 80 combinations, 0 overflowing, CLEAN**.

## v67 exists because v66 shipped a defect that destroyed data

The Zero Day Audit of v66 returned **BLOCK**. Two seeded periods, one tap on Cycle History's new
**Remove**, no confirmation step:

```
BEFORE  ["8/27/2026 – 8/31/2026 (5 days)", "7/28/2026 – 8/1/2026 (5 days)"]
AFTER   ["8/27/2026 – 8/31/2026 (5 days)"]
toast   "Removed"
```

The July period was gone and **could not be recovered from the app**. Three things stacked:
`Remove` deleted the period's *end*, which reopened it; `cyclePeriods()`'s UC20 rule then made the
next `cycle_start` *update* the reopened period rather than start a new one, merging two; and after
the merge `cycleActive()` is false, so every control offers *Period Start* only — nothing anywhere
writes a `cycle_end` for a past day.

**The control is withdrawn.** Every other destructive action in this app is two-step; this one was
one tap, and a delete that can silently merge two months of a patient's record does not belong
behind a single tap. Moving a date stays, because it replaces the marker it removes.

## The Weight add row was backwards, and my own check said otherwise

`renderWeightTrend()` has **three** return paths. v66 fixed two. The third is a *ternary* return —
`return paraLine ? [toggle, …] : [toggle, …]` — which no `return [` regex matched, and which the
count check could not see either **because it counted `return [` occurrences**. So it reported
"2 of 2" and went green while the path every real device takes had no add row.

Shipped behaviour: the add control appeared **only when there were no readings**. Brandi has months
of them, so it was invisible on the live app while `RENDER-v66.md` claimed the defect was caught.
The count check now counts every `return`, not every `return [`.

## The suite tested the state no real device is in

`enhance-test` seeded no weights, so its Weight check exercised the empty state and passed on a
broken build. It now seeds readings, and asserts the Weeks/Months toggle is present so the check
cannot silently drift back to the empty path.

## Screenshots actually looked at

`v67-paracentesis.png`, `v67-weight.png`, `v67-cycle.png`, `v67-para-edit.png` — the add rows are
present, Cycle History shows Move start / Move end and **no Remove**.

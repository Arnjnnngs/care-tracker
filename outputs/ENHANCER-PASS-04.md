# Enhancer pass 04 — v72, run BEFORE the build on the screens it touches (Rule 1.5)

Screens v72 changes: **Home** (bowel banner, bowel and appetite end-of-day cards), **Symptoms** tab,
**History**, **Reports → Bowel Movement**, **Reports → Appetite**.

## The table, read off the real controls (v71)

| Screen | Add | Add for another day | Correct | Remove |
|---|---|---|---|---|
| Home bowel card | today only, once | no | no — the card hides once answered | no |
| Home bowel banner | — | — | the latest answered day only, and only while an "issue" is active | no |
| Home appetite card | today only, once | no | no — hides once answered | no |
| Symptoms tab | yes | yes (date in the modal) | yes (Edit) | yes (Remove) — but it was a delete the rules refuse past 48h |
| Reports → Bowel Movement | no | no | no | yes (Remove per row) — same refused delete |
| Reports → Appetite | no | no | no | yes (Remove per row) — same refused delete |
| History | — | — | no | yes, on bowel/appetite/symptom rows at any age — same refused delete |

Correction to pass 03: both report screens DO carry a Remove per row. Pass 03 said "no controls at
all"; it did not read the labels. This is the mistake Rule 2.6 warns about, made by the role itself.

## What v72 builds (the correctness fix — Aaron's pick, standing queue)

Every path in the table that "corrects" or "removes" a daily answer or a symptom now appends —
a superseding document or a tombstone — and none of them can fail past 48 hours or resurrect an
older version. The delete path is gone from all of them.

## Proposed, sizes attached — Aaron picks. NOT built in v72.

| # | Change | Size | Recommend |
|---|---|---|---|
| A | **"Change answer" on the Bowel Movement and Appetite report rows.** Today the only way to change a bowel answer is the issue banner, and there is no way at all to change an appetite answer once given — the card hides. With v72's append model this is one control per row, reusing the Home card's own handlers. | S each | Yes, next |
| B | **"Log for another day" on both reports**, matching Weight and Paracentesis (v66) — a missed evening question can be answered the next morning. | S each | Yes, with A |
| C | **History's Remove on a corrected weight or period marker.** Still a plain delete (since v69/v70): refused past 48h, and on a fresh correction it would delete the correction and resurrect the reading it replaced. Same fix as v72 applied to weight and cycle rows in History: route to their tombstones. | S | Yes — it is the last delete-based path on a superseded type |
| D | The History day summary counted a bowel answer, an appetite answer and a symptom note as **doses**. | — | Fixed in v72 (one filter); noted here because it is a number on a screen that was untrue |

## Read out loud — the empty states on the touched screens

- Reports → Bowel Movement: *"Review bowel movement history logged from Home."* — the app saying
  the screen cannot log. Item A/B.
- Reports → Appetite: same sentence. Same item.

## Exempt, said out loud

- Legacy same-day duplicates written before v72 still tie exactly as they did in v71 (the later
  document wins). That cannot be repaired retroactively without editing documents, which the rules
  forbid. The first v72 answer for that day settles it for good.

# Enhancer pass 06 — the Meds screen, after v75 / app-v73

Run on the screens this release touches, in both apps. Rule 2.6's checklist. **The list of proposals
goes in the release message, not only here** — a role whose output is a file in a repo the owner
does not read is not a role, it is a habit.

## The screen, as it now stands

| Record on the Meds screen | Add | Correct | Remove | Bring back |
|---|---|---|---|---|
| An active medication | yes (Add medication) | yes (Edit) | yes (Remove) | n/a |
| A removed medication | — | no | — | **yes, new in this release** |

The row this release was written to fill is filled. Before it, a medication paused between cycles had
to be typed in again and came back under a new id, which orphaned every dose that referenced the old
one. The data was never lost; it was unreachable.

## Checklist

**1. Add / edit / remove symmetry.** Closed for the active list. A removed medication cannot be
edited while it is removed, which is correct rather than missing: bring it back, edit it, remove it
again — three taps, and every intermediate state is one the app already understands.

**2. Read the empty states out loud.** There is no empty state to read, and that is deliberate and
asserted: the "Removed medications" heading renders **only** when something is removed. A heading
over an empty list is a notice about nothing, which is the defect the sibling app's audit found in
the v74 disclaimer. The suite fails if the section appears with nothing in it.

**3. Can a mistake be corrected, or only redone?** Removing the wrong medication is now correctable
in two taps. That was the whole point.

**4. Is anything a dead end?** **YES, and it is the finding of this pass.** The row shows the
medication's name, its generic name, and — when an older build wrote the entry — a note that its
doses and rules were not kept. **It does not say when it was removed, although this release starts
recording exactly that.** `removedAt` is written at removal and survives a reload; the row could read
*"Removed 14 days ago"* for nothing but the formatting. For a caregiver looking at a list of four
removed medications, *when* is the thing that tells one from another.

**5. Where a sibling screen got it right, why didn't this one?** Both apps ship this release
together, so they do not diverge. ChemoWell additionally restores `pausePeriods`, which care-tracker
has no equivalent of.

**6. Is everything already on the screen worth being there?** Yes — three fields, each load-bearing.
The role most likely to walk past what should not be there found nothing to remove.

## Proposed, for Aaron to pick from

1. **"Removed 14 days ago" on each removed row (S). BUILT IN THIS RELEASE, not deferred** — because
   the independent audit turned out to need the same line for a different reason, and the two
   findings collapsed into one change. The audit's blocker was that three strings promised,
   unconditionally, that only the days a medication was off the list go uncounted — untrue for every
   archive entry written before this release, which is every entry that existed on upgrade day. The
   row that can say *"Removed 14 days ago · the days it was away will not count as missed doses"* is
   the row that can say *"Removed before this update — the app cannot tell when, so the days it was
   away will still count as missed doses"* instead. **The Enhancer asked for information; the audit
   asked for honesty; the same line answers both.** Worth noticing: this pass proposed it as a
   nice-to-have and ranked it third in importance behind nothing. It was load-bearing.
2. **A note on the missed-dose banner when a medication is currently removed (S).** Today the banner
   simply stops mentioning it, which is right, but a caregiver who removed it by accident gets no
   hint that a tracked medication has gone quiet. Weaker than item 1: it puts words on the screen
   this project has been careful to keep clear. **Not recommended unless Aaron wants it.**
3. **"Forget this medication for good" (a purge control). CONSIDERED AND REJECTED — deliberately not
   proposed.** The archive is what makes an old dose render as *Protonix* rather than as a removed
   medication. Purging an entry would silently damage the display of history that is otherwise
   intact, which is the v66 class of failure exactly. The list growing slowly is the correct trade.

## What this pass did NOT look at

The Reports screens, the Today screen and the History screen are untouched by this release and were
not walked. `Bowel Movement` and `Appetite` report controls remain open from pass 05 (TASK-SHEET,
QUEUED).

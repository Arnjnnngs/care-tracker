# Enhancer pass 05 — the Meds screen, across all three apps (v74 / app-v72 / beta-v61)

Aaron, 2026-09-08: *"still haven't seen anything the enhancer recommends to add, remove, fix or
update."*

**He is right, and the reason is delivery rather than the role.** The list WAS in the last two
release messages — one line among many, in dense text, below the technical detail. For him that is
the same as not being there. **It goes at the TOP of the release message from now on, before any
technical detail**, and this file stays as the record rather than the delivery.

## The screen this release touched: Meds

Read off the real controls, not a keyword search.

| Can the caregiver… | care-tracker | ChemoWell |
|---|---|---|
| See what a medication is for | **yes (new)** | **yes (new)** |
| Add a medication | yes (`Add`) | yes (`Add`) |
| Edit one | yes (pencil, `Edit <name>`) | yes |
| Remove one | yes, two-step (`Remove <name>` → `Confirm delete`) | yes |
| Reorder the Home cards | yes (▲▼ list at the top) | yes |
| Say what a medication is for, in her own words | **yes (new)** | **yes (new)** |
| **See or restore an ARCHIVED medication** | **no** | **no** |

## Proposed — Aaron picks. Nothing here was built.

| # | Change | Why it earns a place | Size |
|---|---|---|---|
| **A** | **Show archived medications, with a Restore button.** The app has carried `archivedMeds` for many releases — removing a medication keeps its name so old doses still render properly — but **there is no screen anywhere that lists them and no way to bring one back.** A medication paused between cycles has to be re-created by hand, and re-created with a new id, which means the dose history that referenced the old one reads as a removed medication. | S–M | Recommended first |
| **B** | **A "what changed" line on the medication card.** When two phones disagree the app already tells her they differ, but the card itself never says which medication changed or when. | S | |
| **C** | **The reorder list at the top of Meds shows only names.** With thirteen medications it is a long list of bare words above the cards that carry all the information. Worth collapsing behind a "Reorder" control. | S | |

## Read out loud — the empty states on this screen

The Meds screen has **no empty state at all**: with no medications it renders a heading, the
reorder box and nothing else. That is unreachable in care-tracker (thirteen defaults) but perfectly
reachable in ChemoWell, where every medication is one the user typed and a new user has none.
**Filed as a finding for ChemoWell, not care-tracker** — the two apps have genuinely different risk
here, which is exactly the kind of thing this pass exists to notice.

## Is everything already on the screen worth being there?

Yes, with one caveat now retired: this release added a line under every medication, and the check
that matters — asked by the Voice and enforced by the suite — is that **none of it states a dose or
a schedule.** It does not. Thirteen sentences in care-tracker, forty-two in ChemoWell, and the guard
rejects digits and scheduling words alike.

## Still open from pass 04, unbuilt

| # | Change | Size |
|---|---|---|
| D | "Change answer" on the Bowel Movement and Appetite report rows | S each |
| E | "Log for another day" on both reports | S each |
| F | History labels a removed reading's rows "Superseded" where "Removed" would read better | S |

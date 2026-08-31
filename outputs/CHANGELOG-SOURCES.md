# What's new — the pairing record

Every entry in the app's `CHANGELOG` beside the source it was written from. This exists because
the claim "all entries were re-checked" was made twice and both times someone found more errors
within half an hour. An assertion nobody can check is not evidence; this is the checkable form.

**Read it like this:** the app text is what Brandi sees. The source is what actually happened,
from `README.md` (v13–v43.3, v56–v61) or `STATUS.md` (v44–v55). If the two disagree, the app is
wrong — the docs are the record, and three separate audits have found the app text wrong, never
the other way round.

| Version | App title (what she reads) | Source | Source says |
|---|---|---|---|
| `v61` | You can see what changed | README.md version-history row | **You can see what changed.** Aaron: *"I wanted a section on caretracker under the ellipsis for latest updates or versioning. I also want something with a pop up when opening the app to say what new on the latest release |
| `v60` | Hospital stays, and a three-week false alarm | README.md version-history row | **In-patient stays, and the Dexamethasone alarm that ran for three weeks.** Aaron reported that ending a hospital stay produced a wall of missed doses. It was **three separate defects**, and the in-patient logic was only |
| `v59` | One spelling for the fluid unit | README.md version-history row | **One spelling for "liter".** Aaron: *"for the para.. is it supposed to be 'Litres' or Liters?"* It was both — every identifier used the American spelling while four user-facing strings used the British one, in an app wh |
| `v58` | Settings, and the backup lives in it | README.md version-history row | **Settings exists, and the backup lives in it.** Aaron: *"all the backup stuff shouldn't live under reports. it should be under settings. and i don't even see a settings tab anymore in caretracker."* Right twice — there  |
| `v57` | The app writes down its own errors | README.md version-history row | **The app writes down its own errors, and there is a place to add yours.** Aaron: *"we were also going to build in a logger for errors or improvements."* A **Report a problem** row, last in the menu. Three things in the  |
| `v56` | A backup can be password-protected | README.md version-history row | **A backup file can be protected with a password before it is sent.** Aaron, twice: *"build the encryption part."* The link is already the sharing story for a caregiver trusted with everything; the backup **file** is the |
| `v55` | Restoring never leaves the medication list behind | STATUS.md section heading | SHIPPED — a restore never leaves the medication list behind in silence |
| `v54` | A saved file tells you where it went | STATUS.md section heading | SHIPPED — a saved file says where it went, and a second caregiver can be brought in |
| `v53` | A new version actually reaches the phone | STATUS.md section heading | SHIPPED — a pushed build reaches the phone on the next load |
| `v52` | Paracentesis is its own record | STATUS.md section heading | SHIPPED — paracentesis is its own record, and the weight trend never moves because of it |
| `v51` | The end-of-day check-in asks about today | STATUS.md section heading | SHIPPED — bowel movement and appetite are asked at the END of the day, about TODAY |
| `v50` | A different way of handing over the saved file | STATUS.md section heading | SHIPPED — exports finally reach the iPhone, and the phones stop silently disagreeing |
| `v49` | A card can no longer disagree with the alert | STATUS.md section heading | SHIPPED — a card can no longer hide a missed dose behind "Waiting" |
| `v48` | Honest failures, and bigger text | STATUS.md section heading | SHIPPED — honest write failures, the 16px iOS floor, and a mechanical PM |
| `v47` | Live updates stop wiping what you are typing | STATUS.md section heading | SHIPPED — live sync no longer wipes what you are typing |
| `v46` | Shared medication settings | STATUS.md section heading | SHIPPED — shared medication settings (LIVE SAFETY FIX) |
| `v45` | A guided tour | STATUS.md section heading | SHIPPED — the guided tour |
| `v44` | Calendar, appointments, and the menu | STATUS.md section heading | SHIPPED |
| `v43.3` | Three live faults fixed | README.md version-history row | **Three defects fixed that were live on the patient's phone, all one root cause in the renderer.** `h()` routed `value` through `setAttribute`, which sets the DEFAULT value rather than the current one. On a `<textarea>`  |
| `v43.2` | Late doses and false alarms | README.md version-history row | **Missed-dose alerts: a late dose no longer raises a false alarm on the window it was late for, and no longer silences the next one.** `missedDosesFor` claimed windows in two passes -- pass 1 offered EVERY window any unu |
| `v43.1` | Save a copy of the records | README.md version-history row | **Save a copy of your records — a spreadsheet export and a printable report. The first backup this app has ever had.** Brandi's records live in one Firestore project with no copy anywhere; that is why this was built ahea |
| `v42` | Tested changes brought across | README.md version-history row | **Full promotion from care-tracker-testing** — production brought up to date with everything validated during the 30-use-case QA pass on the testing app, per Aaron's go-ahead ("this is the main big push for all features" |
| `v41` | Morning window timing corrected | README.md version-history row | **Correction to v40's Buspirone/Paroxetine default window**, per Aaron's direct feedback: the "no Protonix log yet" default is now a fixed 10 AM (Protonix's typical 8 AM dose time + 2h, mirroring Iron's 10 PM default exa |
| `v40` | Buspirone and Paroxetine moved to the morning | README.md version-history row | **Buspirone/Paroxetine moved from the 10 PM evening window to a new Morning window with Protonix** (default 8 AM–noon, matching Protonix's own morning window; shifts to 2h after Protonix's actual logged morning dose if t |
| `v39` | A broken upload | README.md version-history row | ~~Intended: SW cache bump + handoff doc update.~~ **This commit corrupted `sw.js` and `CARETRACKER_HANDOFF.md` to the literal 9-byte string "undefined"** — a paste-gone-wrong via GitHub's inline web editor (the same fail |
| `v38` | Refresh only | README.md version-history row | SW cache bump only (`caretracker-v37` → `caretracker-v38`), no functional change \| |
| `v37` | A way to clear the missed-dose alert | README.md version-history row | Missed-dose banner gets a persistent **Clear** button. Tapping it writes `caretracker_prefs/settings.missedClearedAt` (a synced Firestore doc, read via `onSnapshot` at startup like everything else) — every existing miss  |
| `v36` | Duplicate wording removed | README.md version-history row | Fixed the redundant "Available"/"Available now" text on Quick Log cards (the next-dose line is now only shown while a med is locked). Replaced `window.scrollTo({behavior:'smooth'})` with an instant scroll on tab/editor n |
| `v35` | Clearer status on each card | README.md version-history row | Promoted a redesigned Quick Log status-badge treatment and further chemo/Dex polish from testing. Simplified `status()`'s Dexamethasone course-complete handling by removing the `lateLog` exception added in v34 (a complet |
| `v34` | Chemo-day medication rules corrected | README.md version-history row | Fixed Dexamethasone/Zofran chemo-window logic: Zofran restriction widened from chemo days 0–1 to 0–2 (`zofranBlockedOn`), and Dexamethasone's final premed day now correctly shows an 8 AM-only window via a new `dexWindows |
| `v33` | Senokot is as-needed | README.md version-history row | Senokot converted to plain as-needed: schedule windows (8 AM & 10 PM) removed, quick-log now offers 1 pill or 2 pills \| |
| `v32` | False missed alerts fixed | README.md version-history row | Fix false MISSED alert when a dose was logged the same day: dose-to-window assignment is now two-pass — in-window/early doses first, then late doses (after a window closed, before the next opened) credit the window they  |
| `v31` | Evening reminders match the app | README.md version-history row | Evening push reminders split to match app windows: Protonix nudge stays at 8:00 PM (its window closes 10 PM), Iron/Buspirone/Paroxetine/Compazine reminder moved to 10:00 PM. Quiet hours now start 10:05 PM so the 10 PM se |
| `v30` | The chemo cycle system | README.md version-history row | Promote tested features from care-tracker-testing (t-v28–v33): chemo cycle system (chemo date scheduling, auto-appearing Dexamethasone 2 tablets 8 AM & 2 PM day −1..+1, Zofran restricted on chemo days 1–2 with override,  |
| `v29` | The 48-hour edit lock is back | README.md version-history row | Re-enable the 48-hour edit-lock check in removeBtn(), reverting a Jul 16 temporary unlock that had allowed manual deletion of fake seedDemo() entries dated 7/6-7/7 (otherwise locked from removal after 48h) \| |
| `v28` | Demo data removed | README.md version-history row | Data-integrity fix. Removed the dormant seedDemo() function entirely, along with the demo state flag, its banner UI, and the wasEmpty-triggered auto-seed call in the Firestore subscription callback, which had silently wr |
| `v27` | Yesterday’s misses show too | README.md version-history row | Missed-dose banner also shows yesterday's misses (overnight rollover fix) \| |
| `v26` | Missed-dose alerts | README.md version-history row | Missed-dose alert system: red banner + journal/history MISSED rows for Protonix, Buspirone, Paroxetine, Iron \| |
| `v25` | Times of day | README.md version-history row | New time-of-day categories in Today's Journal and History: Overnight 12–6 AM, Morning 6–noon, Afternoon noon–5 PM, Evening 5 PM–midnight \| |
| `v24` | Home screen layout | README.md version-history row | Layout: Protonix and Senokot get individual cards; group card renamed "Evening meds" (Buspirone, Paroxetine, Iron, Compazine) \| |
| `v23` | Senokot added | README.md version-history row | Add Senokot (senna): 2 pills, 8 AM & 10 PM windows, as needed; scheduled-card and Take-all logs now record each med's default dose \| |
| `v22` | Daily limits are enforced | README.md version-history row | Block dose buttons that would exceed remaining daily limit; Buspirone/Paroxetine/Iron 10 PM windows; Compazine joins Scheduled Meds card; "Take all" one-tap logging; Early tag now based on logged time, not click time \| |
| `v21` | Tylenol limit, and safer logging | README.md version-history row | Tylenol ceiling 2500 mg; Protonix windows 8 AM/8 PM; future-time log warning; delete confirmation + 48h delete window; grouped Scheduled Meds card; conditional counters + Lidocaine counter; WCAG AA contrast pass (pink th |
| `v20` | Lidocaine added | README.md version-history row | Add Lidocaine topical cream (4h gap, max 4 applications/day); generalize daily-count ceiling; doc corrections \| |
| `v19` | History cannot be wiped | README.md version-history row | Remove "Clear all" buttons, preserve history \| |
| `v18` | Phone reminders | README.md version-history row | Add FCM push notifications + firebase-messaging-sw.js \| |
| `v17` | Fewer reminders | README.md version-history row | Remove Tylenol/Morphine/Imodium from reminders \| |
| `v16` | Medication reminders | README.md version-history row | Add med reminder notifications \| |
| `v15` | A new look | README.md version-history row | Light pink glassmorphism theme + fix sticky tabs \| |
| `v14` | Typing no longer loses focus | README.md version-history row | Fix input focus loss on mobile during render cycle \| |
| `v13` | Forced refresh | README.md version-history row | Bump SW cache to force refresh on all devices \| |

## Entries with no source in either document

None — every entry is backed.

## Corrections already made against this record

Three rounds of review found eleven wrong entries in total. Each was written from *headline
extraction* — the first bold phrase of a row — rather than from reading the release:

- **v37** described v36's change; real v37 gave the missed-dose banner its Clear button.
- **v39/v40 inverted** — v39 caused the file corruption, v40 repaired it.
- **v41** titled as an evening fix; it corrects a morning window.
- **v44** claimed nothing visible; it added the calendar, appointments, backup/restore and the
  navigation drawer this page lives in.
- **v50** stated the unconfirmed iPhone outcome as fact, against CLAUDE.md Rule 7.
- **v33** implied false missed alerts that never happened.
- **v52** contradicted the app's own Weight report about drainage.
- **v49** claimed the alert never appeared; it appeared, and the card disagreed with it.
- **v54** claimed a device field that does not exist.
- **v23** credited it with v24's card — the same credit-the-neighbour error as v37.
- **v28** said "could have written" fake entries; it did, into the real record.
- **v59** named a Help page as one of four locations. CareTracker has no Help page; the fourth
  was the line on the paracentesis card itself.

The last of those was introduced *while correcting another entry in the same commit*, which is
the reason this file exists rather than another promise to have checked.

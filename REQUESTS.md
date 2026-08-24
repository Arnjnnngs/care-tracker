# REQUESTS.md — Aaron's running list

Everything Aaron has asked for, whether or not it has been built. This file exists because things
he said **got lost** — twice in one week, confirmed, not suspected. care-tracker had no request log
at all, so chat was the only record, and chat scrolls.

## The rule that makes this work

**The moment Aaron asks for something, it is added here — before any code is touched.** Not when
it is understood, not when it is scheduled, not when it is done. If it is unclear whether something
he said was a request or a passing remark, it goes in as a request. An extra line costs nothing.
A dropped ask costs him having to notice and say it again, which is the failure this file exists
to stop.

Nothing is deleted when it is finished. It moves to Completed with the version it shipped in.

---

## OPEN — nothing here is done

### Blocked on Aaron, not on work

- [ ] **Live sync between two phones** — the biggest gap in the product, in his words: *"there is
  no sync. and I still think that is the biggest flaw we will have or people will have."*
  **Blocked on one legal question**, not on engineering: whether a relay holding only ciphertext it
  cannot decrypt counts as "collection" under Washington's My Health My Data Act. The backend
  (`sync-backend/`, 930 lines, no stubs) and the client crypto (AES-GCM + ECDH key exchange, at
  app-v49) are already written. What is missing is the wiring, the screens, and a deployment.
  Needs a privacy attorney, ~30 minutes. Cheapest, highest-leverage spend on this project.
- [ ] **Migrate Brandi from care-tracker to ChemoWell** — he asked for this directly. **Deliberately
  waiting for sync**, his call and the right one: care-tracker syncs today and ChemoWell does not,
  so moving her now would take two phones that stay in step and make them stop.
- [ ] **Real access control for care-tracker** — there is no login; the link is the password and it
  cannot be revoked. v54 added a warning before sharing. That is not a fix. Scoped in the artifact
  "Backups and Access"; recommendation is to skip the halfway option and do sign-in plus a
  revocable caregiver list, in a calm week, rehearsed on the beta.

### Ready to build

- [ ] **Units picker for CareTracker (°F/°C, lbs/kg) — and the per-entry tagging it depends on.**
  Raised by Aaron 2026-08-24 while asking about "Litres" vs "Liters". ChemoWell already has this;
  CareTracker has `CONFIG.tempUnit` with no UI and no weight unit at all. **Order matters:** a
  reading is stored as `{ temp: 98.6, dose: '98.6 °F' }`, the unit only in a display string, while
  `tempFever()`/`tempHigh()` already switch thresholds on `CONFIG.tempUnit`. A picker added today
  would make every historical reading be re-read in the new unit. Port ChemoWell's `entryTempUnit`
  / `entryWeightIn` tagging FIRST. Own release, own adversarial gate.

- [ ] **Language localisation — DECISION NEEDED, not started.** Both apps are single-file with
  every string inline; weeks, not a setting. Carries a medical-safety dimension: the copy routing a
  frightened person to their care team cannot be machine-translated without review.

- [ ] **Undo a restore / snapshot before importing** — 2026-08-22: *"if someone is doing a backup
  and it fits wrong or they accidentally add to wrong profile. there needs to be a way to undo or
  capture their live data before input."* Take an automatic snapshot immediately before any restore
  writes, and offer a single Undo afterwards.
- [x] **The encryption part** — asked twice. **BUILT: care-tracker v56 and ChemoWell app-v63.**
  A password switch under the save buttons; the file is AES-256-GCM under a PBKDF2-SHA256 key at
  310,000 rounds. Fails closed on a wrong password, a tampered byte, a hostile iteration count, and
  a file that decrypts but is not a backup. See Completed.
- [x] **In-app logger for errors and improvements** — *"we were also going to build in a logger for
  errors or improvements."* **BUILT: care-tracker v57 and ChemoWell app-v64.** See Completed.
- [ ] **ChemoWell hardcoding removal, Phases 1–5** — `HARDCODED_MEDS_PLAN.md`. **LOST ITEM.** He
  said explicitly *"the hardcode needs to not wait to be built"* and it then waited through six
  releases. Called out here rather than quietly rescheduled.
- [ ] **Weight-change reasons in care-tracker** — **LOST ITEM.** From the same message that asked
  for paracentesis: *"there needs to be a way to log the reason for weight change."* The
  paracentesis half shipped as v52; the reason half never did. ChemoWell has `WEIGHT_REASONS`;
  care-tracker has nothing.
- [ ] **Regenerate chemowell-beta** from care-tracker v55 — the beta is a version behind, so the
  place he is supposed to test things is not currently testable.

### Known, not urgent

- [ ] **`test/v57-browser-notice.mjs` fails 17 checks in ChemoWell** — pre-existing, present on
  app-v58 as well, so not caused by any recent release. Those suites need a manually started server
  on port 8899 and otherwise die with a connection error that reads like infrastructure rather than
  failure, which is why real design regressions sat unnoticed.
- [ ] **Quiet-hours vs late-recovery policy** — the 10 PM reminder sits on the 22:05 boundary.
  Needs a decision from Aaron about which wins.

---

## COMPLETED

- [x] **"Litres" or "Liters"** — asked 2026-08-24. **Built as care-tracker v59 / ChemoWell app-v65.**
  American in every identifier, British in 4 user-facing strings here and 10 there, including a
  ChemoWell Help page. Normalised to liters, asserted by absence against the shipped bytes.

- [x] **Backup does not belong under Reports; there is no Settings tab** — asked 2026-08-24:
  *"all the backup stuff shouldn't live under reports. it should be under settings. and i don't
  even see a settings tab anymore in caretracker."* **v58.** Built the Settings screen this app has
  never had and moved the backup, its password switch, restore and the share control into it.
  Reports keeps the spreadsheet and the printable record and now says where the backup went, with a
  one-tap route. `harness/settings-test.mjs` 11/11, falsified at 8 red on v57.

- [x] **In-app logger for errors and improvements** — asked 2026-08-22. **v57.** A *Report a
  problem* menu row. The app records its own errors and unhandled rejections without swallowing
  them; repeats collapse to one counted entry; a full phone does not turn an error into a broken
  screen; trimming drops the oldest errors first, so a flood cannot evict what the person wrote.
  Kept in localStorage, never in Firestore — a stack trace is not a medical record and could not be
  cleaned out of an append-only collection. The file carries version, device and the log, and no
  dose, temperature, weight, symptom or appointment. `harness/logger-test.mjs` 19/19, falsified at
  16 red on v55.

- [x] **Password-protected backup files** — asked 2026-08-22, twice. **v56.** The link is already
  the sharing story for a caregiver trusted with everything; the backup FILE is the one that gets
  emailed and sits wherever it lands, and it was plain text. Now AES-256-GCM under PBKDF2-SHA256 at
  310,000 rounds via `crypto.subtle`. Locked files name nothing about their contents until they
  open, the patient's name is inside the ciphertext and out of the filename, plain files stay at
  formatVersion 1 so older phones can still read them, and protected files are written at 2 so an
  older phone says "update first" instead of reporting the backup empty. No recovery path by
  design. `harness/encbackup-test.mjs` 16/16, falsified at 13 red on v55.

- [x] **ChemoWell backup & restore, destination asked not assumed** — app-v61, 2026-08-22.
- [x] **Pro stops leading with a feature that does not exist** — app-v60, 2026-08-22.
- [x] **A restore never leaves the medication list behind in silence** — v55, 2026-08-22.
- [x] **A saved file says where it went; a second caregiver can be brought in** — v54, 2026-08-22.
- [x] **Builds reach the phone on the next load; the paracentesis dialog says what it is** — v53.
- [x] **Paracentesis as its own record, never touching the weight trend** — v52 / app-v59.
- [x] **Bowel movement and appetite asked at the end of the day, about today** — v51 / app-v58.
- [x] **Naming pass and clearance screen** — 44 candidates, 21 screened, delivered 2026-08-22.

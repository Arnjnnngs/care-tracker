# EXPORT-REPORT — a real backup, a real restore, and the concurrent-edit notice

**Deliverables:** `export-patch.py`, `export-test.mjs`, this file.
**Built against:** care-tracker **v43.4**, commit `f9015b7`, `index.html` md5 `520a150aa4ef7d6a0bda5b3843355e62`, `sw.js` md5 `504181487e25c557b7f3b29769844d8d`.

| artifact | md5 |
|---|---|
| base `index.html` (v43.4, untouched) | `520a150aa4ef7d6a0bda5b3843355e62` |
| + `cleanup-patch` + `calendar-patch` + `reason-patch` | `50c4ce9a0e66467549258b11b4b94447` |
| + `export-patch.py` (11 anchored edits, +32,835 bytes) | `e9b74979892b87b5f9697b922bfd59eb` |
| `sw.js` before **and after** | `504181487e25c557b7f3b29769844d8d` (identical — never opened) |

**Result: 49/49 checks pass. 18/18 falsification mutators produce the expected RED.**

---

## 0. Read this first — two things that block the release

### 0.1 `calendar-patch.py` and `reason-patch.py` cannot be applied to v43.4 at all

Neither is my patch, but neither runs on today's `main`, so nothing ships until they are fixed.

Both carry a post-condition pinned to a **literal** version string:

- `calendar-patch.py:721` — `if "const APP_VERSION = 'v43.3';" not in out: fail("APP_VERSION is no longer intact.")`
- `reason-patch.py:639` — `post("const APP_VERSION = 'v43.3';" in out, "APP_VERSION was altered.")`

v43.4 ships `const APP_VERSION = 'v43.4';`. The check that exists to prove the patch *didn't* touch the version now fires because someone else legitimately bumped it. On a clean v43.4 tree:

```
calendar-patch: ok edit 1 ... ok edit 9      <- all nine edits applied fine
REFUSING TO PATCH: APP_VERSION is no longer intact.
Nothing was written. index.html is untouched.
```

Every anchor in both patches still matches v43.4 exactly; only the guard is stale. The fix is one line in each: compare the version string read out of the *input* against the *output*, rather than against a hardcoded constant. `reason-patch.py:640` already does the correct version of this (`src.count("APP_VERSION") == out.count("APP_VERSION")`).

I did **not** edit their files. For my own composed test fixture I used throwaway `/tmp` copies with that one literal relaxed. `export-patch.py` reads the version out of the file and asserts it is unchanged, so it will not repeat this at v43.5:

```python
versions = re.findall(r"const APP_VERSION = '([^']*)';", src)
if len(versions) != 1: fail(...)
version_line = "const APP_VERSION = '%s';" % versions[0]
...
post(version_line in out, "APP_VERSION was altered. This patch must never touch it.")
```

### 0.2 `deliverFile()` — this patch makes the consequence of the known bug worse. Yes, worse.

`deliverFile()` is a bare `<a download>` + `.click()` with no fallback and no failure detection. **I did not change it.** I re-confirmed it on this exact build by suppressing `HTMLAnchorElement.prototype.click` (probe kept at `.tmp/deliver-probe.mjs`):

```
  backup  clicks-swallowed=1  downloads=0
          toast : Backup saved — 2 records, including 1 appointment record...
  csv     clicks-swallowed=2  downloads=0
  report  clicks-swallowed=3  downloads=0

  TOTAL FILES PRODUCED: 0
```

All three buttons report success. Zero files exist.

**Stated plainly: my work makes the consequence of this bug worse, and that is not a reason to hold the work.** Before this patch, a silent `deliverFile()` failure cost Brandi a spreadsheet she could have regenerated. After it, she can believe she is holding a restorable backup of her entire medical history and be holding nothing — and she will only find out at the moment she needs it, on a new phone, with the old one gone. A person who *thinks* she has a backup is in a worse position than one who knows she has none, because she stops looking for another way.

Two things I did about it without touching the shared path:

1. The success notice tells her to go and check, and gives her a way to actually verify:
   *"Check it landed in your Files app, then load it back here once to be sure it opens."*
   That is not decoration — loading the file back is a genuine end-to-end proof, and it is safe to do because restore is idempotent (§4).
2. The restore control is deliberately prominent and always enabled, so verifying is one tap.

**Recommendation, out of scope for this patch:** `deliverFile()` should get a real fallback (`navigator.share` with a `File`, or open the blob in a new tab as a last resort) and should only report success once something observable happened. Until then Aaron's on-phone test is the only evidence that any of the three buttons work in the installed PWA, and it should be repeated specifically for the new backup button.

---

## 1. What was actually wrong, and what changed

**Before:** "Save a copy" produced a CSV and a printable HTML report, and **neither could be restored**. The CSV is a twelve-column display flattening: no document ids, derived missed-dose rows mixed in with real documents, and appointments deliberately absent. Appointments were the one thing a restore could never bring back. There was no JSON backup of any kind.

**After:** three files, of which exactly one is restorable, and the card says which.

| edit | what it does |
|---|---|
| 1 | icon table gains `bkRestore` (the `download` tray with the arrow reversed) |
| 2 | `state` gains `restoring`, `backupNotice` |
| 3 | save-card counts the backup separately from `allExportEntries()` |
| 4 | `btn()` takes an explicit off-condition and a stable `data-backup-btn` hook |
| 5 | buttons row, honest copy, and the new "Put a backup back" row |
| 6 | `calOpenApptSheet` records the version the sheet was opened from |
| 7 | `calSaveAppt` stops on a concurrent edit |
| 8 | `calRemoveAppt` stops on a concurrent edit |
| 9 | the concurrent-edit notice inside the appointment sheet |
| 10 | the BACKUP & RESTORE block |
| 11 | the card's description, which no longer described the card |

---

## 2. The format

Canonical JSON — object keys sorted at every depth, document arrays sorted by document id, `NaN`/`Infinity` normalised to `null` before serialisation rather than by `JSON.stringify` silently doing it. Pretty-printed at 2 spaces.

```json
{
  "app": "v43.4",
  "appointments": [
    {
      "apptId": "expfix-appt-a",
      "cancelled": false,
      "dose": "Appointment",
      "id": "expfix-appt-doc-1",
      "loggedAt": 1786980591000,
      "medId": "appointment",
      "mg": 0,
      "note": "",
      "title": "Oncology review OLD EXPFIX-APPT-SUPERSEDED",
      "ts": 1786975200000
    },
    ...
  ],
  "createdAt": 1786980600000,
  "entries": [ ... ],
  "format": "care-tracker-backup",
  "formatVersion": 1,
  "medications": { "archivedMeds": {...}, "meds": [...], "version": 1 },
  "patient": "Brandi",
  "prefs": { "missedClearedAt": 1786952400000 }
}
```

Filename: `Brandi-backup-2026-08-17.json`, alongside the existing `-records-*.csv` and `-report-*.html`.

### Why the backup reads Firestore directly instead of going through `allExportEntries()`

`subscribeEntries()` fans one snapshot into `state.entries`, `state.chemoDates`, `state.appointments` and `state.missReasons` — and the last two are then **collapsed to their live versions with the superseded history thrown away**. Every one of those splits is right for the screen and wrong for a backup.

`bkCollect()` calls `getDocs(col)` and reads the collection itself. `getDocs` was already imported at line 39 of the base and was **unused** — no collision. This has a second property that matters more than convenience:

> **`allExportEntries()` is not touched, at all.** It is the single seam keeping appointments and `missed_reason` documents out of the spreadsheet and out of the record handed to an oncologist. `calendar-patch.py:723` and `reason-patch.py:644` both *assert* it is byte-identical and abort if it is not. A backup routed through it would have had to widen it, and the leak would then have been one careless edit away forever after. Reading the collection directly preserves the seam **by construction** rather than by anybody remembering.

### Why appointments get their own section

Two reasons, both load-bearing:
1. It makes their presence in the file auditable at a glance — this is the thing that was missing.
2. It is what makes an **old** file recognisable as complete rather than damaged. See §5.

---

## 3. Round trip, proven at byte level

`ROUNDTRIP-bytes` does exactly this, in one browser session:

1. tap **Save backup file** → capture the downloaded bytes;
2. **empty the database** (all entries, the prefs document) **and clear the device medication list**;
3. tap **Restore from a backup file** → the OS file chooser opens → hand it the file from step 1;
4. tap **Save backup file** again → capture those bytes;
5. `md5(file1) === md5(file2)`.

```
fa649d235ab321d1a485c0a9a5b3d883  backup-1.json
fa649d235ab321d1a485c0a9a5b3d883  backup-2.json
```

Not field equality. Whole-file digest, 10,863 bytes, 12 entries + 4 appointment documents.

Two things make this a real test rather than a tautology:

- **The clock is pinned** (`Date.now` fixed in `addInitScript`), so `createdAt` is the same in both files and the comparison can be the *whole file* rather than the whole file with an exception carved out of it.
- **The stub is hostile about ordering.** `getDocs()` rotates both the document list and each document's field order by a different amount on every call, so the two exports genuinely see different orderings. Firestore promises no order for a bare collection read, and a document rebuilt from a restored file has no reason to carry its fields in the order the original did. Falsified: removing the key sort (`no-canonical-key-order`) and removing the document sort (`no-document-sort`) each turn `ROUNDTRIP-bytes` RED.

### Honest limit of a round trip — found by falsification, not reasoned about afterwards

I originally expected `ROUNDTRIP-bytes` to catch a backup that **omits a whole section**. It does not, and the falsification sweep is what told me:

```
NOT RED appointments-dropped-from-backup
        expected these to fail and they did not: ROUNDTRIP-bytes
NOT RED removed-med-history-dropped
        expected these to fail and they did not: ROUNDTRIP-bytes
```

Dropping a section is **symmetric**: both exports omit it, so the two files still match byte for byte. A round trip proves nothing is lost *between the file and the database*; it cannot prove the file is *complete*. Completeness needs separate positive assertions, which is what `BACKUP-has-appointments`, `BACKUP-has-reasons`, `BACKUP-keeps-removed-med-history` and `RESTORE-keeps-ids` are for — and all four do go RED on those mutators. The mutator expectations were corrected to say so rather than the check being quietly stretched to cover it.

---

## 4. Restore

```js
await setDoc(doc(db, COL_NAME, id), fields);
```

A **create at a known document id** — an append under append-only rules. No `updateDoc`, no `deleteDoc`, nothing removed. Asserted mechanically in the patch's own post-conditions (`deleteDoc`, `removeEntryDB`, `updateDoc`, `clearAllDB` all absent from the block; exactly two `setDoc` call sites) and again by `FILE-append-only` in the suite.

Consequences, all deliberate and all tested:

- **ids are preserved** (`RESTORE-keeps-ids`: the sorted id list before and after the wipe-and-restore is identical);
- **idempotent** — a second import of the same file adds nothing and writes nothing (`RESTORE-idempotent`);
- **never overwrites** — an id already on this phone is skipped. `RESTORE-never-overwrites` edits a live document in place behind the app's back, re-imports the file, and asserts the local edit **survived**;
- **never deletes** (`RESTORE-no-deletes`: zero `deleteDoc` calls);
- one document failing does not abandon the rest; failures are counted and reported honestly.

### `const here = Object.create(null)` — never `{}`

```js
// Object.create(null). NEVER {}. These keys are Firestore document ids, and a document id is
// free to be the string "constructor", "toString", "valueOf" or "hasOwnProperty" -- all four are
// legal ids. Against a plain object literal the membership test `here[id]` is TRUTHY on an
// EMPTY map, because it finds Object.prototype.constructor. Those records would have been
// counted as "already on this phone", skipped, and never written, while the screen reported a
// clean successful restore. Silent medical-record loss with a green tick on it.
const here = Object.create(null);
```

There is a detail here that makes this bug much easier to miss than it looks: **Firestore reserves ids matching `__.*__`, so `__proto__` — the one id everybody reaches for when testing this — can never occur.** `constructor`, `toString`, `valueOf` and `hasOwnProperty` all can, and all four are in the fixture as real document ids on real records (a Zofran dose, a temperature reading, an appointment, a missed-dose reason).

Pinned permanently by two checks:
- `FILE-proto-safe-map` (source: the map is `Object.create(null)`, and no plain-object form is present);
- `PROTO-ids-restore` (live: all four documents come back after a wipe-and-restore).

Falsified — `here-map-is-plain-object` turns `{}` back on and goes RED on `FILE-proto-safe-map`, `PROTO-ids-restore`, `ROUNDTRIP-bytes`, `RESTORE-keeps-ids` and two more.

The same trap is avoided a second time in `bkRestoreMedications()`, which uses `Object.prototype.hasOwnProperty.call(archived, id)` rather than a bare index — the same fix v43.4 made in `nameOf`/`reportNameOf`.

### Medications, and rule 12 (removed medications' history)

The medication list is device-local, and the person holding the phone is the one who set it up, so a file does not overwrite it.

- **No saved configuration on this device** (a new phone — the case restore exists for): the file's list is adopted whole.
- **This device has its own list**: it is left alone, and only the **archived names** are merged in.

The archived names are the load-bearing part. Every dose ever logged against a removed medication is still a real document in `caretracker_entries` and restores automatically — but without the archived name those rows come back as a bare id and the printable record reads **"Medication (removed)"** where a drug name belongs.

`RESTORE-removed-med-name-comes-back` proves this **from the bytes of the downloaded printable report** after a restore onto an empty phone, not from an internal field — because the report is the document that goes to an oncologist and that is where the failure would show. Falsified by `removed-med-history-dropped`.

### Preferences

`missedClearedAt` is a high-water mark. It is the only write in the block that is not a create, it uses the same `setDoc(..., {merge:true})` the app already uses on that document, and **it only ever moves forward** — restoring an older value would resurface months of already-dismissed missed-dose warnings.

---

## 5. Backward compatibility

An **old** backup — `formatVersion: 1`, no `appointments` key at all — imports cleanly. `bkReadIncoming()` reads it with:

```js
const take = (arr) => { if (!Array.isArray(arr)) return; ... };
take(parsed.entries);
take(parsed.appointments);   // absent => undefined => no-op, not a throw
```

`BACKCOMPAT-old-file` writes such a file, imports it through the real file input, and asserts both of its records land and that the notice reads *"Restored 2 records"* rather than a rejection. Falsified by `legacy-file-rejected`, which adds an `Array.isArray` requirement and turns the check RED.

The reverse direction is refused rather than half-done: a file whose `formatVersion` is higher than this build understands is rejected with *"This backup was made by a newer version of CareTracker than the one on this phone. Update the app first — loading it here could leave part of it out without saying so."* (`REJECT-newer-format`, asserted to change zero records.)

---

## 6. The CSV / report non-leak proof, from downloaded bytes

Two prior attempts failed here in specific ways, so this section is explicit about avoiding both.

- One agent checked **the screen** for three rounds while appointments were leaking.
- Another asserted only on appointment **titles** — and titles have no column in either file, so the checks stayed green straight through a live leak.

**What actually leaks is the medId, the dose label, the private note and the document id, and those are what is asserted.** All three files are downloaded through Playwright's download event in one session from one fixture, and their bytes are read from disk.

Asserted **absent** from `records.csv` and `report.html`:

| sentinel | what it is | count in CSV | count in report |
|---|---|---|---|
| `appointment` | the medId | 0 | 0 |
| `Appointment` | the dose label | 0 | 0 |
| `Appointment removed` | the tombstone dose label | 0 | 0 |
| `Ask about the port line EXPFIX-APPT-NOTE` | the private note | 0 | 0 |
| `Oncology review EXPFIX-APPT-TITLE` | the title | 0 | 0 |
| `expfix-appt-doc-1/-2/-3`, `valueOf` | the document ids | 0 | 0 |
| `expfix-appt-a` / `expfix-appt-c` | the apptIds | 0 | 0 |
| `missed_reason` | the reason medId | 0 | 0 |
| `Missed-dose reason` | the reason dose label | 0 | 0 |
| `expfix-reason-doc-1`, `hasOwnProperty` | the reason document ids | 0 | 0 |
| `Felt too sick EXPFIX-REASON-NOTE` | the reason note | 0 | see below |

The report is also asserted against `/appointment/i` as a whole — the word appears **zero times** in a document handed to a doctor.

### The positive control — why these checks are not vacuous

`BACKUP-has-sentinels` asserts, in the **same run, from the same fixture**, that every one of those strings **is** present in the backup file. Without it, "the CSV does not contain X" would pass just as happily if X had never reached the app at all. Actual bytes from the CSV, showing the real dose rows are there (so the file is not simply empty):

```
Date,Time,Timestamp,Time of day,Type,Med ID,Detail,Amount (mg),Note,Source,Entry ID,Logged at
8/15/2026,7:00 AM,2026-08-15T07:00:00.000Z,Morning,Old Antinausea EXPFIX-ARCHIVED-NAME,expfix-removed-med,10 mg EXPFIX-REMOVED-DOSE,10,,logged,expfix-removed-dose-1,2026-08-15T07:00:00.000Z
```

`CSV-still-has-real-doses` pins that separately, including the row whose document id is `constructor`.

### One correction I had to make, in the opposite direction

My first `REPORT-no-reason-leak` went RED on the reason note text. **It is not a leak.** `reason-patch.py` *deliberately* prints the patient's own words in a labelled subsection — "Notes Brandi added" — beneath the calculated missed-dose table, documented in its source as clinically valuable ("three missed doses, all nausea" is worth a great deal to an oncologist; three blank rows are worth nothing).

Verified from the report bytes that the **document** does not leak: `missed_reason`, `Missed-dose reason` and the document ids all appear **0 times**. So the check was narrowed rather than the feature broken: it splits the report at the `<h2>Scheduled doses with nothing logged` heading and asserts the note appears **only below it** — never in the daily log, the totals or the symptom tables above — plus an assertion that the deliberate subsection *is* present, so the check cannot pass by that section having vanished. Falsified by `reasons-leak-into-export`, which stops splitting reason documents out of `state.entries`; the note then appears above the heading and the check goes RED.

**Worth flagging to whoever reviews next:** a naive "the report must not contain reason text" assertion would have blocked reason-patch's shipped feature. The rule is *no reason **documents** as entries*, not *no reason text*.

---

## 7. The concurrent-edit notice

Brandi and Aaron both use this app. The silent-overwrite is real and specific:

The appointment sheet **deliberately does not repaint while it is open** — `subscribeEntries` defers the snapshot so a half-typed note is not wiped, and the clock tick is guarded. So a save posted from that sheet is written against whatever the appointment looked like **when the sheet was opened** — and because an edit is an *append* carrying a newer `loggedAt`, it **wins**. Aaron reschedules the oncology appointment from his phone while Brandi has it open on hers; she taps Save; his new time is gone and nothing anywhere said so.

`state.appointments` *is* refreshed inside `subscribeEntries` before the deferral, so the live version is available even though the screen has not repainted. That is what makes save-time detection exact.

**Detection.** `calOpenApptSheet` records `baseStamp` — document id, `loggedAt`, `ts`, title and note of the version the sheet is a view of. Visible fields are folded in as well as the timestamp so that a document written by anything else (a repair script, a restore, a future build) still registers as a change instead of slipping past on a matching `loggedAt`. `calSaveAppt` and `calRemoveAppt` compare it against the live stamp before writing.

**The notice** — plain language, no jargon, asserted against `/conflict|stale|revision|merge|version mismatch/i`:

> **This changed while you had it open**
> Someone else changed this appointment from another phone while you had it open. It now says "Oncology review — MOVED to Thursday", 8/18/2026 at 7:51 PM — Aaron rebooked it. Nothing has been saved yet.
> [ Use the newer one ] [ Keep mine ]

Removal gets the same rule, because a tombstone removes whatever the appointment has *become* — removing a stale one destroys a reschedule just as silently as saving over it. If the other phone *removed* the appointment, the notice says so and the choices become "Leave it removed" / "Keep mine".

**Never silently overwrites.** `overwriteOk` is set in exactly one place: the `calKeepMine()` handler, reached only by reading what the other version says and pressing a button. Proven:

| check | what it proves |
|---|---|
| `CONFLICT-save-stops` | the notice appears and names what the other phone now says |
| `CONFLICT-no-write` | **zero** documents written while the notice is showing |
| `CONFLICT-use-theirs` | adopts their version into the sheet and writes **nothing** |
| `CONFLICT-keep-mine-writes` | writes exactly **one** append, with the appointment identity intact and `cancelled: false` |
| `CONFLICT-removal-stops-too` | a stale removal writes nothing |
| `CONFLICT-clean-save-unaffected` | an uncontested save still writes exactly one document and closes the sheet |
| `CONFLICT-tap-targets` | both choices ≥ 44px |

Falsified by `conflict-check-removed`.

Screenshots: `shot-conflict.png`, `shot-save-card.png` (both 375×812).

---

## 8. The card copy

The card used to say **"Keep the spreadsheet as your backup."** It is not one and never was: a CSV cannot be loaded back, has no document ids, and deliberately omits appointments. Telling her the wrong file is her backup is worse than telling her nothing, because it stops her looking for the right one.

Now:

> **Save a copy of your records**
> Everything you've logged — doses, temperatures, weights, symptoms, treatment dates and appointments. The files save to this phone. Nothing is sent anywhere.
> `2 entries · 2 appointments · last logged 8/17/2026`
> [ **Save backup file** ] [ Save spreadsheet ] [ Save printable report ]
>
> The backup file is the only one of these that can be put back. It holds everything — doses, temperatures, weights, symptoms, treatment dates and appointments. The spreadsheet and the printable report are for reading and for handing to a doctor; neither one can be loaded back into the app.
>
> ---
> **Put a backup back**
> On a new phone, or if something has gone missing, load a backup file here. Anything already on this phone stays exactly as it is — nothing is deleted and nothing is written over. Loading the same file twice is safe.
> [ ⤒ Restore from a backup file ]

The description and the counter line were both stale after the rest of the change — the description listed five things and stopped short of appointments, and the counter read "2 entries" on a phone holding two entries *and* an appointment, under a button that saves all three. Fixed in edit 11; `card-copy-omits-appointments` falsifies it.

**Restore is deliberately its own row under a rule, not a fourth button in the save row.** Saving is routine and restoring is not, and a restore control in the same row as the one she taps every week is a control she will eventually tap by accident.

---

## 9. Traps specifically checked for

### The `h()` trap — this patch's exact area

`h()` does a bare `el.setAttribute(k, v)`. `disabled: cond ? 'disabled' : null` renders `disabled="null"`, and **any** value disables the control. This shipped two dead export buttons. Every conditional attribute in this patch is applied by **spreading**:

```js
}, busy ? { disabled: 'disabled' } : {}),
```

Three layers of defence:
- `export-patch.py` refuses to write if a regex finds the ternary form anywhere in the output;
- `FILE-no-null-attr-literals` re-checks the source;
- `TRAP-no-null-attributes` walks **every attribute of every element** in the live DOM and fails on any value that is the string `"null"` or `"undefined"`.

Falsified by `h-null-attribute-trap`, which turns the restore button's `disabled` into the ternary form. It goes RED on 16 checks, including `UI-restore-button-live` — i.e. the button is measurably dead, which is exactly what shipped before.

### Duplicate keys and duplicate names

Duplicate object keys are legal JS, last one silently wins, no error — and this project has already been bitten. Before writing a single byte, `export-patch.py` greps the target for **28 identifiers and 8 data-hooks** and aborts if any is already present. `getDocs` was verified imported-but-unused in the composed build before being adopted; the new icon key `bkRestore` was checked against all 17 existing glyphs.

The icon is inserted as the **first** key in `paths`, immediately after `const paths = {`, rather than beside `download` — because whether that line ends in a comma depends on whether `calendar-patch` has already appended its three keys. First position needs no comma bookkeeping and applies identically in either order.

### The file input and `render()`

`render()` does `root.innerHTML = ''` on every repaint, and the clock tick repaints once a second. An `<input type="file">` returned from `render()` is **destroyed while the operating system's file picker is still open** — the change event then fires on a node no longer in the document, the chosen file is dropped, and nothing anywhere reports a failure.

The input is therefore created once and appended to `document.body`, outside `#root`. This also avoids having to add another condition to the tick's repaint guard. `FILE-input-outside-root` and `UI-file-input-survives-repaint` (which tags the live node, navigates away and back, and asserts it is the *same* element) both pin it; `file-input-inside-root` falsifies it.

It is also set to `fontSize: 16px` — found by the 16px check at 13.3px. Off-screen, but a file input *does* take focus when its picker opens, and iOS Safari zooms and does not zoom back.

### `setState` in `onInput`

Never. Checked across the whole file by both the patch post-condition and `FILE-no-setState-in-onInput`.

---

## 10. Safety of the harness

- All **three** gstatic Firebase modules stubbed. One catch-all Playwright route with explicit dispatch aborts every request that is not `127.0.0.1` or one of the three stubs.
- `NET-1` asserts the only refused requests were the base build's Google Fonts `<link>`, and separately that **nothing Firebase-shaped was ever attempted** (`/firestore|firebase|fuelforge|identitytoolkit|firebaseio/`). A new outbound request appearing there is a finding, not noise.
- `NET-2` fails the run if `sw.js` was ever requested; the service worker is deleted from `Navigator.prototype` before any script runs, so the app's own guard skips registration.
- Fixtures only. No credentials, no network, nothing written anywhere but the in-memory stub.
- The suite refuses to start if `HTTPS_PROXY` (or any of its three siblings) is set, rather than failing every check for the wrong reason.

**A note on how the checks are driven.** The app is one `<script type="module">`, so none of its functions and none of `state` are reachable from `page.evaluate()` — module scope is not the global object. Every check therefore drives the app through its **real controls**: nav buttons by `aria-label`, the calendar drawer, the appointment row's own edit button, and the file import through Playwright's `filechooser` event (tap the button → the app opens the picker → the picker returns a file). The only global is `globalThis.__bk`, which the Firestore *stub* installs deliberately. That constraint is a feature: these checks cannot pass by poking at internals a user has no access to.

---

## 11. Falsifications performed — all 18 confirmed RED, then restored

| mutator | breaks | goes RED on |
|---|---|---|
| `here-map-is-plain-object` | `Object.create(null)` → `{}` | `FILE-proto-safe-map`, `PROTO-ids-restore`, `ROUNDTRIP-bytes`, `RESTORE-keeps-ids`, +2 |
| `appointments-dropped-from-backup` | the original defect | `BACKUP-has-appointments`, `BACKUP-has-sentinels`, `RESTORE-keeps-ids`, +4 |
| `appointments-leak-into-export` | widens `allExportEntries()` | `FILE-allExportEntries`, `CSV-no-appointment-leak`, `REPORT-no-appointment-leak` |
| `reasons-leak-into-export` | stops splitting `missed_reason` out | `CSV-no-reason-leak`, `REPORT-no-reason-leak` |
| `no-canonical-key-order` | stops sorting object keys | `BACKUP-format`, `ROUNDTRIP-bytes` |
| `no-document-sort` | stops sorting documents by id | `ROUNDTRIP-bytes` |
| `restore-mints-new-ids` | `setDoc` → `addDoc` | `RESTORE-idempotent`, `RESTORE-keeps-ids`, `ROUNDTRIP-bytes`, +5 |
| `restore-overwrites-whats-here` | stops skipping known ids | `RESTORE-never-overwrites`, `RESTORE-idempotent` |
| `legacy-file-rejected` | requires an appointments array | `BACKCOMPAT-old-file` |
| `removed-med-history-dropped` | filters the backup to current meds | `BACKUP-keeps-removed-med-history`, `RESTORE-removed-med-name-comes-back`, +6 |
| `conflict-check-removed` | removes the concurrent-edit check | all 5 `CONFLICT-*` |
| `spreadsheet-called-a-backup` | restores the old card copy | `COPY-spreadsheet-not-a-backup` |
| `card-copy-omits-appointments` | restores the old description | `COPY-spreadsheet-not-a-backup` |
| `restore-button-gated-on-empty` | disables restore when nothing is logged | `RESTORE-enabled-when-empty`, +13 |
| `backup-button-gated-on-nLogged` | gates backup on `allExportEntries()` | `BACKUP-enabled-with-only-appointments` |
| `h-null-attribute-trap` | `disabled: cond ? 'disabled' : null` | `TRAP-no-null-attributes`, `UI-restore-button-live`, +14 |
| `file-input-inside-root` | mounts the input inside `#root` | `FILE-input-outside-root`, `UI-file-input-survives-repaint` |
| `app-version-bumped` | touches `APP_VERSION` | `FILE-app-version`, `BACKUP-format` |

Additional falsifications performed by hand, outside the mutator sweep:

- **`node --check` on the extracted module** — exit 0 on the patched build; ran it against a deliberately broken file first and confirmed exit 1, so the pass means something.
- **Patch refuses without `calendar-patch`** — run against pristine v43.4 it lists all 7 missing markers, prints the correct apply order, exits 2, and leaves `index.html` at `520a150aa4ef7d6a0bda5b3843355e62` (byte-identical).
- **Idempotence** — second run reports "ALREADY APPLIED", writes zero bytes.
- **Ordering** — applies cleanly in three orders: `cleanup→calendar→reason→export`, `calendar→reason→export`, and `calendar→export`. (`cleanup-patch` must run *before* `calendar-patch`; they conflict on the `subscribeEntries` block otherwise. That is a pre-existing constraint, not one I introduced.)
- **`sw.js`** — md5 identical before and after; the path is never passed to `open()`.
- **`deliverFile` suppression** — §0.2.

---

## 12. Constraints honoured

| | |
|---|---|
| never `git reset --hard` | not used at any point |
| never point a harness at real Firestore | all three gstatic URLs stubbed, service worker blocked, `NET-1`/`NET-2` enforce it |
| never `playwright install` | used `/opt/pw-browsers/chromium`; global playwright loaded via `createRequire` |
| `HTTPS_PROXY` | suite refuses to start if set; `127.0.0.1` throughout, never `localhost` |
| no push to GitHub | nothing pushed; nothing committed |
| append-only rules | `setDoc` creates only; no `updateDoc`, no `deleteDoc`; asserted twice |
| no placeholders / TODOs / hardcoded test values | none; all fixture strings live in the harness |
| mobile 375×812 | every new control ≥ 44px (`UI-restore-button-live`, `CONFLICT-tap-targets`); every input ≥ 16px (`FONT-16px-inputs`) |
| removed medications' history | §4, `BACKUP-keeps-removed-med-history` + `RESTORE-removed-med-name-comes-back` |
| no ChemoWell storage keys | `FILE-no-chemowell-keys` |
| `APP_VERSION` untouched | read from the file, asserted before and after |
| `sw.js` untouched | never opened; md5 identical |

---

## 13. How to run

```bash
# apply, in this order
python3 cleanup-patch.py  --repo /path/to/care-tracker
python3 calendar-patch.py --repo /path/to/care-tracker     # fix its v43.3 literal first, see §0.1
python3 reason-patch.py   --repo /path/to/care-tracker     # same
python3 export-patch.py   --repo /path/to/care-tracker     # last

# dry run
python3 export-patch.py --repo /path/to/care-tracker --check

# verify (49 checks)
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
  node export-test.mjs --file /path/to/care-tracker/index.html

# falsify (18 mutators, ~15 min)
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
  node export-test.mjs --falsify
```

---

## 14. What I would want looked at next

1. **§0.1 — the two sibling patches are hard-blocked on v43.4.** One line each. Nothing ships until then.
2. **§0.2 — `deliverFile()`.** This patch raises the cost of that bug meaningfully. It needs a real fallback and real failure detection, and Aaron's on-phone test should now specifically cover the **backup** button in the installed PWA.
3. **Restore currently has no confirmation step.** It is safe by construction — nothing is deleted, nothing is overwritten, importing twice is a no-op — so a confirmation would be friction without a hazard behind it. But it is a deliberate call, not an oversight, and worth a second opinion.
4. **The backup is not encrypted.** It is a plain JSON file of one patient's medication history sitting in the phone's Files app. That is the same exposure the CSV already has and I did not change it, but it is now a *complete* record rather than a partial one, and somebody should decide consciously whether that is acceptable.

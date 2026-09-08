VERDICT: BLOCK

**The one check standing behind the third fix in this release goes GREEN on a build that still has
the bug — for most of every day.** `harness/remove-group-test.mjs` scored 19/20 on a build with the
paracentesis tombstone stamp reverted to a bare `Date.now()` when I ran it at 02:39 local, and
**20/20 on that same broken build** when the wall clock was moved to the afternoon. The suite freezes
the app clock at 15:00 today and seeds the corrected paracentesis with `loggedAt = 15:00 − 3h =
12:00`, so a bare `Date.now()` loses the tie only while real time is before noon. Run this suite any
time after ~12:00 and the guard it exists to protect cannot fail.

The patient-facing code in v73 is sound. I attacked it hard and it held on every path. This is a
block on the verification, and the repair is one line in the seed.

---

## 1. THE BLOCK — a check that cannot fail after noon

**File:** `harness/remove-group-test.mjs`, section 4, check *"the procedure is GONE — the 4.0 L it
replaced did not come back"*.

The release's third fix stamps the paracentesis tombstone
`Math.max(Date.now(), (p.loggedAt || p.ts || 0) + 1)` instead of a bare `Date.now()`, so the
tombstone cannot lose the tie to the record it removes. That is the correct fix and it matches how
weight (v69), cycle markers and the daily answers already stamp.

The suite that proves it is time-of-day dependent:

| Build under test | Wall clock | Result |
|---|---|---|
| v73 as shipped | 02:39 real | **20/20** |
| v73 with the para stamp reverted to bare `Date.now()` | 02:39 real | **19/20 — FAIL** (correct) |
| the same broken build | `Date.now()` shifted +13h (i.e. run at ~15:39) | **20/20 — GREEN on the bug** |

Method: `scratchpad/mutant-para.html` is v73 with exactly one substitution — the para tombstone's
`loggedAt` back to `Date.now()`. `scratchpad/suite-afternoon.mjs` is a byte copy of the shipped
suite with one added `addInitScript` that offsets `Date.now()` by +13h and changes nothing else.

**Why the builder's falsification could not have caught it.** The suite was falsified against
`outputs/rollback-v72/index.html` and scored 10/20. On v72 the whole of section 4 fails for a
different reason — v72 has no routing at all, so the row is hard-deleted and the para report still
shows a row. The stamp check was never exercised in isolation. 10/20 → 20/20 is a real delta that
still leaves this one check unfalsified.

**Why it matters beyond today.** The stamp bug was pre-existing since v52 and survived every gate
this project has until a suite happened to run in the morning. Ship it with this seed and the next
release that touches `removeParacentesis` gets a green light on a reintroduced bug whenever it is
verified after lunch — the "v66 Weight" failure exactly, tested in the one state no real device is
in, which is the mistake this suite's own header warns about one section earlier.

**The repair, one line.** Seed the corrected paracentesis with a `loggedAt` that is always ahead of
real `Date.now()` rather than one derived from the frozen 15:00 app clock — e.g.
`loggedAt: Date.now() + 6 * H` on `seed_p_corr` (and the same for `seed_w_corr` so the weight
tombstone's identical guard is covered too, which today it also is not). Then re-run the three rows
of the table above; the middle row must stay red at every hour.

---

## 2. WHAT I TRIED TO BREAK AND COULD NOT

All of the below was measured, not read. Probe: `outputs/audit-v73-probe.mjs` (11/11 on v73, **9/11
on v72** — that is its falsification, and the two v72 failures are the two real defects v73 fixes).
It seeds records the shipped suite does not: legacy readings with **no** `weightId`/`paraId`, a
neighbouring reading, a junk-valued weight, a reading **older than 48 hours**, and a control dose.

**Over-removal — disproved.** Two legacy weights on the same day (150 and 151, neither carrying a
`weightId`). Removing the 150 appended one tombstone keyed `doc:leg_a`, attempted **zero** deletes,
and left the 151 standing. `weightKey`/`paraKey` reproduce the resolvers' keying exactly, so a
legacy document is its own group of one and a tombstone on it kills nothing else.

**Legacy single reading vs v72 — figures identical, History differs (see §3).** After the removal
the Weight report drops the reading, the History day summary still reads `1 wt` (it counts
`weightResolved()`, not raw rows), the printable report's net-weight tile reads
`weightResolvedFrom(allExportEntries())`, and the CSV keeps the audit trail. No reader left behind:
every figure that touches weight goes through a resolver, and `exportDetailFor` labels the tombstone
`Removed` and the original `(superseded)`.

**The fall-through — reachable, correct, and it does not crash.** A weight document with
`weight: 'oops'` is skipped by `weightResolvedFrom`, so `removeEntryFor` falls through to
`removeEntry(e.id)` and the junk document is really deleted inside 48h. Confirmed: one delete
attempted, entry gone, no page error.

**The >48h weight is a real improvement the release notes do not claim.** `bypasses48h` includes
`weight`, so History has always offered Remove on a five-day-old reading. On **v72** that tap fired
`deleteDoc`, the rules refused it, the reading stayed, the confirmation closed as if it had worked
and the page raised an uncaught `Error: Missing or insufficient permissions.` (captured in my v72
run). On v73 the same tap appends a tombstone and the reading actually goes. Paracentesis is not in
`BYPASS_48H_IDS`, so its Remove is still hidden past 48h — unchanged, and correct.

**The ordinary path is not swallowed.** A Compazine dose still hard-deletes, one `deleteDoc`, no
tombstone invented.

**Refused write (offline) — honest.** With `addDoc` rejecting, tapping Remove on a weight from
History shows exactly one message, *"Could not remove — check connection and try again"*, the
reading stays on the Weight report, no success toast, no page error, no state that lies.
(`addEntryDB` also sets `state.writeError`, so the red banner *"That didn't save. Nothing was lost —
check your connection and log it again"* will be waiting on Today — wording aimed at a failed log,
not a failed removal. Pre-existing since v69 on the report screens; noted, not blocking.)

**No TDZ / ordering trap.** `PARA_MED_ID` is declared ~1,500 lines below `removeEntryFor`, but the
function only runs on a tap, long after module evaluation. Exercised live: the paracentesis route
fired and no page error was raised.

**Gates.** `python3 pm.py` on the release itself is **exit 2** — clear, one pre-existing pinned-
literal warning to disclose, and the delete ratchet green (*"no delete-based correction paths
remain"*). `harness/para-test.mjs` 16/16 on v73, including *PARA-7 remove is append, not delete* —
the stamp change did not regress it. `harness/remove-group-test.mjs` 20/20.

---

## 3. DISCLOSE THESE IN THE RELEASE MESSAGE (not blocking, but do not ship them silent)

1. **History no longer loses the row, and the note does not say so.** On v72, removing a weight from
   History made the row vanish. On v73 the original row stays, dimmed, tagged **SUPERSEDED**, and a
   second row appears tagged **REMOVED** ("Weight removed"). Every figure is right and this matches
   what paracentesis, bowel, appetite and symptoms have done for releases — but a caregiver who
   reads *"Remove now clears the whole reading"* and then sees **150 lbs still sitting in History**
   has been given a reason to think it did not work. One line in the note, or a named exemption in
   the release message. Home's journal is unaffected: it filters both rows out.
2. **"SUPERSEDED" is the wrong word on a row that was removed.** It means *corrected* everywhere
   else in this app, including the CSV's `(superseded)`. Pre-existing for the other tombstoned
   types; newly reachable for weight. A `REMOVED` chip on the original would be truer. Small.
3. **The Voice, on changelog point 3: *"It always takes effect now."*** Absolute, and offline it
   does not — the toast correctly says so. *"It takes effect now"* costs nothing and is true.
   Points 1 and 2 read true and would survive a tired 2am reading; point 1's "the same way the
   Weight and Paracentesis screens already did" is accurate.
4. **Exempt, say it out loud:** this sandbox has Chromium only, so nothing here is evidence about
   the iPhone's rendering, and no claim in the note has been confirmed on the patient's own phone.
5. `outputs/audit-v73-probe.mjs` is mine and is untracked — it will trip `pm.py`'s unpushed-work
   blocker until it is committed or removed. That is the only reason pm.py exits 1 with it present.

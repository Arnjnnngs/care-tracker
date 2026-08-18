#!/usr/bin/env python3
"""
medsync-patch.py -- shared medication settings for care-tracker.  Anchored, idempotent, refuses
loudly on any anchor mismatch.

WHAT IT DOES
  Medication configuration (state.meds AND state.archivedMeds) stops being per-device.  It moves
  into the EXISTING caretracker_prefs/settings document, written with the setDoc(..., {merge:true})
  the app already uses -- no new collection, because the published Firestore rules match named
  collections and a new one fails silently on the live app while passing in every harness.

  Nothing is auto-merged.  A shared list exists only after a person presses a confirm button that
  names, in plain words, exactly which list is being adopted and which is being replaced.  Both
  phones' original lists are snapshotted first, in two independent places, and stay recoverable
  from the UI afterwards.

  Also adds the app version to the menu footer.  It is derived from the APP_VERSION constant that
  is already in the file -- this patch never writes a version literal.

WHAT IT MUST NEVER DO
  * touch APP_VERSION            (set at ship time)
  * touch sw.js                  (set at ship time; this script never opens it)
  * write anything to caretracker_entries, which is append-only
  * introduce a new Firestore collection
  * pass a nullish value as an h() attribute -- h() calls setAttribute for anything it does not
    special-case, so `disabled: null` renders disabled="null" and the control is dead

Post-conditions are VERSION-AGNOSTIC throughout: they compare the input to the output and never
assert a version literal.  Three earlier patches on this project broke exactly that way.

USAGE
  python3 medsync-patch.py --file path/to/index.html [--check]
"""

import argparse
import hashlib
import io
import os
import re
import sys

MARK = 'MEDSYNC-PATCH-MARK'
HERE = os.path.dirname(os.path.abspath(__file__))
BLOCK_FILE = os.path.join(HERE, 'medsync_js_block.txt')


def die(msg):
    sys.stderr.write('medsync-patch: REFUSING TO WRITE\n  ' + msg + '\n')
    sys.exit(2)


def anchor(src, needle, what):
    n = src.count(needle)
    if n == 0:
        die('anchor not found (%s):\n      %s' % (what, needle.strip().splitlines()[0][:160]))
    if n > 1:
        die('anchor is ambiguous, found %d times (%s):\n      %s'
            % (n, what, needle.strip().splitlines()[0][:160]))
    return needle


# ---------------------------------------------------------------------------------------------
# Anchors
# ---------------------------------------------------------------------------------------------

A_PERSIST_OLD = """function persistMedicationConfig(meds, archivedMeds) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MED_CONFIG_STORAGE_KEY, JSON.stringify({ version: 1, meds, archivedMeds }));
  } catch (error) {
    console.warn('Medication configuration could not be saved:', error);
    setToast('Medication changes are active for this session but could not be saved on this device.');
  }
}
"""

A_PERSIST_NEW = """function persistMedicationConfig(meds, archivedMeds) {
  // The local copy is now a CACHE of the shared list, not the source of truth.  The early return
  // that used to sit inside this try block was moved into the condition on purpose: a device with
  // no usable localStorage must still publish its change to the other phone, and returning early
  // silently skipped that.
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MED_CONFIG_STORAGE_KEY, JSON.stringify({ version: 1, meds, archivedMeds }));
    }
  } catch (error) {
    console.warn('Medication configuration could not be saved:', error);
    setToast('Medication changes are active for this session but could not be saved on this device.');
  }
  // The single choke point.  Every medication edit in this app -- the editor, reordering, removing
  // a medication, and the archived-name merge that restore performs -- reaches Firestore through
  // this one line, which is why a later edit on either phone cannot cause the two to diverge again.
  medsyncPublishLocalChange(meds, archivedMeds);
}
"""

A_CONFIG_DECL = "const CONFIG = { patientName: 'Brandi', ceilingMg: 2500, tempUnit: 'Fahrenheit' };"

A_STATE_TAIL = "apptConfirmDelete: null, tour: null };"
A_STATE_TAIL_NEW = (
    "apptConfirmDelete: null, tour: null, "
    # devices:null means "the prefs snapshot has not arrived".  It is the offline state and every
    # medsync surface is invisible while it holds, so nothing can block dosing on a network read.
    "medsync: { devices: null, sharedJson: null, setAt: 0, setBy: '', confirm: null, saving: false } };"
)

A_SETSTATE_OLD = """function setState(patch) {
  Object.assign(state, patch);
  // Flush any deferred Firestore entries when the time modal closes
  if (!state.timeModal && pendingEntries) {
    state.entries = pendingEntries;
    pendingEntries = null;
  }
  render();
}"""

A_SETSTATE_NEW = """function setState(patch) {
  Object.assign(state, patch);
  // Flush any deferred Firestore entries when the time modal closes
  if (!state.timeModal && pendingEntries) {
    state.entries = pendingEntries;
    pendingEntries = null;
  }
  // A shared medication list that arrived while the medication editor was open is applied the
  // moment the editor closes -- never underneath a half-typed medication form.  Applied directly
  // rather than through setState() because we are already inside it.
  if (!state.medEditor && medsyncPendingShared) {
    const medsyncDeferred = medsyncPendingShared;
    medsyncPendingShared = null;
    const medsyncApplied = medsyncAdopt(medsyncDeferred.cfg, medsyncDeferred.json);
    state.meds = medsyncApplied.meds;
    state.archivedMeds = medsyncApplied.archivedMeds;
  }
  render();
}"""

A_RENDERCONTENT_OLD = """function renderContent(now, mg, pct, tyColor, ceiling) {
  if (state.view === 'meds') return renderMedicationManager(now);"""

A_RENDERCONTENT_NEW = """function renderContent(now, mg, pct, tyColor, ceiling) {
  if (state.view === 'medsync') return renderMedsyncScreen(now);
  if (state.view === 'meds') return renderMedicationManager(now);"""

A_MEDS_BLURB_OLD = ("'Review, add, edit, or remove the active medication list. Configuration is stored "
                    "on this device; dose history and live sync stay intact.'")
A_MEDS_BLURB_NEW = ("'Review, add, edit, or remove the active medication list. Dose history and live "
                    "sync stay intact.'")

A_MEDS_RETURN_OLD = """    renderMedicationEditor(),
    homeOrderSection,"""
A_MEDS_RETURN_NEW = """    renderMedsyncCard(),
    renderMedicationEditor(),
    homeOrderSection,"""

A_PREFS_OLD = """unsubPrefs = subscribePrefs((prefs) => {
  setState({ missedClearedAt: prefs.missedClearedAt || 0 });
});"""

A_PREFS_NEW = """unsubPrefs = subscribePrefs((prefs) => {
  // ONE patch, ONE repaint.  medsyncOnPrefs mutates the patch object rather than calling setState
  // itself, so a snapshot carrying both a cleared banner and a new shared medication list does not
  // render twice.  It never throws: every read inside it is defensive and every write is
  // fire-and-forget, because this callback also runs on the phone that is mid-dose.
  const patch = { missedClearedAt: prefs && prefs.missedClearedAt ? prefs.missedClearedAt : 0 };
  try { medsyncOnPrefs(prefs, patch); } catch (err) { console.warn('[medsync] prefs handler:', err); }
  setState(patch);
});"""

A_DRAWER_TAIL_OLD = """            h('span', { style: { display: 'block', fontSize: '11.5px', color: '#6E5261', marginTop: '1px', lineHeight: '1.3' } }, 'A minute-long look around')
          )
        )
      )
    )
  );
}"""

A_DRAWER_TAIL_NEW = """            h('span', { style: { display: 'block', fontSize: '11.5px', color: '#6E5261', marginTop: '1px', lineHeight: '1.3' } }, 'A minute-long look around')
          )
        ),
        // The build number, in the one place anybody looks when something is wrong.  Before this it
        // appeared nowhere in the UI at all -- the printable report was the only way to find out
        // which build a phone was running, which made diagnosing the medication-config split
        // considerably harder than it should have been.  Derived from APP_VERSION, never a literal.
        h('div', { 'data-app-version': 'true', style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(212,104,138,0.12)', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#8A7080', letterSpacing: '0.02em' } }, 'CareTracker ' + APP_VERSION)
      )
    )
  );
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True, help='path to index.html')
    ap.add_argument('--check', action='store_true', help='validate and report, write nothing')
    args = ap.parse_args()

    target = args.file
    if not os.path.isfile(target):
        die('no such file: %s' % target)
    if os.path.basename(target) != 'index.html':
        die('refusing to patch %s -- this patch only ever edits index.html and never sw.js'
            % os.path.basename(target))
    if not os.path.isfile(BLOCK_FILE):
        die('missing %s -- the patch and its JS block ship together' % BLOCK_FILE)

    with io.open(target, encoding='utf-8') as f:
        src = f.read()
    with io.open(BLOCK_FILE, encoding='utf-8') as f:
        block = f.read()

    before_md5 = hashlib.md5(src.encode('utf-8')).hexdigest()

    if MARK in src:
        print('medsync-patch: already applied (%s present) -- nothing to do. md5 %s'
              % (MARK, before_md5))
        return 0

    m = re.search(r"const APP_VERSION = '([^']+)';", src)
    if not m:
        die('APP_VERSION declaration not found -- refusing to work on an unfamiliar file')
    app_version_line = m.group(0)

    # Names this patch introduces must not already exist.  A silent collision is how a patch
    # overwrites somebody else's function and nobody finds out until it is live.
    introduced = sorted(set(re.findall(r'\bfunction (medsync[A-Za-z0-9_]*)\s*\(', block)) |
                        set(re.findall(r'\b(?:const|let) (MEDSYNC_[A-Z0-9_]*|medsync[A-Za-z0-9_]*)\s*=', block)) |
                        {'renderMedsyncCard', 'renderMedsyncScreen', 'renderMedsyncConfirm',
                         'renderMedsyncPanel', 'renderMedsyncDiffBlock'})
    collisions = [n for n in introduced if re.search(r'\b' + re.escape(n) + r'\b', src)]
    if collisions:
        die('name collision with the base file: ' + ', '.join(collisions))

    out = src

    # 1. persistMedicationConfig becomes the single publish choke point.
    anchor(out, A_PERSIST_OLD, 'persistMedicationConfig')
    out = out.replace(A_PERSIST_OLD, A_PERSIST_NEW)

    # 2. The module lands immediately before CONFIG, so every const/let in it is initialised before
    #    the state literal and before anything can call setState().
    anchor(out, A_CONFIG_DECL, 'CONFIG declaration')
    out = out.replace(A_CONFIG_DECL, block.rstrip('\n') + '\n\n' + A_CONFIG_DECL)

    # 3. state.medsync
    anchor(out, A_STATE_TAIL, 'state literal tail')
    out = out.replace(A_STATE_TAIL, A_STATE_TAIL_NEW)

    # 4. deferred adoption flush
    anchor(out, A_SETSTATE_OLD, 'setState')
    out = out.replace(A_SETSTATE_OLD, A_SETSTATE_NEW)

    # 5. the chooser view
    anchor(out, A_RENDERCONTENT_OLD, 'renderContent')
    out = out.replace(A_RENDERCONTENT_OLD, A_RENDERCONTENT_NEW)

    # 6. Medications screen: the notice, and the now-false "stored on this device" blurb
    anchor(out, A_MEDS_BLURB_OLD, 'medication manager blurb')
    out = out.replace(A_MEDS_BLURB_OLD, A_MEDS_BLURB_NEW)
    anchor(out, A_MEDS_RETURN_OLD, 'medication manager return array')
    out = out.replace(A_MEDS_RETURN_OLD, A_MEDS_RETURN_NEW)

    # 7. prefs subscription
    anchor(out, A_PREFS_OLD, 'prefs subscription')
    out = out.replace(A_PREFS_OLD, A_PREFS_NEW)

    # 8. version in the menu footer
    anchor(out, A_DRAWER_TAIL_OLD, 'menu drawer tail')
    out = out.replace(A_DRAWER_TAIL_OLD, A_DRAWER_TAIL_NEW)

    # -----------------------------------------------------------------------------------------
    # Post-conditions.  Every one compares the INPUT to the OUTPUT; not one asserts a version
    # literal, a build number, or a cache name.
    # -----------------------------------------------------------------------------------------
    problems = []

    if MARK not in out:
        problems.append('the module mark is missing from the result')
    if out.count(MARK) != 1:
        problems.append('the module mark appears %d times, expected 1' % out.count(MARK))

    # APP_VERSION: byte-identical to whatever the input said.
    if app_version_line not in out:
        problems.append('APP_VERSION was altered -- this patch must never touch it')
    if len(re.findall(r"const APP_VERSION = '[^']+';", out)) != 1:
        problems.append('APP_VERSION is declared %d times in the result'
                        % len(re.findall(r"const APP_VERSION = '[^']+';", out)))

    # The version shown in the UI is derived, never written.  Any quoted 'v<number>' literal that
    # this patch introduced would be a hardcoded build number.
    added_version_literals = [s for s in re.findall(r"'v\d+(?:\.\d+)*'", out)
                              if out.count(s) != src.count(s)]
    if added_version_literals:
        problems.append('a version literal was introduced: ' + ', '.join(sorted(set(added_version_literals))))
    if "'CareTracker ' + APP_VERSION" not in out:
        problems.append('the menu version label is not derived from APP_VERSION')

    # sw.js: this script never opens it, and it must not touch the registration block either.
    for frag in ["navigator.serviceWorker.register('sw.js')", "'serviceWorker' in navigator"]:
        if src.count(frag) != out.count(frag):
            problems.append('the service-worker registration block changed: ' + frag)

    # Storage: no new collection, and nothing new pointed at the append-only entries collection.
    if src.count('const COL_NAME = "caretracker_entries";') != out.count('const COL_NAME = "caretracker_entries";'):
        problems.append('the entries collection constant changed')
    for name in ["'caretracker_entries'", '"caretracker_entries"']:
        if out.count(name) != src.count(name):
            problems.append('a new reference to caretracker_entries appeared (%d -> %d): %s'
                            % (src.count(name), out.count(name), name))
    collections_before = set(re.findall(r"collection\(db,\s*([A-Za-z_$][\w$]*|'[^']*'|\"[^\"]*\")", src)) | \
                         set(re.findall(r"doc\(db,\s*([A-Za-z_$][\w$]*|'[^']*'|\"[^\"]*\")", src))
    collections_after = set(re.findall(r"collection\(db,\s*([A-Za-z_$][\w$]*|'[^']*'|\"[^\"]*\")", out)) | \
                        set(re.findall(r"doc\(db,\s*([A-Za-z_$][\w$]*|'[^']*'|\"[^\"]*\")", out))
    if collections_after - collections_before:
        problems.append('a NEW Firestore collection was introduced: '
                        + ', '.join(sorted(collections_after - collections_before))
                        + ' -- the published rules match named collections and a new one fails '
                          'silently on the live app while passing in every harness')

    # Every setDoc this patch adds must be the merged write onto the prefs document.
    src_code_all = strip_comments(src)
    out_code_all = strip_comments(out)
    added_setdocs = [s for s in re.findall(r'setDoc\([^;]*?\)', out_code_all, re.S)
                     if 'PREFS_DOC' not in s and s not in src_code_all]
    if added_setdocs:
        problems.append('a setDoc was added that does not target PREFS_DOC: '
                        + added_setdocs[0][:120])
    if out_code_all.count("setDoc(PREFS_DOC, payload, { merge: true })") != 1:
        problems.append('expected exactly one shared-config write helper, found %d'
                        % out_code_all.count("setDoc(PREFS_DOC, payload, { merge: true })"))
    if out_code_all.count('addDoc(') != src_code_all.count('addDoc(') or out_code_all.count('deleteDoc(') != src_code_all.count('deleteDoc('):
        problems.append('this patch added an entry write or delete -- it must add neither')

    # The h() trap: no nullish attribute may be passed anywhere in the code this patch introduced.
    module_start = out.index(MARK)
    module_end = out.index(A_CONFIG_DECL, module_start)
    module = out[module_start:module_end]
    module_code = strip_comments(module)
    for bad in re.findall(r"\b(disabled|aria-current|aria-\w+|hidden|readonly|checked)\s*:\s*[^,}\n]*\bnull\b", module_code):
        problems.append('a nullish attribute is passed to h() inside the new module: ' + bad)
    if re.search(r"disabled\s*:", module_code):
        problems.append('the new module passes a `disabled` attribute -- h() disables the control '
                        'for ANY value, including "false" and "null"')

    # setState from onInput is a repeat offender on this project.
    for mm in re.finditer(r'onInput:\s*\([^)]*\)\s*=>\s*\{([^}]*)\}', strip_comments(out)):
        if 'setState(' in mm.group(1):
            problems.append('setState() is called from an onInput handler')

    # Lookups keyed by ids must not inherit Object.prototype.
    if 'Object.create(null)' not in module_code:
        problems.append('the new module builds no null-prototype maps -- a plain {} keyed by '
                        'medication ids answers truthy for "constructor" even when empty')
    for name in ['medsyncMedMap', 'medsyncReadDevices', 'medsyncCandidates']:
        fn = re.search(r'function ' + name + r'\([^)]*\)\s*\{(.*?)\n\}', module_code, re.S)
        if not fn:
            problems.append('%s() not found in the result' % name)
        elif 'Object.create(null)' not in fn.group(1):
            problems.append('%s() uses a plain {} as an id-keyed map' % name)

    # There must be exactly ONE writer of the shared field, and it must be the confirm path.
    writers = re.findall(r'payload\[MEDSYNC_SHARED_FIELD\] = ', module_code)
    if len(writers) != 2:
        problems.append('expected exactly two shared-field writes (the confirmed choice and the '
                        'post-choice edit propagation), found %d' % len(writers))
    commit = re.search(r'function medsyncCommitChoice\(.*?\n\}', module_code, re.S)
    if not commit:
        problems.append('medsyncCommitChoice() not found in the result')
    elif 'medsyncBusy' not in commit.group(0):
        problems.append('medsyncCommitChoice() is not re-entrancy guarded')
    yes_btn = re.search(r"'data-medsync-confirm-yes'", module_code)
    if not yes_btn:
        problems.append('the confirm button hook is missing')
    if module_code.count('medsyncCommitChoice(') != 2:
        problems.append('medsyncCommitChoice is reachable from %d place(s); expected exactly one '
                        'call site plus its declaration' % module_code.count('medsyncCommitChoice('))

    # The pre-share snapshot must be written before anything can be adopted, and never overwritten.
    adopt = re.search(r'function medsyncAdopt\(.*?\n\}', module_code, re.S)
    if not adopt:
        problems.append('medsyncAdopt() not found in the result')
    elif not adopt.group(0).strip().splitlines()[1].strip().startswith('medsyncBackupLocalOnce()'):
        problems.append('medsyncAdopt() does not snapshot the local list as its FIRST action')
    backup = re.search(r'function medsyncBackupLocalOnce\(.*?\n\}', module_code, re.S)
    if not backup or 'if (medsyncLsGet(MEDSYNC_PRECHOICE_KEY)) return false;' not in backup.group(0):
        problems.append('medsyncBackupLocalOnce() can overwrite an existing snapshot')

    # An empty shared list must never be adoptable.
    parse = re.search(r'function medsyncParseConfig\(.*?\n\}', module_code, re.S)
    if not parse or '!raw.meds.length' not in parse.group(0):
        problems.append('medsyncParseConfig() would accept an empty medication list, which could '
                        'wipe a phone')

    # Nothing may be awaited on a render path.
    for fn_name in ['renderMedsyncCard', 'renderMedsyncScreen', 'renderMedsyncPanel',
                    'renderMedsyncConfirm', 'renderMedsyncDiffBlock']:
        fn = re.search(r'function ' + fn_name + r'\(.*?\n\}', module_code, re.S)
        if not fn:
            problems.append('%s() not found in the result' % fn_name)
        elif 'await ' in fn.group(0) or 'setDoc(' in fn.group(0):
            problems.append('%s() blocks on the network' % fn_name)

    # Existing hooks other patches assert on must not move.
    for hook in sorted(set(re.findall(r"data-(?:cal|mr|backup|tour)-[a-z-]+", src))):
        if src.count(hook) != out.count(hook):
            problems.append('hook %s occurrence count changed: %d -> %d'
                            % (hook, src.count(hook), out.count(hook)))
    # The composed one-second tick guard belongs to four earlier patches and is deliberately NOT
    # touched here: the chooser is a screen, not an overlay, so it needs no term in that guard.
    tick = "if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();"
    if src.count(tick) != out.count(tick):
        problems.append('the composed one-second tick guard changed')
    items = re.search(r'const CAL_DRAWER_ITEMS = \[(.*?)\n\];', out, re.S)
    if not items or items.group(1).count('{ view:') != 6:
        problems.append('CAL_DRAWER_ITEMS is no longer the original six rows')
    if out.count("data-app-version") != 1:
        problems.append('expected exactly one version label, found %d' % out.count('data-app-version'))

    # v43.4 and the Home counter cards must be untouched.
    if src.count('function medIsOnActiveList(id)') != out.count('function medIsOnActiveList(id)'):
        problems.append('medIsOnActiveList was altered')
    for gate in ["medIsOnActiveList('tylenol')", "medIsOnActiveList('imodium')", "medIsOnActiveList('lidocaine')"]:
        if src.count(gate) != out.count(gate):
            problems.append('a Home counter-card gate changed: ' + gate)

    # Balance: the file must still parse as far as bracket counting can tell.
    for op, cl in [('(', ')'), ('{', '}'), ('[', ']')]:
        if (out.count(op) - src.count(op)) != (out.count(cl) - src.count(cl)):
            problems.append('unbalanced %s%s introduced' % (op, cl))

    if 'TODO' in module or 'FIXME' in module or 'placeholder' in module.lower():
        problems.append('the new module contains a TODO/FIXME/placeholder')

    if problems:
        die('post-conditions failed -- nothing written:\n  - ' + '\n  - '.join(problems))

    after_md5 = hashlib.md5(out.encode('utf-8')).hexdigest()
    if args.check:
        print('medsync-patch: --check OK. would write %s  (%s -> %s)' % (target, before_md5, after_md5))
        return 0

    with io.open(target, 'w', encoding='utf-8') as f:
        f.write(out)
    print('medsync-patch: applied to %s' % target)
    print('  APP_VERSION untouched : %s' % app_version_line)
    print('  sw.js                 : never opened by this script')
    print('  md5 %s -> %s' % (before_md5, after_md5))
    print('  shared config field   : caretracker_prefs/settings . medConfigJson  (merged write)')
    print('  device snapshots      : caretracker_prefs/settings . medConfigDevices  (frozen once chosen)')
    print('  local snapshot key    : caretracker-medication-config-prechoice-v1')
    return 0


def strip_comments(src):
    """Strip /* */ blocks and whole-line // comments.

    Without this the post-conditions grep their own prose: the module explains in words that
    `disabled: null` must never be written, and a check that reads comments would fire on the
    warning instead of on the code.  A suite on this project once read document.body.textContent,
    which on a single-file app includes the inline <script> source, and every check passed on a
    broken build.
    """
    src = re.sub(r'/\*[\s\S]*?\*/', ' ', src)
    return '\n'.join(l for l in src.split('\n') if not l.lstrip().startswith('//'))


if __name__ == '__main__':
    sys.exit(main())

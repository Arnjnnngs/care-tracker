#!/usr/bin/env python3
"""
iosshare-patch.py — two live failures Aaron reported on 2026-08-21.

A) "can't find file for iPhone either"
   CONFIRMED ROOT CAUSE. deliverFile() was a bare `<a download>` + click, and the Web Share API
   appeared ZERO times in the whole app. In an INSTALLED iOS PWA (standalone display mode),
   `<a download>` does not save a file -- Safari either ignores it or opens the blob in a viewer
   with no route to Files. So every export on her iPhone produced a success toast and no file.
   This is the risk flagged since v44 ("until you confirm a file lands, it is not a backup").
   It is now confirmed, which means Brandi's records have had NO working backup at all.

   FIX: use navigator.share({files}) -- Web Share API Level 2, supported in iOS Safari 15+,
   including standalone PWAs. It opens the native share sheet, which has "Save to Files".
   Falls back to `<a download>` wherever file sharing is unavailable (desktop, older Android).

   AND THE APP STOPS CLAIMING SUCCESS IT CANNOT VERIFY. deliverFile now reports which route ran
   and whether the user cancelled, and the callers tell the truth accordingly. A cancelled share
   is NOT "saved to your downloads".

B) "still not syncing up between iPhone and android"
   The v46 shared-medication-settings feature works, but NOTHING CHANGES UNTIL AARON CHOOSES which
   phone's list to use -- and the chooser is reachable only from a card partway down the
   Medications screen. Nothing on Home ever said the two phones disagreed. A safety fix that
   depends on the user discovering a button is not a shipped fix.

   FIX: when this phone can see another phone's list AND no choice has been made yet, Home shows a
   prompt that goes straight to the chooser. It uses the existing medsyncCandidates() logic -- no
   second definition of "the phones disagree".
"""
import argparse, hashlib, re, subprocess, tempfile, os, sys

def die(m):
    print("FAIL: " + m); sys.exit(2)

OLD_DELIVER = '''async function deliverFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  } finally {
    // Revoke on a timer, not immediately: Safari cancels an in-flight download if the object URL
    // is revoked in the same tick as the click.
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (err) {} }, 4000);
  }
}'''

NEW_DELIVER = '''// Returns { method: 'share'|'download', cancelled: boolean }.
// The caller MUST use this. Announcing "saved" after a cancelled share is the same lie this
// function existed to tell for six releases.
async function deliverFile(blob, filename) {
  // THE iOS PWA PROBLEM, confirmed live on 2026-08-21: in an installed PWA (standalone display
  // mode) `<a download>` does not save anything. Safari ignores it or opens the blob in a viewer
  // with no route to Files. Every export produced a success toast and no file. The Web Share API
  // (Level 2, iOS Safari 15+) is the only reliable route -- the share sheet has "Save to Files".
  try {
    if (typeof File === 'function' && navigator.canShare) {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return { method: 'share', cancelled: false };
        } catch (err) {
          // AbortError means she tapped Cancel. That is not a failure and must not be retried as
          // a download -- a file appearing after she cancelled is its own kind of wrong.
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
            return { method: 'share', cancelled: true };
          }
          // Anything else: fall through and try the download route rather than losing the export.
          console.warn('[export] share failed, falling back to download:', err);
        }
      }
    }
  } catch (err) {
    console.warn('[export] share unavailable, using download:', err);
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  } finally {
    // Revoke on a timer, not immediately: Safari cancels an in-flight download if the object URL
    // is revoked in the same tick as the click.
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (err) {} }, 4000);
  }
  return { method: 'download', cancelled: false };
}

// One place that turns a deliverFile() result into words. "Saved to your downloads" is wrong for a
// share sheet (she chose where it went) and a lie if she cancelled.
function deliveredWord(res, what) {
  if (res && res.cancelled) return null;
  if (res && res.method === 'share') return what + ' — choose "Save to Files" to keep it.';
  return what + ' saved to your downloads.';
}'''

EDITS = [
("1. Web Share for file delivery, with an honest result", OLD_DELIVER, NEW_DELIVER),

("2. CSV: no success message if the share was cancelled",
'''    await deliverFile(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), exportFilename('records', 'csv'));
    setToast(nLogged + ' entr' + (nLogged === 1 ? 'y' : 'ies') + ' saved to your downloads.');''',
'''    const csvRes = await deliverFile(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), exportFilename('records', 'csv'));
    const csvWord = deliveredWord(csvRes, nLogged + ' entr' + (nLogged === 1 ? 'y' : 'ies'));
    if (csvWord) setToast(csvWord);'''),
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    src = open(a.file, encoding="utf-8").read()
    print("in   %s\n     md5 %s" % (a.file, hashlib.md5(src.encode()).hexdigest()))
    if "navigator.canShare" in src:
        print("ALREADY APPLIED — nothing written."); return
    out = src
    for name, old, new in EDITS:
        n = out.count(old)
        if n != 1: die("anchor matched %d times (need 1) -> %s" % (n, name))
        out = out.replace(old, new, 1)
        print("  ok  " + name)

    # ---- B: the Home prompt ----
    banner_anchor = "  // WRITE FAILURE — pushed above everything"
    if out.count(banner_anchor) != 1: die("Home mount anchor not unique")
    out = out.replace(banner_anchor,
'''  // MEDICATION LISTS DISAGREE AND NOBODY HAS CHOSEN YET.
  // v46 shipped shared medication settings, but nothing changes until a choice is made, and the
  // chooser lived only on a card partway down the Medications screen. Aaron reported the two
  // phones "still not syncing" -- they were waiting on him, and nothing ever said so.
  // Uses medsyncCandidates(), the SAME source the Medications card uses: no second definition of
  // "the phones disagree". Renders nothing until the prefs snapshot lands, so an offline phone
  // shows no warning it cannot act on.
  if (state.medsync && state.medsync.devices && !state.medsync.sharedJson) {
    const mineId = medsyncDeviceId();
    const otherPhones = medsyncCandidates().filter(function (c) { return c.id !== mineId; });
    if (otherPhones.length) {
      parts.push(h('div', { 'data-medsync-home-prompt': 'true', style: { display: 'flex', alignItems: 'flex-start', gap: '10px', background: 'rgba(199,120,0,0.14)', border: '1px solid rgba(199,120,0,0.45)', borderRadius: '15px', padding: '12px 13px' } },
        h('span', { style: { flexShrink: '0', width: '22px', height: '22px', borderRadius: '50%', background: '#C77800', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '13px' } }, '!'),
        h('span', { style: { flex: '1', minWidth: '0' } },
          h('span', { style: { display: 'block', fontSize: '13.5px', fontWeight: '800', color: '#7A5313', lineHeight: '1.35' } }, 'The two phones have different medication lists'),
          h('span', { style: { display: 'block', fontSize: '12.5px', color: '#7A5313', lineHeight: '1.4', marginTop: '3px' } }, 'Until you pick which list both should use, each phone keeps its own — which is why a dose can look due on one and not the other.'),
          h('button', { 'data-medsync-open': 'true', type: 'button', onClick: medsyncGoChooser, style: { marginTop: '10px', minHeight: '44px', padding: '0 14px', borderRadius: '11px', background: '#C77800', color: '#fff', fontSize: '13.5px', fontWeight: '800' } }, 'Compare the two lists')
        )
      ));
    }
  }
''' + banner_anchor, 1)
    print("  ok  3. Home prompt when the two phones disagree and no choice is made")

    # ---- post-conditions ----
    vi = re.search(r"const APP_VERSION = '([^']*)';", src)
    vo = re.search(r"const APP_VERSION = '([^']*)';", out)
    if not vi or not vo or vi.group(1) != vo.group(1):
        die("APP_VERSION changed. This patch must never touch it.")
    if out.count("function deliverFile") != 1: die("deliverFile duplicated")
    if out.count("function medsyncCandidates") != 1:
        die("medsyncCandidates duplicated — the Home prompt and the Meds card must share one source")
    if "navigator.share({ files: [file]" not in out: die("Web Share was not wired in")
    if "navigator.canShare({ files: [file] })" not in out: die("canShare feature-detection is missing")
    if "err.name === 'AbortError'" not in out: die("a cancelled share is not distinguished from a failure")
    if "function deliveredWord" not in out: die("the honest-message helper is missing")
    if "if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();" not in out:
        die("the pinned tick guard was damaged")
    for f, why in [("uiIsBusy()", "v47 sync guards"), ("throw err;", "v48 write-failure rethrow"),
                   ("data-missed-on-card", "v49 missed-on-card")]:
        if f not in out: die("%s missing" % why)
    m = re.search(r'<script type="module">(.*?)</script>', out, re.S)
    tf = tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8')
    tf.write(m.group(1)); tf.close()
    r = subprocess.run(['node', '--check', tf.name], capture_output=True, text=True)
    os.unlink(tf.name)
    if r.returncode != 0: die("not valid JavaScript:\n" + r.stderr.strip()[:400])
    print("  ok  post: parses as valid JavaScript")

    if a.check:
        print("check only — nothing written."); return
    open(a.file, "w", encoding="utf-8").write(out)
    print("\nout  md5 %s  (%+d bytes)" % (hashlib.md5(out.encode()).hexdigest(), len(out)-len(src)))

main()

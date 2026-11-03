#!/usr/bin/env python3
"""
axis-patch.py -- the weight chart's x-axis repeated dates and ran into the future.

PORTED FROM chemowell-app-beta app-v90, verified first in chemowell-beta (staging). This is the
LIVE app, so the patch exists so the release is reproducible from the repo alone (Rule 0) and so
the change can be read before it is applied rather than after.

THE TWO HALVES, as they appear on the Weight report:
  1. tMax was floored at `tMin + DAY`, so a day holding a single reading drew a right-hand edge
     24 hours after the FIRST reading and labelled the axis with TOMORROW.
  2. Labels were always M/D and always evenly spaced, so a span of hours printed one calendar date
     under four or five ticks: "10/31 10/31 10/31 11/1 11/1".

Both came from six lines. In the product app those six lines existed TWICE -- a temperature chart
as well -- which is why the fix is written as two shared helpers there. THIS app has one chart, and
the helpers are kept in that shape anyway so the three files stay diffable and the next port is a
copy rather than a rewrite.

WHAT IT DOES NOT DO: it does not touch APP_VERSION or the sw.js cache. Pinning a version literal
in a patch is forbidden by Rule 5 -- three patches and several suites broke on legitimate releases
because of exactly that -- so the version bump stays in the deploy step where it belongs.

NO PATIENT-SPECIFIC CONTENT IS INVOLVED in either direction. The porting rule runs one way only:
a fix travelling TO chemowell-app-beta has her name, her pronouns and her doses taken out. This
one carries none of that, so nothing had to be removed on the way out or put back on the way in.

Run:  python3 harness/axis-patch.py --file index.html [--check]
"""
import argparse, hashlib, sys

HELPERS = '''
// ONE TIME AXIS. (Ported from chemowell-app-beta app-v90, where Aaron reported it: "chart x-axes
// repeat dates and run into the future".) Written as helpers rather than inline because the
// product app has the same axis in two charts, and this file is the one the other two are diffed
// against. Three Zero Day Audit passes and 162 checks are behind the logic below; the comments are
// that app's own and are kept word for word on purpose -- they are the record of what was tried.
//
// WHY THE FORMAT IS CHOSEN FROM THE SPAN. The labels were always M/D, so a span shorter than a few
// days put the same calendar day under four or five ticks. Over a few hours the DATE is not what
// varies and printing it says nothing; the time is.
//
// WHY NOT CALENDAR BOUNDARIES. Ticking on midnights would make repeats impossible by construction,
// and it was rejected: it moves the end labels off the data, so a ten-day chart would open before
// the first reading and end after the last, and a span under a day has no interior midnight at all
// and degenerates to one tick or none. Keeping the ticks on the data and fixing the FORMAT answers
// both symptoms without changing what the axis means.
const AXIS_HOUR = 3600000, AXIS_DAY = 86400000;
function timeAxisLabels(tMin, tMax, count, x) {
  const span = Math.max(tMax - tMin, 1);
  // A TIME IS ONLY UNAMBIGUOUS INSIDE ONE CALENDAR DAY, and the first version of this got it
  // wrong: it chose times for any span under two days, so a chart from yesterday morning to this
  // morning read "9 AM, 3 PM, 9 PM, 3 AM, 9 AM" -- the same label twice, twenty-four hours apart,
  // which is both a repeat and a lie about which reading is which.
  //
  // So the question is not how LONG the span is, it is whether it crosses midnight. Within a day
  // the date never varies and the time is the whole story; across days the reverse.
  //
  // AND A SPAN OVER A YEAR IS REACHABLE. When every reading is older than the window,
  // renderWeightTrend falls back to `weightEntries.slice(-2)` with no bound at all on how far
  // apart those two readings are, and M/D carries no year: two readings 730 days apart render
  // "7/25, 1/24, 7/25". Measured at a 365-day span, de-duplication did not merely leave an
  // ambiguous label -- it DROPPED the tick sitting under the most recent reading. So the year is
  // printed once the span passes ~300 days.
  const dayOf = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const sameDay = dayOf(tMin) === dayOf(tMax);
  const fmt = sameDay
    ? (span < 3 * AXIS_HOUR
        ? (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : (d) => d.toLocaleTimeString([], { hour: 'numeric' }))
    : (span > 300 * AXIS_DAY
        ? (d) => (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(-2)
        : (d) => (d.getMonth() + 1) + '/' + d.getDate());
  const out = [], seen = new Set();
  for (let i = 0; i <= count; i++) {
    const ts = tMin + (span / count) * i;
    const label = fmt(new Date(ts));
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label: label, px: x(ts) });
  }
  return out;
}
// THE RIGHT EDGE OF A CHART IS NEVER LATER THAN NOW. The old floor was `tMin + DAY`, so a day
// holding a single reading drew an axis labelled with TOMORROW.
//
// Math.max(lastTs, ...) is load-bearing in the one direction that matters: the data always fits.
// If a reading is somehow later than "now", the axis still reaches it rather than cropping a
// reading out of the chart. `now` is passed in rather than read again: every caller already holds
// the one the rest of the chart was built from, and reading the clock here would put two clocks in
// one drawing.
function chartTimeMax(tMin, lastTs, now) {
  return Math.max(lastTs, Math.min(tMin + AXIS_DAY, now));
}

'''

def die(m):
    print("FAIL: " + m); sys.exit(2)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    src = open(a.file, encoding="utf-8").read()
    print("in   %s\n     md5 %s" % (a.file, hashlib.md5(src.encode()).hexdigest()))
    if "function timeAxisLabels(" in src or "function chartTimeMax(" in src or "data-weight-range" in src:
        print("ALREADY APPLIED -- nothing written."); return
    out = src

    # ---- 1. the helpers, at module scope, immediately above the chart that calls them ----------
    anchor = "function renderWeightTrend(now) {"
    if out.count(anchor) != 1: die("renderWeightTrend anchor matched %d times" % out.count(anchor))
    out = out.replace(anchor, HELPERS.lstrip("\n") + anchor, 1)
    print("  ok  1. timeAxisLabels() and chartTimeMax() added at module scope")

    # ---- 2. the right edge ---------------------------------------------------------------------
    old = "  const tMax = Math.max(points[points.length - 1].ts, tMin + DAY);"
    if out.count(old) != 1: die("tMax anchor matched %d times" % out.count(old))
    out = out.replace(old, "  const tMax = chartTimeMax(tMin, points[points.length - 1].ts, now);", 1)
    print("  ok  2. the axis no longer runs past now")

    # ---- 3. the labels -------------------------------------------------------------------------
    old = """  // X-axis labels (dates)
  const xLabels = [];
  const labelCount = range === 'weeks' ? 4 : 6;
  for (let i = 0; i <= labelCount; i++) {
    const ts = tMin + (tRange / labelCount) * i;
    const d = new Date(ts);
    const label = (d.getMonth() + 1) + '/' + d.getDate();
    xLabels.push({ label, px: x(ts) });
  }"""
    if out.count(old) != 1: die("x-label loop anchor matched %d times" % out.count(old))
    out = out.replace(old, """  // X-axis labels -- dates OR times, decided by the span. See timeAxisLabels() above.
  const labelCount = range === 'weeks' ? 4 : 6;
  const xLabels = timeAxisLabels(tMin, tMax, labelCount, x);""", 1)
    print("  ok  3. the labels are no longer always M/D")

    # ---- 4. the padding a time label was clipped by --------------------------------------------
    old = "  const pad = { top: 30, right: 20, bottom: 50, left: 55 };"
    if out.count(old) != 1: die("pad anchor matched %d times" % out.count(old))
    out = out.replace(old, """  // right: 34, not 20. A date label is "10/31" -- 18 units wide in this 11px monospace -- but a
  // TIME label is "10:36 PM" at 29, and the rightmost one is centred on the right edge, so at 20
  // it rendered clipped as "10:09 P". Measured from the text metrics, asserted by the suites.
  const pad = { top: 30, right: 34, bottom: 50, left: 55 };""", 1)
    print("  ok  4. pad.right 20 -> 34, so a time label is not clipped at the right edge")

    # ---- 5. a data hook, so no suite ever selects a label by its text (Rule 5) -----------------
    old = """    svg += '<text x="' + xl.px.toFixed(1) + '" y="' + (H - 10) + '" fill="#7D6974" font-size="11" font-family="IBM Plex Mono,monospace" text-anchor="middle">' + xl.label + '</text>';"""
    if out.count(old) != 1: die("x-label render anchor matched %d times" % out.count(old))
    out = out.replace(old, """    svg += '<text data-xaxis="1" x="' + xl.px.toFixed(1) + '" y="' + (H - 10) + '" fill="#7D6974" font-size="11" font-family="IBM Plex Mono,monospace" text-anchor="middle">' + xl.label + '</text>';""", 1)
    print("  ok  5. data-xaxis hook on every x label")

    # ---- 6 & 7. the two navigation hooks the suite needs, so it reaches the chart the way a
    #             caregiver does rather than by poking state. Production already has
    #             data-cal-menu-button and data-cal-drawer-item; these two were missing.
    old = "        return h('button', { onClick: () => openReport(type), style:"
    if out.count(old) != 1: die("report card anchor matched %d times" % out.count(old))
    out = out.replace(old, "        return h('button', { 'data-report': type, onClick: () => openReport(type), style:", 1)
    print("  ok  6. data-report hook on each report card")

    n = 0
    for rng in ("weeks", "months"):
        old = "    h('button', { onClick: () => setState({ weightRange: '%s' }), style:" % rng
        if out.count(old) != 1: die("weightRange '%s' anchor matched %d times" % (rng, out.count(old)))
        out = out.replace(old, "    h('button', { 'data-weight-range': '%s', onClick: () => setState({ weightRange: '%s' }), style:" % (rng, rng), 1)
        n += 1
    print("  ok  7. data-weight-range hook on both toggle buttons (%d)" % n)

    if a.check:
        print("--check: %d bytes would be written (md5 %s). Nothing written."
              % (len(out.encode()), hashlib.md5(out.encode()).hexdigest()))
        return
    open(a.file, "w", encoding="utf-8").write(out)
    print("out  %s\n     md5 %s" % (a.file, hashlib.md5(out.encode()).hexdigest()))

if __name__ == "__main__":
    main()

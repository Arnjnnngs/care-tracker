# RENDER — v77 (the phone's own Back button)

Run: `node harness/overflow-scan.mjs`, 2026-09-14, against the built v77.

```
  every screen clean at all 10 device widths (iOS and Android)

140 of 140 screen/width combinations scanned, 0 overflowing element(s).
CLEAN — Android rows are high fidelity (Chromium is Android's engine); iOS rows are Chromium at Apple viewport sizes, not Safari.
```

**Deliberately exempt, said out loud:** the iOS rows are Chromium at Apple viewport sizes, not Safari — this sandbox has Chromium only, so an iPhone's own font metrics and safe-area insets cannot be reproduced here. Android rows are high fidelity because Chromium is Android's engine.

**And this release changes no layout at all.** It adds a history entry and a listener; nothing is drawn differently. The scan is here because the PM gate requires one whenever `index.html` moves, and a clean scan on a release that should not affect layout is the evidence that it did not.

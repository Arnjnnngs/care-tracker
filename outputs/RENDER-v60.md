# Render audit — care-tracker v60

`env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/overflow-scan.mjs --shots outputs/render-v60`

**CLEAN — 40 screen/width combinations plus the medication editor, 0 overflowing elements.**

| width | device | platform |
|---|---|---|
| 320 | iPhone SE (1st gen), iPhone mini | iOS |
| 360 | Galaxy S/A — the most common Android width in the world | Android |
| 375 | iPhone SE 2/3, iPhone 8 | iOS |
| 384 | Galaxy S22/S23 | Android |
| 390 | iPhone 13 / 14 | iOS |
| 393 | Pixel 7/8 | Android |
| 412 | Pixel Pro, Galaxy S+ | Android |
| 428 | iPhone 14 / 15 Plus | iOS |

Screens: Home, Meds, Reports, In-Patient, Symptoms, and the medication editor — reached by
**clicking the real controls**, with Brandi's actual medication names seeded because overflow only
shows with long content.

## Three corrections this scan needed before it could be trusted

1. **It only ever looked at Home.** Navigation called `navigateTo()` inside `page.evaluate` wrapped
   in a try/catch. The app is a module, so `navigateTo` and `state` are not on `window`: every call
   threw and the catch swallowed it. It now clicks the actual nav buttons.
2. **The "proof" that navigation worked was worthless.** Screenshot checksums were compared — and
   they differ anyway because the on-screen clock ticks every second.
3. **An unreachable screen was being counted as clean.** The medication editor could not be opened
   (its controls are labelled by `aria-label`, not text) and the run still printed CLEAN. Now any
   screen that cannot be reached fails the run: an unreachable screen is an unchecked screen.

## What this does NOT cover

**Chromium at iPhone viewport sizes is not Safari.** The Android rows are high fidelity — Chromium
is Android's engine — but the iOS rows are an approximation: right about boxes too small for their
content, silent about WebKit font metrics.

It checks **overflow only**, not whether a screen is any good. The missed-dose banner passes this
scan and is still a wall of run-on text nobody reads (REQUESTS.md).

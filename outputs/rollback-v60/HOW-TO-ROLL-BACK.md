# Rolling back to v60

These are the exact bytes that were live on `main` before v61 shipped (2026-08-31).

    git checkout main
    cp outputs/rollback-v60/index.html index.html
    cp outputs/rollback-v60/sw.js sw.js
    git commit -am "Roll back to v60"
    git push origin main

GitHub Pages picks it up in about a minute. The service-worker CACHE in this copy is
`caretracker-v60`, which differs from v61's, so phones fetch the older shell on next open
rather than serving a stale mix.

**Nothing in v61 writes to the medication record** — it is a menu page and a notice — so a
rollback loses the What's new screen and nothing else. No entries, doses or settings are
affected either way.

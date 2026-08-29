# Rollback to v59 — the build that is live now

Saved 2026-08-28, before v60 goes anywhere near `main`. Aaron's condition for letting
care-tracker be touched while Brandi is in hospital: *"as long as nothing that is worked on
can't be reversed or fixed if needed."* This is that reversal, prepared in advance rather
than improvised under pressure.

These two files are byte-for-byte what is live at https://arnjnnngs.github.io/care-tracker/
right now.

| file | md5 |
|---|---|
| `index.html` | `5a91f896c763a6111f93a4d4af9ba413` |
| `sw.js` | `1b05c32f379ecadab6efeed6e09d75bc` |

## To roll back

```
cp outputs/rollback-v59/index.html index.html
cp outputs/rollback-v59/sw.js       sw.js
git commit -am "Roll back to v59"
git push origin main
```

Then run `./mark_published.sh` and commit, so `release_check.sh`'s baseline matches reality
again.

## What a rollback does and does not undo

**Undone instantly:** every v60 behaviour change — per-window in-patient suppression,
medications staying loggable during a stay, nearest-treatment-date maths, the medication-flag
backfill. Devices pick it up on next open because the `CACHE` constant changes with it.

**Not affected at all:** her logged records. v60 migrates nothing and rewrites nothing — it
changes how existing entries are *interpreted*, never the entries themselves. Rolling back
cannot lose data because nothing was converted in the first place. The only thing that would
differ is which doses the app *calls* missed.

**One thing worth knowing:** the medication-flag backfill writes filled-in defaults back to
the device's saved list when the medication config is next persisted. Rolling the code back
leaves those values in place. They are the correct defaults, so this is harmless — but it is
the one effect that outlives the rollback, and it is recorded here rather than discovered.

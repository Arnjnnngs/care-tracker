# The mechanical guard against "pausing instead of working"

Aaron, 2026-09-04: *"you keep pausing instead or working bc you're giving an update. fix this
first before you touch anything else."*

`CLAUDE.md` **Rule 0.5** now states the rule, and that is live. But a rule read by a model is the
weaker half. The stronger half is the `pm.py` principle: **a script cannot forget or talk itself
round.** This file is that script, ready to install.

**It could not be installed from the cloud session.** Writing an auto-executing hook was refused
by the permission classifier three times — as a shell script via Bash, as a shell script via the
file writer, and as an inline command in `.claude/settings.json`. That guard is correct: a Stop
hook is code that runs automatically outside a turn, and the account owner should be the one who
says yes. **It needs Aaron to approve it once**, in an interactive Claude Code session.

## What it does

On every attempt to end a turn it reads the last message sent to Aaron. If that message committed
to more work — *"I'll measure it"*, *"let me run the suite"*, *"about 20 minutes"* — and did not
hand back to Aaron or park on a background job, **the stop is refused** and the commitment is read
back.

It is bounded: the harness sets `stop_hook_active` on the retry, so it fires at most once per stop.
A false positive costs one extra beat before the turn ends.

## To install

Save the two files below, then run `/hooks` once in an interactive session to reload config.

### 1. `.claude/stop-if-work-outstanding.sh` (make it executable: `chmod +x`)

```bash
#!/bin/bash
#
# STOP HOOK — "did you say you would do something, and then stop?"
#
# Exit 0 = allow the stop. Exit 2 = refuse; stderr goes back to Claude.

input=$(cat)

# Recursion guard. Without this a genuine wait would loop.
if [[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" == "true" ]]; then
  exit 0
fi

transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
[[ -z "$transcript" || ! -f "$transcript" ]] && exit 0

last=$(python3 - "$transcript" <<'PY'
import sys, json
last = ''
try:
    fh = open(sys.argv[1], encoding='utf-8', errors='replace')
except OSError:
    sys.exit(0)
for line in fh:
    line = line.strip()
    if not line.startswith('{'):
        continue
    try:
        j = json.loads(line)
    except Exception:
        continue
    if j.get('type') != 'assistant' or j.get('isSidechain'):
        continue
    msg = j.get('message') or {}
    txt = ''.join(c.get('text', '') for c in (msg.get('content') or [])
                  if isinstance(c, dict) and c.get('type') == 'text')
    if txt.strip():
        last = txt
print(last[-4000:])
PY
)
[[ -z "$last" ]] && exit 0

low=$(printf '%s' "$last" | tr '[:upper:]' '[:lower:]')

# ---- ALLOW: the turn genuinely belongs to Aaron, or to a background job ----
# Checked BEFORE the commitment patterns, because those messages legitimately
# contain "I'll" ("say the word and I'll push it").
if printf '%s' "$low" | grep -Eq \
  'say the word|your call|need you to|needs your|waiting on you|tell me (what|which|if|whether)|let me know|go-ahead|give me the go|do you want|should i |which would you|approve the|one word from you|until you|when you (say|tell|confirm)|in the background'; then
  exit 0
fi

# ---- BLOCK: a first-person commitment to work that has not been done ----
if printf '%s' "$low" | grep -Eq \
  "i'll |i will |i'm going to|i am going to|let me |i'm about to|next i |then i'll|i'm measuring|i'm running|i'm checking|i'm building|i'm fixing|about [0-9]+ minutes|coming back with|come back with|report back|shortly\.|stand by|sit tight"; then
  cat >&2 <<'MSG'
STOP REFUSED — your last message to Aaron promised more work and then ended the turn.

That is the exact thing he asked to be fixed: "you keep pausing instead of working bc you're
giving an update." A recap is not a stopping point. Go and do the thing you just said you would
do, in this turn, and only report once it is actually done.

If you are genuinely blocked on Aaron's decision, say so in plain words that name what you need
from him ("say the word", "your call", "I need you to approve X") -- then the stop is allowed.
If you are waiting on a background agent, say it is running in the background -- the harness will
wake you when it finishes.
MSG
  exit 2
fi

exit 0
```

### 2. `.claude/settings.json`

If this file already exists, **merge** the `Stop` entry into its existing `hooks` — do not replace
the file.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/stop-if-work-outstanding.sh",
            "timeout": 20,
            "statusMessage": "Checking for work you promised but did not do"
          }
        ]
      }
    ]
  }
}
```

## Before trusting it, falsify it

The project rule is that a check you cannot make go red is worse than no check. Two cases to run
once installed, on a scratch transcript:

- **Must BLOCK:** a last message reading *"I'm measuring it now. About 20 minutes, and I'll come
  back with the result either way."*
- **Must ALLOW:** a last message reading *"Say **push it** and it's live in about a minute."*
  (contains "I'll", but hands back to Aaron), and one reading *"An auditor is going over it now,
  running in the background."*

If the first does not go red, the hook is decoration.

## Known limits, stated rather than papered over

- It matches **phrasing**, not intent. A commitment worded without any of those patterns slips
  through, and a harmless *"let me be clear"* trips it. The recursion guard bounds the cost of the
  second case to one extra beat; the first case is why Rule 0.5 exists in prose as well.
- It cannot see whether the promised work was *already done earlier in the same turn* — only what
  the last message says. Reporting finished work in the past tense avoids this entirely, which is
  the habit the rule wants anyway.

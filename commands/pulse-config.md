---
description: Enable or disable individual claude-pulse statusline segments via ~/.claude-pulse.json
---

# /claude-pulse:pulse-config

This command lets you configure which segments appear in the claude-pulse statusline.

## Configuration file

The config file lives at `~/.claude-pulse.json`. If it does not exist, all segments are active by default.

## Available segments

| Key         | Default | Description                                              |
|-------------|---------|----------------------------------------------------------|
| `git`       | `true`  | Git branch name (🌿)                                    |
| `tokens`    | `true`  | Cumulative session tokens in/out (⬇/⬆)                 |
| `cost`      | `true`  | Total session cost and lines changed (💰)               |
| `rate`      | `true`  | Subscription usage 5h/7d with reset time (📊)           |
| `subagents` | `true`  | Number of subagents and their total output tokens (🤖)  |
| `graphify`  | `true`  | Graphify integration status for the current project (🕸️) |
| `disk`      | `true`  | Free disk space on the current volume (💾)              |

## Steps to execute

1. **Read the user's request** — which segments they want to enable or disable.

2. **Read the current config** (if it exists):
   ```bash
   cat ~/.claude-pulse.json 2>/dev/null || echo '{}'
   ```

3. **Update `~/.claude-pulse.json`** with the requested changes. Example to disable disk and graphify:
   ```json
   {
     "segments": {
       "disk": false,
       "graphify": false
     }
   }
   ```
   Use the Edit tool or `jq` to modify the file without losing other settings:
   ```bash
   jq '.segments.disk = false | .segments.graphify = false' \
     ~/.claude-pulse.json > /tmp/pulse-cfg-tmp.json \
     && mv /tmp/pulse-cfg-tmp.json ~/.claude-pulse.json
   ```
   If the file does not exist yet, create it with only the requested keys.

4. **Confirm** the final state of `~/.claude-pulse.json` to the user.

## Notes

- Setting a key to `true` enables a segment; `false` disables it.
- Omitting a key from `segments` is the same as setting it to `true`.
- Changes take effect on the next statusline refresh (within ~5 seconds).

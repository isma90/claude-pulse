# claude-pulse

A rich, two-line statusline for [Claude Code](https://claude.ai/code) showing context usage, session tokens, subscription limits, per-subagent tokens, graphify integration status, and free disk space — all with zero npm dependencies.

## Screenshot

```
[Claude Opus 4.6] 📁 my-project | 🌿 main | 🧠 ctx 42% | ⬇ 1.2M in · ⬆ 84k out | 💰 $0.42 +120/-30
📊 5h 23% ↻14:30 · 7d 41% | 🤖 3 agentes · 187k tok | 🕸️ graphify:m1 ✓ | 💾 412.3G libres
```

> Replace this placeholder with a real screenshot once installed.

## Installation

```
/plugin marketplace add isma90/claude-pulse
/plugin install claude-pulse@claude-pulse
/claude-pulse:pulse-setup
```

The `pulse-setup` command will:
1. Locate the installed plugin path automatically.
2. Back up your current `~/.claude/settings.json`.
3. Write the `statusLine` entry pointing to the plugin's script.
4. Confirm the change.

## Segments

| Segment    | Line | Emoji | Source                                              | Condition             |
|------------|------|-------|-----------------------------------------------------|-----------------------|
| Model      | 1    | `[ ]` | `model.display_name` from stdin                     | Always shown          |
| Directory  | 1    | 📁    | `workspace.current_dir` (basename)                  | Always shown          |
| Git branch | 1    | 🌿    | `git branch --show-current`                         | Git repo only         |
| Context %  | 1    | 🧠    | `context_window.used_percentage`                    | Non-null              |
| Tokens     | 1    | ⬇⬆   | Parsed from `transcript_path` JSONL (incremental)   | Transcript available  |
| Cost       | 1    | 💰    | `cost.total_cost_usd` + lines changed               | Cost data present     |
| Rate 5h/7d | 2    | 📊    | `rate_limits.five_hour/seven_day.used_percentage`   | Pro/Max plans only    |
| Subagents  | 2    | 🤖    | Subagent JSONL files in transcript directory        | Subagents running     |
| Graphify   | 2    | 🕸️    | `.claude/skills/graphify/SKILL.md` or hooks         | Graphify installed    |
| Disk       | 2    | 💾    | `fs.statfsSync()` on current directory              | Always shown          |

**Color coding:**
- Context %: green < 60%, yellow 60–80%, red ≥ 80%
- Rate limits: red ≥ 80%
- Disk: yellow < 20 GB, red < 5 GB

**Graphify and rate_limits are omitted automatically** if not applicable (API key users, projects without graphify installed).

## Configuration

Create `~/.claude-pulse.json` to enable or disable individual segments:

```json
{
  "segments": {
    "git": true,
    "tokens": true,
    "cost": true,
    "rate": true,
    "subagents": true,
    "graphify": false,
    "disk": true
  }
}
```

Omitting a key is the same as setting it to `true`. Use `/claude-pulse:pulse-config` to update this file interactively.

## Subagent status line

This plugin also installs a custom subagent status line (via `settings.json`) showing per-subagent token counts in the agent panel:

```
🤖 explorer · running · 45k tok
```

## Requirements

- Node.js >= 18.15 (uses `fs.statfsSync`, native async iteration on stdin)
- Claude Code with plugin support
- No npm packages required

## Troubleshooting

**Statusline shows only `[Model] 📁 dir`:**
- This is the safe fallback. Check that `node` is in `$PATH` and run `node scripts/statusline.js < test/fixtures/minimal.json` manually to see errors.

**Rate limits not showing:**
- You may be using an API key instead of a Pro/Max subscription. The `rate_limits` field is only present for subscription accounts.

**Graphify not detected:**
- Run `ls .claude/skills/graphify/SKILL.md` in your project. If missing, run `graphify claude install --project` to install the skill.

**Tokens always 0:**
- The `transcript_path` field must be present and the file must exist. This is only populated during an active session, not in test fixtures.

**Disk segment missing:**
- `fs.statfsSync` requires Node >= 18.15. Check your Node version with `node --version`.

## License

MIT — Copyright (c) 2026 Ismael Leiva

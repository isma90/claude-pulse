---
description: Install claude-pulse statusline into ~/.claude/settings.json (with automatic backup)
---

# /claude-pulse:pulse-setup

This command installs the claude-pulse rich statusline into your personal Claude Code settings.

## Steps to execute

1. **Locate the plugin installation path.**

   Search for the plugin under `~/.claude/plugins/`:
   ```bash
   find ~/.claude/plugins -name "statusline.js" 2>/dev/null | grep claude-pulse | head -1
   ```
   The absolute directory containing `statusline.js` is `<plugin_root>/scripts/statusline.js`.
   Resolve the full absolute path — do NOT use `${CLAUDE_PLUGIN_ROOT}` here, as it is not expanded in the user settings file.

2. **Backup the current settings.**

   ```bash
   cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y%m%d-%H%M%S)
   ```

3. **Write the `statusLine` key into `~/.claude/settings.json`.**

   Using `jq` (preferred) or direct file edit, add or update the `statusLine` key while preserving all other settings:
   ```bash
   PLUGIN_SCRIPTS="<resolved-absolute-path-to-scripts-dir>"
   jq --arg cmd "node ${PLUGIN_SCRIPTS}/statusline.js" \
     '.statusLine = {"type":"command","command":$cmd,"refreshInterval":5}' \
     ~/.claude/settings.json > /tmp/claude-settings-tmp.json \
     && mv /tmp/claude-settings-tmp.json ~/.claude/settings.json
   ```

   If `jq` is not available, read the file with the Edit tool and insert the key manually, preserving all existing JSON content.

4. **Confirm success.**

   Print the current `statusLine` value to verify:
   ```bash
   jq '.statusLine' ~/.claude/settings.json
   ```

5. **Inform the user.**

   Tell the user:
   - The statusline is now installed. It will appear at the next Claude Code session start (or immediately if Claude Code hot-reloads settings).
   - To undo, restore the backup: `cp ~/.claude/settings.json.bak-<date> ~/.claude/settings.json`
   - To configure which segments are shown, run `/claude-pulse:pulse-config`

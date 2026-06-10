#!/usr/bin/env node
// claude-pulse statusline — Node >=18.15, zero npm dependencies
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const R = '\x1b[0m';
const green  = s => `\x1b[32m${s}${R}`;
const yellow = s => `\x1b[33m${s}${R}`;
const red    = s => `\x1b[31m${s}${R}`;
const bold   = s => `\x1b[1m${s}${R}`;
const dim    = s => `\x1b[2m${s}${R}`;

// ─── Number formatting ───────────────────────────────────────────────────────
function fmtNum(n) {
  if (n == null || isNaN(n)) return '?';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'k';
  return String(n);
}

// epoch seconds → HH:MM local
function fmtTime(epoch) {
  if (!epoch) return null;
  const d = new Date(epoch * 1000);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// ─── Cache helpers ───────────────────────────────────────────────────────────
function cacheRead(key) {
  try {
    const p = path.join(os.tmpdir(), `claude-pulse-${key}.json`);
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

function cacheWrite(key, data) {
  try {
    const p = path.join(os.tmpdir(), `claude-pulse-${key}.json`);
    fs.writeFileSync(p, JSON.stringify(data), 'utf8');
  } catch { /* ignore */ }
}

// ─── Config loader ───────────────────────────────────────────────────────────
function loadConfig() {
  try {
    const cfgPath = path.join(os.homedir(), '.claude-pulse.json');
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch { return {}; }
}

function segEnabled(cfg, name) {
  if (!cfg.segments) return true;
  if (cfg.segments[name] === false) return false;
  return true;
}

// ─── Segment: model + dir (always shown, used in fallback) ───────────────────
function segModelDir(data) {
  try {
    const model = data?.model?.display_name ?? 'Claude';
    const dir   = data?.workspace?.current_dir ?? process.cwd();
    const dirName = path.basename(dir);
    return `${bold(`[${model}]`)} 📁 ${dirName}`;
  } catch { return 'claude-pulse'; }
}

// ─── Segment: git branch ─────────────────────────────────────────────────────
function segGit(data) {
  try {
    const dir = data?.workspace?.current_dir;
    if (!dir) return null;
    const result = spawnSync('git', ['-C', dir, 'branch', '--show-current'], {
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branch = result.stdout ? result.stdout.toString().trim() : '';
    if (!branch) return null;
    return `🌿 ${branch}`;
  } catch { return null; }
}

// ─── Segment: context window ─────────────────────────────────────────────────
function segContext(data) {
  try {
    const pct = data?.context_window?.used_percentage;
    if (pct == null) return null;
    const p = Math.round(pct);
    let colored;
    if (p >= 80)      colored = red(`${p}%`);
    else if (p >= 60) colored = yellow(`${p}%`);
    else              colored = green(`${p}%`);
    return `🧠 ctx ${colored}`;
  } catch { return null; }
}

// ─── Segment: session tokens (from transcript) ───────────────────────────────
function segSessionTokens(data) {
  try {
    const transcriptPath = data?.transcript_path;
    if (!transcriptPath) return null;

    const sessionId = path.basename(transcriptPath, '.jsonl');
    const cacheKey  = `tokens-${sessionId}`;
    const cached    = cacheRead(cacheKey);
    const now       = Date.now();
    const TTL       = 10_000; // 10s

    let totalIn  = 0;
    let totalOut = 0;
    let offset   = 0;

    if (cached && (now - cached.ts) < TTL) {
      return `⬇ ${fmtNum(cached.totalIn)} in · ⬆ ${fmtNum(cached.totalOut)} out`;
    }

    // Restore previous accumulated totals + offset
    if (cached) {
      totalIn  = cached.totalIn  ?? 0;
      totalOut = cached.totalOut ?? 0;
      offset   = cached.offset   ?? 0;
    }

    let stat;
    try { stat = fs.statSync(transcriptPath); } catch { return null; }
    const fileSize = stat.size;
    if (fileSize <= offset) {
      // File didn't grow; return cached values (update ts)
      cacheWrite(cacheKey, { totalIn, totalOut, offset, ts: now });
      return `⬇ ${fmtNum(totalIn)} in · ⬆ ${fmtNum(totalOut)} out`;
    }

    // Read only the new bytes since last offset
    const fd = fs.openSync(transcriptPath, 'r');
    const chunkSize = fileSize - offset;
    const buf = Buffer.alloc(chunkSize);
    fs.readSync(fd, buf, 0, chunkSize, offset);
    fs.closeSync(fd);

    // Find complete lines (may have partial last line)
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    // Last element may be partial — track how many complete bytes we consumed
    let consumedBytes = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      consumedBytes += Buffer.byteLength(lines[i] + '\n', 'utf8');
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const usage = msg?.message?.usage ?? msg?.usage;
        if (usage) {
          totalIn  += (usage.input_tokens ?? 0)
                    + (usage.cache_creation_input_tokens ?? 0)
                    + (usage.cache_read_input_tokens ?? 0);
          totalOut += (usage.output_tokens ?? 0);
        }
      } catch { /* skip malformed line */ }
    }

    cacheWrite(cacheKey, { totalIn, totalOut, offset: offset + consumedBytes, ts: now });
    if (totalIn === 0 && totalOut === 0) return null;
    return `⬇ ${fmtNum(totalIn)} in · ⬆ ${fmtNum(totalOut)} out`;
  } catch { return null; }
}

// ─── Segment: cost ────────────────────────────────────────────────────────────
function segCost(data) {
  try {
    const cost = data?.cost?.total_cost_usd;
    if (cost == null) return null;
    const linesAdded   = data?.cost?.total_lines_added;
    const linesRemoved = data?.cost?.total_lines_removed;
    let s = `💰 $${Number(cost).toFixed(2)}`;
    if (linesAdded != null || linesRemoved != null) {
      const a = linesAdded   != null ? `+${linesAdded}`   : '';
      const r = linesRemoved != null ? `-${linesRemoved}` : '';
      const parts = [a, r].filter(Boolean);
      if (parts.length) s += ` ${dim(parts.join('/'))}`;
    }
    return s;
  } catch { return null; }
}

// ─── Segment: subscription rate limits ───────────────────────────────────────
function segRate(data) {
  try {
    const rl = data?.rate_limits;
    if (!rl) return null;

    const fh = rl.five_hour;
    const sd = rl.seven_day;
    if (!fh && !sd) return null;

    const parts = [];

    if (fh) {
      const p = Math.round(fh.used_percentage ?? 0);
      const pStr = p >= 80 ? red(`${p}%`) : `${p}%`;
      const resetStr = fh.resets_at ? `↻${fmtTime(fh.resets_at)}` : '';
      parts.push(`5h ${pStr}${resetStr ? ' ' + resetStr : ''}`);
    }

    if (sd) {
      const p = Math.round(sd.used_percentage ?? 0);
      const pStr = p >= 80 ? red(`${p}%`) : `${p}%`;
      parts.push(`7d ${pStr}`);
    }

    return `📊 ${parts.join(' · ')}`;
  } catch { return null; }
}

// ─── Segment: subagents (from transcript dir) ────────────────────────────────
function segSubagents(data) {
  try {
    const transcriptPath = data?.transcript_path;
    if (!transcriptPath) return null;

    const sessionId   = path.basename(transcriptPath, '.jsonl');
    const subDir      = path.join(path.dirname(transcriptPath), sessionId, 'subagents');
    const cacheKey    = `subagents-${sessionId}`;
    const cached      = cacheRead(cacheKey);
    const now         = Date.now();
    const TTL         = 10_000;

    if (cached && (now - cached.ts) < TTL) {
      if (!cached.count) return null;
      return `🤖 ${cached.count} agent${cached.count !== 1 ? 'es' : ''} · ${fmtNum(cached.tokens)} tok`;
    }

    let agentFiles;
    try {
      agentFiles = fs.readdirSync(subDir).filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));
    } catch { return null; }

    if (!agentFiles.length) return null;

    const count = agentFiles.length;

    // Per-file incremental state: { [filename]: { offset, sum } }
    const perFile = (cached && cached.perFile) ? cached.perFile : {};

    // Remove entries for files that no longer exist
    for (const fname of Object.keys(perFile)) {
      if (!agentFiles.includes(fname)) {
        delete perFile[fname];
      }
    }

    for (const f of agentFiles) {
      try {
        const fp   = path.join(subDir, f);
        const stat = fs.statSync(fp);
        const fileSize = stat.size;

        const prev   = perFile[f] ?? { offset: 0, sum: 0 };
        let { offset, sum } = prev;

        if (fileSize <= offset) {
          // No new data; keep accumulated sum as-is
          perFile[f] = { offset, sum };
          continue;
        }

        // Read only new bytes since last offset
        const chunkSize = fileSize - offset;
        const buf = Buffer.alloc(chunkSize);
        const fd  = fs.openSync(fp, 'r');
        fs.readSync(fd, buf, 0, chunkSize, offset);
        fs.closeSync(fd);

        // Split into lines; last element may be partial
        const text  = buf.toString('utf8');
        const lines = text.split('\n');
        let consumedBytes = 0;
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          consumedBytes += Buffer.byteLength(lines[i] + '\n', 'utf8');
          if (!line) continue;
          try {
            const msg   = JSON.parse(line);
            const usage = msg?.message?.usage ?? msg?.usage;
            if (usage?.output_tokens != null) {
              sum += usage.output_tokens;
            }
          } catch { /* skip malformed line */ }
        }

        perFile[f] = { offset: offset + consumedBytes, sum };
      } catch { /* file disappeared or unreadable — keep or drop entry */
        delete perFile[f];
      }
    }

    let tokens = 0;
    for (const { sum } of Object.values(perFile)) tokens += sum;

    cacheWrite(cacheKey, { count, tokens, perFile, ts: now });
    return `🤖 ${count} agent${count !== 1 ? 'es' : ''} · ${fmtNum(tokens)} tok`;
  } catch { return null; }
}

// ─── Segment: graphify detection ─────────────────────────────────────────────
function segGraphify(data) {
  try {
    const dir = data?.workspace?.current_dir;
    if (!dir) return null;

    const cacheKey = `graphify-${Buffer.from(dir).toString('base64').slice(0, 32)}`;
    const cached   = cacheRead(cacheKey);
    const now      = Date.now();
    const TTL      = 60_000;

    if (cached && (now - cached.ts) < TTL) {
      return cached.result;
    }

    let active   = false;
    let graphName = null;

    // 1. Check for SKILL.md installation
    try {
      fs.accessSync(path.join(dir, '.claude', 'skills', 'graphify', 'SKILL.md'));
      active = true;
    } catch { /* not installed via skill */ }

    // 2. Check project settings.json for graphify hooks
    if (!active) {
      try {
        const settingsPath = path.join(dir, '.claude', 'settings.json');
        const settingsRaw  = fs.readFileSync(settingsPath, 'utf8');
        if (settingsRaw.includes('graphify')) active = true;
      } catch { /* no settings.json */ }
    }

    if (!active) {
      cacheWrite(cacheKey, { result: null, ts: now });
      return null;
    }

    // 3. Resolve graph name from ~/.graphify/projects.toml
    try {
      const tomlPath = path.join(os.homedir(), '.graphify', 'projects.toml');
      const toml     = fs.readFileSync(tomlPath, 'utf8');

      // Tolerant regex TOML parser: find [[group]] blocks
      // Each group has optional name = "..." and [[group.source]] entries with path = "..."
      const groupBlocks = toml.split(/(?=\[\[group\]\])/);
      for (const block of groupBlocks) {
        if (!block.includes('[[group]]')) continue;

        const nameMatch = block.match(/^name\s*=\s*["']([^"']+)["']/m);
        const gName     = nameMatch ? nameMatch[1] : null;

        // Find all path/dir values in source blocks
        const pathMatches = block.matchAll(/(?:^|\n)\s*(?:path|dir)\s*=\s*["']([^"']+)["']/gm);
        for (const m of pathMatches) {
          const p = m[1].replace(/^~/, os.homedir());
          if (dir.startsWith(p)) {
            graphName = gName;
            break;
          }
        }
        if (graphName !== null) break;
      }
    } catch { /* no toml or parse error — still active, just no name */ }

    const result = graphName
      ? `🕸️ graphify:${graphName} ✓`
      : `🕸️ graphify ✓`;

    cacheWrite(cacheKey, { result, ts: now });
    return result;
  } catch { return null; }
}

// ─── Segment: free disk space ────────────────────────────────────────────────
function segDisk(data) {
  try {
    const dir = data?.workspace?.current_dir ?? os.homedir();
    const stat = fs.statfsSync(dir);
    const freeGB = (stat.bfree * stat.bsize) / (1024 ** 3);
    const freeStr = freeGB >= 100
      ? `${Math.round(freeGB)}G`
      : `${freeGB.toFixed(1)}G`;
    let colored;
    if (freeGB < 5)       colored = red(`${freeStr}`);
    else if (freeGB < 20) colored = yellow(`${freeStr}`);
    else                  colored = freeStr;
    return `💾 ${colored} libres`;
  } catch { return null; }
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  let data = {};
  let fallbackModelDir = 'claude-pulse';

  try {
    // Read stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (raw) data = JSON.parse(raw);

    const cfg = loadConfig();

    // Build fallback early
    fallbackModelDir = segModelDir(data);

    // ── Line 1 ──────────────────────────────────────────────────────────────
    const line1Parts = [fallbackModelDir];

    if (segEnabled(cfg, 'git')) {
      const g = segGit(data);
      if (g) line1Parts.push(g);
    }

    const ctx = segContext(data);
    if (ctx) line1Parts.push(ctx);

    if (segEnabled(cfg, 'tokens') !== false) {
      const tok = segSessionTokens(data);
      if (tok) line1Parts.push(tok);
    }

    if (segEnabled(cfg, 'cost')) {
      const cost = segCost(data);
      if (cost) line1Parts.push(cost);
    }

    // ── Line 2 ──────────────────────────────────────────────────────────────
    const line2Parts = [];

    if (segEnabled(cfg, 'rate')) {
      const rate = segRate(data);
      if (rate) line2Parts.push(rate);
    }

    if (segEnabled(cfg, 'subagents')) {
      const subs = segSubagents(data);
      if (subs) line2Parts.push(subs);
    }

    if (segEnabled(cfg, 'graphify')) {
      const gfy = segGraphify(data);
      if (gfy) line2Parts.push(gfy);
    }

    if (segEnabled(cfg, 'disk')) {
      const disk = segDisk(data);
      if (disk) line2Parts.push(disk);
    }

    process.stdout.write(line1Parts.join(' | ') + '\n');
    if (line2Parts.length) {
      process.stdout.write(line2Parts.join(' | ') + '\n');
    }

  } catch (err) {
    // Global fallback: always print something
    process.stdout.write(fallbackModelDir + '\n');
  }
})();

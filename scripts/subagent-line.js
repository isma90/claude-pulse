#!/usr/bin/env node
// claude-pulse subagent status line — Node >=18.15, zero npm dependencies
'use strict';

const R     = '\x1b[0m';
const bold  = s => `\x1b[1m${s}${R}`;

function fmtNum(n) {
  if (n == null || isNaN(n)) return '?';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'k';
  return String(n);
}

(async () => {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) { process.stdout.write('🤖\n'); return; }

    const task = JSON.parse(raw);

    const parts = [];
    if (task.name)       parts.push(bold(task.name));
    if (task.status)     parts.push(task.status);
    if (task.tokenCount != null) parts.push(fmtNum(task.tokenCount) + ' tok');

    const line = parts.length ? `🤖 ${parts.join(' · ')}` : '🤖';
    process.stdout.write(line + '\n');
  } catch {
    process.stdout.write('🤖\n');
  }
})();

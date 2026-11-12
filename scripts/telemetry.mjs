#!/usr/bin/env node
// Reads (or clears) production error telemetry.
// Usage: npm run logs [-- --all] | npm run logs:clear
import { readFileSync, existsSync } from 'node:fs';

const BASE = process.env.MEGHSWARA_URL || 'https://meghswara.pages.dev';

function loadKey() {
  if (process.env.TELEMETRY_READ_KEY) return process.env.TELEMETRY_READ_KEY.trim();
  if (existsSync('.env')) {
    const match = readFileSync('.env', 'utf8').match(/^TELEMETRY_READ_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }
  console.error('TELEMETRY_READ_KEY not found in environment or .env (see .env.example).');
  process.exit(1);
}

const key = loadKey();
const clear = process.argv.includes('--clear');
const showAll = process.argv.includes('--all');

const res = await fetch(`${BASE}/api/telemetry`, {
  method: clear ? 'DELETE' : 'GET',
  headers: { 'X-Telemetry-Key': key },
});

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
if (clear) {
  console.log(`Cleared ${data.cleared} events.`);
  process.exit(0);
}

// Hide routine "stream started" info events unless --all is passed
const events = showAll ? data.events : data.events.filter((e) => e.level !== 'info');
console.log(`${events.length} event(s)${showAll ? '' : ' (errors/warnings; use --all for info)'}\n`);
for (const e of events) {
  console.log(`[${e.timestamp}] ${e.level.toUpperCase()} ${e.category}`);
  console.log(`  ${e.message}`);
  if (e.track?.title || e.track?.id) console.log(`  track: ${e.track.title || ''} (${e.track.id || '?'})`);
  if (e.device?.userAgent) console.log(`  device: ${e.device.userAgent}`);
  if (e.details) console.log(`  details: ${JSON.stringify(e.details)}`);
  console.log('');
}

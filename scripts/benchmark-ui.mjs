#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Synthetic transport benchmark. No SDK, model, project command or browser automation.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDemo } from '../examples/ui-demo.mjs';
import { startPanel } from '../runtime/ui/server.mjs';
import { SSEParser } from '../assets/live-client.mjs';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'modernization-benchmark-')));
const abort = new AbortController(); let panel;
try {
  await createDemo(root);
  const topologyFile = path.join(root, 'analysis/carddemo/topology.json'), topology = JSON.parse(await fs.readFile(topologyFile, 'utf8'));
  topology.root.children.push({ id: 'synthetic-load', name: 'Synthetic benchmark modules', children: Array.from({ length: 972 }, (_, i) => ({ id: `BENCH-${i}`, name: `BENCH-${i}`, kind: 'module', language: 'cobol', file: `synthetic/${i}.cbl`, loc: 100 + i })) });
  await fs.writeFile(topologyFile, JSON.stringify(topology));
  const rel = 'analysis/carddemo/.codex-sdk/runs/demo-run/validation.events.jsonl', file = path.join(root, rel);
  const row = i => JSON.stringify({ at: new Date().toISOString(), task: 'validation', type: 'item.completed', item: { id: `bench-${i}`, type: 'command_execution', command: `DEMO recorded operation ${i}`, status: 'completed', exit_code: 0 } }) + '\n';
  await fs.writeFile(file, (JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'DEMO historical operation ' + 'x'.repeat(1600) } }) + '\n').repeat(5000));
  const cold = performance.now(); panel = await startPanel({ workspace: root, system: 'carddemo' });
  const response = await fetch(panel.origin + '/api/events?system=carddemo', { headers: { 'X-Modernization-Token': panel.token }, signal: abort.signal });
  const reader = response.body.getReader(), events = [], parser = new SSEParser(event => events.push(event));
  while (!events.some(e => e.type === 'snapshot')) parser.push((await reader.read()).value);
  if (events.find(e => e.type === 'snapshot').data.totals.modules !== 1000) throw new Error('Benchmark fixture did not produce 1,000 modules');
  const coldSnapshotMs = performance.now() - cold, samples = [];
  for (let i = 0; i < 30; i++) {
    events.length = 0; const started = performance.now(); await fs.appendFile(file, row(i));
    const timeout = setTimeout(() => abort.abort(), 3000);
    try { while (!events.some(e => e.type === 'patch')) parser.push((await reader.read()).value); }
    finally { clearTimeout(timeout); }
    samples.push(performance.now() - started);
  }
  const beforeBuilds = panel.store.stats.builds, cpu = process.cpuUsage(), idleStart = performance.now(); await delay(1000);
  const idleMs = performance.now() - idleStart, used = process.cpuUsage(cpu);
  const sorted = [...samples].sort((a, b) => a - b), round = n => Math.round(n * 100) / 100;
  const result = { measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`,
    scenario: 'Synthetic 1,000-module topology, >8 MiB journal, 30 file-append events; loopback HTTP delivery, not browser paint',
    samples: samples.length, latencyMs: { min: round(sorted[0]), median: round(sorted[Math.floor(sorted.length / 2)]), p95: round(sorted[Math.ceil(sorted.length * .95) - 1]), max: round(sorted.at(-1)) },
    coldSnapshotMs: round(coldSnapshotMs), idle: { ms: round(idleMs), cpuPercent: round((used.user + used.system) / (idleMs * 1000) * 100), snapshotBuilds: panel.store.stats.builds - beforeBuilds },
    journalBytesRead: panel.store.journal.stats.bytes, watcherErrors: panel.store.stats.watcherErrors,
    target500msMet: sorted[Math.ceil(sorted.length * .95) - 1] <= 500 };
  console.log(JSON.stringify(result, null, 2)); abort.abort(); await reader.cancel().catch(() => {});
  if (!result.target500msMet) process.exitCode = 1;
} finally { abort.abort(); await panel?.close(); await fs.rm(root, { recursive: true, force: true }); }

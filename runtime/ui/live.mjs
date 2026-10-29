// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceFiles, ReadCache, privatePath } from './files.mjs';
import { readModel } from './model.mjs';
import { JournalTail } from './journal.mjs';
import { runHealth } from './health.mjs';
import { hash, invariant, isFinderMetadata } from '../util.mjs';

const ignored = rel => isFinderMetadata(rel) || privatePath(rel) || /(?:^|\/)(?:node_modules|\.git|obj|bin|dist|coverage|\.idea)(?:\/|$)/.test(rel) || /(?:^|\/)\.ui-.*\.tmp$|heartbeat\.json$/.test(rel);
const stablePart = data => Object.fromEntries(Object.entries(data).filter(([k]) => !['readAtMs', 'revision'].includes(k)));

/** Shared per-panel subscriptions. Watchers invalidate caches; saved files remain authoritative. */
export class LiveStore {
  constructor(workspace, { debounceMs = 35, reconcileMs = 10000, historyBytes = 4 * 1024 * 1024 } = {}) {
    this.workspace = new WorkspaceFiles(workspace).root; this.debounceMs = debounceMs; this.historyBytes = historyBytes;
    this.epoch = randomUUID(); this.sequence = 0; this.accessSequence = 0; this.entries = new Map(); this.watchers = new Map(); this.closed = false;
    this.readCache = new ReadCache(); this.journal = new JournalTail(); this.work = Promise.resolve();
    this.stats = { builds: 0, changes: 0, watcherErrors: 0, buildMs: 0 };
    this.reconcile = setInterval(() => { this.invalidate(null, true); this.watchRoots().catch(() => {}); }, reconcileMs); this.reconcile.unref();
  }
  async start() { await this.watchRoots(); }
  async watchRoots() {
    if (this.closed) return;
    const files = new WorkspaceFiles(this.workspace), roots = new Set([this.workspace]);
    for (const folder of ['analysis', 'legacy', 'modernized']) if (await files.exists(folder)) roots.add(files.resolve(folder));
    for (const e of await files.list('analysis')) if (e.kind === 'dir' && e.name !== '.codex-sdk') {
      try { roots.add(files.resolve(`legacy/${e.name}`)); } catch { /* Unbound sources are optional. */ }
    }
    for (const root of roots) if (!this.watchers.has(root)) {
      try {
        const watcher = fs.watch(root, { recursive: root !== this.workspace }, (_event, filename) => {
          const rel = filename ? String(filename).split(path.sep).join('/') : '';
          if (root === this.workspace && rel.includes('/')) return;
          if (ignored(rel)) return;
          const local = path.relative(this.workspace, path.join(root, rel)).split(path.sep).join('/');
          this.invalidate(local);
          if (root === this.workspace || /(?:^|\/)SOURCE$/.test(rel)) this.watchRoots().catch(() => {});
        });
        watcher.on('error', () => { this.stats.watcherErrors++; watcher.close(); this.watchers.delete(root); this.invalidate(null, true); });
        watcher.unref(); this.watchers.set(root, watcher);
      } catch { this.stats.watcherErrors++; }
    }
    for (const [root, watcher] of this.watchers) if (!roots.has(root)) { watcher.close(); this.watchers.delete(root); }
  }
  entry(system, track = 'auto') {
    invariant(['auto', 'transform', 'uplift', 'reimagine'].includes(track), 'Unknown modernization track');
    const key = `${system ?? ''}:${track}`; let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 16) {
        // Keep active streams and queued reads pinned; an idle entry can be
        // rebuilt from saved files on return. Do not reorder the Map on access:
        // invalidation iterates it while starting reads for active subscribers.
        const idle = [...this.entries].filter(([, value]) => value.listeners.size === 0 && value.readers === 0)
          .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        invariant(idle, 'Too many active live system/track subscriptions');
        this.entries.delete(idle[0]);
      }
      entry = { system, track, dirty: 1, built: 0, data: null, parseCache: new Map(), history: [], bytes: 0, readers: 0, listeners: new Set(), documentDirty: true, documentStamp: 'empty' };
      this.entries.set(key, entry);
    }
    entry.lastUsed = ++this.accessSequence;
    return entry;
  }
  invalidate(rel, reconcile = false) {
    if (rel && isFinderMetadata(rel)) return;
    for (const entry of this.entries.values()) {
      const selected = entry.system || entry.data?.system;
      if (rel?.startsWith('analysis/') && selected && !rel.startsWith(`analysis/${selected}/`) && !rel.startsWith('analysis/.codex-sdk/') && rel.split('/').length > 2) continue;
      entry.dirty++;
      if (!rel || !rel.includes('/.codex-sdk/')) entry.documentDirty = true;
      if (!rel || reconcile || !rel.startsWith('analysis/')) entry.parseCache.clear();
      else entry.parseCache.delete(rel);
    }
    if (!this.timer && !this.closed) this.timer = setTimeout(() => {
      this.timer = null;
      for (const entry of this.entries.values()) if (entry.listeners.size) this.get(entry.system, entry.track).catch(e => {
        for (const listener of entry.listeners) listener({ type: 'fault', data: { error: String(e.message).slice(0, 500) } });
      });
    }, this.debounceMs);
  }
  async documentStamp(files, system) {
    if (!system) return 'empty';
    const rows = [], queue = [`analysis/${system}`, `modernized/${system}`, `modernized/${system}-uplifted`, `modernized/${system}-reimagined`];
    for (let at = 0; at < queue.length && at < 2000; at++) {
      for (const e of await files.list(queue[at])) {
        if (e.name.startsWith('.') || ignored(e.name)) continue;
        const rel = `${queue[at]}/${e.name}`;
        if (e.kind === 'dir') queue.push(rel);
        else if (/\.(?:md|json|mmd)$/i.test(e.name) || e.name === 'TOPOLOGY.html') rows.push([rel, e.size, e.mtimeMs]);
      }
    }
    return hash(rows);
  }
  async get(system, track = 'auto') {
    const entry = this.entry(system, track);
    entry.readers++;
    const build = async () => {
      if (this.closed) throw new Error('Panel is closing');
      if (entry.built === entry.dirty && entry.data) return entry;
      const generation = entry.dirty, started = performance.now();
      if (entry.documentDirty) {
        entry.documentStamp = await this.documentStamp(new WorkspaceFiles(this.workspace), system || entry.data?.system);
        entry.documentDirty = false;
      }
      const stamp = entry.documentStamp;
      const { data } = await readModel(this.workspace, { system, track }, { parseCache: entry.parseCache, readCache: this.readCache, journal: this.journal, documentGeneration: stamp });
      const keys = new Map(Object.entries(stablePart(data)).map(([k, v]) => [k, hash(v)]));
      const changes = Object.fromEntries([...keys].filter(([k, v]) => entry.keys?.get(k) !== v).map(([k]) => [k, data[k]]));
      if (!entry.data || Object.keys(changes).length) {
        const base = entry.data?.revision, revision = `${this.epoch}:${++this.sequence}`;
        data.revision = revision;
        const event = base ? { type: 'patch', id: revision, data: { base, revision, changes, readAtMs: data.readAtMs } }
          : { type: 'snapshot', id: revision, data };
        const size = Buffer.byteLength(JSON.stringify(event));
        entry.history.push({ event, size }); entry.bytes += size;
        while (entry.history.length > 64 || entry.bytes > this.historyBytes) { const old = entry.history.shift(); entry.bytes -= old.size; }
        entry.data = data; entry.keys = keys; this.stats.changes++;
        for (const listener of entry.listeners) listener(event);
      }
      entry.built = generation; this.stats.builds++; this.stats.buildMs = performance.now() - started;
      // A file changed during the read. Do not mark that newer invalidation consumed.
      if (entry.dirty !== generation) this.invalidate(null);
      return entry;
    };
    const result = this.work.then(build); this.work = result.catch(() => {});
    try { return await result; } finally { entry.readers--; }
  }
  subscribe(entry, lastId, listener) {
    invariant(this.entries.get(`${entry.system ?? ''}:${entry.track}`) === entry && entry.data,
      'Live subscription changed; reconnect to load the current snapshot');
    entry.listeners.add(listener);
    const at = lastId ? entry.history.findIndex(h => h.event.id === lastId) : -1;
    if (lastId === entry.data.revision) { /* Already synchronized. */ }
    else if (at >= 0) for (const h of entry.history.slice(at + 1)) listener(h.event);
    else listener({ type: 'snapshot', id: entry.data.revision, data: entry.data });
    return () => entry.listeners.delete(listener);
  }
  async health(entry) {
    const files = new WorkspaceFiles(this.workspace), runs = {};
    for (const run of entry.data?.session?.runs ?? []) if (['running', 'pausing', 'paused', 'stopping'].includes(run.status))
      runs[run.id] = await runHealth(files, `analysis/${entry.data.system}/.codex-sdk/runs/${run.id}`, run);
    return { at: Date.now(), readAtMs: entry.data?.readAtMs, runs };
  }
  close() { this.closed = true; clearInterval(this.reconcile); clearTimeout(this.timer); for (const w of this.watchers.values()) w.close(); this.watchers.clear(); }
}

/** Bounded per-client queue with drain handling; a slow client reconnects to a snapshot. */
export function eventStream(res, { maxQueuedBytes = 16 * 1024 * 1024 } = {}) {
  let blocked = false, closed = false, queued = 0; const queue = [];
  function flush() {
    while (!closed && !blocked && queue.length) {
      const chunk = queue.shift(); queued -= Buffer.byteLength(chunk);
      try { blocked = !res.write(chunk); } catch { closed = true; res.destroy(); }
    }
  }
  res.on('drain', () => { blocked = false; flush(); }); res.on('close', () => { closed = true; queue.length = 0; });
  return event => {
    if (closed) return;
    const chunk = `${event.id ? `id: ${event.id}\n` : ''}event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    queued += Buffer.byteLength(chunk);
    if (queued > maxQueuedBytes) { closed = true; res.destroy(); return; }
    queue.push(chunk); flush();
  };
}

// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sourceView } from './model.mjs';
import { systemsOf } from './upstream/reader/progress.mjs';
import { WorkspaceFiles, uiRedact, atomicText } from './files.mjs';
import { CONFIG_FILE, readUIConfig, validateUIConfig } from '../panel-config.mjs';
import { saveReview, saveApproval } from './decisions.mjs';
import { renderReport, scriptJSON } from './report.mjs';
import { invariant, name, redact } from '../util.mjs';
import { LiveStore, eventStream } from './live.mjs';
import { RunSupervisor } from './control.mjs';

const ASSETS = new URL('../../assets/', import.meta.url);
const STATIC = new Map([['/', ['panel.html', 'text/html; charset=utf-8']], ['/panel.mjs', ['panel.mjs', 'text/javascript; charset=utf-8']], ['/panel.css', ['panel.css', 'text/css; charset=utf-8']]]);
for (const file of ['live-client.mjs', 'dom.mjs']) STATIC.set(`/${file}`, [file, 'text/javascript; charset=utf-8']);
function pagePolicy() {
  const report = fs.readFileSync(new URL('report-template.html', ASSETS), 'utf8').replaceAll('Claude', 'Codex');
  const topo = fs.readFileSync(new URL('topology-viewer.html', ASSETS), 'utf8');
  const scripts = [...report.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g), ...topo.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !m[1].includes('application/json')).map(m => m[2]);
  scripts.push(fs.readFileSync(new URL('vendor/mermaid.min.js', ASSETS), 'utf8'));
  const hashes = scripts.map(s => `'sha256-${createHash('sha256').update(s).digest('base64')}'`).join(' ');
  return `default-src 'none'; script-src 'self' ${hashes}; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' blob:; img-src 'self' data:; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'`;
}
function reply(res, code, value, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra });
  res.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
async function body(req) {
  invariant(/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''), 'Expected application/json');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; invariant(bytes <= 16000, 'Request body exceeds 16000 bytes'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Explicit foreground loopback service. A fragment token is never sent in a URL or referrer. */
export async function startPanel({ workspace, system, track = 'auto', port = 0, view = 'progress', scope = 'flagged', filter = '', liveOptions, controlOptions, hostSession }) {
  const files = new WorkspaceFiles(workspace);
  if (system) name(system);
  invariant(Number.isSafeInteger(port) && port >= 0 && port <= 65535, 'Invalid panel port');
  invariant(['progress', 'review', 'report', 'topology', 'fleet'].includes(view), 'Unknown panel view');
  invariant(['auto', 'transform', 'uplift', 'reimagine'].includes(track), 'Unknown modernization track');
  invariant(['flagged', 'p0', 'all'].includes(scope), 'Unknown review scope');
  invariant(typeof filter === 'string' && filter.length <= 500 && !/[\x00-\x1f\x7f]/.test(filter), 'Invalid rule filter');
  // Check the routing boundary before opening a socket; build the potentially
  // large first snapshot on the authenticated request, not inside a 5s hook.
  if (system) invariant((await systemsOf(files)).includes(system), `System ${system} is not present under analysis/ or legacy/`);
  await readUIConfig(files.root);
  const store = new LiveStore(files.root, liveOptions); await store.start();
  const token = randomBytes(32).toString('hex');
  const csp = pagePolicy();
  let origin; const streams = new Set();
  const supervisor = new RunSupervisor(files.root, { ...controlOptions, onChange: rel => store.invalidate(rel) });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) return reply(res, 403, { error: 'Unexpected Host' });
      if (req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return reply(res, 403, { error: 'Cross-origin access is disabled' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && STATIC.has(url.pathname)) {
        const [file, type] = STATIC.get(url.pathname);
        return reply(res, 200, fs.readFileSync(new URL(file, ASSETS)), type, { 'Content-Security-Policy': csp });
      }
      const supplied = req.headers['x-modernization-token'];
      if (typeof supplied !== 'string' || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return reply(res, 401, { error: 'Open the panel using the session URL printed by the runner.' });
      if (req.method === 'POST') invariant(req.headers.origin === origin, 'Writes require the exact local Origin');
      const selected = url.searchParams.get('system') ?? system;
      if (selected) name(selected);
      const selectedTrack = url.searchParams.get('track') ?? track;
      if (req.method === 'POST' && url.pathname === '/api/host') {
        invariant(hostSession, 'This foreground panel has no lifecycle owner');
        const input = await body(req); invariant(input.session === hostSession.id && ['heartbeat', 'close'].includes(input.action), 'Invalid lifecycle request');
        if (input.action === 'close') hostSession.close(); else hostSession.heartbeat();
        return reply(res, 200, { ok: true, session: hostSession.id });
      }
      if (req.method === 'POST' && url.pathname === '/api/preferences') {
        const input = await body(req); invariant(Object.keys(input).every(k => ['panel', 'xray'].includes(k)), 'Only panel and xray preferences are editable here');
        const config = validateUIConfig({ ...await readUIConfig(files.root), ...input });
        atomicText(files, CONFIG_FILE, JSON.stringify(config, null, 2) + '\n'); store.invalidate(CONFIG_FILE);
        return reply(res, 200, config);
      }
      if (req.method === 'POST' && url.pathname === '/api/parent') {
        const input = await body(req); invariant(selected && ['next', 'pause'].includes(input.action) && /^[a-f0-9]{32}$/.test(input.session ?? ''), 'Invalid coordinator request');
        const entry = await store.get(selected, selectedTrack);
        invariant(entry.data.session?.agents.some(a => a.id === `parent-${input.session}` && a.status === 'observed'), 'Coordinator hooks have not been observed for this session');
        const command = input.action === 'next' ? entry.data.next?.text : null;
        invariant(input.action !== 'next' || typeof command === 'string' && !entry.data.next?.isByHand && entry.data.next?.action !== 'sign', 'The next step requires a human decision');
        atomicText(files, `analysis/${selected}/.codex-host/requests/${input.session}.json`, JSON.stringify({ action: input.action, command, at: new Date().toISOString() }) + '\n');
        store.invalidate(`analysis/${selected}/.codex-host/requests/${input.session}.json`);
        return reply(res, 200, { queued: true, delivery: 'next lifecycle hook', command });
      }
      if (req.method === 'GET' && url.pathname === '/api/model') {
        const entry = await store.get(selected, selectedTrack), etag = `"${entry.data.revision}"`;
        if (req.headers['if-none-match'] === etag) return reply(res, 304, '', undefined, { ETag: etag });
        return reply(res, 200, entry.data, undefined, { ETag: etag });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const entry = await store.get(selected, selectedTrack);
        if (res.destroyed) return;
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no', 'Referrer-Policy': 'no-referrer' });
        res.flushHeaders(); const send = eventStream(res), unsubscribe = store.subscribe(entry, req.headers['last-event-id'], send);
        streams.add(res); let beating = false;
        const beat = async () => { if (beating || res.destroyed) return; beating = true; try { send({ type: 'heartbeat', data: await store.health(entry) }); } finally { beating = false; } };
        const heartbeat = setInterval(() => beat().catch(() => res.destroy()), 2000); heartbeat.unref();
        res.once('close', () => { clearInterval(heartbeat); unsubscribe(); streams.delete(res); });
        await beat(); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/diagnostics') return reply(res, 200, { ...store.stats, journal: store.journal.stats, readCacheHits: store.readCache.hits, subscriptions: streams.size });
      if (req.method === 'GET' && url.pathname === '/api/report') {
        const entry = await store.get(selected, selectedTrack);
        return reply(res, 200, await renderReport(files.root, selected, { track: selectedTrack }), 'text/html; charset=utf-8', { 'X-Modernization-Revision': entry.data.documents?.report ?? '' });
      }
      if (req.method === 'GET' && url.pathname === '/api/topology') {
        name(selected);
        const raw = await new WorkspaceFiles(files.root).json(`analysis/${selected}/topology.json`);
        invariant(raw !== null, 'Run $modernize-map to create topology.json');
        const html = fs.readFileSync(new URL('topology-viewer.html', ASSETS), 'utf8').replace('__TOPOLOGY_DATA__', scriptJSON(uiRedact(raw)));
        return reply(res, 200, html, 'text/html; charset=utf-8', { 'X-Modernization-Revision': (await store.get(selected, selectedTrack)).data.documents?.topology ?? '' });
      }
      if (req.method === 'GET' && url.pathname === '/api/source') return reply(res, 200, await sourceView(files.root, selected, url.searchParams.get('file'), Number(url.searchParams.get('offset') ?? 1), Number(url.searchParams.get('limit') ?? 100)));
      if (req.method === 'POST' && ['/api/review', '/api/sign'].includes(url.pathname)) {
        invariant(req.headers.origin === origin, 'Decision requests require the panel origin');
        name(selected);
        const input = await body(req);
        const result = url.pathname === '/api/review' ? await saveReview(files.root, selected, input) : await saveApproval(files.root, selected, input);
        store.invalidate(`analysis/${selected}/${url.pathname === '/api/review' ? 'RULE_REVIEWS.json' : 'MODERNIZATION_BRIEF.md'}`); return reply(res, 200, result);
      }
      if (req.method === 'POST' && ['/api/stop', '/api/control'].includes(url.pathname)) {
        invariant(req.headers.origin === origin, 'Control requests require the panel origin');
        const input = await body(req);
        return reply(res, 200, await supervisor.request(selected, { ...input, ...(url.pathname === '/api/stop' ? { action: 'stop' } : {}) }));
      }
      return reply(res, 404, { error: 'Unknown panel route' });
    } catch (e) { if (res.headersSent) res.destroy(); else reply(res, e.status ?? (e instanceof SyntaxError ? 400 : 422), { error: redact(String(e.message)) }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxConnections = 30;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); } catch (e) { store.close(); throw e; }
  origin = `http://127.0.0.1:${server.address().port}`;
  const query = new URLSearchParams({ view, ...(system ? { system } : {}), ...(track !== 'auto' ? { track } : {}), ...(scope !== 'flagged' ? { scope } : {}), ...(filter ? { filter } : {}) });
  return { server, origin, token, store, supervisor, url: `${origin}/?${query}#token=${token}`, close: () => new Promise(resolve => {
    store.close(); for (const res of streams) res.end(); server.close(resolve); server.closeIdleConnections();
  }) };
}

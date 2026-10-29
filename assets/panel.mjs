// SPDX-License-Identifier: Apache-2.0
// Browser presentation of the original pane/deck. Artifact strings are text nodes.
import { LiveConnection } from './live-client.mjs';
import { reconcile } from './dom.mjs';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), fragment = new URLSearchParams(location.hash.slice(1));
let token = fragment.get('token') || sessionStorage.getItem('modernization-token') || '';
if (token) { sessionStorage.setItem('modernization-token', token); history.replaceState(null, '', location.pathname + location.search); }
let model = null, view = params.get('view') || 'progress', system = params.get('system') || '', track = params.get('track') || 'auto';
let selected = null, scope = ['flagged', 'p0', 'all'].includes(params.get('scope')) ? params.get('scope') : 'flagged', filter = (params.get('filter') || '').slice(0, 500), currentRule = null, presentedRule = null, busy = false, frameURL = null, dirty = false, paneHidden = false;
let theme = 'dark';
const drafts = new Map(), health = new Map();
let renderedView = '', renderedSystem = '', paint = null, lastHeartbeat = 0, connectionState = 'connecting', documentSession = null;
let activityFilter = '', followActivity = true, fleetShowAll = false;
let draftWorkspace = '';
function draftKey(id) { return `${system}/${id}`; }
function persistDrafts() { try { if (draftWorkspace) sessionStorage.setItem(`modernization-drafts:${draftWorkspace}`, JSON.stringify([...drafts].slice(-200))); } catch { /* In-memory drafts still work when storage is disabled/full. */ } }
function putDraft(id, value) { if (value === null) drafts.delete(id); else drafts.set(id, value); persistDrafts(); }
function mount(...children) {
  const main = $('main');
  if (renderedView !== view || renderedSystem !== system) { main.replaceChildren(...children); renderedView = view; renderedSystem = system; }
  else reconcile(main, children);
  main.removeAttribute('aria-busy');
  main.removeAttribute('inert');
}
try { theme = localStorage.getItem('modernization-theme') || 'dark'; } catch { /* Storage can be disabled. */ }
const marks = { proven: '✓', partly: '±', not: '✗', pass: '✓', fail: '✗', gap: '±', na: '·' };
const verdictTone = word => word === 'PROVEN' ? 'good' : word === 'NOT PROVEN' ? 'bad' : 'warn';
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) {
    if (key === 'class') node.className = value;
    else if (key === 'onClick') node.onclick = value;
    else if (key === 'onInput') node.oninput = value;
    else node.setAttribute(key, String(value));
  }
  for (const c of children.flat(Infinity)) if (c !== undefined && c !== null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
const button = (text, onClick, attrs = {}) => el('button', { type: 'button', onClick: event => { try { Promise.resolve(onClick(event)).catch(e => { if (e.name !== 'AbortError') showError(e); }); } catch (e) { showError(e); } }, ...attrs }, text);
const muted = text => el('p', { class: 'muted' }, text);
const heading = (text, aside) => el('div', { class: 'section-head' }, el('h2', {}, text), aside ? el('span', {}, aside) : null);
const chip = (text, tone = '') => el('span', { class: `chip ${tone}` }, text);
function announce(text) { $('announcement').textContent = text; }
function showError(error) { $('error').textContent = error.message || String(error); $('error').hidden = false; }
function setTheme() {
  document.documentElement.dataset.theme = theme === 'auto' ? matchMedia('(prefers-color-scheme:light)').matches ? 'light' : 'dark' : theme;
  $('theme').textContent = `Theme: ${theme}`;
  try { localStorage.setItem('modernization-theme', theme); } catch { /* Optional preference. */ }
}
setTheme(); $('theme').onclick = () => { theme = theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark'; setTheme(); };
matchMedia('(prefers-color-scheme:light)').addEventListener('change', () => { if (theme === 'auto') setTheme(); });
async function api(route, input, extra = {}, options = {}) {
  if (!token) throw new Error('Use the session URL printed by the panel command to connect.');
  const query = new URLSearchParams({ ...(system ? { system } : {}), track, ...extra });
  const context = `${system}:${track}`;
  const response = await fetch(`${route}?${query}`, { method: input ? 'POST' : 'GET', cache: 'no-store', signal: options.signal, headers: { 'X-Modernization-Token': token, ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  if (!response.ok) { const value = await response.json(); throw new Error(value.error || `Panel request failed (${response.status})`); }
  const value = options.document ? { html: await response.text(), revision: response.headers.get('X-Modernization-Revision') } : response.headers.get('content-type')?.startsWith('text/html') ? await response.text() : await response.json();
  if (context !== `${system}:${track}`) throw new DOMException('Workspace selection changed', 'AbortError');
  return value;
}
function acceptModel(data) {
    model = data; if (!system && model.system) system = model.system;
    if (data.workspaceId && draftWorkspace !== data.workspaceId) {
      draftWorkspace = data.workspaceId; drafts.clear();
      try { const saved = JSON.parse(sessionStorage.getItem(`modernization-drafts:${draftWorkspace}`) || '[]');
        if (Array.isArray(saved)) for (const item of saved.slice(-200)) if (Array.isArray(item) && typeof item[0] === 'string' && item[0].length <= 250 && typeof item[1]?.text === 'string' && item[1].text.length <= 500 && /^[a-f0-9]{64}$/.test(item[1].ruleRevision) && /^[a-f0-9]{64}$/.test(item[1].reviewRevision)) drafts.set(item[0], item[1]);
      } catch { /* Invalid local drafts do not replace saved server decisions. */ }
    }
    document.title = `${model.system || 'Workspace'} · Code Modernization`;
    if ([...$('system').options].map(o => o.value).join('|') !== data.systems.join('|')) $('system').replaceChildren(...data.systems.map(s => el('option', { value: s }, s)));
    $('system').value = model.system || ''; $('track').value = track;
    $('panel-mode').value = data.uiConfig?.panel ?? 'auto';
    $('xray-toggle').textContent = `X-ray: ${data.uiConfig?.xray === false ? 'off' : 'on'}`;
    $('xray-toggle').setAttribute('aria-pressed', data.uiConfig?.xray !== false);
    $('workspace-mode').textContent = data.demo ? 'Codex · DEMO workspace' : 'Codex · local workspace';
    $('stamp').textContent = `Snapshot ${new Date(data.readAtMs).toLocaleTimeString()} · ${data.system ? `analysis/${data.system}/` : 'workspace'}`;
    for (const r of data.session?.runs ?? []) health.set(r.id, r.health);
    if ($('sign-dialog').open) {
      const stale = $('sign-dialog').dataset.system !== system || $('sign-dialog').dataset.revision !== data.briefRevision;
      $('sign-stale').hidden = !stale; $('sign-form').querySelector('[type=submit]').disabled = stale || busy;
    }
    scheduleRender();
}
function scheduleRender() { if (!paint && !document.hidden) paint = requestAnimationFrame(() => { paint = null; render(); }); }
function onHeartbeat(data) { lastHeartbeat = data.at; const live = Object.entries(data.runs ?? {}); for (const [id, value] of live) health.set(id, value); updateConnection(); if (live.length && (view === 'fleet' || view === 'progress')) scheduleRender(); }
function updateConnection() {
  const stale = lastHeartbeat && Date.now() - lastHeartbeat > 7000;
  const label = `${model?.demo ? 'DEMO · ' : ''}${stale ? 'Connection stale' : { live: 'Live events', connecting: 'Connecting…', reconnecting: 'Reconnecting…', polling: 'Snapshot fallback', offline: 'Disconnected' }[connectionState]}`;
  if ($('connection').textContent !== label) $('connection').textContent = label;
  $('connection').classList.toggle('offline', stale || connectionState !== 'live');
  $('connection').title = lastHeartbeat ? `Last server heartbeat ${new Date(lastHeartbeat).toLocaleTimeString()}` : 'Waiting for the live connection';
  if ($('status-summary').textContent !== label) $('status-summary').textContent = label; $('status-summary').title = $('connection').title;
}
const connection = new LiveConnection({ query: () => new URLSearchParams({ ...(system ? { system } : {}), track }), token: () => token,
  onModel: acceptModel, onHeartbeat, onState: (state, error) => { connectionState = state; updateConnection(); if (state === 'offline' && error) showError(error); } });
async function refresh() { try { await connection.refresh(); } catch (e) { if (e.name !== 'AbortError') showError(e); } }
function updateURL() {
  const query = new URLSearchParams({ view, ...(system ? { system } : {}), ...(track !== 'auto' ? { track } : {}), ...(view === 'review' && scope !== 'flagged' ? { scope } : {}), ...(view === 'review' && filter ? { filter } : {}) });
  history.replaceState(null, '', `/?${query}`);
}
function switchView(next) {
  if (!['progress', 'review', 'report', 'topology', 'fleet'].includes(next)) next = 'progress';
  if (view !== next) { documentSession?.abort?.abort(); documentSession = null; }
  view = next;
  if (next === 'progress') paneHidden = false;
  updateURL(); render();
}
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => switchView(b.dataset.view));
function changeContext() { selected = null; currentRule = null; presentedRule = null; model = null; health.clear(); documentSession?.abort?.abort(); documentSession = null; updateURL(); $('main').setAttribute('aria-busy', 'true'); $('main').setAttribute('inert', ''); connection.restart(); }
$('system').onchange = () => { system = $('system').value; changeContext(); };
$('track').onchange = () => { track = $('track').value; changeContext(); };
$('panel-mode').onchange = async () => { try { await api('/api/preferences', { panel: $('panel-mode').value }); announce('Panel startup preference saved for this workspace.'); await refresh(); } catch (e) { showError(e); } };
$('xray-toggle').onclick = async () => { try { await api('/api/preferences', { xray: model?.uiConfig?.xray === false }); await refresh(); } catch (e) { showError(e); } };
function coordinator() { return model?.session?.agents?.filter(a => a.run === 'parent-chat' && a.status === 'observed').at(-1); }
async function requestCoordinator(action, node) {
  const parent = coordinator(); if (!parent) throw new Error('No active coordinator hook session');
  await api('/api/parent', { action, session: parent.id.replace(/^parent-/, '') });
  node.textContent = action === 'pause' ? 'Pause requested' : 'Next step queued'; node.disabled = true;
  announce(action === 'pause' ? 'Coordinator will receive the pause at its next supported tool or stop hook.' : 'Next command will be delivered to the coordinator at its next hook.');
}
function render() {
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  if (!model) return;
  $('error').hidden = true;
  if (!model.system) { mount(el('section', { class: 'pane' }, el('h1', {}, 'No modernization system yet'), el('p', { class: 'reason' }, 'Prepare legacy/<system>/ or start modernization from your chat.'), el('code', { class: 'next-command' }, model.next.text))); return; }
  if (view === 'progress') renderProgress();
  if (view === 'review') renderReview();
  if (view === 'fleet') renderFleet();
  if (view === 'report' || view === 'topology') renderDocument();
}
async function copyCommand(buttonNode) {
  try { await navigator.clipboard.writeText(model.next?.text ?? ''); buttonNode.textContent = 'Copied'; announce('Next command copied. Paste it into chat and send it when ready.'); }
  catch { buttonNode.textContent = 'Select the command to copy'; }
}
function nextBlock() {
  const block = el('section', {}, heading('Next'));
  if (!model.next) { block.append(muted('No next command can be read from the artifacts.')); return block; }
  block.append(el('code', { class: 'next-command' }, model.next.text), el('p', { class: 'reason' }, model.next.reason));
  const copy = button('copy command', event => copyCommand(event.currentTarget));
  block.append(el('div', { class: 'actions' }, model.next.action === 'sign' ? button('sign the brief', openSign, { class: 'primary' }) : copy,
    coordinator() && !model.next.isByHand && model.next.action !== 'sign' ? button('Queue next step in chat', event => requestCoordinator('next', event.currentTarget)) : null,
    coordinator() ? button('Pause coordinator at next tool', event => requestCoordinator('pause', event.currentTarget)) : null,
    button('review rules', () => switchView('review'))));
  return block;
}
function proofChip(proof) {
  if (!proof) return null;
  if (proof.state === 'changed') return chip('changed since verified', 'warn');
  if (proof.state === 'none') return chip('not verified yet', 'warn');
  return chip(proof.verdict, verdictTone(proof.verdict));
}
function renderProgress() {
  if (paneHidden) { mount(el('div', { class: 'pane-title' }, el('span', {}, model.summary), button('show pane', () => { paneHidden = false; renderProgress(); }))); return; }
  const open = new Set([...document.querySelectorAll('details[open][data-phase]')].map(d => d.dataset.phase));
  const pane = el('section', { class: 'pane', 'aria-label': 'Modernization progress' });
  pane.append(el('div', { class: 'pane-title' }, el('h1', {}, `${model.system}${model.brief?.target ? ` → ${model.brief.target}` : ''} · ${model.track === 'transform' ? 'rewrite' : model.track}`), button('hide', () => {
    paneHidden = true; renderProgress();
  }, { class: 'plain' })),
  el('div', { class: 'stage-rail', 'aria-label': 'Workflow steps' }, model.stages.map(s => el('span', { class: s.isDone ? 'good-text' : 'pending', title: s.detail || s.label }, `${s.isDone ? '✓' : '·'} ${s.label}`))));
  if (model.estate) pane.append(el('p', { class: 'estate-line' }, model.estate.languages.filter(l => l.share >= .03).map(l => `${l.name} ${Math.round(l.share * 100)}%`).join(' · '), ` · ${model.totals.modules} ${model.estate.granularity}s${model.estate.isPartial ? '+' : ''}`));
  if (model.tiles.length) {
    const map = el('div', { class: 'treemap', role: 'group', 'aria-label': 'Modules sized by source size' });
    for (const tile of model.tiles) {
      const b = button('', () => { selected = tile.id; renderProgress(); }, { class: 'tile', 'data-key': `tile-${tile.id}`, title: `${tile.name} · ${tile.domain} · ${tile.loc.toLocaleString()} ${model.estate?.measure} · ${tile.stateLabel}${tile.proof ? ` · ${tile.proof}` : ''}`, 'aria-label': `${tile.name}: ${tile.stateLabel}`, 'aria-pressed': selected === tile.id });
      Object.assign(b.style, { left: `${tile.rect.x / 160 * 100}%`, top: `${tile.rect.y / 42 * 100}%`, width: `${tile.rect.w / 160 * 100}%`, height: `${tile.rect.h / 42 * 100}%`, background: tile.color });
      if (tile.rect.w >= 8 && tile.rect.h >= 3) b.append(el('span', { class: 'tile-label' }, tile.proof ? `${marks[tile.proof]} ` : '', tile.label));
      const touched = model.session.touches[tile.id];
      if (touched && Date.now() - Date.parse(touched.at) < 4000) b.classList.add('flash-write');
      map.append(b);
    }
    pane.append(map);
    const counts = new Map(); for (const t of model.tiles) { const item = counts.get(t.state) ?? { count: 0, label: t.stateLabel, color: t.color }; item.count++; counts.set(t.state, item); }
    pane.append(el('div', { class: 'legend' }, [...counts.values()].map(c => { const dot = el('span', { class: 'legend-dot', 'aria-hidden': true }, '■'); dot.style.color = c.color; return el('span', {}, dot, `${c.label} ${c.count}`); })));
  } else pane.append(muted('No module map yet. Run the map command to name the units of work.'));
  if (model.percent !== null) {
    const bar = el('div', { class: 'progress-fill' }); bar.style.width = `${Math.min(100, Math.max(0, model.percent * 100))}%`;
    pane.append(el('div', { class: 'progress-row' }, el('div', { class: 'progress-track', role: 'progressbar', 'aria-label': 'Modernization progress by source size', 'aria-valuenow': Math.round(model.percent * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar), `${(model.percent * 100).toFixed(model.percent < .1 ? 1 : 0)}% done`));
  }
  pane.append(heading('Phases', model.approvalStale ? 'approval is stale' : model.brief?.approval.isSigned ? `signed · ${model.brief.approval.covers === 'full' ? 'full plan' : 'phase 1'}` : 'brief not signed'));
  if (!model.brief?.phases.length) pane.append(muted('No phase plan on disk yet.'));
  for (const phase of model.brief?.phases ?? []) {
    const done = phase.criteria.filter(c => c.isTicked).length;
    const d = el('details', { class: 'phase', 'data-phase': phase.number, 'data-key': `phase-${phase.number}` }, el('summary', {}, `${phase.number}. ${phase.title} `, el('span', { class: 'muted' }, `(${done}/${phase.criteria.length} criteria)`)), el('div', { class: 'criteria' }, phase.criteria.map(c => el('p', { class: c.isTicked ? 'good-text' : '' }, `${c.isTicked ? '✓' : '☐'} ${c.text}`))));
    if (open.has(String(phase.number))) d.open = true;
    pane.append(d);
  }
  pane.append(heading(model.track === 'uplift' ? 'Working copy' : 'Built modules', `${model.modules.length} on disk`));
  if (!model.modules.length) pane.append(muted('No built modules yet.'));
  for (const m of model.modules.slice(0, 30)) pane.append(el('div', { class: 'module-row', 'data-key': `module-${m.dir}` }, el('div', { class: 'name' }, m.name || m.dir, el('small', {}, m.state, m.tests ? ` · ${m.tests.tests} tests · ${m.tests.failures + m.tests.errors} failing` : ' · no test report')), proofChip(model.proofs[m.dir.toLowerCase()])));
  if (model.modules.length > 30) pane.append(muted(`${model.modules.length - 30} more modules are in the report.`));
  pane.append(nextBlock(), heading('Attention'));
  pane.append(model.attention.length ? el('ul', { class: 'attention' }, model.attention.map(a => el('li', {}, a))) : muted('No attention item was found in the saved artifacts.'));
  for (const f of model.session.failures) pane.append(el('p', { class: 'warn-text' }, `${f.agents.length} agents share a failure: ${f.text}`));
  pane.append(heading('Session', model.session.active ? `${model.session.active} active · ${model.session.done} done` : 'idle'));
  for (const a of model.session.agents.slice(-4)) pane.append(el('div', { class: 'session-row', 'data-key': `agent-${a.run}-${a.id}` }, el('span', { class: a.status === 'running' ? 'good-text' : 'muted' }, a.role || a.id), el('span', { class: 'subject muted' }, a.subject || a.status)));
  if (!model.session.agents.length) pane.append(muted('No SDK agent activity recorded for this system.'));
  pane.append(el('p', { class: 'subtle-note' }, model.session.observation));
  const controls = runControls(true); if (controls.childNodes.length) pane.append(controls);
  mount(el('div', { class: 'workspace-grid' }, pane, detailPane()));
}
function detailPane() {
  const tile = model.tiles.find(t => t.id === selected), detail = el('aside', { class: 'detail-pane' });
  if (tile) {
    detail.append(el('h2', {}, tile.name), el('p', { class: 'muted' }, tile.domain), el('div', { class: 'facts' }, chip(tile.stateLabel), chip(`${tile.loc.toLocaleString()} ${model.estate.measure}`)));
    const unit = model.estate.units.find(u => u.id === tile.id);
    if (unit?.file) detail.append(button('source & x-ray', () => showSource({ path: unit.file, from: 1, to: 80 })));
    const module = model.byNode[tile.id], p = module ? model.proofs[module.dir.toLowerCase()] : null;
    if (p) detail.append(el('p', {}, proofChip(p)), muted(p.reason || 'Verdict read from the saved proof pack.'));
    const matching = model.rules.filter(r => r.citations.some(c => unit?.file && (c.path === unit.file || c.path.endsWith('/' + unit.file))));
    if (matching.length) detail.append(heading('Rules citing this file'), ...matching.slice(0, 12).map(r => el('p', {}, button(`${r.id} · ${r.title}`, () => { scope = 'all'; currentRule = r.id; switchView('review'); }, { class: 'plain' }))));
  } else detail.append(el('h2', {}, 'Proof at a glance'), muted('Select a module on the map to inspect its progress and source context.'));
  const proof = tile ? model.proof?.modules.find(m => m.name.toLowerCase() === model.byNode[tile.id]?.dir.toLowerCase()) : model.proof?.modules[0];
  if (proof) {
    detail.append(heading(proof.name), el('p', {}, chip(proof.verdict, verdictTone(proof.verdict))), el('p', { class: 'reason' }, `Checked ${proof.verifiedAt || 'at an unknown time'} · saved evidence`));
    detail.append(el('div', { class: 'checks' }, proof.checks.map(c => el('div', { class: 'check' }, el('span', { class: `check-icon ${c.state}` }, marks[c.state] || '·'), el('span', {}, c.label), el('span', { class: 'detail' }, c.detail)))));
    detail.append(el('div', { class: 'actions', style: 'margin-top:16px' }, button('open proof report', () => switchView('report'))));
  } else detail.append(el('p', { class: 'reason' }, 'No proof pack for this selection. Run the verify command after building and collecting evidence.'));
  if (model.brief && (!model.brief.approval.isSigned || model.approvalStale)) detail.append(heading('Brief approval'), muted(`${model.brief.phases.length} phases · ${model.brief.openQuestions} open questions${model.approvalStale ? ' · approval is stale' : ''}`), el('div', { class: 'actions' }, button('sign the brief', openSign, { class: 'primary' })));
  return detail;
}
function queueOf() {
  const wanted = filter.toLowerCase().trim();
  const flagged = r => r.defect || r.sme || r.confidence && r.confidence !== 'High';
  const weight = r => (r.priority === 'P0' ? 0 : r.priority === 'P1' ? 10 : 20) + (r.sme ? 0 : 2) + (r.defect ? 0 : 1) + (r.confidence && r.confidence !== 'High' ? 0 : 1);
  return model.rules.filter(r => (scope !== 'flagged' || r.priority === 'P0' && flagged(r)) && (scope !== 'p0' || r.priority === 'P0') && (!wanted || [r.id, r.domain, r.title, r.statement, r.then, r.defect, ...r.citations.map(c => c.path)].some(t => String(t || '').toLowerCase().includes(wanted)))).sort((a, b) => weight(a) - weight(b));
}
function moveRule(delta) {
  const queue = queueOf(), index = queue.findIndex(r => r.id === currentRule);
  currentRule = queue[(Math.max(0, index) + delta + queue.length) % queue.length]?.id ?? null; renderReview();
}
function renderReview() {
  updateURL();
  const queue = queueOf(); let r = queue.find(r => r.id === currentRule);
  if (!r) { r = queue.find(r => !model.reviews[r.id]) || queue[0]; currentRule = r?.id; }
  presentedRule = r; const review = r ? model.reviews[r.id] : null;
  const search = el('input', { type: 'search', value: filter, maxlength: 500, placeholder: 'Filter ID, title, domain or source…', 'aria-label': 'Filter rules' });
  let timer; search.oninput = event => { filter = event.target.value; clearTimeout(timer); timer = setTimeout(() => renderReview(), 200); };
  const toolbar = el('div', { class: 'review-toolbar', 'data-key': 'review-toolbar' }, el('div', { class: 'filters', role: 'group', 'aria-label': 'Rule selection' }, ['flagged', 'p0', 'all'].map(s => button(s === 'p0' ? 'P0' : s, () => { scope = s; currentRule = null; renderReview(); }, { 'aria-pressed': scope === s }))), search, button('Reload cards', () => refresh()));
  if (!r) { mount(toolbar, el('p', { class: 'empty' }, model.rules.length ? 'No rules match this selection. Choose All or change the filter.' : 'No business-rule cards yet. Run $modernize-extract-rules in chat.')); return; }
  const count = word => queue.filter(r => model.reviews[r.id]?.verdict === word).length;
  const status = `${count('confirmed')} confirmed · ${count('wrong')} wrong · ${count('discuss')} to discuss · ${queue.filter(r => !model.reviews[r.id]).length} open`;
  const card = el('article', { class: 'deck', 'data-key': `rule-${r.id}`, 'aria-label': 'Current rule card' }, el('div', { class: 'deck-header' }, el('span', {}, `Rule review ${queue.indexOf(r) + 1} of ${queue.length}`), el('span', {}, `${status} · ${scope}`)),
    el('h1', {}, `${r.id} · ${r.title}`), el('p', { class: 'rule-meta' }, [r.priority, r.category, r.confidence ? `confidence ${r.confidence}` : 'confidence unknown', r.domain].filter(Boolean).join(' · ')),
    el('p', { class: 'rule-meta' }, r.citations.map((c, index) => [index ? ' · ' : '', button(`${c.path}:${c.from}-${c.to}`, () => showSource(c), { class: 'plain' })])),
    el('p', { class: 'statement' }, r.statement || 'No plain-language statement was recorded.'));
  if (r.given || r.when || r.then) card.append(el('div', { class: 'spec' }, [['Given', r.given], ['When', r.when], ['Then', r.then]].filter(([, text]) => text).map(([word, text]) => el('p', {}, el('strong', {}, word), el('span', {}, text)))));
  if (r.defect) card.append(el('div', { class: 'defect' }, el('strong', {}, 'Suspected defect'), r.defect));
  if (r.sme) card.append(el('div', { class: 'defect' }, el('strong', {}, 'Question for the SME'), r.sme));
  if (r.edgeCases.length) card.append(el('details', {}, el('summary', {}, 'Edge cases'), el('ul', {}, r.edgeCases.map(e => el('li', {}, e)))));
  if (model.staleReviews.includes(r.id)) card.append(el('p', { class: 'warn-text' }, 'The card changed after its review. A new decision is needed.'));
  card.append(el('p', { class: `saved-verdict ${review ? review.verdict === 'confirmed' ? 'good-text' : review.verdict === 'wrong' ? 'bad-text' : 'warn-text' : 'muted'}` }, review ? `${review.verdict} · ${review.at}${review.note ? ` · ${review.note}` : ''}` : 'No verdict recorded yet.'));
  const draft = drafts.get(draftKey(r.id)), stale = draft && (draft.ruleRevision !== r.revision || draft.reviewRevision !== r.reviewRevision);
  if (draft) card.append(el('p', { class: stale ? 'warn-text' : 'muted', 'data-key': 'draft-state' }, stale ? 'This card or its saved review changed. Your draft is preserved. Read the current card before using it.' : 'Unsaved draft · kept while switching cards and views.',
    stale ? button('Use draft with current revision', () => { putDraft(draftKey(r.id), { ...draft, ruleRevision: r.revision, reviewRevision: r.reviewRevision }); renderReview(); }) : null,
    button('Discard draft', () => { putDraft(draftKey(r.id), null); $('review-note').value = review?.note || ''; renderReview(); })));
  const note = el('textarea', { class: 'review-note', 'aria-label': 'Reviewer note', maxlength: 500, placeholder: 'Your note (optional). Saved with your decision.' }, draft?.text ?? review?.note ?? '');
  note.oninput = event => { putDraft(draftKey(r.id), { text: event.target.value, ruleRevision: draft?.ruleRevision ?? r.revision, reviewRevision: draft?.reviewRevision ?? r.reviewRevision }); dirty = true; scheduleRender(); }; card.append(el('label', { class: 'muted', for: 'review-note' }, 'Reviewer note'), note); note.id = 'review-note';
  const keys = [['1', 'confirm', () => decide('confirmed')], ['2', 'wrong', () => decide('wrong')], ['3', 'discuss', () => decide('discuss')], ['4', 'back', () => moveRule(-1)], ['5', 'skip', () => moveRule(1)], ['6', 'source', () => r.citations[0] ? showSource(r.citations[0]) : announce('No source citation')], ['7', 'undo verdict', () => decide('retract')], ['0', 'close', () => switchView('progress')]];
  card.append(el('div', { class: 'keys' }, keys.map(([key, text, action]) => button(el('span', {}, el('kbd', {}, key), text), action, { 'aria-label': `${key} ${text}`, ...(model.ledgerProblem && ['1', '2', '3', '7'].includes(key) ? { disabled: '' } : {}) }))));
  const list = el('ul', { class: 'queue', 'data-key': 'review-queue', 'aria-label': 'Review queue' }, queue.map(item => el('li', { 'data-key': item.id }, button(el('span', {}, item.id, el('small', {}, item.title), el('small', {}, model.reviews[item.id]?.verdict || 'open')), () => { currentRule = item.id; renderReview(); }, { 'aria-current': item.id === r.id }))));
  mount(toolbar, el('div', { class: 'review-layout' }, list, card));
}
async function decide(verdict) {
  if (busy || !presentedRule) return; busy = true;
  const r = presentedRule, decisionKey = draftKey(r.id), decisionSystem = system, queue = queueOf(), index = queue.findIndex(item => item.id === r.id), note = $('review-note')?.value ?? '';
  const draft = drafts.get(draftKey(r.id));
  if (draft && (draft.ruleRevision !== r.revision || draft.reviewRevision !== r.reviewRevision)) { busy = false; showError(new Error('Read the changed card and explicitly accept its current revision before saving your draft.')); return; }
  try {
    await api('/api/review', { id: r.id, verdict, note, ruleRevision: r.revision, reviewRevision: r.reviewRevision });
    putDraft(decisionKey, null); dirty = false; await refresh(); if (system !== decisionSystem) return;
    if (verdict !== 'retract') currentRule = queue.slice(index + 1).concat(queue.slice(0, index + 1)).find(item => !model.reviews[item.id])?.id || r.id;
    if (view === 'review') renderReview(); announce(`${r.id}: ${verdict === 'retract' ? 'verdict removed' : verdict} saved.`);
  } catch (e) { showError(e); } finally { busy = false; }
}
async function showSource(citation) {
  try {
    const result = await api('/api/source', null, { file: citation.path, offset: Math.max(1, citation.from - 3), limit: Math.min(200, Math.max(30, citation.to - citation.from + 8)) });
    $('source-title').textContent = `${result.file}:${result.offset}`; $('source-note').textContent = result.xray?.text || 'No additional analysis context for this file.';
    $('source-code').replaceChildren(...result.text.split('\n').map((line, i) => el('span', { class: 'source-line' }, el('span', { class: 'line-no' }, String(result.offset + i)), line)));
    $('source-dialog').showModal();
  } catch (e) { showError(e); }
}
function openSign() {
  if (!model.brief || model.brief.approval.isSigned && !model.approvalStale) return;
  $('sign-form').reset(); $('sign-error').textContent = '';
  $('sign-stale').hidden = true;
  $('sign-summary').textContent = `${model.system}${model.brief.target ? ` → ${model.brief.target}` : ''}\n${model.brief.phases.map(p => `Phase ${p.number}: ${p.title}`).join('\n')}\n${model.brief.openQuestions} open questions\nRevision ${model.briefRevision.slice(0, 16)}${model.approvalStale ? `\nReplaces the earlier approval by ${model.brief.approval.by || '(unknown)'}; its history will be retained.` : ''}`;
  $('sign-brief').textContent = model.briefText || ''; $('sign-dialog').dataset.revision = model.briefRevision; $('sign-dialog').dataset.system = system;
  $('sign-dialog').showModal(); $('approver').focus();
}
$('sign-reload').onclick = () => { const name = $('approver').value; openSign(); $('approver').value = name; $('sign-stale').hidden = true; };
$('sign-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return; busy = true;
  const submit = $('sign-form').querySelector('[type=submit]'); submit.disabled = true;
  try {
    if ($('sign-dialog').dataset.system !== system || !model) throw new Error('Workspace selection changed. Reopen the approval dialog.');
    await api('/api/sign', { name: $('approver').value, covers: new FormData($('sign-form')).get('covers'), confirm: $('approve-confirm').checked, briefRevision: $('sign-dialog').dataset.revision });
    $('sign-dialog').close(); await refresh(true); announce('Brief approval saved.');
  } catch (e) { $('sign-error').textContent = e.message; } finally { busy = false; submit.disabled = $('sign-dialog').dataset.system !== system || $('sign-dialog').dataset.revision !== model?.briefRevision; }
};
document.querySelectorAll('[data-close-dialog]').forEach(b => b.onclick = () => b.closest('dialog').close());
const frameRequests = new Map();
function documentState(frame) {
  return new Promise(resolve => {
    const requestId = crypto.randomUUID(), timer = setTimeout(() => { frameRequests.delete(requestId); resolve(null); }, 350);
    frameRequests.set(requestId, { frame, resolve: value => { clearTimeout(timer); resolve(value); } });
    frame.contentWindow?.postMessage({ type: 'modernization:state-request', requestId }, '*');
  });
}
function renderDocument() {
  if (!documentSession || documentSession.view !== view || documentSession.system !== system) {
    const session = documentSession = { view, system, revision: '', frozen: false, loading: false, abort: new AbortController() };
    const toolbar = el('div', { class: 'frame-toolbar' }, el('span', { id: 'document-state' }, 'Loading current saved artifacts…'));
    const frame = session.frame = el('iframe', { class: 'document-frame', title: view === 'report' ? 'Modernization report' : 'Topology explorer', sandbox: 'allow-scripts allow-downloads' });
    toolbar.append(el('div', { class: 'actions' }, button('Freeze version', event => { session.frozen = !session.frozen; event.currentTarget.textContent = session.frozen ? 'Follow updates' : 'Freeze version'; renderDocument(); }),
      button('Refresh document', () => loadDocument(session, true))));
    if (view === 'report') toolbar.append(button('Download REPORT.html', () => { if (!frameURL) return; const a = el('a', { href: frameURL, download: `${system}-REPORT.html` }); document.body.append(a); a.click(); a.remove(); }));
    mount(toolbar, frame); loadDocument(session, false);
  }
  const session = documentSession, changed = session.revision && session.revision !== model.documents?.[view];
  $('document-state').textContent = `${view === 'report' ? 'Report' : 'Topology'} · ${session.frozen ? 'version frozen' : 'following saved artifacts'}${session.loading ? ' · updating…' : changed ? ' · update available' : ''}${session.revision ? ` · ${session.revision.slice(0, 10)}` : ''}`;
  $('document-state').classList.toggle('warn-text', Boolean(changed));
  if (changed && !session.frozen && !session.loading && session.failedRevision !== model.documents?.[view]) loadDocument(session, true);
}
async function loadDocument(session, preserve) {
  if (session.loading || documentSession !== session) return; session.loading = true; session.failedRevision = null;
  try {
    const saved = preserve ? await documentState(session.frame) : null;
    const result = await api(session.view === 'report' ? '/api/report' : '/api/topology', null, {}, { signal: session.abort.signal, document: true });
    if (documentSession !== session) return;
    if (frameURL) URL.revokeObjectURL(frameURL); frameURL = URL.createObjectURL(new Blob([result.html], { type: 'text/html' }));
    session.frame.onload = () => { if (saved && documentSession === session) session.frame.contentWindow.postMessage({ type: 'modernization:state-restore', state: saved }, '*'); };
    session.revision = result.revision || model.documents?.[session.view] || ''; session.frame.srcdoc = result.html;
  } catch (e) { session.failedRevision = model.documents?.[session.view]; if (e.name !== 'AbortError') showError(e); }
  finally { session.loading = false; if (documentSession === session) renderDocumentStatus(session); }
}
function renderDocumentStatus(session) {
  if (!session.revision) { $('document-state').textContent = 'Document unavailable · refresh to retry'; return; }
  renderDocument();
}

function elapsed(agent) {
  const start = Date.parse(agent.startedAt), end = agent.finishedAt ? Date.parse(agent.finishedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  const seconds = Math.max(0, Math.round((end - start) / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function runControls(compact = false) {
  const node = el('section', { class: 'run-controls', 'data-key': 'run-controls', 'aria-label': 'Run controls' });
  const runs = [...model.session.runs].reverse().filter(r => !compact || ['running', 'pausing', 'paused', 'stopping'].includes(r.status) || r.launch?.status === 'starting').slice(0, compact ? 2 : 30);
  if (!runs.length) return node;
  node.append(heading('Runs', 'cooperative control'));
  for (const run of runs) {
    const beat = health.get(run.id) || run.health, alive = beat?.state;
    const active = ['running', 'pausing', 'paused', 'stopping'].includes(run.status) && alive !== 'dead';
    const row = el('article', { class: 'run-card', 'data-key': `run-${run.id}` }, el('div', { class: 'run-heading' }, el('strong', {}, run.workflow), chip(alive === 'dead' ? 'runner stopped unexpectedly' : run.status, alive === 'dead' ? 'bad' : run.status === 'paused' ? 'warn' : '')), el('small', {}, run.id));
    const b = run.budget, q = run.queue;
    row.append(el('p', { class: 'reason' }, `${q.running} running · ${q.pending} queued · ${q.done} done · ${q.failed} failed`, el('br'), `${b.turns}/${b.maxTurns || '—'} turns · ${b.tokens.toLocaleString()}${b.maxTokens ? `/${b.maxTokens.toLocaleString()}` : ''} observed tokens${b.maxTokens ? '' : ' · no token cap'}`,
      b.maxActiveMs ? el('span', {}, el('br'), `${Math.round((beat?.activeMs ?? b.activeMs) / 1000)}s active / ${Math.round(b.maxActiveMs / 1000)}s · pause time excluded`) : null));
    if (active) row.append(el('p', { class: alive === 'alive' ? 'muted' : 'warn-text' }, `Runner ${alive || 'unknown'}${beat?.lastSeen ? ` · last heartbeat ${new Date(beat.lastSeen).toLocaleTimeString()}` : ''}`));
    if (run.gateChange) row.append(el('p', { class: 'warn-text' }, run.gateChange.reason, el('br'), run.gateChange.files.join(', ')));
    if (run.control?.error) row.append(el('p', { class: 'bad-text' }, run.control.error));
    if (run.pendingControl) row.append(el('p', { class: 'muted' }, `${run.pendingControl.action} requested · waiting for the runner`));
    if (run.launch?.status === 'failed' && run.launch.error) row.append(el('pre', { class: 'launch-error' }, run.launch.error));
    const actions = el('div', { class: 'actions' });
    if (active && run.supportsControl) {
      if (run.status === 'running') actions.append(button('Pause after active tasks', () => control(run, 'pause'), { ...(run.pendingControl ? { disabled: '' } : {}) }));
      if (['paused', 'pausing'].includes(run.status)) actions.append(button('Resume run', () => run.gateChange ? openControl(run, 'resume', true) : control(run, 'resume'), { ...(run.pendingControl ? { disabled: '' } : {}) }));
    }
    if (active && run.supportsCancellation && run.status !== 'stopping') actions.append(button('Stop run', () => control(run, 'stop')));
    if ((!active && run.canRestart || alive === 'dead') && run.supportsControl && !run.simulation) {
      actions.append(button('Resume saved run', () => openControl(run, 'resume')));
      if (q.failed) actions.append(button('Retry failed tasks', () => openControl(run, 'retry-failed')));
    }
    row.append(actions); node.append(row);
  }
  return node;
}
async function control(run, action, extra = {}) {
  try { await api('/api/control', { runId: run.id, action, runRevision: run.runRevision, ...extra }); announce(`${action} requested. Waiting for the runner.`); await refresh(); }
  catch (e) { if (e.name !== 'AbortError') showError(e); throw e; }
}
let controlChoice = null;
function openControl(run, action, decisions = false) {
  controlChoice = { run, action, decisions, system, track };
  $('control-form').reset(); $('control-error').textContent = '';
  $('control-title').textContent = action === 'retry-failed' ? 'Retry failed tasks' : 'Resume saved run';
  $('control-form').querySelector('[type=submit]').textContent = action === 'retry-failed' ? 'Retry failed tasks' : 'Resume run';
  $('control-summary').textContent = `${run.workflow}\n${run.id}\n${decisions ? `Changed decisions: ${run.gateChange.files.join(', ')}\nRevision ${run.gateChange.nextRevision}` : `${run.queue.done} completed tasks retained · ${run.queue.failed} failed · ${run.queue.pending} queued`}\nBudget: ${run.budget.turns}/${run.budget.maxTurns} turns · ${run.budget.tokens}/${run.budget.maxTokens || 'uncapped'} observed tokens`;
  for (const [id, needed] of [['stopped', !decisions], ['writes', !decisions && run.allowWrites], ['decisions', decisions]]) {
    $(`control-${id}-row`).hidden = !needed; $(`control-${id}`).required = needed;
  }
  $('control-dialog').showModal();
}
$('control-form').onsubmit = async event => {
  event.preventDefault(); if (!controlChoice || busy) return; busy = true;
  const submit = $('control-form').querySelector('[type=submit]'); submit.disabled = true;
  try {
    const { run, action, decisions, system: chosenSystem, track: chosenTrack } = controlChoice;
    if (chosenSystem !== system || chosenTrack !== track) throw new Error('Workspace selection changed. Reopen the control dialog.');
    await control(run, action, { confirm: $('control-confirm').checked, confirmStopped: $('control-stopped').checked, allowWrites: $('control-writes').checked,
      acceptDecisions: decisions && $('control-decisions').checked, decisionRevision: run.gateChange?.nextRevision });
    $('control-dialog').close();
  } catch (e) { $('control-error').textContent = e.message; }
  finally { busy = false; submit.disabled = false; }
};
function activity() {
  const node = el('section', { 'data-key': 'activity', class: 'activity' }, heading('Activity timeline', 'last 200 saved events'));
  if (model.session.activityLimited) node.append(muted('Showing bounded recent activity. Complete journals remain in the saved run directory.'));
  const search = el('input', { id: 'activity-filter', type: 'search', value: activityFilter, placeholder: 'Filter run, role, task, file or error…', 'aria-label': 'Filter activity' });
  search.oninput = event => { activityFilter = event.target.value; renderFleet(); };
  node.append(el('div', { class: 'review-toolbar' }, search, button(followActivity ? 'Pause following' : 'Follow latest events', () => { followActivity = !followActivity; renderFleet(); })));
  const list = el('ol', { class: 'timeline', id: 'activity-timeline', tabindex: '0', 'aria-label': 'Recorded agent events' });
  const wanted = activityFilter.toLowerCase();
  const events = (model.session.timeline ?? []).filter(e => !wanted || [e.run, e.role, e.task, e.summary, e.type].some(s => String(s).toLowerCase().includes(wanted)));
  for (const e of events) {
    const failed = e.type.includes('fail') || e.exitCode !== undefined && e.exitCode !== 0;
    const row = el('li', { 'data-key': e.id, class: failed ? 'event failed' : 'event' }, el('div', { class: 'event-meta' }, el('time', { datetime: e.at }, Number.isFinite(Date.parse(e.at)) ? new Date(e.at).toLocaleTimeString() : '—'), el('span', {}, `${e.role} · ${e.task}`), el('span', {}, e.type)), el('pre', {}, e.summary));
    if (e.exitCode !== undefined) row.append(chip(`exit ${e.exitCode}`, failed ? 'bad' : 'good'));
    if (e.sourceFile) row.append(button('Open source', () => showSource({ path: e.sourceFile, from: 1, to: 60 })));
    if (e.output) row.append(el('details', {}, el('summary', {}, 'Recorded output (last 4,000 characters)'), el('pre', {}, e.output)));
    list.append(row);
  }
  if (!events.length) list.append(el('li', { class: 'muted' }, 'No matching saved events.'));
  node.append(list); return node;
}
function renderFleet() {
  const s = model.session, live = s.agents.filter(a => a.status === 'running' && (health.get(a.run)?.state ?? a.health) !== 'dead').length;
  const oldList = $('activity-timeline'), shouldFollow = followActivity && (!oldList || oldList.scrollHeight - oldList.scrollTop - oldList.clientHeight < 60);
  const node = el('section', {}, el('div', { class: 'fleet-head' }, el('div', {}, el('strong', { class: 'good-text' }, live), el('small', {}, 'active')), el('div', {}, el('strong', {}, s.done), el('small', {}, 'completed')), el('div', {}, el('strong', {}, s.runs.length), el('small', {}, 'recorded runs'))), muted(s.observation));
  for (const f of s.failures) node.append(el('div', { class: 'defect' }, el('strong', {}, `${f.agents.length} agents share a failure`), f.text));
  node.append(runControls(), activity());
  node.append(heading('Agent activity'), button(fleetShowAll ? 'Show active and recent tasks' : `Show all task summaries (${s.agents.length})`, () => { fleetShowAll = !fleetShowAll; renderFleet(); }));
  const shown = fleetShowAll ? s.agents : [...s.agents.filter(a => ['running', 'observed'].includes(a.status)), ...s.agents.filter(a => ['failed', 'interrupted'].includes(a.status)).slice(-6), ...s.agents.filter(a => a.status === 'completed').slice(-6)];
  if (!s.agents.length) node.append(el('p', { class: 'empty' }, 'No SDK run metadata yet. Activity appears here when the SDK runner works in this workspace.'));
  else node.append(el('table', { class: 'fleet-table' }, el('thead', {}, el('tr', {}, ['Agent', 'State / duration', 'Last recorded activity', 'Scope'].map((h, i) => el('th', i === 3 ? { class: 'scope-col' } : {}, h)))), el('tbody', {}, shown.map(a => el('tr', { 'data-key': `${a.run}-${a.id}` }, el('td', {}, a.role, el('small', { style: 'display:block' }, a.id)), el('td', {}, (health.get(a.run)?.state ?? a.health) === 'dead' && a.status === 'running' ? 'runner lost' : a.status, el('small', { style: 'display:block' }, elapsed(a))), el('td', {}, a.subject || a.tool || '—', a.error ? el('p', { class: 'bad-text' }, a.error) : null), el('td', { class: 'scope-col' }, a.scope))))));
  mount(node);
  if (shouldFollow && $('activity-timeline')) $('activity-timeline').scrollTop = $('activity-timeline').scrollHeight;
}
document.addEventListener('keydown', event => {
  if (view !== 'review' || event.ctrlKey || event.altKey || event.metaKey || /^(?:INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
  const actions = { '1': () => decide('confirmed'), '2': () => decide('wrong'), '3': () => decide('discuss'), '4': () => moveRule(-1), '5': () => moveRule(1), '6': () => presentedRule?.citations[0] && showSource(presentedRule.citations[0]), '7': () => decide('retract'), '0': () => switchView('progress') };
  if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
});
window.addEventListener('message', event => {
  const frame = document.querySelector('iframe.document-frame');
  if (frame && event.source === frame.contentWindow && event.data?.type === 'modernization:topology') switchView('topology');
  if (event.data?.type === 'modernization:state-response') {
    const pending = frameRequests.get(event.data.requestId);
    if (pending && event.source === pending.frame.contentWindow) { frameRequests.delete(event.data.requestId); pending.resolve(event.data.state); }
  }
});
window.addEventListener('hashchange', () => {
  const nextToken = new URLSearchParams(location.hash.slice(1)).get('token');
  if (/^[a-f0-9]{64}$/.test(nextToken || '')) {
    token = nextToken; sessionStorage.setItem('modernization-token', token);
    history.replaceState(null, '', location.pathname + location.search); connection.restart();
  }
});
connection.start();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateConnection(); scheduleRender(); } });
window.addEventListener('pagehide', () => connection.stop());
window.addEventListener('pageshow', event => { if (event.persisted) connection.start(); });

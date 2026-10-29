// SPDX-License-Identifier: Apache-2.0
import path from 'node:path';
import { WorkspaceFiles, privatePath, uiRedact as redact } from './files.mjs';
import { readSnapshot, systemsOf, oneLineOf } from './upstream/reader/progress.mjs';
import { tilesOf, STATE_COLORS, stateWord } from './upstream/map/estate.mjs';
import { queueOf, tallyOf } from './upstream/review/deck.mjs';
import { xrayOf } from './upstream/xray/xray.mjs';
import { unitOfPath } from './upstream/reader/estate-model.mjs';
import { hash, invariant, name, relative, within } from '../util.mjs';
import { clean, isObject } from '../proof-io.mjs';
import { proofView } from './proof-view.mjs';
import { newFleet, noteCall, noteFailure, SIGNATURE_WINDOW_MS, announceThresholdOf } from './upstream/fleet/fleet.mjs';
import { collectObservations } from './observations.mjs';
import { readUIConfig } from '../panel-config.mjs';
import { JournalTail } from './journal.mjs';
import { runHealth } from './health.mjs';
import { runRevision } from './control.mjs';

const serialize = value => JSON.parse(JSON.stringify(value, (_key, v) => v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v));
export const cardRevision = rule => hash(rule);
export const entryRevision = entry => hash(entry ?? null);

async function sessionOf(files, snapshot, journal) {
  const folder = `analysis/${snapshot.system}/.codex-sdk/runs`, runs = [], agents = [], touches = {}, timeline = [];
  const observations = [], fleetEvents = [];
  const entries = (await files.list(folder)).filter(e => e.kind === 'dir' && /^[A-Za-z0-9_.-]+$/.test(e.name)).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 30);
  const bytesBefore = journal.stats.bytes; let logs = 0, activityLimited = false;
  for (const entry of entries) {
    let state;
    try { state = await files.json(`${folder}/${entry.name}/state.json`); } catch { continue; }
    if (!isObject(state) || !isObject(state.tasks)) continue;
    const runFolder = `${folder}/${entry.name}`, health = await runHealth(files, runFolder, state, snapshot.readAtMs);
    let launch = null, request = null;
    try { launch = await files.json(`${runFolder}/launch.json`); request = await files.json(`${runFolder}/control.json`); } catch { /* Optional supervisor metadata. */ }
    const statuses = Object.values(state.tasks).map(t => t?.status);
    runs.push({ id: entry.name, workflow: clean(state.workflow), status: clean(state.status), at: clean(state.createdAt), usage: state.usage,
      supportsCancellation: state.supportsCancellation === true, supportsControl: state.supportsControl === true, runRevision: runRevision(state),
      health, owner: state.owner ? { pid: state.owner.pid, host: clean(state.owner.host), generation: clean(state.owner.generation) } : null,
      control: state.control ?? null, pendingControl: request && request.controlToken === state.controlToken && request.id !== state.control?.acknowledged && ['running', 'pausing', 'paused', 'stopping'].includes(state.status) ? { action: clean(request.action), at: clean(request.requestedAt) } : null,
      gateChange: state.gateChange ?? null, decisionRevision: state.decisionRevision ?? null, launch,
      budget: { turns: state.turnsStarted ?? 0, maxTurns: state.options?.maxTurns ?? 0, tokens: (state.usage?.input_tokens ?? 0) + (state.usage?.output_tokens ?? 0), maxTokens: state.options?.maxTokens ?? 0, activeMs: state.activeMs ?? 0, maxActiveMs: state.options?.runTimeoutMs ?? 0 },
      queue: { running: statuses.filter(s => s === 'running').length, pending: statuses.filter(s => ['queued', 'pending', 'deferred'].includes(s)).length,
        failed: statuses.filter(s => ['failed', 'interrupted'].includes(s)).length, done: statuses.filter(s => s === 'completed').length },
      allowWrites: state.options?.allowWrites === true, simulation: state.simulation === true,
      canRestart: state.simulation !== true && state.supportsControl === true && !['running', 'pausing', 'paused', 'stopping', 'completed'].includes(state.status) });
    const priority = task => task?.status === 'running' ? 0 : task?.startedAt || task?.finishedAt ? 1 : 2;
    for (const [id, task] of Object.entries(state.tasks).sort(([, a], [, b]) => priority(a) - priority(b) || Date.parse(b?.startedAt || 0) - Date.parse(a?.startedAt || 0)).slice(0, 500)) {
      if (!isObject(task) || !/^[A-Za-z0-9_.-]+$/.test(id)) continue;
      const withinBudget = logs < 200 && journal.stats.bytes - bytesBefore < 8 * 1024 * 1024;
      const hasLog = Boolean(task.startedAt || task.finishedAt || task.attempts > 0);
      const events = withinBudget && hasLog ? await journal.read(files, `${folder}/${entry.name}/${id}.events.jsonl`) : [];
      observations.push(...events.map(event => ({ ...event, workingDirectory: task.workingDirectory })));
      fleetEvents.push(...events.map(event => ({ ...event, agent: `${entry.name}/${id}` })));
      if (withinBudget && hasLog) logs++; else if (hasLog) activityLimited = true;
      const recent = events.filter(e => isObject(e.item));
      const last = recent.filter(e => !['agent_message', 'reasoning'].includes(e.item.type)).at(-1) ?? recent.at(-1);
      const writes = recent.flatMap(e => e.item?.type === 'file_change' && Array.isArray(e.item.changes) ? e.item.changes.map(c => ({ path: c.path, at: e.at })) : []);
      for (const write of writes) {
        if (typeof write.path !== 'string') continue;
        const rel = path.relative(path.join(files.root, 'legacy', snapshot.system), path.resolve(task.workingDirectory ?? files.root, write.path));
        const unit = snapshot.estate ? unitOfPath(snapshot.estate, snapshot.topology, rel) : null;
        if (unit && (!touches[unit.id] || Date.parse(touches[unit.id].at) < Date.parse(write.at))) touches[unit.id] = { kind: 'write', at: write.at };
        const full = path.resolve(task.workingDirectory ?? files.root, write.path);
        for (const [unitId, module] of snapshot.byNode) if (within(path.resolve(files.root, module.path), full) && (!touches[unitId] || Date.parse(touches[unitId].at) < Date.parse(write.at))) touches[unitId] = { kind: 'write', at: write.at };
      }
      const scope = typeof task.workingDirectory === 'string' && within(files.root, task.workingDirectory) ? path.relative(files.root, task.workingDirectory) : '';
      for (const event of events) {
        const item = event.item, changed = item?.changes?.[0]?.path;
        if (['agent_message', 'reasoning'].includes(item?.type)) continue;
        let sourceFile = null;
        if (changed) {
          const full = path.resolve(task.workingDirectory ?? files.root, changed);
          try { const legacy = files.resolve(`legacy/${snapshot.system}`); if (within(legacy, full)) sourceFile = path.relative(legacy, full); } catch { /* Candidate changes still appear in the timeline. */ }
        }
        timeline.push({ id: `${entry.name}/${id}/${hash(event.generation).slice(0, 12)}/${event.offset}`, at: event.at, run: entry.name, task: id, role: clean(task.role), scope,
          type: event.type, status: item?.status ?? '', file: changed ?? null, sourceFile,
          summary: event.error || item?.command || changed || item?.type || event.type,
          ...(item?.exit_code !== undefined ? { exitCode: item.exit_code } : {}), ...(item?.output ? { output: item.output } : {}) });
      }
      agents.push({ id, run: entry.name, role: clean(task.role), status: clean(task.status), scope,
        at: clean(events.at(-1)?.at ?? task.finishedAt ?? task.startedAt), startedAt: task.startedAt ?? null, finishedAt: task.finishedAt ?? null, health: health.state,
        calls: recent.filter(e => e.type === 'item.started').length,
        tool: clean(last?.item.type), subject: clean(last?.item.command ?? last?.item.changes?.[0]?.path, 180), error: clean(task.error, 240) });
    }
  }
  const hostFolder = `analysis/${snapshot.system}/.codex-host/events`;
  for (const entry of (await files.list(hostFolder)).filter(e => e.kind === 'file' && /^[a-f0-9]{32}\.jsonl$/.test(e.name)).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 30)) {
    const events = await journal.read(files, `${hostFolder}/${entry.name}`);
    observations.push(...events); fleetEvents.push(...events.filter(e => e.actor !== 'sdk-worker').map(event => ({ ...event, agent: event.task })));
    const last = events.at(-1);
    if (last && last.actor !== 'sdk-worker') agents.push({ id: last.task, run: 'parent-chat', role: 'coordinator', status: last.type === 'session.ended' ? 'completed' : 'observed', scope: '', at: last.at,
      calls: events.filter(e => e.type === 'item.completed').length, tool: clean(last.item?.type), subject: clean(last.item?.command, 180), error: '' });
    for (const event of events) {
      timeline.push({ id: `host/${entry.name}/${event.offset}`, at: event.at, run: event.actor === 'sdk-worker' ? 'worker-hooks' : 'parent-chat', task: event.task, role: event.actor === 'sdk-worker' ? 'SDK worker read' : 'coordinator', scope: '',
        type: event.type, status: event.item?.status ?? '', file: event.item?.changes?.[0]?.path ?? null, summary: event.item?.command || event.item?.changes?.[0]?.path || event.type,
        ...(event.item?.exit_code !== undefined ? { exitCode: event.item.exit_code } : {}), ...(event.item?.output ? { output: event.item.output } : {}) });
      for (const change of event.item?.changes ?? []) {
        const full = path.resolve(event.workingDirectory ?? files.root, change.path);
        try {
          const legacy = files.resolve(`legacy/${snapshot.system}`), unit = snapshot.estate && within(legacy, full) ? unitOfPath(snapshot.estate, snapshot.topology, path.relative(legacy, full)) : null;
          if (unit && (!touches[unit.id] || Date.parse(touches[unit.id].at) < Date.parse(event.at))) touches[unit.id] = { kind: event.item.type === 'file_read' ? 'read' : 'write', at: event.at };
        } catch { /* Unbound legacy has no read touch. */ }
        for (const [unitId, module] of snapshot.byNode) if (within(path.resolve(files.root, module.path), full) && (!touches[unitId] || Date.parse(touches[unitId].at) < Date.parse(event.at))) touches[unitId] = { kind: event.item.type === 'file_read' ? 'read' : 'write', at: event.at };
      }
    }
  }
  const fleet = newFleet();
  for (const event of fleetEvents.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const ms = Date.parse(event.at); if (!Number.isFinite(ms) || snapshot.readAtMs - ms > SIGNATURE_WINDOW_MS) continue;
    noteCall(fleet, event.agent, event.item?.type ?? event.type, event.item?.command ?? '', ms);
    if (event.type === 'item.completed' && Number.isInteger(event.item?.exit_code) && event.item.exit_code !== 0)
      noteFailure(fleet, event.agent, event.item.failure || event.item.output || '', ms, event.item.command?.slice(0, 180));
  }
  for (const agent of agents.filter(a => a.error)) if (snapshot.readAtMs - Date.parse(agent.at) <= SIGNATURE_WINDOW_MS) {
    noteCall(fleet, `${agent.run}/${agent.id}`, agent.tool, agent.subject, Date.parse(agent.at));
    noteFailure(fleet, `${agent.run}/${agent.id}`, agent.error, Date.parse(agent.at), agent.subject);
  }
  return { observed: collectObservations(observations, files.root), session: redact({ runs: runs.sort((a, b) => a.at.localeCompare(b.at)), agents: agents.sort((a, b) => a.at.localeCompare(b.at)).slice(-200), touches,
    timeline: timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)).slice(-200), activityLimited,
    active: runs.filter(r => r.health.state !== 'dead').reduce((n, r) => n + r.queue.running, 0), done: runs.reduce((n, r) => n + r.queue.done, 0),
    failures: [...fleet.signatures.values()].filter(s => s.agents.size >= 3).map(s => ({ text: s.text, agents: [...s.agents], examples: s.examples, announcedAt: s.announcedAt, announcedMs: s.announcedMs })),
    failureAnnouncementThreshold: announceThresholdOf(fleet),
    observation: 'SDK commands and changes; parent tool activity is included when trusted lifecycle hooks are active. Unobserved reads are not inferred.' }) };
}

export async function readModel(workspace, { system, track = 'auto', scope = 'flagged', filter = '', now = Date.now() } = {}, context = {}) {
  if (system) name(system);
  invariant(['auto', 'transform', 'uplift', 'reimagine'].includes(track), 'Unknown modernization track');
  invariant(['flagged', 'p0', 'all'].includes(scope), 'Unknown review scope');
  invariant(typeof filter === 'string' && filter.length <= 500 && !/[\x00-\x1f\x7f]/.test(filter), 'Invalid rule filter');
  const files = new WorkspaceFiles(workspace, context.readCache), systems = await systemsOf(files);
  if (system) invariant(systems.includes(system), `System ${system} is not present under analysis/ or legacy/`);
  // The live store invalidates changed paths, including nested estate changes.
  const config = await readUIConfig(files.root);
  if (!system && config.system) invariant(systems.includes(config.system), `Configured system ${config.system} is not present under analysis/ or legacy/`);
  const readerOptions = { system: system ?? config.system, track: track === 'auto' ? config.track : track, commandPrefix: config.commandPrefix, nowMs: now, changedTtlMs: 0 };
  let snapshot = structuredClone(await readSnapshot(files, context.parseCache ?? new Map(), readerOptions));
  if (!snapshot) return { files, snapshot: null, data: { system: null, systems: [], readAtMs: now, next: { text: '$modernize <system>', reason: 'Start with the modernization front door.' }, problems: [] } };
  const activity = context.skipSession ? null : await sessionOf(files, snapshot, context.journal ?? new JournalTail());
  if (activity?.observed.size) snapshot = structuredClone(await readSnapshot(files, context.parseCache ?? new Map(), { ...readerOptions, observed: activity.observed }));
  const rules = snapshot.rules?.rules ?? [];
  let contexts = {};
  try { contexts = (await files.json(`analysis/${snapshot.system}/UI_REVIEW_CONTEXT.json`))?.cards ?? {}; } catch { /* Exposed below if ledger is invalid. */ }
  let rawReviews = {};
  try { rawReviews = (await files.json(`analysis/${snapshot.system}/RULE_REVIEWS.json`))?.reviews ?? {}; } catch { /* Validated below. */ }
  const staleReviews = rules.filter(r => snapshot.reviews[r.id] && (contexts[r.id] && contexts[r.id] !== cardRevision(r) || rawReviews[r.id]?.title && rawReviews[r.id].title !== r.title)).map(r => r.id);
  for (const id of staleReviews) delete snapshot.reviews[id];
  if (staleReviews.length) snapshot.attention.unshift(`${staleReviews.length} rule review(s) refer to changed cards and need renewed review`);
  let ledgerProblem = '';
  try { const raw = await files.json(`analysis/${snapshot.system}/RULE_REVIEWS.json`); if (raw !== null) invariant(isObject(raw) && isObject(raw.reviews), 'Malformed review ledger'); } catch (e) { ledgerProblem = e.message; }
  if (ledgerProblem) snapshot.attention.unshift('RULE_REVIEWS.json cannot be read; existing decisions must be repaired before saving');
  if (staleReviews.length) snapshot.next = { text: `$modernize-review ${snapshot.system} p0`, isByHand: false, reason: 'Changed rule cards need renewed human review before building.' };
  if (snapshot.next) snapshot.next.reason = snapshot.next.reason.replace(/\bClaude\b/g, 'Codex');
  const briefText = await files.optional(`analysis/${snapshot.system}/MODERNIZATION_BRIEF.md`);
  let approvalContext = null;
  try { approvalContext = await files.json(`analysis/${snapshot.system}/UI_APPROVAL_CONTEXT.json`); } catch { /* Exposed as an attention item. */ }
  const approvalStale = Boolean(snapshot.brief?.approval.isSigned && approvalContext?.approvedRevision && approvalContext.approvedRevision !== hash(briefText ?? ''));
  if (approvalStale) {
    snapshot.attention.unshift('The brief changed since its recorded approval. Read and approve the revised plan.');
    snapshot.next = { text: 'approve the revised brief', isByHand: true, action: 'sign', reason: 'The existing signature belongs to an earlier revision.' };
  }
  const rawProof = await files.json(`analysis/${snapshot.system}/VERIFICATION.json`).catch(() => null);
  const proof = proofView(rawProof);
  if (proof) {
    for (const [key, state] of snapshot.proofs) {
      const checked = proof.modules.find(m => m.name.toLowerCase() === key && (m.track === snapshot.track || m.track === 'rewrite' && snapshot.track === 'transform'));
      if (checked && state.state !== 'changed' && state.state !== 'none' && state.verdict !== checked.verdict) {
        snapshot.proofs.set(key, { state: checked.verdict === 'PROVEN' ? 'proven' : checked.verdict === 'NOT PROVEN' ? 'not' : 'partly', verdict: checked.verdict, reason: checked.reasons[0] ?? 'Saved proof is inconsistent' });
        snapshot.attention.unshift(`${checked.name}: the saved verdict contradicts its checks; ${checked.verdict} is shown`);
      }
    }
    if (snapshot.verification) snapshot.verification.overall = proof.verdict;
    const verify = snapshot.stages.find(s => s.key === 'verify');
    if (verify) {
      const states = [...snapshot.proofs.values()];
      verify.isDone = states.length > 0 && states.every(s => s.state === 'proven');
      verify.detail = `${states.filter(s => s.state === 'proven').length} of ${states.length} proven`;
    }
  }
  const session = activity?.session ?? null;
  const documents = { topology: hash(await files.optional(`analysis/${snapshot.system}/topology.json`)), report: hash({ stages: snapshot.stages, modules: snapshot.modules, rules, reviews: snapshot.reviews,
    brief: briefText, proof: rawProof, uplift: snapshot.uplift, generation: context.documentGeneration ?? 0 }) };
  const queue = snapshot.rules ? queueOf(snapshot.rules, scope, filter) : [];
  const data = serialize({ ...snapshot, workspaceId: hash(files.root).slice(0, 24), rules: rules.map(r => ({ ...r, revision: cardRevision(r), reviewRevision: entryRevision(rawReviews[r.id]) })),
    reviewQueue: queue.map(r => r.id), reviewTally: tallyOf(queue, snapshot.reviews), staleReviews, ledgerProblem,
    approvalStale, briefRevision: hash(briefText ?? ''), briefText: briefText === null ? null : redact(briefText),
    tiles: tilesOf(snapshot, 160, 42).map(t => ({ ...t, color: `#${STATE_COLORS[t.state].toString(16).padStart(6, '0')}`, stateLabel: stateWord(snapshot.track, t.state) })),
    demo: await files.exists(`analysis/${snapshot.system}/DEMO.json`), proof, session, documents, uiConfig: config, summary: oneLineOf(snapshot), problems: files.io.problems,
    reviewContext: { scope, filter }, readAtMs: now });
  return { files, snapshot, data: redact(data) };
}

export async function sourceView(workspace, system, requested, offset = 1, limit = 100) {
  name(system); relative(requested);
  const prefix = `legacy/${system}/`;
  const file = requested.startsWith(prefix) ? requested.slice(prefix.length) : requested;
  invariant(!privatePath(file), 'Private source files are excluded');
  invariant(Number.isSafeInteger(offset) && offset >= 1 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200, 'Invalid source range');
  const { files, snapshot, data } = await readModel(workspace, { system }, { skipSession: true });
  const text = await files.read(`legacy/${system}/${file}`);
  const lines = text.split(/\r?\n/), window = lines.slice(offset - 1, offset - 1 + limit);
  return { file, offset, total: lines.length, text: redact(window.join('\n')), xray: snapshot && data.uiConfig?.xray !== false ? xrayOf(snapshot, { fileRel: file, offset, limit }) : null };
}

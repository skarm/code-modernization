// SPDX-License-Identifier: Apache-2.0
// Deterministic test double of PUBLIC SDK APIs; this is not an LLM or a bundled runtime.
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveLayout } from '../runtime/engine.mjs';

export async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'modernization-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'), source = path.join(root, 'source');
  await fs.mkdir(workspace); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'main.go'), 'package main\nfunc main() {}\n');
  const layout = await resolveLayout(workspace, 'billing', source);
  return { root, workspace, source, layout };
}
export function sample(schema) {
  if (Array.isArray(schema.type) && schema.type.includes('null')) return null;
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, sample(v)]));
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  return 'observed';
}
export function fakeCodex(handler = async c => ({ result: sample(c.schema) })) {
  let next = 0;
  const calls = [], started = [], resumed = [];
  const threadUsage = new Map();
  const stats = { active: 0, peak: 0 };
  function thread(id, options, isResumed) {
    let turns = 0;
    return { id,
      async runStreamed(input, { outputSchema, signal }) {
        turns++;
        const call = { id, options, input, schema: outputSchema, signal, turn: turns, isResumed };
        calls.push(call);
        return { events: (async function* () {
          stats.active++; stats.peak = Math.max(stats.peak, stats.active);
          try {
            yield { type: 'thread.started', thread_id: id };
            yield { type: 'turn.started' };
            const response = await handler(call);
            if (response.delayMs) await delay(response.delayMs, undefined, { signal });
            for (const event of response.events ?? []) yield event;
            if (response.error) throw new Error(response.error);
            for (const command of response.commands ?? []) yield { type: 'item.completed', item: { type: 'command_execution', id: 'cmd', status: 'completed', aggregated_output: '', ...command } };
            if (response.omitResponse !== true) yield { type: 'item.completed', item: { id: 'result', type: 'agent_message', text: response.raw ?? JSON.stringify(response.result ?? sample(outputSchema)) } };
            if (response.omitCompletion !== true) {
              const previous = threadUsage.get(id) ?? {};
              const usage = response.usage ?? Object.fromEntries(Object.entries({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 4,
                cache_write_input_tokens: 0, reasoning_output_tokens: 0 }).map(([key, n]) => [key, (previous[key] ?? 0) + n]));
              threadUsage.set(id, usage);
              yield { type: 'turn.completed', usage };
            }
          } finally { stats.active--; }
        })() };
      },
    };
  }
  return {
    calls, started, resumed, stats,
    startThread(options) { const id = `thread-${++next}`; started.push({ id, options }); return thread(id, options, false); },
    resumeThread(id, options) { resumed.push({ id, options }); return thread(id, options, true); },
  };
}
export function workflowEngine(workflow, handler, concurrency = 4) {
  const calls = [];
  const engine = { workflow, layout: { source: '/source' }, options: { concurrency }, calls,
    async task(spec) {
      calls.push(spec);
      const answer = await handler(spec);
      return { taskId: spec.id, ok: true, result: sample(spec.schema), evidence: { commands: [] }, ...answer };
    },
    async parallel(specs, limit = concurrency) {
      const outputs = [];
      for (let start = 0; start < specs.length; start += Math.min(limit, concurrency)) {
        outputs.push(...await Promise.all(specs.slice(start, start + Math.min(limit, concurrency)).map(spec => engine.task(spec))));
      }
      return outputs;
    },
  };
  return engine;
}

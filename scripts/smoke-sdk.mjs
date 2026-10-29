#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Opt-in REAL SDK + REAL model test. May consume your Codex allowance/API budget.
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodex, streamTurn, threadOptions, usageDelta } from '../runtime/sdk.mjs';
import { invariant, validate } from '../runtime/util.mjs';
import { record, string } from '../runtime/schemas.mjs';

invariant(process.argv.includes('--confirm-live'), 'This test starts real Codex turns and consumes usage. Run npm run smoke:sdk -- --confirm-live only after reviewing this script.');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modernize-sdk-smoke-'));
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 120000);
const stop = () => controller.abort(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  const codex = await createCodex();
  const opts = threadOptions({ workingDirectory: directory });
  const schema = record({ remembered: string });
  const thread = codex.startThread(opts);
  let id;
  const onEvent = async event => { if (event.type === 'thread.started') id = event.thread_id; };
  const first = await streamTurn(thread, 'Remember the harmless synthetic phrase SILVER-PINE-42. Return it as remembered. Do not run any tools or write files.',
    { schema, signal: controller.signal, onEvent });
  const firstOutput = validate(schema, JSON.parse(first.finalResponse));
  invariant(firstOutput.remembered === 'SILVER-PINE-42', 'First structured response did not match');
  invariant(first.commands.length === 0 && first.changes.length === 0, 'Unexpected command/file operation in the smoke turn');
  invariant(id, 'No SDK thread ID');
  const resumed = codex.resumeThread(id, opts);
  const second = await streamTurn(resumed, 'Return the exact harmless phrase from the previous turn as remembered. Do not run tools.',
    { schema, signal: controller.signal, onEvent });
  validate(schema, JSON.parse(second.finalResponse));
  invariant(second.commands.length === 0 && second.changes.length === 0, 'Unexpected command/file operation in the resumed smoke turn');
  invariant(JSON.parse(second.finalResponse).remembered === 'SILVER-PINE-42', 'Resumed context did not preserve phrase');
  console.log(JSON.stringify({ liveSdk: true, streamedTurns: 2, resumed: true, threadId: id,
    firstTurnUsage: usageDelta(first.usage), resumedTurnUsage: usageDelta(second.usage, first.usage),
    sdkReportedThreadTotals: [first.usage, second.usage] }, null, 2));
} finally {
  clearTimeout(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop);
  await fs.rm(directory, { recursive: true, force: true });
}

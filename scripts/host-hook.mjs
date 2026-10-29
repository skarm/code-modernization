#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { handleHook } from '../runtime/host-hooks.mjs';
import { uiRedact } from '../runtime/ui/files.mjs';
try {
  let bytes = 0; const chunks = [];
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new Error('Hook input exceeds 2 MiB'); chunks.push(chunk); }
  const result = await handleHook(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  // Advisory failure never silently denies an unrelated user action.
  process.stdout.write(JSON.stringify({ systemMessage: `Modernization hook: ${uiRedact(String(error.message)).slice(0, 400)}` }) + '\n');
}

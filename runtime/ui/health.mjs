// SPDX-License-Identifier: Apache-2.0
import os from 'node:os';

export function processAlive(owner) {
  if (!owner || owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return null;
  try { process.kill(owner.pid, 0); return true; } catch (e) { return e.code === 'ESRCH' ? false : null; }
}

export async function runHealth(files, folder, state, now = Date.now()) {
  if (!['running', 'pausing', 'paused', 'stopping'].includes(state.status)) return { state: 'finished', lastSeen: null };
  let beat;
  try { beat = await files.json(`${folder}/heartbeat.json`); } catch { /* A torn/old heartbeat is not proof of liveness. */ }
  const alive = processAlive(state.owner);
  if (alive === false) return { state: 'dead', lastSeen: beat?.at ?? null };
  if (!state.owner || beat?.generation !== state.owner.generation) return { state: 'unknown', lastSeen: null };
  const age = now - Date.parse(beat.at);
  return { state: Number.isFinite(age) && age >= -5000 && age < 8000 ? 'alive' : 'stale', lastSeen: beat.at, activeMs: Number.isFinite(beat.activeMs) ? beat.activeMs : null };
}

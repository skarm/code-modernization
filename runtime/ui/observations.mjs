// SPDX-License-Identifier: Apache-2.0
// Observations are display evidence, never a proof verdict or permission to execute.
import path from 'node:path';
import { parseRunnerLog } from '../proof-results.mjs';
import { within } from '../util.mjs';
const RUNNER = /^(?:(?:\.\/)?mvnw?\b.*\b(?:test|verify|surefire:test)\b|(?:\.\/)?gradlew?\b.*\b(?:test|check)\b|pytest\b|py\.test\b|python3?\s+-m\s+(?:pytest|unittest)\b|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:npx\s+|bunx\s+)?(?:jest|vitest|mocha)\b|node\b[^\n]*\s--test\b|dotnet\s+test\b|go\s+test\b|cargo\s+test\b|(?:bundle\s+exec\s+)?rspec\b|prove\b|ctest\b|(?:\.\/vendor\/bin\/)?phpunit\b|make\s+(?:test|check)\b)/;
export function isTestCommand(command = '') {
  return String(command).split(/&&|\|\||[;|\n(]/).some(segment => RUNNER.test(segment.trim().replace(/^(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S*|time|env|sudo|exec|nice|command)\s+)+/, '')));
}
export function testTotals(command, output) {
  if (!isTestCommand(command) || typeof output !== 'string') return null;
  try {
    const counts = parseRunnerLog(output.replace(/\x1b\[[0-9;]*m/g, ''));
    if (!counts) return null;
    return { tests: counts[0] + counts[2], failures: counts[1], errors: 0, skipped: counts[2], reports: 1 };
  } catch { return null; } // Incomplete TAP/XML is an observation gap, never a green count.
}
export function commandDirectory(command, cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  const changes = [...String(command).matchAll(/(?:^|&&|;)\s*cd\s+(?:"([^"$`]+)"|'([^']+)'|([^\s;&|$`]+))\s*(?=&&|;|$)/g)];
  if (changes.length > 1 || /\b(?:pushd|popd)\b/.test(command)) return null;
  if (!changes.length && /(?:^|[;&|()\n])\s*cd\b/.test(command)) return null;
  if (changes.length) return path.resolve(cwd, changes[0][1] ?? changes[0][2] ?? changes[0][3]);
  return cwd;
}
export function collectObservations(events, workspace) {
  const latest = new Map();
  for (const event of events) {
    const item = event.item;
    if (event.type !== 'item.completed' || item?.type !== 'command_execution' || !Number.isInteger(item.exit_code)) continue;
    const totals = item.testTotals ?? testTotals(item.command, item.output), dir = commandDirectory(item.command, event.workingDirectory);
    if (!totals || !dir || !within(path.join(workspace, 'modernized'), dir) || !Number.isFinite(Date.parse(event.at))) continue;
    // A failed command cannot be displayed as an all-green test execution.
    if (item.exit_code !== 0 && totals.failures + totals.errors === 0) continue;
    if (!Object.values(totals).every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e9) || totals.failures + totals.errors + totals.skipped > totals.tests) continue;
    const key = path.relative(workspace, dir).split(path.sep).join('/');
    if (!latest.has(key) || Date.parse(event.at) > Date.parse(latest.get(key).at)) latest.set(key, { at: event.at, totals });
  }
  return new Map([...latest].map(([key, row]) => [key, row.totals]));
}

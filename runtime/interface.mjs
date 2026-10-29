// SPDX-License-Identifier: Apache-2.0
// Browser presentation is optional. Unknown clients and remote shells use text.
export function hostInterface(env = process.env) {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY || env.CI === 'true' ||
      env.CODEX_MODERNIZATION_HEADLESS === '1' || env.CODEX_MODERNIZATION_WORKER === '1') return 'terminal';
  if (env.CODEX_MODERNIZATION_INTERFACE === 'terminal') return 'terminal';
  if (env.CODEX_MODERNIZATION_INTERFACE === 'gui') return 'gui';
  // A CLI launched by Desktop can inherit its originator. Terminal markers win.
  if (env.TERM || env.TERM_PROGRAM || env.WT_SESSION) return 'terminal';
  return env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE === 'Codex Desktop' ? 'gui' : 'terminal';
}

export function terminalStatus(data) {
  const line = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
  if (!data.system) return 'No modernization system registered. Next: $modernize <system>\n';
  const stages = data.stages ?? [], current = stages.find(stage => !stage.isDone);
  const lines = [`System: ${line(data.system)}`, `Stage: ${line(current?.label ?? 'recorded stages complete')}`];
  if (data.totals) lines.push(`Source: ${data.totals.modules} ${data.estate?.granularity === 'file' ? 'files' : 'modules'}; ${data.totals.done} marked complete`);
  if (data.rules?.length) lines.push(`Rules: ${data.rules.length}; review queue: ${data.reviewQueue?.length ?? 0}`);
  for (const run of data.session?.runs ?? []) lines.push(`SDK ${line(run.id)}: ${line(run.status)}; tasks completed ${run.queue?.done ?? 0}, running ${run.queue?.running ?? 0}, failed ${run.queue?.failed ?? 0}`);
  for (const task of data.session?.agents ?? []) if (task.error) lines.push(`SDK error ${line(task.id)}: ${line(task.error)}`);
  for (const item of [...(data.attention ?? []), ...(data.problems ?? [])]) lines.push(`Attention: ${line(item)}`);
  if (data.next?.text) lines.push(`Next: ${line(data.next.text)}`);
  return lines.join('\n') + '\n';
}

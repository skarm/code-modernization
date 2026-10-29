# Codex SDK workflow: reimagine-scaffold

> Adapted from Anthropic `code-modernization/workflows/reimagine-scaffold.js` (Apache-2.0).
> Modified: the executable adapter is runtime/workflows.mjs using the official Codex SDK.
> This document retains the original process constraints; it is not a Claude Workflow runtime.

Read [CODEX.md](../references/CODEX.md) and [SDK.md](../references/SDK.md) first. The coordinator executes this procedure
within the user's authorized turn and records incomplete work honestly.

Inputs: system, approved spec and architecture, explicit service list with exclusive
paths. Both original reimagine checkpoints and applicable brief approval must be recorded.
Read [scaffolder](../agents/scaffolder.md). Reject duplicate/overlapping/traversing paths
and ambiguous ownership before writing; coordinator owns shared root configuration.

Use one SDK scaffolder thread per service, at most three in parallel or the host's lower
limit. Supply the complete approved service contract, assigned rules, intended stack and
exclusive modernized/<system>-reimagined/<service> path. The official SDK performs delegation using local Codex; no own API client/key, server or background process is added.

Workers return created files, interface/rule mapping, actual build/test results and
unimplemented behavior. Pending acceptance tests stay visibly pending; stubs are never
reported as completed business capabilities. Null/failed workers remain missing services.
Process all approved services in bounded batches, not only the first three.
The runner checks service identity, actual scope-relative ordinary files, blockers and
completed build/syntax-check events. Missing outputs or an unavailable/failed build make
the scaffold partial. Pending business acceptance behavior is tracked separately and
never becomes an implemented-system claim.

The coordinator checks boundary consistency, writes only its owned shared metadata,
executes safe available acceptance/build commands and writes AGENTS.md handoff with the
real pending work. Reconcile incompatible worker assumptions before claiming the
architecture is scaffolded. Do not deploy or confuse a scaffold with verified behavior.

## Executable entry

The coordinator writes the validated input JSON and calls `scripts/modernize.mjs run`
with `--workflow reimagine-scaffold` as documented in SDK.md. Read `examples/sdk/reimagine-scaffold.json`.
Result JSON is execution evidence; publish the original Markdown/JSON artifacts in the parent.

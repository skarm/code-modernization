# Codex SDK workflow: portfolio-assess

> Adapted from Anthropic `code-modernization/workflows/portfolio-assess.js` (Apache-2.0).
> Modified: the executable adapter is runtime/workflows.mjs using the official Codex SDK.
> This document retains the original process constraints; it is not a Claude Workflow runtime.

Read [CODEX.md](../references/CODEX.md) and [SDK.md](../references/SDK.md) first. The coordinator executes this procedure
within the user's authorized turn and records incomplete work honestly.

Inventory the requested immediate systems, then assign one read-only legacy-analyst per
system with the same metric method and output schema. Limit concurrency to actual host
capacity; missing or failed results remain visible rows, never zero-sized systems.

Each result includes system, observed stack, LOC/method or unknown, principal domains,
build/test availability, concrete modernization risk, critical debt/security observations,
confidence and missing scope/runtime evidence. Do not run source builds in its tree.
A single-system pass may delegate its appropriate original roles; do not multiply tasks
without a bounded plan or tell the user jobs continue in the background.

The coordinator checks completeness, computes the original relative scale index only
when KSLOC is actually available (`2.94 × KSLOC^1.10`) and makes clear that it is NOT an
effort/time estimate. Compare systems only with compatible measurement methods. Save
source-attributed findings and `analysis/portfolio.html` using the static report approach.
The SDK adapter bounds local scheduling; no metrics service, database or HTML generator runtime is introduced.

## Executable entry

The coordinator writes the validated input JSON and calls `scripts/modernize.mjs run`
with `--workflow portfolio-assess` as documented in SDK.md. Read `examples/sdk/portfolio-assess.json`.
Result JSON is execution evidence; publish the original Markdown/JSON artifacts in the parent.

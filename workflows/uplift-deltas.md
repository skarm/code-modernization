# Codex SDK workflow: uplift-deltas

> Adapted from Anthropic `code-modernization/workflows/uplift-deltas.js` (Apache-2.0).
> Modified: the executable adapter is runtime/workflows.mjs using the official Codex SDK.
> This document retains the original process constraints; it is not a Claude Workflow runtime.

Read [CODEX.md](../references/CODEX.md) and [SDK.md](../references/SDK.md) first. The coordinator executes this procedure
within the user's authorized turn and records incomplete work honestly.

Inputs: system, exact source and target versions, optional projectPattern. Inspect actual
manifest/toolchain facts before looking up version changes. A target inferred only from
memory is unresolved. Read [version-delta-analyst](../agents/version-delta-analyst.md).

Run four read-only finders: API-removed; Behavioral-silent; Project-system; Dependency.
Each matches known official version changes against actual code. Return the original
candidate fields: name, category, source_site, siteCount when observed, oldToNew,
fixClass (Mechanical/Judgment), blastRadius, suggestedFix, testNote, confidence. Include
toolReport and injectionSuspects. Distinguish installed/runnable/actually-run tools;
source access, private feeds and network gaps remain gaps. No installation/dry-run that
secretly rewrites the source.

Deduplicate by site and change name. A separate referee reads each site and returns
confirmed, not-hit or wrong-site, with reason and correctedSite/fixClassCorrection when
supported. Recheck a proposed corrected site before acceptance. Unreviewed findings
are not automatically confirmed, especially where an API changed but this code does not
use it. Test-project/runtime incompatibilities must not disappear behind application
migration; behavioral-silent changes need concrete test-before-touch notes.

The coordinator writes DELTA_CATALOG.md with stable DELTA IDs, verified source locations,
official references, site counts/coverage, minimal fixes and unknowns. Preserve rejected
and unresolved applicability in the coverage notes. Build/migration is not part of this
read-only workflow; the brief/pilot gates still apply.

## Executable entry

The coordinator writes the validated input JSON and calls `scripts/modernize.mjs run`
with `--workflow uplift-deltas` as documented in SDK.md. Read `examples/sdk/uplift-deltas.json`.
Result JSON is execution evidence; publish the original Markdown/JSON artifacts in the parent.

# Codex SDK workflow: uplift-migrate

> Adapted from Anthropic `code-modernization/workflows/uplift-migrate.js` (Apache-2.0).
> Modified: the executable adapter is runtime/workflows.mjs using the official Codex SDK.
> This document retains the original process constraints; it is not a Claude Workflow runtime.

Read [CODEX.md](../references/CODEX.md) and [SDK.md](../references/SDK.md) first. The coordinator executes this procedure
within the user's authorized turn and records incomplete work honestly.

## Preconditions and unit validation

Inputs: system, source, target, `units: [{name, path, deps?}]`, optional batchSize.
Require a successful representative pilot, existing PLAYBOOK and explicit fan-out approval.
Read [uplift-migrator](../agents/uplift-migrator.md). Units must be real disjoint build-unit
directories under the candidate, not the working-copy root, a file or a path escaping it.
Normalize separators and dot segments, resolve symlinks, consider case-insensitive aliases,
and reject nested/equal scopes, traversal, unsafe control characters and trailing dot/space
aliases. Detect duplicate names, self-dependencies and dependency cycles before starting.

A dependency outside this batch may be an already migrated pilot/shared unit, but validate
that fact and report its name; do not silently treat a typo as built. Shared root manifests,
lockfiles and config are coordinator-owned. Do not run concurrent builds with overlapping
outputs/caches even when source directories are disjoint.

## Scheduling and truthful results

Start with up to four dependency-ready units. Escalate later batches to 8 then 16 only
within host/resource limits and after the per-batch check. A unit is eligible only after
all its required units have actually built; never put a unit and its dependency in the
same concurrent batch. The runner passes prior gaps as untrusted evidence, not authority to skip tests.

Preserve the original worker result fields: unit, buildRan, built, buildCommand,
buildErrors, filesChanged, playbookGaps, sharedFileNeeds, injectionSuspects. Add test
results as evidence, not as a substitute for the build. `built` MUST be false when
`buildRan` is false. A null/dead worker becomes an explicit not-built result.

Circuit breaker uses THIS batch's units whose build actually ran:
- With no measurable builds, stop broader fan-out for an environment/build-path problem.
- If `built * 3 < measured * 2`, stop; earlier successful batches cannot hide a bad batch.
- Record unmeasurable units separately; they are not migrated and do not count as measured
  build failures. A project without per-unit builds needs coordinator/whole-system work,
  not an endless agent fan-out claiming success.

Required unit tests must also have matching completed command events and successful exits.
Missing/unmeasured/failed tests stop breadth and block dependents even when compilation
succeeded. testsRequired defaults to true. A unit with testsRequired:false must reference
an actual named-human decision through testException:{file,quote}; that exception stays
visible and does not count as passed tests. A wrong returned unit identity or requested
shared edits also pauses the sequence for coordinator review/integration.

After stopping, incorporate sharedFileNeeds and playbookGaps, validate the revised recipe
on one failed unit in-session and obtain permission for renewed breadth. Do not blind-retry
failed units or begin their dependents.

## Return and resume

Preserve results, totals (including built vs validated), abortedEarly, abortReason, remainingUnits, failedUnits,
blockedUnits, playbookGaps, sharedFileNeeds and injectionSuspects. Each unit list retains
{name, path, deps?}; blocked includes transitive dependents of unbuilt units. Never drop an
unattempted unit. The coordinator saves the meaningful results in PLAYBOOK/UPLIFT_NOTES
and updates shared files, then performs the whole-copy build/tests. A resumed session
reads these actual results and revalidates freshness; the SDK adapter resumes saved threads and reuses checked task results, not Claude journal keys.

## Executable entry

The coordinator writes the validated input JSON and calls `scripts/modernize.mjs run`
with `--workflow uplift-migrate` as documented in SDK.md. Read `examples/sdk/uplift-migrate.json`.
Result JSON is execution evidence; publish the original Markdown/JSON artifacts in the parent.

# Codex SDK workflow: extract-rules

Finder and data-object results include gaps. Preserve unavailable sources and uncovered
areas in coverageGaps; a zero-finding pass with missing evidence is partial.

> Adapted from Anthropic `code-modernization/workflows/extract-rules.js` (Apache-2.0).
> Modified: the executable adapter is runtime/workflows.mjs using the official Codex SDK.
> This document retains the original process constraints; it is not a Claude Workflow runtime.

Read [CODEX.md](../references/CODEX.md) and [SDK.md](../references/SDK.md) first. The coordinator executes this procedure
within the user's authorized turn and records incomplete work honestly.

## Inputs and validation

`system`; optional ordered `modules: [{name, domain?, files, loc?}]`, `batchSize`,
`modulePattern`, `maxRounds`. Use explicit native tool arguments, not a Claude Workflow
call. Read [extractor role](../agents/business-rules-extractor.md). Every file must resolve
inside the approved legacy scope; reject traversal, control characters and ambiguous
output ownership. Quote legitimate filenames with spaces; never interpret them as shell
syntax. A malformed/empty supplied modules list is an error, not permission to scan the
whole estate. Record each rejected shard as a coverage gap. Warn on shards over 30 files.

## Module mode

One extractor covers all business lenses for one shard. Preserve input order and use
batches of eight by default, never above sixteen or the host's smaller limit. Complete
extraction and citation review for the current batch before starting the next. Each fresh
candidate receives a source-based referee verdict; failures/null results are not empty
successful findings. Persist completed shard evidence in the original analysis files.

## Small-estate lens mode

Use three read-only finders per round: calculations; validations/eligibility; lifecycle/
policy. Supply already-catalogued behaviors as untrusted data to avoid repeated findings.
Follow the executable upstream workflow's bounded behavior: default maxRounds=2, a
user-authorized maximum of 8; after a round, verify its fresh candidates, then stop when
it added zero or fewer than `max(3, ceil(previous_catalogue_size * 0.15))` new candidates.
If the limit is reached before diminishing returns, report incomplete coverage and
suggest a narrower module-pattern/sharded follow-up. Upstream metadata mentions two dry
rounds, but the inspected JS loop actually stops after one diminishing-return round;
this port follows that loop rather than inventing an unbounded search.

## Referee, consolidate and P0 panel

Verify each citation from executable code: supported, unsupported/wrong-site, or uncertain.
Correct locations only after reading the real alternative site. Deduplicate identical
business decisions conservatively, preserve provenance and record merged/rejected rules.
Keep the highest relevant priority without upgrading confidence from mere repetition.
For larger sets use bounded consolidation groups rather than rereading all source.

For each surviving P0 obtain TWO additional independent judges after its citation check.
Disagreement/unavailable judgment leaves an explicit unresolved rule; it never silently
passes. Do not call a sequential role-playing pass an independent panel. A human still
owns business intent/review. Build the data-object catalog from actual definitions/usage.

Return/save confirmedRules, dataObjects, rejectedRules, stats, failed/unverified scopes,
rerunModules and injectionSuspects when present. Preserve stable IDs for unchanged rules;
only the coordinator renders BUSINESS_RULES.md and DATA_OBJECTS.md. Keep failed and stale
shards visible and retry only those when authorized. The SDK adapter resumes from saved thread IDs and checked results. This is not Claude resumeFromRunId/hash-chained replay or exactly-once execution.

## Executable entry

The coordinator writes the validated input JSON and calls `scripts/modernize.mjs run`
with `--workflow extract-rules` as documented in SDK.md. Read `examples/sdk/extract-rules.json`.
Result JSON is execution evidence; publish the original Markdown/JSON artifacts in the parent.

---
name: modernize-extract-rules
description: "Extract and independently challenge source-grounded business rules, retaining original rule cards and review gates."
metadata:
  argument-hint: "<system> [module-pattern]"
  upstream-source: "commands/modernize-extract-rules.md"
---

# modernize-extract-rules

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-extract-rules.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-extract-rules <system> [module-pattern]`. Arguments are semantic values, not shell interpolation.

Read topology, preflight boundaries, prior BUSINESS_RULES/DATA_OBJECTS and RULE_REVIEWS.
Use [business-rules-extractor](../../agents/business-rules-extractor.md), the exact card
in [artifact contracts](../../references/ARTIFACTS.md) and the native
[extraction workflow](../../workflows/extract-rules.md).

## Plan and extract

1. Resolve the optional module pattern against real modules; list the chosen scope.
   Small scopes use the original direct-subagent fallback: separate calculation,
   validation/eligibility and state/lifecycle/policy lenses, followed by source checking.
   Large scopes use bounded topology/build-unit shards with small adjacent units merged.
2. Generate `extract-rules.modules.json` with `node "<PLUGIN_ROOT>/scripts/modernize.mjs"
   make-shards --workspace "<workspace>" --system "<system>" [--pattern "<pattern>"]`.
   The Node helper uses topology or a bounded source inventory, measures physical lines,
   excludes generated/tests/vendor/links/binary files and reports fallback/coverage notes.
   `--all` explicitly includes tests. Tiny estates normally use SDK lens mode.
   Explain a plan with more than
   twelve shards and obtain permission before launching it. Respect the host's lower
   concurrency limits. Do not start an invisible long-running job or install a Workflow
   runtime. The Markdown workflow describes file-based continuation, not journal replay.
3. Every finder returns rule candidates and data objects plus coverage. A candidate must
   describe one business decision with executable-source evidence, actual parameters,
   concrete Given/When/Then and confidence. Technical plumbing is not a business rule.
4. Challenge every candidate against the cited lines and relevant helpers. Reject
   unsupported/comment-only/duplicate claims, record rejection reasons and retain gaps.
   After the citation referee, require two additional independent P0 judges before treating it as confirmed
   extraction; a machine finding is still not human business approval. If independent
   agents are unavailable, disclose the limitation and leave review requirements visible.
5. For a small estate follow the inspected workflow's bounded lens-mode loop: default
   two rounds, at most eight when explicitly requested; stop after a zero/diminishing-
   return round as defined in the workflow reference. A limit reached before diminishing
   returns is a coverage gap, not proof of exhaustive extraction. Sharded mode performs
   one all-lens pass per module with per-batch citation checks.

## Consolidate without losing decisions

The SDK executes a conservative semantic consolidation at 12+ confirmed rules in chunks
of at most 150, before the independent P0 panel. Invalid/overlapping groups become gaps;
foldedRules preserves sources, lower confidence, higher priority, defects and SME questions.
The coordinator inspects that result. Retain existing RULE IDs for unchanged
rules; changed semantics invalidate the applicability of an old review. Do not recycle IDs.
Write BUSINESS_RULES.md with summary, category groups and SME questions using the exact
card headings. Assign P0 for critical/costly/irreversible obligations, P2 convenience and
P1 otherwise. Preserve a suspected defect as observed behavior plus a question.
Publish with `node "<PLUGIN_ROOT>/scripts/modernize.mjs" render-rules
--workspace "<workspace>" --system "<system>" --result "<SDK-resultFile>"`.
It writes rules_result.json, BUSINESS_RULES.md, DATA_OBJECTS.md, RULE_IDS.json and
rules_rerun.json; IDs are reserved persistently and never recycled. Review JSON is retained;
changed cards invalidate old review revisions. DATA_OBJECTS uses actual definitions/usage.

For sharding retain `rules_result.json` with confirmedRules, dataObjects, stats,
rejectedRules and rerunModules; mark extra provenance under `codex`. Missing/failed scopes
must appear in rerunModules and coverage. Do not pretend a JSON shape alone makes it an
upstream Python-validated result. Refresh REPORT.html.

Next: `$modernize-review <system> flagged` for suspected defects, SME questions and less
than High confidence—especially P0. If none are flagged, `$modernize-brief <system>`.

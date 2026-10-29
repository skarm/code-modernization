---
name: modernize-uplift
description: "Upgrade an existing stack with a measured baseline, version deltas, a representative pilot and controlled unit migration."
metadata:
  argument-hint: "<system> [source-version] [target-version] [project-pattern]"
  upstream-source: "commands/modernize-uplift.md"
---

# modernize-uplift

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-uplift.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-uplift <system> [source-version] [target-version] [project-pattern]`. Arguments are semantic values, not shell interpolation.

Read INTENT/PREFLIGHT, the approved brief phase, topology and DELTA_CATALOG. Use
[version-delta-analyst](../../agents/version-delta-analyst.md),
[uplift-migrator](../../agents/uplift-migrator.md), the
[delta workflow](../../workflows/uplift-deltas.md) and
[migration workflow](../../workflows/uplift-migrate.md).
This is a minimum-diff version upgrade, not a rewrite or architectural cleanup.

## Bind the phase and toolchain

1. Resolve the exact source→target pair from arguments/intent and verified manifests.
   Ask about ambiguous targets; never substitute a guessed latest release. For mandatory
   intermediate upgrades, make each hop explicit and test it before the next.
2. Bind to the approved phase's modules, entry/exit criteria and external-consumer decision.
   If no applicable approval exists, return to brief/sign-off without editing code.
3. Verify target compiler/runtime AND test framework compatibility. A target-incompatible
   test harness can be a shared Phase 1 prerequisite, not an excuse to remove tests.
   Inspect installed analyzers/migration tools, distinguish present/runnable/ran, and
   run only authorized commands. Source runtime unavailable means trace-only evidence,
   never full dual-run proof. Don't bypass tests to produce a build success.
4. Create `modernized/<system>-uplifted/` as a working copy, preserving module boundaries.
   Never overwrite an existing candidate, follow symlinks into source, expose credential
   configs or initialize/commit a repository without user permission. All old-system
   execution uses a separate disposable source copy; no writes to the legacy tree.

## Baseline and deltas BEFORE touch

5. Build the old system and execute its real suite in the safe source copy when possible.
   Save raw test reports/logs under `analysis/<system>/baseline/` and BASELINE.md with
   exact commands, versions, actual per-test outcomes, pre-existing failures and `Recorded:`
   references. Hand-entered counts or a test name inventory are not a measured baseline.
   No runnable old runtime: record exactly what trace/source evidence exists and the gap.
6. Read/revise DELTA_CATALOG across API-removed, Behavioral-silent, Project-system and
   Dependency. Match deltas to actual sites. For silent behavior, add and run meaningful
   characterization tests BEFORE altering those sites. The tests must call real code;
   a dummy type/constant comparison is not a harness. Preserve pre-existing failures.
7. Decide the unit order from the dependency graph. Normally migrate leaves first, but
   handle shared test infrastructure, coordinated dependency/root configuration and
   approved external consumers explicitly. A directory is not automatically a build unit.
   Explain the plan and stop for any missing human gate before implementation.

## Representative pilot — coordinator first

8. Select ONE representative medium-complexity/high-blast-radius unit, not merely the
   easiest leaf. Perform its upgrade in the coordinator, capturing exact ordered edits,
   environment discoveries, failures/fixes and build/test commands. Build and test it.
   New silent differences require tests and a human decision, not a hidden new baseline.
9. Write `analysis/<system>/PLAYBOOK.md` from this successful pilot and update the delta
   catalog. An unexecuted checklist is not a validated playbook. If the pilot contradicts
   assumptions, propose brief revisions and renew approval; do not silently replan.
10. Present pilot evidence and ask for approval to fan out. Stop here until that approval.
    A full-plan signature does not remove this original pilot checkpoint.

## Migrate with controlled concurrency

11. Follow the SDK migration workflow: one worker per proven build unit, normally
    batches of four or the host's smaller limit, dependency-ready units only. Assign
    disjoint directories; shared manifests, lockfiles and aggregate reports are owned by
    the coordinator. Do not run races through the same build outputs or mutable caches.
12. Each worker must read PLAYBOOK/DELTA_CATALOG, apply minimal changes and actually run
    the unit's required build/tests. Collect success, failed, blocked and remaining
    separately. If fewer than two thirds of the actually run builds succeed (or none can run),
    stop the batch sequence; revise the
    playbook, validate on one previously failed unit, then ask before resuming breadth.
    Required test failures or missing matching test-command evidence also stop breadth,
    independently of the build rate. A genuine baseline/no-test exception must be an actual
    human decision recorded for that unit as testsRequired:false and testException:{file,quote};
    do not infer it or report waived tests as passed. Integrate shared-file requests before
    starting dependent units. Distinguish compiled units from fully validated units.
13. Independently build/test the whole working copy after unit work. Compare measured
    per-test outcomes old/new: PASS→FAIL is a regression; FAIL→PASS or changed outputs
    need a documented intended-change decision. Zero executed, skipped-only or removed
    tests are not evidence of preservation. Detect changed test selection and fixtures.

## Output and next step

Write UPLIFT_NOTES.md inside the candidate: version pair, applied DELTA mapping, tool vs
manual work actually performed, unit statuses, pilot/playbook, real test results,
behavioral differences and human decisions, deferred work and residual risks. Preserve
raw evidence; do not describe unfinished units as complete. Refresh REPORT.html.

If this needs broad API redesign rather than bounded compatibility edits, stop and
propose transform instead of quietly changing the meaning of uplift. Next:
`$modernize-verify <system>` on the actual upgraded copy; hardening follows evidence and
human review. Do not declare the upgrade production-ready from a successful compilation.

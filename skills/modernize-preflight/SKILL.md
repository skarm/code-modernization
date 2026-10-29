---
name: modernize-preflight
description: "Check source scope, actual build/test capabilities and five human answers before modernization."
metadata:
  argument-hint: "<system> [--source <path>]"
  upstream-source: "commands/modernize-preflight.md"
---

# modernize-preflight

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-preflight.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-preflight <system> [--source <path>]`. Arguments are semantic values, not shell interpolation.

## Inputs and source boundary

Read INTENT.md and previous PREFLIGHT.md answers. Set up `legacy/<system>` as a symlink
(or a supported platform equivalent) to an explicitly selected existing source directory.
Do not point it at the filesystem root or the user's whole home. If a link/path already
exists, resolve and compare it; never replace a different source silently. Use the plain
SOURCE-file fallback only as described in the host adaptation. Do not copy or change the
legacy tree. Put analysis and scratch outputs outside its resolved directory.

## Five human questions

Record supplied answers verbatim and ask only what is still unknown. Group into one
interaction when possible; mark unanswered as Open, never fill with assumptions.

1. What is in scope, and what outside this repository consumes its APIs/data/packages?
2. How do developers and CI actually build and test it? Are safe local test targets known?
3. Are there internal feeds, wrapper scripts, custom toolchains or unpublished components?
4. What modernization has already been attempted, and what failed or must be preserved?
5. What is off-limits: paths, systems, data, external calls or intentional legacy quirks?

## Seven checks

1. **Stack and units.** Read manifests, language/build descriptors, extended configuration,
   runtime pins and repository layout. Include parent/inherited settings, not just leaf
   files. Identify the runnable/buildable units and the intended target from INTENT.
2. **Available tools.** Distinguish present, runnable and actually executed. Existing
   scc/cloc/lizard and ecosystem analyzers are optional. Missing optional tools do not
   trigger an install. No Python/database is required. Check Node.js and the official Codex SDK using the SDK doctor; do not silently install them.
3. **Real build/test path.** Inspect CI, wrappers, Directory.Build.props/targets, NuGet
   sources, parent POM/.mvn, npm configuration and equivalents. Check runtime/compiler,
   test framework and target-version compatibility. Run a representative approved build
   in a disposable copy; build the entire project when small and safe. Validate the
   actual test target with a real test, not a manifest count or mere tool discovery.
   Record command, working directory, exit code, raw report location and failure cause.
   Networked dependencies and custom plugins need the usual permission; never hit prod.
4. **Source completeness.** Check missing includes, generated inputs, binary-only modules,
   schemas, deployment descriptors, data fixtures and external executables. Identify
   what can only be inferred because its implementation is absent.
5. **Runtime evidence/history.** Read supplied or already available operational data and
   relevant history. Do not install telemetry, connect an account or guess traffic/latency.
6. **Scope boundary.** Resolve dependencies and external consumers beyond the selected
   subtree. A shared version change can break projects outside the apparent scope.
   Present the actual choice: compatible multi-targeting, widening the approved scope,
   or scheduling a coordinated external change. Record the human decision before build.
7. **Effective protection.** Confirm where writes/tests can occur and the host's actual
   permissions. Read-only instructions are not OS enforcement. Do not create Claude
   settings, alter Codex sandbox/approval configuration or claim the plugin blocks writes.

## Result

Write PREFLIGHT.md with **Answers first**, scope/Check 6 decisions, checks and evidence,
missing information and readiness per subsequent command: Ready, Ready with gaps, or
Not ready. A missing target toolchain blocks build/verification, not reading source;
unavailable legacy execution limits comparative proof. Report separate capabilities
rather than a single misleading green light. Never turn skipped tests into passed tests.
Refresh REPORT.html. Next: `$modernize-assess <system>`.

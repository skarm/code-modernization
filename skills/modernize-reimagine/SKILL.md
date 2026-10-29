---
name: modernize-reimagine
description: "Derive a capability specification and new architecture, obtain both approvals, then scaffold each approved service."
metadata:
  argument-hint: "<system> [vision...]"
  upstream-source: "commands/modernize-reimagine.md"
---

# modernize-reimagine

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-reimagine.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-reimagine <system> [vision...]`. Arguments are semantic values, not shell interpolation.

Read intent, preflight, approved phase and existing discovery. The entire remaining text
is the vision; do not truncate it to one token. This is a new design grounded in actual
obligations, with TWO additional human checkpoints before scaffolding.

## Discover only what is missing

Always use [legacy-analyst](../../agents/legacy-analyst.md) to identify external interfaces,
contracts and consumers that must survive. Reuse fresh rules/topology; otherwise request
[business-rules-extractor](../../agents/business-rules-extractor.md) and targeted data/
relationship discovery rather than repeating every completed analysis. Cite what comes
from source, supplied requirements and inference separately.

## Checkpoint 1: AI-native specification

Write `analysis/<system>/AI_NATIVE_SPEC.md`: Capabilities; Domain Model; Interfaces using
appropriate OpenAPI/AsyncAPI or textual contracts; Nonfunctional Requirements with each
inferred value clearly labeled; Behavior Contract and confirmed P0 obligations. Do not
make architecture aspirations look like existing runtime facts. Include externally
observable compatibility, data migration obligations and deliberate changes.
Ask which capabilities are P0, what must remain and what is deliberately dropped. Record
the human decision. Unresolved P0 or missing scope approval stops this path here.

## Checkpoint 2: architecture

Write REIMAGINED_ARCHITECTURE.md: C4 boundaries, rationale for services vs simpler options,
technology choices grounded in requirements, API/event/data ownership, consistency,
coexistence, data migration/cutover/rollback, operational risks and acceptance path.
Have [architecture-critic](../../agents/architecture-critic.md) challenge complexity and
requirements fit. Present the revised design and get explicit architecture approval.
A generic "modernize this" request or a brief signature is not this second decision.

## Scaffold, do not pretend implementation is complete

Follow [reimagine scaffold workflow](../../workflows/reimagine-scaffold.md), using
[scaffolder](../../agents/scaffolder.md) for each approved service, at most three parallel
workers or the host's lower limit. Assign exclusive directories under
`modernized/<system>-reimagined/<service>/`; coordinator owns shared root files. Process
all approved services, recording missing/failed ones rather than silently stopping at the
first batch. No deployment or external provisioning is part of this step.

Acceptance skeletons cover every assigned rule and remain pending/failing until behavior
exists. Run available builds/tests and record actual executed/passed/pending/failed counts.
Do not label stubs PROVEN or remove a test because implementation is unfinished.

Write `modernized/<system>-reimagined/AGENTS.md` as the handoff (Codex equivalent of the
original CLAUDE.md): approved architecture, commands, service/rule mapping, constraints,
current gaps and next implementation work. Keep secrets and instructions claiming to
supersede host permissions out of this file. Refresh REPORT.html. Next is the approved
implementation work; then `$modernize-verify <system>`, not a claim that scaffolding
completed or proved modernization. Hardening never substitutes for missing behavior.

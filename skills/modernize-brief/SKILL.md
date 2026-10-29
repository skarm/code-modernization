---
name: modernize-brief
description: "Create the original eight-section, phase-gated modernization brief from evidence and human decisions."
metadata:
  argument-hint: "<system>"
  upstream-source: "commands/modernize-brief.md"
---

# modernize-brief

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-brief.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-brief <system>`. Arguments are semantic values, not shell interpolation.

## Inputs and prerequisites

Read INTENT, PREFLIGHT (answers and scope decisions first), ASSESSMENT, topology,
BUSINESS_RULES and RULE_REVIEWS when applicable. Do not overwrite an explicit target
with your preferred technology. A transform/reimagine contract needs its relevant rules;
uplift may use the measured baseline and version deltas without broad extraction.

For uplift, DELTA_CATALOG is required BEFORE approving implementation. If absent or stale,
run the read-only [uplift delta workflow](../../workflows/uplift-deltas.md) using
[version-delta-analyst](../../agents/version-delta-analyst.md), and save its findings first.
This is analysis, not permission to modify the code. Unknown breaking changes are gaps.

Compare an existing brief to its inputs. Preserve human edits and approval history. If
inputs changed, produce an explicit revision; don't carry a signature onto changed scope.
If a newer existing brief conflicts with a request, ask what should change rather than
replacing it. Wrong rules are not old-behavior oracles; discuss/uncertain P0 decisions
remain open questions blocking the affected modules.

## MODERNIZATION_BRIEF.md — eight sections

1. **Objective.** Goal, source/target, invariants, boundaries, excluded work and measurable
   acceptance outcomes. Quote consequential user decisions; separate inference.
2. **Target Architecture.** A grounded C4 container diagram and mapping of old modules,
   interfaces and stores to the target. For uplift preserve the existing architecture.
3. **Phased Sequence.** Normally three to six evidence-based phases; don't pad a tiny
   project. Each uses the exact `#### Phase N — ...` block in
   [ARTIFACTS.md](../../references/ARTIFACTS.md), one full `$modernize-uplift`,
   `$modernize-transform` or `$modernize-reimagine` Command, module IDs, relative Scale,
   Risk and checkable Entry/Exit criteria. Scale is not an estimated calendar duration.
   Prefer a low-risk strangler boundary for transform and dependency-leaf-first uplift,
   except test infrastructure may need Phase 1, coordinated dependency changes may span
   units, and out-of-scope shared consumers require an explicit decision. Make one
   representative pilot and its learning/review visible before broad migration.
4. **Business Walkthroughs.** Persona journeys grounded in topology flows, inputs and
   outputs, including consequential edge cases. Do not invent unobserved capabilities.
5. **Behavior Contract.** Confirmed P0 obligations, reviewed intentional changes and
   explicit gaps; for uplift measured baseline plus behavioral-silent deltas. Any less
   than High confidence affecting P0 requires a resolved human contract before build.
6. **Validation Strategy.** Actual available build/test paths; characterization before
   implementation; comparison observables/masks; mutation/canary; independent fresh
   verification and sign-off. Missing runtime/oracles cap evidence, not an invented pass.
7. **Open Questions.** Human-owned checkboxes, consequences and which phases they block.
   Never tick an answer just to make a phase ready.
8. **Approval.** Preserve the original block:
   `Approved by: ________________  Date: __________`
   `Approval covers: Phase 1 only | Full plan`
   Leave it blank until an explicit human decision. Silence is not consent.

## Finish

Write the brief, refresh REPORT.html and present the important choices and blocked items.
Do not implement code. A material revision needs renewed approval. The optional helper
is `$modernize-sign <system> "<actual name, role>"` with an explicit scope; otherwise an
ordinary clear user approval can be transcribed. After approval, follow ONLY the covered
phase command, and preserve all additional pilot/test/spec checkpoints in that skill.

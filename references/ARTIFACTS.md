# Original artifact contracts retained by the port

Paths are relative to the modernization workspace. Preserve names and identifiers so one
stage can consume another without an installer, database or memory of the chat.

## Discovery and decisions

- `analysis/<system>/INTENT.md`: goal (`understand`, `uplift`, `transform`, `reimagine`),
  source/target or vision, invariants, date, verbatim answers and unanswered items.
- `PREFLIGHT.md`: five human Answers; Check 6 scope boundary; stack, actual tooling/build
  results, source completeness, permission facts and readiness per command.
- `ASSESSMENT.md`, `ARCHITECTURE.mmd`: inventory, domains, debt, security, runtime evidence
  when available, documentation gaps and modernization recommendation.
- `topology.json`, `TOPOLOGY.html`, `map/<chunk>.json`, `call-graph.mmd`,
  `data-lineage.mmd`, `critical-path.mmd`: topology and optional browser presentation.
- `BUSINESS_RULES.md`, `DATA_OBJECTS.md`: rules and data model.
- `RULE_REVIEWS.json`, `RULE_REVIEWS.md`: human decisions; do not edit extracted cards to
  pretend the old code implements a newly desired behavior.
- `MODERNIZATION_BRIEF.md`: the eight sections, exact phase blocks and approval block.
- `rules_result.json`, `extract-rules.modules.json`: saved shard results when sharding.
  Any port-only additions to upstream-like JSON must be marked `codex`; these files are
  not claimed to be validated inputs for upstream Python utilities.

## A rule card

```text
### RULE-NNN: <plain-language name>
**Category:** Calculation | Validation | Lifecycle | Policy
**Priority:** P0 | P1 | P2
**Source:** `path/to/file.ext:line-line`
**Plain English:** <one sentence>
**Specification:**
  Given <precondition with concrete values>
  When  <trigger>
  Then  <outcome>
**Parameters:** <rates, thresholds and constants; credentials masked>
**Edge cases handled:** <list>
**Suspected defect:** <optional>
**Confidence:** High | Medium | Low — <why and the exact SME question if needed>
```

Use exactly one repo-relative source range per card; verify it from executable code.
On initial extraction number sequentially. On a rerun retain IDs for unchanged behaviors
and do not recycle a removed ID: reviews and tests may already reference it. Flag a
substantively changed card for renewed review. This small portability safeguard prevents
plain-file merges from applying an old decision to a different rule.

```json
{"system":"billing","version":1,"reviews":{"RULE-004":{"verdict":"confirmed","at":"<actual ISO time>","title":"<rule title>","note":"<user's words>"}}}
```

Review verdicts are `confirmed`, `wrong`, `discuss`. Only a new human answer may replace a
prior decision. When a card changed, do not silently reuse its previous review.

## A phase and approval

```text
#### Phase N — <name>
Command: $modernize-transform <system> <module> "<target>"
Modules: <ids from topology.json, comma-separated>
Scale: S | M | L | XL
Risk: <level; risks and mitigations>
Entry criteria:
- [ ] <checkable condition>
Exit criteria:
- [ ] <checkable condition>
```

Exactly one build skill per phase: transform, uplift or reimagine. Full invocation replaces
the original Claude command prefix. Preserve user-edited criteria; proposed changes are
explicit `Proposed revision:` text, not silently rewritten requirements.

```text
Approved by: ________________  Date: __________
Approval covers: Phase 1 only | Full plan
```

Leave blank until an explicit human decision; record the actual scope, never both choices.
`$modernize-sign` signs the BRIEF only, as the original pane command did. Verification
has a separate human sign-off block in VERIFICATION.md.

## Build outputs

Uplift: `analysis/<system>/DELTA_CATALOG.md`, `BASELINE.md`, `baseline/`, `PLAYBOOK.md`;
`modernized/<system>-uplifted/UPLIFT_NOTES.md` and the working copy.
Transform: `modernized/<system>/<module>/TRANSFORMATION_NOTES.md` and target code/tests.
Reimagine: `analysis/<system>/AI_NATIVE_SPEC.md`, `REIMAGINED_ARCHITECTURE.md`;
`modernized/<system>-reimagined/<service>/` and `AGENTS.md` handoff (Codex replacement
for upstream `CLAUDE.md`). A scaffold is not an implemented or verified system.

## Evidence and hardening

Use original folders `equivalence/`, `equivalence/fresh/`, `equivalence/canary/` and, for
multiple modules, `equivalence/<module>/`. Save test runner reports/logs, observed outputs,
`cases.json`, `fresh-cases.json`, `test-runs.json`, `EQUIVALENCE.json`,
`FRESH_EQUIVALENCE.json`, `VERIFICATION.md` and `VERIFICATION.json`.
See [VERIFICATION.md](VERIFICATION.md) for the native adaptation and its limitations.
Security uses `SECURITY_FINDINGS.md`, `security_remediation.patch`, the private
`security_remediation.local.patch` and `SECRETS.local.md`; see [SECRETS.md](SECRETS.md).

REPORT.html is derived, not authoritative. Status reads the source artifacts, not HTML.
File times help detect staleness but cannot establish byte-for-byte source immutability;
use existing host comparison tools when available and disclose weaker checks.

The optional [local UI](UI.md) adds UI_REVIEW_CONTEXT.json (reviewed card hashes) and
UI_APPROVAL_CONTEXT.json (brief revision receipt and superseded approvals). These are
freshness/audit metadata. The original RULE_REVIEWS.json and brief remain the decisions.
SDK runs advertise supportsCancellation and a per-generation control token in state.json;
cancel.json is a cooperative request for that generation, never an instruction to kill a PID.
New runs additionally record `supportsControl`, `owner`, `control`, `decisionRevision`,
`decisionHistory`, `gateChange`, `activeMs` and per-task `contextRevision` in state.json.
`heartbeat.json` contains a generation, timestamp and active-time counter; it is a liveness
receipt, not business evidence. `control.json` contains one generation-bound pause/resume/stop
request and acknowledgement IDs are checkpointed in state.json. `launch.json` records the
panel's fixed CLI resume/retry process and sanitized errors. None of these records approves
the brief or signs proof. Human decision writers serialize on `analysis/<system>/.review.lock`.

## SDK execution metadata (0.4.0)

`analysis/<system>/.codex-sdk/runs/<run-id>/` holds request/state/results/events JSON.
The workspace coordinator lock is `analysis/.codex-sdk/coordinator.lock`. These are
execution metadata, not replacement business-rule or human-approval records. See SDK.md.
State format version 2 records declared write scopes, their initial snapshots and shared
candidate input fingerprints. Start a new 0.4.0 run for changed code/contracts; earlier
checkpoints are not silently upgraded. Comparator reports identify their own evaluator;
they are observation evidence, not a standalone PROVEN verdict.

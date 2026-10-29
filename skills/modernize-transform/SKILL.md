---
name: modernize-transform
description: "Translate one approved module into a target stack, with tests before code and behavioral comparison afterwards."
metadata:
  argument-hint: "<system> [module] [target-stack]"
  upstream-source: "commands/modernize-transform.md"
---

# modernize-transform

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-transform.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-transform <system> [module] [target-stack]`. Arguments are semantic values, not shell interpolation.

Read the approved brief, preflight scope, topology, BUSINESS_RULES, RULE_REVIEWS and
[verification contract](../../references/VERIFICATION.md). Resolve the target from the
user's arguments or intent. By default select the first pending module of the earliest
approved transform phase; missing notes alone is not a reliable completion test.

## Bind and plan

1. Confirm phase scope, entry criteria, outside consumers, target tools and safe test
   endpoints. A missing target runtime blocks execution; no runnable legacy means a
   stated trace/source-only gap. Do not contact production or silently provision a service.
2. Select relevant rules. Wrong rules cannot be old-behavior oracles; unresolved P0 review
   must be settled before implementing the affected behavior. Preserve reviewed quirks
   unless a human explicitly authorized changing them.
3. Propose the mapping, target module boundary, interfaces and test strategy. Respect
   existing brief approval; ask for missing implementation permission, never broaden it.

## Characterization before implementation

4. Delegate [test-engineer](../../agents/test-engineer.md) with relevant source, rules,
   reviews and the exclusive modernized/<system>/<module> test scope. Tests need concrete
   real oracles and RULE IDs, target idioms, boundaries and error behavior. No fake values
   in place of unknown results, no skipped comparison because the old output is missing.
5. Review these executable tests and show their obligations/gaps to the user. **Ask for
   approval of the characterization tests before implementing the module**, as in the
   original workflow. A previous broad plan signature does not waive this checkpoint.

## Implement and exercise

6. Implement in `modernized/<system>/<module>/` with idiomatic target structures. Preserve
   the approved behavior, not the source language's incidental class/file arrangement.
   Do not touch the legacy code. Changes to shared contracts need the scoped decision.
7. Run the actual module tests; fix within scope, then run the full applicable suite.
   Record executed/passed/failed/skipped and raw runner output. A successful command with
   zero tests is not a pass. Missing expected outputs must be investigated, not skipped.
8. Perform a real canary in a disposable copy: introduce a small known behavioral break,
   show an otherwise passing test fails and retain the evidence; discard the mutation.
9. Run old and new implementations on the same concrete inputs where possible. Save
   observations, `equivalence/cases.json` and actual comparison outputs using the native
   evidence rules. Legitimate nondeterminism masks require reasons; unapproved semantic
   differences are failures. Present each intentional difference for human acceptance.
   Never compare only status codes if the behavior includes payloads or state changes.
10. Ask [architecture-critic](../../agents/architecture-critic.md) for a separate review.
    Address Blocker/High findings within approved scope; report unresolved findings and
    lower-priority tradeoffs, not an unqualified completed label.

## Handoff

Write TRANSFORMATION_NOTES.md with legacy-to-target behavioral mapping, changes and their
approvals, concrete old/new examples after redaction, test/canary results, missing oracles,
omissions and follow-ups. Refresh REPORT.html. Next: `$modernize-verify <system> <module>`.
The implementation agent's claims do not substitute for fresh independent verification.

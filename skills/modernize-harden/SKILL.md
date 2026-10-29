---
name: modernize-harden
description: "Find and refute security findings, then propose independently reviewed patches without applying them."
metadata:
  argument-hint: "<system> [--show-secrets]"
  upstream-source: "commands/modernize-harden.md"
---

# modernize-harden

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-harden.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-harden <system> [--show-secrets]`. Arguments are semantic values, not shell interpolation.

Read [SECRETS.md](../../references/SECRETS.md) before touching output, then the
[hardening workflow](../../workflows/harden-scan.md) and
[security-auditor](../../agents/security-auditor.md). Resolve the candidate from the approved
track and notes. With only legacy available, analysis and proposed patch generation are
allowed, but modifying source is not. `--show-secrets` never means leak raw credentials
into shared chat/reports; require a protected private channel and explicit approval.

## Find, challenge and judge

Run five scoped finder lenses: injection; authentication/session/authorization; secrets;
dependency CVEs; input validation and related boundary issues. Use native read-only
subagents when available. Verify each finding against real code and the exact installed
versions. Confirm authoritative advisory/fixed-version information when available; don't
invent a CVE or assert an unverified current vulnerability.

For each candidate obtain a source-based refutation check. Give High/Critical candidates
a second independent adjudication; unresolved or unavailable reviews are listed as such,
not confirmed by default. A scanner/comment assertion alone is not a finding. Maintain
coverage including deadFinders, unverified findings and unscanned scopes. Missing coverage
cannot produce a clean bill of health. Retry only failed/missing lenses when authorized,
merging by CWE and source location rather than duplicating the entire scan.

The executable follow-up input is `{"classes":["secrets"],"findings":[...]}`.
Valid class keys are injection, auth, secrets, deps and input. Pass only missing classes
and previously unresolved finding records (the result's `rerun` object is ready for this).
An empty follow-up or an unknown class fails before any SDK task starts. Omit both fields
for a full scan. Resume/retry-failed restores interrupted tasks of a saved run; this
selective follow-up creates a separately scoped run and does not repeat covered lenses.

## Findings and proposed remediation

Write SECURITY_FINDINGS.md with SEC IDs, CWE, severity, location, exploit preconditions,
evidence, concrete fix and residual uncertainty. Mask before saving/delegating. Private
quarantine of raw secret remediation is optional and explicitly protected; exclude it
from analysis Git and reports before writing anything sensitive.

Generate a reviewable unified `security_remediation.patch` using `a/` and `b/` paths
relative to the intended target root; identify related SEC IDs in a separate narrative or
valid patch metadata. Do not insert prose that makes the unified diff invalid. Secret
replacement hunks containing original raw values belong only in protected
`security_remediation.local.patch`, never the public patch; use a safe pointer instead.

A separate reviewer audits the proposed patch: RESOLVES, PARTIAL or INTRODUCES-RISK for
each finding. Use at most three revision rounds; unresolved or risky hunks are removed
from the apply-ready patch and described as manual work. Do not invent an independent
review by playing two roles in the same pass. Existing tests may run in a scratch copy
with the proposal, when authorized, but the real source/candidate remains unchanged.

## Finish

Present verified issues, coverage gaps, patch-review outcome and how the user can inspect
and apply the proposal to the correct target. **Do not apply the patch automatically.**
A user applying it changes the candidate and makes earlier verification stale. Recommend
retesting/reverification after application. Refresh REPORT.html. Never claim clean or
production-safe merely because no confirmed finding survived a partial scan.

---
name: modernize-assess
description: "Assess one legacy system or a portfolio, including architecture, debt, security and relative scale."
metadata:
  argument-hint: "<system> | --portfolio"
  upstream-source: "commands/modernize-assess.md"
---

# modernize-assess

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-assess.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-assess <system> | --portfolio`. Arguments are semantic values, not shell interpolation.

## Preconditions

Read INTENT.md and PREFLIGHT.md. Respect explicit scope and gaps. Assessment is read-only
on source. Read [secret handling](../../references/SECRETS.md) before delegating or reporting.

## Portfolio mode

For `--portfolio`, inventory immediate systems under legacy (and known SOURCE mappings),
not every nested package. Follow [portfolio workflow](../../workflows/portfolio-assess.md).
Use the same metrics method for every comparable system. Installed scc/cloc data is
preferable; host inspection/counting is a labeled estimate, never pretend it came from a
missing analyzer. For available KSLOC, preserve the upstream relative scale index:
`2.94 × KSLOC^1.10`. This is a comparative index, NOT person-months, a budget or duration.
Never calculate a precise score from invented LOC. Save portfolio findings and the static
`analysis/portfolio.html` view, clearly separating unavailable metrics from zero values.

## Single system

1. Inventory languages/versions, build units, frameworks, entry points, data stores,
   integrations, deployment, tests and ownership indicators. Cite actual evidence.
2. Delegate independent read-only passes when the SDK is available:
   - [legacy-analyst](../../agents/legacy-analyst.md): 5–12 grounded business domains,
     dependencies and a Mermaid overview with fewer than 40 edges per diagram.
   - [legacy-analyst](../../agents/legacy-analyst.md), separate task: the ten most material
     technical-debt findings, each file:line, consequence and remediation direction.
   - [security-auditor](../../agents/security-auditor.md): verified severity/CWE findings,
     with masked secrets and explicit coverage limits.
   Use separate sequential passes if needed and disclose loss of independent review.
3. Read existing APM/operational evidence only when available and authorized. Attribute
   real p50/p95/p99 to its period/source; otherwise say production runtime profile unknown.
4. Identify the five most consequential documentation gaps. Estimate documentation and
   complexity only with a stated repeatable method; keyword proxies are not measurements
   from a static analyzer. Surface missing external consumers from preflight.
5. Recommend a pattern using the user's intent and evidence: Rehost, Replatform, Refactor,
   Rearchitect, Rebuild or Replace. Explain how it routes to uplift, transform or reimagine;
   Rehost/Replace are not permission to run an unrelated code-writing phase.

## Artifacts

Write `analysis/<system>/ASSESSMENT.md` with: Executive Summary; System Inventory;
Architecture at a Glance; Production Runtime Profile; Technical Debt; Security Findings;
Documentation Gaps; Relative Scale; Recommended Pattern. Write ARCHITECTURE.mmd. Retain
citations and confidence; redact before saving any shared file. Refresh REPORT.html.
Next: `$modernize-map <system>`; for an explicitly chosen uplift, a targeted map/delta
analysis can feed the brief without pretending broad business-rule extraction occurred.

---
name: modernize-review
description: "Record human confirmation or disagreement with extracted rules without rewriting what the legacy code does."
metadata:
  argument-hint: "<system> [flagged|p0|all]"
  upstream-source: "commands/modernize-review.md"
---

# modernize-review

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-review.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-review <system> [flagged|p0|all]`. Arguments are semantic values, not shell interpolation.

Read BUSINESS_RULES.md, existing RULE_REVIEWS.json/Markdown and source for affected cards.
Default filter is flagged: suspected defects, SME questions or confidence below High.
`p0` selects P0; `all` selects all. Skip already reviewed unchanged cards, but surface a
changed rule whose old decision may no longer apply.

Present at most four decisions at once using a native question UI or ordinary chat.
For each show ID/title, priority, observed behavior, exact source and the uncertainty.
Choices are confirmed, wrong, discuss. A supplied explicit verdict in the user's message
counts; do not ask it again. Ask for the intended behavior when the answer is wrong, and
for the open question when it is discuss. Never fill in a human decision from inference.

Read then merge `RULE_REVIEWS.json` with the original schema in
[ARTIFACTS.md](../../references/ARTIFACTS.md): system, version:1, reviews keyed by RULE ID;
verdict, actual at timestamp, title and user's note. Preserve unrelated entries and human
wording. Write RULE_REVIEWS.md as the readable mirror. Do not edit BUSINESS_RULES.md to
make a newly desired behavior appear to be the old implementation.

A wrong rule is not a characterization oracle. An unresolved discuss/uncertain P0 blocks
the affected implementation until a human resolves its contract. Newly changed decisions
make an existing brief stale; never silently reuse its approval. Refresh REPORT.html.
Next: remaining review cards, or `$modernize-brief <system>` after required decisions.

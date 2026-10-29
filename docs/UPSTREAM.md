# Source provenance and adaptation

**English** | [Русский](UPSTREAM.ru.md)

This project adapts [Anthropic Code Modernization](https://github.com/anthropics/claude-plugins-official/tree/c8874f5ad883e26428f483ffa4d537cc81489e64/plugins/code-modernization)
under Apache-2.0. Sources were inspected on October 15, 2026, with upstream manifest
version 1.0.0; the pinned source commit is `c8874f5ad883e26428f483ffa4d537cc81489e64`.
This is an unofficial modified port, not an Anthropic or OpenAI distribution.

## Adapted sources

- Upstream `commands/` and `agents/` supply the process and role instructions in local
  `skills/` and `agents/`. The three panel helpers come from `hooks/README.md`.
- Upstream `workflows/` supplies procedural behavior reimplemented through the official
  Codex SDK in `runtime/workflows.mjs` and `runtime/engine.mjs`.
- `scripts/proof_pack.py`, `baseline_diff.py`, `trace_rules.py`, `uplift_checks.py` and
  comparison semantics were adapted to Node in `runtime/proof-*.mjs` and `runtime/compare.mjs`.
  The frozen test oracle and its limits are documented in [tests/fixtures/README.md](../tests/fixtures/README.md).
- Twenty-one pure upstream hook modules are adapted in `runtime/ui/upstream/`.
  The report template and bundled Mermaid also derive from upstream. Claude JSX and
  hook registration are replaced by the local browser UI and Codex lifecycle hooks.

## Integration boundaries

The port preserves command names, roles, modernization tracks, business artifacts and
human gates. SDK threads execute bounded tasks; the parent conversation coordinates
shared files and human decisions. The Node proof pack evaluates recorded evidence.

Python runtime utilities and telemetry are not distributed. Codex hooks do not reproduce
Claude's native terminal dock, prompt editing or immediate model interruption. Comparison
regex support is bounded rather than the complete Python `re` dialect. Contracts and limits:
[SDK](../references/SDK.md), [UI](../references/UI.md),
[verification](../references/VERIFICATION.md), [security](../references/SECURITY.md).

The SDK dependency is pinned in `package.json`; its public API was checked against
[OpenAI's rust-v0.162.1 source](https://github.com/openai/codex/tree/rust-v0.162.1/sdk/typescript).
Source inspection and frozen cases do not establish complete upstream parity or live
compatibility with every host. Check scope is described in [TESTING.md](TESTING.md).

## Attribution

[LICENSE](../LICENSE) contains Apache-2.0. [NOTICE](../NOTICE) records original authorship,
modifications, third-party libraries and Unicode data provenance. Bundled licenses remain
in `assets/vendor/`. Source-derived Markdown files identify their upstream paths.
Preserve these notices when redistributing or modifying the package.

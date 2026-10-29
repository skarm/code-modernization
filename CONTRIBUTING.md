# Contributing

**English** | [Русский](CONTRIBUTING.ru.md)

Local development requires Node.js 20+, npm and Git. Release packaging also needs `tar`
(Linux/macOS). There is no JavaScript build step: sources are ESM modules.

```bash
npm ci --ignore-scripts --bin-links=false
npm run check
npm test
```

Tests use temporary directories and local HTTP/SSE ports. They do not require Codex login,
API keys or model calls. See [docs/TESTING.md](docs/TESTING.md) for details and limitations.

Before committing, run `npm run scan:secrets`. Install Gitleaks 8.30.1 separately or set
`GITLEAKS_PATH` to its executable. The scanner checks prospective commit files and existing
Git history, excluding ignored local files. Output redacts secrets. CI runs the same check
with pinned Gitleaks and the full checkout history.

In a pull request, describe the problem, behavior change and checks performed. For a bug
fix, add a check that reproduces the failing scenario. Keep skills, contracts in
`references/`, examples and runtime consistent. Update `package-lock.json` when changing
dependencies.

English is the default for documentation, examples, UI labels and command help. Keep
Russian documentation in matching `*.ru.md` files, with links between language versions.
Use the English document at the path without a language suffix as the primary reference.
Keep both versions aligned when changing documented behavior. Skill conversations still
follow the user's language; preserve code identifiers, schema keys and source evidence.

Do not add results from real projects, credentials, local paths, raw SDK logs or release
archives. Use synthetic example data. The frozen oracle
`tests/fixtures/proof-pack-upstream.json.gz` is part of the test contract; its provenance
is described in [tests/fixtures/README.md](tests/fixtures/README.md).

Preserve Apache-2.0, SPDX headers and attribution for ported sources. When adding third-party
code, update [NOTICE](NOTICE) and license information.

Release packaging is described in [docs/RELEASING.md](docs/RELEASING.md).

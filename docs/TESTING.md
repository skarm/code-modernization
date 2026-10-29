# Testing

**English** | [Русский](TESTING.ru.md)

## Local checks

Use Node.js 20+ and npm. Packaging tests also require `tar` (Linux/macOS).

```bash
npm ci --ignore-scripts --bin-links=false
npm run check
npm test
npm run doctor
```

These checks make no model calls and do not require Codex login. Tests use temporary
files and local HTTP/SSE listeners on `127.0.0.1`. Run the full suite in an environment
that permits loopback ports; `listen EPERM` is a failed check.

To run a smaller suite:

```bash
npm run test:proof
npm run test:ui
node --test tests/interface.test.mjs
```

## What the checks establish

- `check` validates JSON, package/dependency consistency, skills, roles, workflows,
  relative Markdown links and JavaScript syntax. It is not an official host validator.
- Workflow/engine tests use SDK doubles to check state, write scopes, gates, cancellation
  and resumption. They do not evaluate model response quality.
- Proof/comparator tests use real files and 260 frozen upstream evaluator cases. They
  cover verdicts, runner reports, rule tracing, fresh inputs, canary sensitivity and
  comparison semantics. See [fixture provenance](../tests/fixtures/README.md).
- UI/lifecycle tests use local processes and HTTP/SSE requests. They do not establish
  real-browser rendering or installation in a particular Codex client.
- `doctor` checks pinned SDK import and client construction. It does not check login
  or whether the host loaded trusted hooks.

## Installation compatibility

Keep `--bin-links=false` when installing inside the plugin directory: Codex CLI 0.164.0
was observed to reject the `node_modules/.bin/codex` symlink during plugin fingerprinting.
The SDK launches its pinned CLI package directly. See [installation](../README.md#install-sdk-and-plugin).

CLI and SSH use text status; a local browser panel requires a GUI host or explicit
`--interface gui`. Hooks require the host's normal review/trust. Check installation
and hook loading in the actual client separately; see [UI behavior](../references/UI.md).

## Secrets and distribution

Install Gitleaks 8.30.1 separately or set `GITLEAKS_PATH`, then run:

```bash
npm run scan:secrets
npm run pack:release
```

The secret scan covers prospective commit files and existing local Git history, excludes
ignored local files and redacts findings. A clean scan is not proof that every possible
secret is absent. Packaging checks cover archive contents, lockfile, licenses and rejection
of symlinks/credentials. CI also installs and tests the extracted archive. See
[release preparation](RELEASING.md).

## Optional live SDK smoke

After configuring local Codex authentication:

```bash
npm run smoke:sdk -- --confirm-live
```

This makes two real model calls and consumes the selected login's allowance. It checks
structured output, thread start/resumption and retention of a synthetic phrase. Without
`--confirm-live`, no calls are made. A passing smoke does not verify every workflow,
sandbox enforcement or a real migration. Do not publish raw output containing thread IDs.

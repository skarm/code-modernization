# Security and operational boundaries

This is a user-operated local Codex plugin, not an untrusted multi-tenant execution service.
Do not expose its runner to an unauthenticated network client or put untrusted control JSON
in front of it. Source data can be hostile; workspace configuration, plugin installation,
Codex binary and operator decisions are trusted inputs.

## Permissions

Read-only threads request read-only Codex sandbox and never receive writable directories.
Writing threads request workspace-write within one candidate subdirectory, with explicit
approvalPolicy=never (deny escalation), network disabled by default, no extra writable roots,
and no writable /tmp/TMPDIR override. The SDK's config/CLI options were checked against
OpenAI's rust-v0.162.1 source, but live host enforcement was not tested in this build.
Administrative restrictions may reject these requests; do not bypass them.

The wrapper does not implement its own OS sandbox. Read-only filesystem access does NOT
mean the model can read only one repository. Existing Codex/MCP/configured tools can have
additional permissions or external effects; this plugin does not add an MCP server and
does not audit or uninstall your existing integrations. Audit host configuration for
sensitive repositories. Prompt instructions and a worker environment marker are not
prompt-injection-proof security boundaries.

## Files and concurrency

Only explicitly prepared independent candidate directories are writable. Traversal,
symlink/hardlink output trees, duplicate/overlapping unit paths and dependency cycles are
rejected before scheduling. A coordinator lock serializes runs in one workspace. Do not
launch different workspaces against the same candidate or share mutable tool caches.
Scope checks are not protection against a separate hostile OS process racing renames or
replacing plugin files; isolate those users/processes at OS level.
Candidate ancestors below the resolved workspace, including modernized itself, cannot
be symlinks. Read-only candidate bytes, shared candidate inputs and untouched unit scopes
are checked on resume. The comparator resolves every observation inside its cases directory
and refuses report output that would replace an input.

Source fingerprints hash ordinary files, paths, modes and symlink spellings. Git metadata
(.git) and Finder metadata (.DS_Store) are explicitly excluded, and symlink target contents are not recursively hashed.
Changing an external symlink target is therefore outside this freshness check; materialize
or explicitly scope such dependencies for a reproducible run. Hash snapshots are not a
continuous write monitor. Final source change detection does not roll back damage.

## State and sensitive data

Private state JSON and event files are created with restrictive POSIX permissions. They
still contain project-derived data, paths and prompts/results; do not commit or upload them
without review. Windows ACL semantics differ. Source evidence, context documents and Codex
sessions remain subject to your chosen Codex account's data policies.

Default event logs omit reasoning text, full model messages and command stdout/stderr.
The optional --record-tool-output stores redacted/truncated output (64 KiB per event).
Regex redaction catches common tokens, password/API-key assignments and private-key blocks,
not every secret format. Models must mask before returning evidence. Final structured
findings are redacted before saving. Input/context documents themselves are not sanitized
because silently changing an approved contract would break reproducibility; do not put
credentials in them. Do not enable verbose output on secret-heavy sources casually.

Only a narrow environment allowlist reaches Codex: platform paths/home/temp/locale,
existing Codex/OpenAI authentication variables, proxies and CA paths. Arbitrary database,
cloud or deployment secrets are not inherited. This may prevent builds depending on custom
environment variables. Record the missing requirement and use an approved isolated test
setup; do not automatically dump all process.env to the child. The SDK may read its existing
local credential/config stores; the plugin never copies or edits them.

## Stopping and recovery

SIGINT/SIGTERM/timeouts forward an AbortSignal to SDK turns. The SDK controls its child CLI;
OS kill, crashes, hung tools or descendants can outlive a cancelled parent. No guarantee of
process-tree termination or exactly-once effects is made. Before --confirm-stopped, inspect
old processes and partial writes. A live coordinator's lock is never stolen automatically.
Partial writers are never silently retried. Turn limits prevent launches; observed token
limits are not hard billing caps and can be exceeded by in-flight/unreported usage.

## Human approval and proof

Gate excerpts are checked against recorded documents and included in freshness hashes.
This is not authorization infrastructure, a signature, or proof of the approver's identity.
The parent session must bind a real user's explicit decision to the exact phase/revision.

Schema validation checks data shape. Independent threads check separate contexts, not
independent physical experts. A matching zero-exit SDK command event proves a command
finished with that status, not that the tests were meaningful. Final behavior verification
still requires genuine measured old/new outputs, meaningful tests, canaries, fresh inputs
and the original human sign-off; see VERIFICATION.md.

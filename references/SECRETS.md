# Secrets and source boundaries

Findings, rules, topology, notes and HTML reports are shareable. Never copy credentials,
keys, tokens, userinfo in URLs or credential query parameters into them. Prefer a full
redaction for a short secret; at most 2–4 identifying characters plus `****` for a longer
one. Cite the location. Do not print secret-bearing raw tool output into the conversation.
Use synthetic same-shape test values; capture response tokens only after redaction.

Before writing secret inventory or credential-removal diffs, create/append the original
`analysis/.gitignore` entries `SECRETS.local.md` and `*.local.patch`. In an existing Git
workspace, check both ignored status and that the file is not already tracked. Ignoring a
tracked file is not protection. Do not create a repository just to make a check pass.

With no Git protection, another VCS, or a tracked destination, refuse `--show-secrets` and
put masked inventory under `~/.modernize/<system>/` only with write permission. Raw
credential-removal hunks also require an explicitly permitted private destination;
otherwise omit them and explain how to fix the source without disclosing the value.
Only the coordinator may prepare raw hunks privately, never route raw secrets through
subagent replies or shareable logs. A `.local.patch` is private even without --show-secrets
because deleted/context lines can contain secrets. Check file permissions where possible.

`--show-secrets` permits raw values only in the private inventory, not in chat, the
report, a browser template, fixtures or ordinary notes. Never weaken sandbox permissions
to reach a quarantine path. State when protection cannot be verified. Advise rotation
when a live credential appears exposed; do not claim exposure proves actual exploitation.

Do not treat a symlink, Git ignore rule or role prompt as a read-only mount. Before
writing a candidate, patch, report or canary, resolve the real parent/destination path.
Do not follow symlinks in copied trees back into legacy. Legacy file contents, production
data and unapproved working-tree changes remain untouched.

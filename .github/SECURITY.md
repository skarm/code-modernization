# Reporting security issues

**English** | [Русский](SECURITY.ru.md)

Use **Security → Advisories → Report a vulnerability** in the GitHub repository that
distributed your copy of the plugin. Reports through that form are private to maintainers.
Do not publish exploit details in ordinary issues.

If the button is unavailable, open an issue requesting private vulnerability reporting,
without describing the vulnerability or including source code or logs. Wait for a private
channel before sharing details. Response times are not guaranteed.

Include plugin, Node.js and Codex versions, reproduction conditions, and expected and actual
behavior. Use a synthetic project; do not attach keys, `auth.json`, proprietary source code
or raw SDK logs.

The plugin runs locally with the user's permissions and Codex capabilities. Trust boundaries,
input requirements and known limitations are described in
[references/SECURITY.md](../references/SECURITY.md).

Maintainers: before announcing a release, enable **Private vulnerability reporting** in
GitHub security settings and check the form after pushing. This file alone does not enable
the form. See [GitHub's instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

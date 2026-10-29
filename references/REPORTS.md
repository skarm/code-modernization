# Reports and local UI

Generate the report from actual saved artifacts with the deterministic Node renderer:

```sh
node "<PLUGIN_ROOT>/scripts/modernize.mjs" report --workspace "/absolute/workspace" --system billing
```

It writes `analysis/<system>/REPORT.html` using the original upstream
[report template](../assets/report-template.html). Search, navigation, themes, printing,
artifact inventory, rules, build notes, comparison case tables, six/nine proof checks and
Mermaid diagrams work offline. Missing/unreadable files are disclosed. No project command
or model runs. The browser download from the live UI is a snapshot; it does not itself
write REPORT.html in the workspace.

The report is derived, not authoritative. Its timestamp is the generation time. Run the
generator after publishing a stage or human decision. A static report does not auto-update.

Embedded JSON is escaped, artifact text uses text nodes, reads are bounded, private files
are excluded, and CSP pins executable scripts by SHA-256. Nothing comes from a CDN.
Saved verdicts are checked for internal contradictions. Only the separate Node proof pack
evaluates evidence files; generating a report is not another proof run.

For the live progress panel, review deck, explicit human brief dialog, X-ray and SDK fleet,
follow [UI.md](UI.md). The offline report itself has no write/approval controls. The local
UI writes the original review/brief artifacts for authenticated explicit human choices.

The [topology viewer](../assets/topology-viewer.html) remains a standalone artifact and is
embedded with current topology.json in the live UI; see [TOPOLOGY.md](TOPOLOGY.md).
If the client cannot render HTML, provide the saved report path and a text summary.

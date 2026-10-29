---
name: modernize-map
description: "Build the original module/data/entry-point topology, persona flows and an offline visual map."
metadata:
  argument-hint: "<system> [--graph <file>]"
  upstream-source: "commands/modernize-map.md"
---

# modernize-map

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-map.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-map <system> [--graph <file>]`. Arguments are semantic values, not shell interpolation.

Read assessment, preflight scope and [topology contract](../../references/TOPOLOGY.md).
Keep the original topology.json data model, not a new generic graph schema.

## Extract a grounded graph

1. Identify build units, modules, stores, jobs, screens and external boundaries. If
   `--graph` supplies real machine-readable ecosystem output, inspect its provenance and
   map it into the original schema; spot-check approximately ten edges (all if fewer).
2. Prefer an already installed native analyzer when appropriate: approved jdeps/build
   metadata, dependency listings, `go list`, Cargo metadata or equivalent. Inspect build
   side effects and run them in scratch when necessary. Do not install an analyzer or
   create/require the original generated Python extractor. Without one, use host source
   inspection and record coverage/method as such, not an exact whole-program analysis.
3. Resolve direct calls plus dispatch/configuration/reflection wiring. Read deployment,
   schedules, schemas and cross-module data access. Connect stores across code boundaries.
   An uncalled function is not a dead end until indirect and external entry points have
   been checked. Mark uncertainty explicitly. For fixed-format COBOL account for the
   meaningful columns and continuations rather than treating sequence numbers as code.
4. For more than roughly 2,000 files or 500,000 LOC, shard by domain/build boundary into
   `analysis/<system>/map/<chunk>.json`; do not load the entire estate into one context.
   Delegate read-only chunks and merge in the coordinator. Reuse only results with checked
   matching scope/source; incomplete or stale chunks remain visible gaps, not completed.
5. Build the hierarchy, unique leaf IDs, edges, entryPoints, deadEnds and observations.
   Check that every endpoint and flow node resolves to a real node. Unknown LOC is null,
   not zero. No credentials, private DSNs or paths outside the approved scope in labels.
6. Add two to four observed persona flows, each three to eight meaningful steps, explaining
   the business action and traversed modules/stores. If evidence supports fewer, say so.

## Descriptions and presentation

Ground a 55–90 word description per selected module in actual names and source behavior,
using a compact source packet (roughly 150 relevant lines rather than an entire repo).
For more than 40 modules offer all, top 40 or none; absent a choice, describe the top 40
and mark the rest undescribed. Batch at most eight descriptions per task within host
limits; read-only subagents return text and the coordinator merges it.

Write topology.json, then validate the invariants in the topology reference. Copy the
bundled [offline viewer](../../assets/topology-viewer.html) to TOPOLOGY.html using native
file tools. Embed the reviewed JSON safely when practical, or keep its local-file chooser
and explain how to select topology.json. It opens directly in a browser without a server,
CDN or package install. Its layout is a Codex-port replacement, not upstream's D3 renderer.

Also write call-graph.mmd, data-lineage.mmd and critical-path.mmd, splitting large diagrams
below approximately 40 edges each. Refresh REPORT.html. Next: `$modernize-extract-rules
<system>` for behavior discovery, or the uplift delta/brief path already selected by user.

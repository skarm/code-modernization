# Topology contract and dependency-free rendering

Keep the original JSON shape:

```json
{"system":"<name>","root":{"id":"sys","name":"<name>","kind":"system","children":[{"id":"dom:core","name":"Core","kind":"domain","children":[{"id":"module-id","name":"Module","kind":"module","language":"go","loc":1234,"file":"src/module"}]},{"id":"dom:data","name":"Data stores","kind":"domain","children":[{"id":"ds:orders","name":"orders","kind":"datastore"}]}]},"edges":[{"source":"module-id","target":"ds:orders","kind":"read"}],"entryPoints":["module-id"],"deadEnds":[],"observations":[],"flows":[{"name":"Submit order","persona":"Customer","description":"A customer submits an order.","steps":[{"label":"Validate the order","nodes":["module-id"]}]}]}
```

This is a format example, not analysis of the user's system. Unknown size is `null`, not a
fabricated zero. A file/directory belongs to one leaf location; IDs are unique. Leaf kinds:
module, datastore, job, screen. Edge kinds: call, dispatch, read, write. Every endpoint is a
leaf ID in the tree. Do not invent a node to hide an unresolved dependency. Keep unresolved
references in observations with evidence. Datastore names are logical identifiers, never
raw DSNs. Optional leaf descriptions follow the original 55–90-word guidance.

For more than approximately 2,000 source files or 500k lines, keep per-domain chunks in
`map/<chunk>.json`. Record the input scope and inspected state for each chunk; reuse only
matching current chunks. Merge cross-chunk endpoints by ID. Report missing chunks and
never imply complete reachability while dynamic targets or deployment config are missing.

## Viewer

Copy the bundled [topology-viewer.html](../assets/topology-viewer.html) to
`analysis/<system>/TOPOLOGY.html` using host file tools. No Python, Node, web server or
external JS library is required. The user opens the HTML in a browser and chooses the
local topology.json file. All parsing/rendering is client-side and offline. It offers a
nested circle view, pan/zoom, search, edge toggles, node details and persona flow stepping.
Its layout implementation is a Codex-port replacement, not the original D3 layout.

Optional self-contained report: the coordinator may embed JSON using the file-edit tool
at the `__TOPOLOGY_DATA__` marker only after escaping `<`, `>` and `&` as JSON Unicode
escapes. Do not guess escaping for arbitrary data; the local file chooser is the safe
fallback. Do not render untrusted names/descriptions as HTML. The viewer does not execute
commands, approve rules, write workspace files, or send network requests.

Keep the small Mermaid source files too (about 40 edges each). Collapse to domain level
when needed. A missing browser preview does not invalidate the underlying topology.json.

// SPDX-License-Identifier: Apache-2.0
// Adapted from Anthropic code-modernization hooks/reader/topology.ts at c8874f5ad883.
// Types erased and ESM import extensions added for Node.js 20+. See NOTICE.
import { baseName, norm } from '../paths.mjs'

/**
 * `analysis/<system>/topology.json`, read into the few shapes the live pane uses.
 *
 * The file is written by an agent, so every field is treated as optional and
 * of unknown shape: anything that does not fit is dropped, never thrown on.
 */

                        
            
              
                                                                          
              
                                                 
             
                                                                               
               
                                                                                
                 
                                                                                   
                   
 

                                                                       

                        
              
                  
                                             
 

                        
                
                   
                                                                               
                     
                                                  
                   
                          
                       
                   
                             
                                                                           
                                     
 

const str = (value         )                     =>
  typeof value === 'string' && value !== '' ? value : undefined

const isRecord = (value         )                                   =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const list = (value         )            => (Array.isArray(value) ? value : [])

function walk(
  raw         ,
  domain                    ,
  out            ,
  depth        ,
)       {
  if (!isRecord(raw) || depth > 12) {
    return
  }

  const id = str(raw.id) ?? str(raw.name)

  if (id === undefined) {
    return
  }

  const kind = str(raw.kind) ?? 'node'
  const name = str(raw.name) ?? id
  const children = list(raw.children)
  const here = kind === 'domain' ? name : domain
  const loc = typeof raw.loc === 'number' && raw.loc > 0 ? raw.loc : 0
  const file = str(raw.file)
  const language = str(raw.language)

  if (children.length === 0 || kind === 'module') {
    out.push({
      id,
      name,
      kind,
      loc,
      ...(file !== undefined && { file: norm(file) }),
      ...(here !== undefined && { domain: here }),
      ...(language !== undefined && { language }),
    })
  }

  for (const child of children) {
    walk(child, here, out, depth + 1)
  }
}

/** Parses topology.json; null when the text is not a usable topology. */
export function parseTopology(text        )                  {
  let raw         

  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }

  if (!isRecord(raw)) {
    return null
  }

  const nodes             = []

  if (isRecord(raw.root)) {
    walk(raw.root, undefined, nodes, 0)
  }

  for (const flat of list(raw.nodes)) {
    walk(flat, undefined, nodes, 0)
  }

  if (nodes.length === 0) {
    return null
  }

  const byId = new Map                  ()

  for (const node of nodes) {
    if (!byId.has(node.id)) {
      byId.set(node.id, node)
    }
  }

  const unique = [...byId.values()]

  const modules = unique.filter(
    node =>
      node.kind === 'module' ||
      (node.file !== undefined && node.loc > 0 && node.kind !== 'datastore'),
  )

  const byDomain = new Map                    ()

  for (const node of modules) {
    const key = node.domain ?? 'Other'
    const bucket = byDomain.get(key) ?? []

    bucket.push(node)
    byDomain.set(key, bucket)
  }

  const byFileBase = new Map                    ()

  for (const node of unique) {
    if (node.file === undefined) {
      continue
    }

    const key = baseName(node.file).toLowerCase()
    const bucket = byFileBase.get(key) ?? []

    bucket.push(node)
    byFileBase.set(key, bucket)
  }

  const edges             = []

  for (const edge of list(raw.edges)) {
    if (!isRecord(edge)) {
      continue
    }

    const source = str(edge.source) ?? str(edge.from)
    const target = str(edge.target) ?? str(edge.to)

    if (source !== undefined && target !== undefined) {
      edges.push({ source, target, kind: str(edge.kind) ?? 'uses' })
    }
  }

  const flows             = []

  for (const flow of list(raw.flows)) {
    if (!isRecord(flow)) {
      continue
    }

    const name = str(flow.name)

    if (name === undefined) {
      continue
    }

    const persona = str(flow.persona)

    flows.push({
      name,
      ...(persona !== undefined && { persona }),
      steps: list(flow.steps)
        .filter(isRecord)
        .map(step => ({
          label: str(step.label) ?? '',
          nodes: list(step.nodes).filter(
            (node)                 => typeof node === 'string',
          ),
        })),
    })
  }

  const ids = (value         ) =>
    new Set(list(value).filter((id)               => typeof id === 'string'))

  return {
    system: str(raw.system) ?? '',
    nodes: unique,
    modules,
    domains: [...byDomain.entries()].map(([name, members]) => ({
      name,
      modules: members,
    })),
    edges,
    entryPoints: ids(raw.entryPoints),
    deadEnds: ids(raw.deadEnds),
    flows,
    byId,
    byFileBase,
  }
}

/**
 * The topology node a legacy file belongs to: by its path relative to
 * `legacy/<system>/` when the map recorded one, else by base name alone.
 */
export function nodeOfFile(topo          , fileRel        )                  {
  const wanted = norm(fileRel)
  const candidates = topo.byFileBase.get(baseName(wanted).toLowerCase()) ?? []

  return (
    candidates.find(node => node.file === wanted) ??
    candidates.find(node => wanted.endsWith(node.file ?? '\0')) ??
    candidates[0] ??
    null
  )
}

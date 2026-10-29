// SPDX-License-Identifier: Apache-2.0
// Adapted from Anthropic code-modernization hooks/fleet/fleet.ts at c8874f5ad883.
// Types erased and ESM import extensions added for Node.js 20+. See NOTICE.
/**
 * The fleet: every agent loop this session has seen a tool call from, kept
 * from the events themselves. A workflow's agents carry ids no `$.agent.list()`
 * names, so the registry is built from `tool.call` and `turn.complete` alone.
 *
 * It also watches for one failure repeating across agents: three agents
 * hitting the same error is a fact about the playbook, not about the agents.
 */

                        
            
                 
                
               
                
                                   
                  
                                                                                       
                     
                 
                                                                                      
               
 

                         
                                                      
              
                     
                 
                
                                                                                        
                     
                                     
                     
                                                                                                        
                    
 

                     
                               
                                    
                                                                 
                                            
                                                                                
              
               
               
                
 

/** An agent with no call for this long reads as finished or stalled, in milliseconds. */
export const IDLE_MS = 90_000

/** How many agents must share a failure before it counts as shared at all. */
export const SIGNATURE_THRESHOLD = 3

/** A shared failure is called out again once it has spread this many times further. */
export const ESCALATE_FACTOR = 5

/** And no sooner than this after the last time, in milliseconds: a fan-out fails all at once. */
export const ESCALATE_QUIET_MS = 60_000

/**
 * How many agents must share a failure before it is called out in the
 * transcript. Three of five agents is a pattern; three of five hundred is not,
 * so the bar rises with the fleet. The pane lists it from three either way.
 */
export const announceThresholdOf = (fleet       )         =>
  Math.max(SIGNATURE_THRESHOLD, Math.ceil(fleet.seen * 0.05))

/** Failures further apart than this are not the same incident, in milliseconds. */
export const SIGNATURE_WINDOW_MS = 15 * 60_000

export const newFleet = ()        => ({
  agents: new Map(),
  signatures: new Map(),
  unitHits: new Map(),
  seen: 0,
  ended: 0,
  calls: 0,
  errors: 0,
})

/** A short subject for a call, from the arguments tools commonly carry. */
export function subjectOf(tool        , args                                   )         {
  const str = (key        ) => (typeof args[key] === 'string' ? (args[key]          ) : undefined)
  const path = str('file_path') ?? str('path') ?? str('notebook_path')

  if (path !== undefined) {
    return path.split('/').slice(-1)[0] ?? path
  }

  const command = str('command')

  if (command !== undefined) {
    // What runs, not where: a leading `cd …`, `VAR=…;` or `export …` says nothing at a glance.
    const lead = /^(?:\s*(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)(?:\s+\d?>{1,2}\s*\S+)*|(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*))\s*(?:&&|;)\s*)+/

    return command.replace(/\s+/g, ' ').replace(lead, '').slice(0, 48)
  }

  return (str('pattern') ?? str('description') ?? str('query') ?? str('prompt') ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 48)
}

/** Records the start of a call by `agentId`. */
export function noteCall(
  fleet       ,
  agentId        ,
  tool        ,
  subject        ,
  nowMs        ,
  unit         ,
)           {
  if (!fleet.agents.has(agentId)) {
    fleet.seen += 1
  }

  fleet.calls += 1

  const row = fleet.agents.get(agentId) ?? {
    id: agentId,
    firstMs: nowMs,
    lastMs: nowMs,
    calls: 0,
    errors: 0,
    lastTool: tool,
    lastSubject: subject,
    isDone: false,
  }

  const next           = {
    ...row,
    lastMs: nowMs,
    calls: row.calls + 1,
    lastTool: tool,
    lastSubject: subject,
    isDone: false,
  }

  if (unit !== undefined) {
    const hits = fleet.unitHits.get(agentId) ?? new Map                ()

    hits.set(unit, (hits.get(unit) ?? 0) + 1)
    fleet.unitHits.set(agentId, hits)

    const top = [...hits.entries()].sort((a, b) => b[1] - a[1])[0]

    if (top !== undefined) {
      next.unit = top[0]
    }
  }

  fleet.agents.set(agentId, next)

  return next
}

const ERRORISH = /error|fail|exception|cannot|not found|denied|refused|blocked|unresolved|undefined|no such|does not exist|does not match/i

/** A path named by a "No such file" line, as the command printed it. */
export function missingPathOf(text        )                     {
  return /([^\s:'"]*\/[^\s:'"]+): (?:open: )?No such file or directory/.exec(text)?.[1]
}

/**
 * A failure text with what varies between agents taken out: paths, numbers,
 * hex, quoted values, timestamps. Two agents hitting one cause then match.
 *
 * Empty when the text names no cause worth matching on: a bare exit code (a
 * search that found nothing), or a malformed tool call, which is the model's
 * slip and not something the agents share.
 */
export function normalizeFailure(text        )         {
  if (/InputValidationError|could not be parsed as JSON/.test(text)) {
    return ''
  }

  const line =
    text
      .split('\n')
      .map(part => part.trim().replace(/^Exit code \d+\s*/i, ''))
      .find(part => part !== '' && ERRORISH.test(part)) ?? ''

  if (line === '') {
    return ''
  }

  // Families: one cause that words itself differently per command or per call.
  if (/file does not exist|no such file or directory|path does not exist/i.test(line)) {
    return 'a path that does not exist'
  }

  const denied = /^Permission to use (\w+) with command\s+(?:cd\s+\S+\s*(?:&&|;)\s*)?([\w./-]+)[\s\S]*has been denied/.exec(line)

  if (denied !== null) {
    return `Permission to use ${denied[1]} with command ${denied[2]} … was denied`
  }

  const blocked = /^([\w./-]+) to .+ was blocked by a deny rule/.exec(line)

  if (blocked !== null) {
    return `${blocked[1]} was blocked by a deny rule`
  }

  if (/does not match required schema/i.test(line)) {
    // Which property broke which constraint, once each: `/rules/13/category` and `/rules/27/category` are one fact.
    const clauses = new Set        ()

    for (const match of line.matchAll(/((?:\/[\w-]+)+): (must [a-z ]+?)(?=:|,|$)/g)) {
      clauses.add(`${(match[1] ?? '').replace(/\/\d+(?=\/|$)/g, '/<n>')}: ${(match[2] ?? '').trim()}`)
    }

    return `Output does not match required schema: ${[...clauses].join('; ')}`.slice(0, 140)
  }

  if (/\(eval\):\d+: =+\S* not found/.test(line)) {
    return '(eval):<n>: ==… not found'
  }

  const key = line
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/g, '<time>')
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@~+-]+){2,}\/?/g, '<path>')
    .replace(/\b0x[0-9a-fA-F]+\b/g, '<hex>')
    .replace(/\b[0-9a-f]{12,}\b/g, '<id>')
    .replace(/(["'`]).{1,60}?\1/g, '<q>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)

  // What is left must still say something: `<n> <q>` and the like match everything.
  return key.replace(/<\w+>|[^A-Za-z]+/g, ' ').trim().split(/\s+/).filter(word => word.length > 2).length >= 2 ? key : ''
}

/**
 * Records a failed call. Returns the signature when this failure is one to
 * call out now: the first time enough agents share it, and again each time it
 * has spread `ESCALATE_FACTOR` times further. `example` is what the failing
 * call was aimed at (a path, a command's head).
 */
export function noteFailure(
  fleet       ,
  agentId        ,
  errorText        ,
  nowMs        ,
  example         ,
)                   {
  const row = fleet.agents.get(agentId)

  fleet.errors += 1

  if (row !== undefined) {
    fleet.agents.set(agentId, { ...row, errors: row.errors + 1 })
  }

  const key = normalizeFailure(errorText)

  if (key.length < 12) {
    return null
  }

  const held = fleet.signatures.get(key)

  const signature            =
    held !== undefined && nowMs - held.lastMs <= SIGNATURE_WINDOW_MS
      ? held
      : { text: key, agents: new Set(), firstMs: nowMs, lastMs: nowMs, announcedAt: 0, announcedMs: 0, examples: [] }

  signature.agents.add(agentId)
  signature.lastMs = nowMs

  if (example !== undefined && example !== '' && signature.examples.length < 3 && !signature.examples.includes(example)) {
    signature.examples.push(example)
  }

  fleet.signatures.set(key, signature)

  const size = signature.agents.size

  const isDue =
    signature.announcedAt === 0
      ? size >= announceThresholdOf(fleet)
      : size >= signature.announcedAt * ESCALATE_FACTOR && nowMs - signature.announcedMs >= ESCALATE_QUIET_MS

  if (isDue) {
    signature.announcedAt = size
    signature.announcedMs = nowMs

    return signature
  }

  return null
}

/** A shared failure in one line, with what the failing calls were aimed at. */
export function lineOf(signature           , form                   = 'full')         {
  const examples = signature.examples.slice(0, form === 'short' ? 1 : 2).join(', ')
  const lead = form === 'short' ? `${signature.agents.size} agents: ` : `${signature.agents.size} agents hit the same failure: `

  return `${lead}${signature.text}${examples !== '' ? ` (e.g. ${examples})` : ''}`
}

/** Marks an agent's loop as ended (its `turn.complete`). */
export function noteDone(fleet       , agentId        , nowMs        )       {
  const row = fleet.agents.get(agentId)

  if (row !== undefined) {
    if (!row.isDone) {
      fleet.ended += 1
    }

    fleet.agents.set(agentId, { ...row, isDone: true, lastMs: nowMs })
  }
}

/** The fleet in numbers, as the pane's header line shows it. */
export function tallyOf(fleet       , nowMs        ) {
  const rows = [...fleet.agents.values()]
  const active = rows.filter(row => !row.isDone && nowMs - row.lastMs < IDLE_MS)

  return {
    total: fleet.seen,
    active: active.length,
    done: fleet.ended,
    stalled: rows.filter(row => !row.isDone && nowMs - row.lastMs >= IDLE_MS).length,
    calls: fleet.calls,
    errors: fleet.errors,
    recent: active.sort((a, b) => b.lastMs - a.lastMs),
    // The widest-spread first: the pane has room for two or three.
    shared: [...fleet.signatures.values()]
      .filter(signature => signature.agents.size >= SIGNATURE_THRESHOLD)
      .sort((a, b) => b.agents.size - a.agents.size),
  }
}

/** Forgets agents that ended long ago, keeping the registry bounded on a long run. */
export function prune(fleet       , nowMs        , keepMs = 30 * 60_000, max = 1500)       {
  if (fleet.agents.size <= max) {
    return
  }

  for (const [id, row] of fleet.agents) {
    if ((row.isDone || nowMs - row.lastMs > keepMs) && fleet.agents.size > max) {
      fleet.agents.delete(id)
      fleet.unitHits.delete(id)
    }
  }
}

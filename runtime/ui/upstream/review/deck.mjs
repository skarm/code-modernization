// SPDX-License-Identifier: Apache-2.0
// Adapted from Anthropic code-modernization hooks/review/deck.ts at c8874f5ad883.
// Types erased and ESM import extensions added for Node.js 20+. See NOTICE.
                                                                     
import { needsReview,                         } from '../reader/rules.mjs'

/**
 * The rule review deck: the rules a person should look at, in the order they
 * matter, and the ledger of what that person decided. The ledger is a file
 * of its own beside the rules (`RULE_REVIEWS.json`, with a readable
 * `RULE_REVIEWS.md`), so the agent-written rules file is never edited.
 */

                                                

const weight = (rule      )         =>
  (rule.priority === 'P0' ? 0 : rule.priority === 'P1' ? 10 : 20) +
  (rule.sme !== undefined ? 0 : 2) +
  (rule.defect !== undefined ? 0 : 1) +
  (rule.confidence !== undefined && rule.confidence !== 'High' ? 0 : 1)

/** The rules to review under `scope`, optionally only those citing a file or under a domain. */
export function queueOf(rules         , scope           , filter = '')         {
  const wanted = filter.trim().toLowerCase()

  return rules.rules
    .filter(rule => {
      if (scope === 'flagged' && !(rule.priority === 'P0' && needsReview(rule))) {
        return false
      }

      if (scope === 'p0' && rule.priority !== 'P0') {
        return false
      }

      if (wanted === '') {
        return true
      }

      return (
        rule.id.toLowerCase() === wanted ||
        (rule.domain ?? '').toLowerCase().includes(wanted) ||
        rule.title.toLowerCase().includes(wanted) ||
        rule.citations.some(citation => citation.base.includes(wanted)) ||
        // What the rule says and what is suspected of it: "truncat" finds the rounding defect whatever its title.
        [rule.statement, rule.then, rule.defect].some(text => (text ?? '').toLowerCase().includes(wanted))
      )
    })
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => weight(a.rule) - weight(b.rule) || a.index - b.index)
    .map(entry => entry.rule)
}

/** The first card at or after `from` that has no verdict yet; `from` itself when all have. */
export function nextUnreviewed(queue                 , ledger              , from        )         {
  for (let step = 0; step < queue.length; step += 1) {
    const index = (from + step) % queue.length
    const rule = queue[index]

    if (rule !== undefined && ledger[rule.id] === undefined) {
      return index
    }
  }

  return Math.min(Math.max(0, from), Math.max(0, queue.length - 1))
}

/** `ledger` with `rule` decided. */
export function decide(
  ledger              ,
  rule      ,
  verdict               ,
  atIso        ,
)               {
  // The reviewer's own words on the rule stay through a new verdict: the deck decides, it does not rewrite what was said.
  const note = ledger[rule.id]?.note

  return { ...ledger, [rule.id]: { verdict, at: atIso, title: rule.title, ...(note !== undefined && { note }) } }
}

/** `ledger` with `rule`'s verdict taken back. */
export function undecide(ledger              , ruleId        )               {
  const { [ruleId]: _gone, ...rest } = ledger

  return rest
}

export const tallyOf = (queue                 , ledger              ) => ({
  total: queue.length,
  confirmed: queue.filter(rule => ledger[rule.id]?.verdict === 'confirmed').length,
  wrong: queue.filter(rule => ledger[rule.id]?.verdict === 'wrong').length,
  discuss: queue.filter(rule => ledger[rule.id]?.verdict === 'discuss').length,
  open: queue.filter(rule => ledger[rule.id] === undefined).length,
})

/** The ledger as `RULE_REVIEWS.json` stores it. */
export function ledgerJson(system        , ledger              )         {
  return `${JSON.stringify({ system, version: 1, reviews: ledger }, null, 2)}\n`
}

const VERDICT_WORDS                                = {
  confirmed: 'Confirmed',
  wrong: 'Wrong',
  discuss: 'Needs discussion',
}

/** One table cell: one line, no pipe that would end it. */
const cell = (text                    )         => (text ?? '').replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim()

/** The ledger as a page a person or a model reads: `RULE_REVIEWS.md`. */
export function ledgerMarkdown(system        , ledger              )         {
  const entries = Object.entries(ledger).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
  const count = (verdict               ) => entries.filter(([, entry]) => entry.verdict === verdict).length

  return [
    `# Rule reviews: ${system}`,
    '',
    `A person's verdict on individual business rules in \`BUSINESS_RULES.md\`, recorded from the review deck. ${count('confirmed')} confirmed, ${count('wrong')} wrong, ${count('discuss')} needing discussion.`,
    '',
    'A rule marked **Wrong** or **Needs discussion** is not settled: do not build on it until it is resolved. A rule with no row here has not been reviewed.',
    '',
    '| Rule | Verdict | When | Title | Note |',
    '|---|---|---|---|---|',
    ...entries.map(
      ([id, entry]) =>
        `| ${id} | ${VERDICT_WORDS[entry.verdict]} | ${entry.at.slice(0, 10)} | ${cell(entry.title)} | ${cell(entry.note)} |`,
    ),
    '',
  ].join('\n')
}

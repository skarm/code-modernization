// SPDX-License-Identifier: Apache-2.0
// Adapted from Anthropic code-modernization hooks/reader/tracks.ts at c8874f5ad883.
// Types erased and ESM import extensions added for Node.js 20+. See NOTICE.
/**
 * The three ways the plugin's commands work on a system, and what each leaves behind. The pane follows
 * whichever one the artifacts on disk say is under way, so a same-stack version uplift or a greenfield
 * rebuild is followed as closely as a rewrite is.
 */

                                                           

export const TRACK_LABELS                           = {
  transform: 'rewrite',
  uplift: 'uplift',
  reimagine: 'reimagine',
}

/** The unit of work in each track, as the pane names a list of them. */
export const TRACK_UNITS                                                  = {
  transform: { one: 'module', many: 'Modules' },
  uplift: { one: 'module', many: 'Modules' },
  reimagine: { one: 'service', many: 'Services' },
}

/** What each state of a unit of work is called, by track: the same colors, worded for what the work is. */
export const STATE_WORDS_BY_TRACK                                           = {
  transform: {
    untouched: 'untouched',
    scaffolded: 'scaffolded',
    'tests-written': 'tests written',
    'tests-red': 'tests red',
    'tests-failing': 'tests failing',
    'tests-green': 'tests green',
    reviewed: 'reviewed',
    ported: 'ported',
    switched: 'switched',
  },
  uplift: {
    untouched: 'not migrated',
    scaffolded: 'changed',
    'tests-written': 'tests written',
    'tests-red': 'worse than baseline',
    'tests-failing': 'tests failing',
    'tests-green': 'tests pass',
    reviewed: 'matches baseline',
    ported: 'ported',
    switched: 'switched',
  },
  reimagine: {
    untouched: 'legacy',
    scaffolded: 'scaffolded',
    'tests-written': 'tests written',
    'tests-red': 'tests red',
    'tests-failing': 'tests failing',
    'tests-green': 'tests green',
    reviewed: 'reviewed',
    ported: 'ported',
    switched: 'switched',
  },
}

/** Times (ms) of the artifacts that mark each track as under way; null where the artifact is absent. */
                          
                            
                         
                            
 

/**
 * The track under way: the one whose own artifacts were written last. The discovery artifacts (preflight,
 * assess, map, rules, brief) feed all three and decide nothing. With no track's own artifacts a system
 * is at the start of the rewrite path, which is where the plugin's commands begin.
 */
export function pickTrack(option                   , facts            )           {
  if (option !== 'auto') {
    return option
  }

  const ranked = (
    [
      ['transform', facts.transformAt],
      ['reimagine', facts.reimagineAt],
      ['uplift', facts.upliftAt],
    ]         
  ).filter((entry)                                       => entry[1] !== null)

  if (ranked.length === 0) {
    return 'transform'
  }

  return ranked.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
}

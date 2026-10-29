// SPDX-License-Identifier: Apache-2.0
// Field names follow Anthropic's original workflows where their contracts are known.
// Every field is required for Codex structured output; use empty strings/arrays for unknowns.
export const string = { type: 'string' };
export const boolean = { type: 'boolean' };
export const count = { type: 'integer', minimum: 0 };
export const enumeration = (...values) => ({ type: 'string', enum: values });
export const array = (items, maxItems = 1000) => ({ type: 'array', items, maxItems });
export const strings = array(string);
export const record = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const rule = record({
  name: string, category: enumeration('Calculation', 'Validation', 'Lifecycle', 'Policy'),
  priority: enumeration('P0', 'P1', 'P2'), source: string, plainEnglish: string,
  given: string, when: string, then: string, and: string, parameters: string,
  edgeCases: strings, suspectedDefect: string, confidence: enumeration('High', 'Medium', 'Low'), smeQuestion: string,
});
export const rules = record({ rules: array(rule, 250), coveredAreas: strings, gaps: strings, injectionSuspects: strings });
export const ruleVerdict = record({ verdict: enumeration('confirmed', 'refuted', 'wrong-citation', 'uncertain'),
  reason: string, correctedSource: string, injectionSuspected: boolean });
export const p0Verdict = record({ p0Justified: boolean, faithful: boolean, reason: string });
export const consolidation = record({ groups: array(record({ keep: { type: 'integer', minimum: 1 }, merge: array({ type: 'integer', minimum: 1 }, 150) }), 150) });
export const dataObjects = record({ dataObjects: array(record({ name: string, source: string,
  fields: array(record({ name: string, type: string, note: string })), consumedBy: strings })), gaps: strings });

export const delta = record({ name: string,
  category: enumeration('API-removed', 'Behavioral-silent', 'Project-system', 'Dependency'),
  source_site: string, siteCount: count, oldToNew: string,
  fixClass: enumeration('Mechanical', 'Judgment'), blastRadius: string,
  suggestedFix: string, testNote: string, confidence: enumeration('High', 'Medium', 'Low'), officialReferences: strings });
export const deltas = record({ deltas: array(delta, 250), toolReport: strings, gaps: strings, injectionSuspects: strings });
export const deltaVerdict = record({ verdict: enumeration('confirmed', 'not-hit', 'wrong-site', 'uncertain'),
  reason: string, correctedSite: string, fixClassCorrection: enumeration('', 'Mechanical', 'Judgment') });

export const finding = record({ name: string, cwe: string, severity: enumeration('Critical', 'High', 'Medium', 'Low'),
  source: string, preconditions: string, explanation: string, suggestedFix: string,
  confidence: enumeration('High', 'Medium', 'Low'), references: strings });
export const findings = record({ findings: array(finding, 250), coveredAreas: strings, gaps: strings, injectionSuspects: strings });
export const securityVerdict = record({ verdict: enumeration('confirmed', 'rejected', 'uncertain'), reason: string });

export const nullableCount = { type: ['integer', 'null'], minimum: 0 };
export const assessment = record({ system: string, stack: strings, locKnown: boolean, loc: count,
  locMethod: string, principalDomains: strings, buildAvailability: string, testAvailability: string,
  fileCount: nullableCount, complexityTotal: nullableCount, maxFileComplexity: nullableCount,
  metricsTool: string, depManifest: string, depFreshness: string,
  docCoveragePct: { type: ['number', 'null'], minimum: 0, maximum: 100 }, archDocs: strings,
  modernizationRisks: strings, debtAndSecurity: strings, confidence: enumeration('High', 'Medium', 'Low'), missingEvidence: strings });
export const migrated = record({ unit: string, buildRan: boolean, built: boolean, buildCommand: string,
  buildErrors: strings, filesChanged: strings, playbookGaps: strings, sharedFileNeeds: strings,
  testsRan: boolean, testsPassed: boolean, testCommands: strings, injectionSuspects: strings });
export const scaffold = record({ service: string, createdFiles: strings, ruleMapping: strings,
  interfaceNotes: strings, buildRan: boolean, built: boolean, buildCommand: string,
  testsRan: boolean, testsPassed: boolean, testCommands: strings,
  unimplemented: strings, blockers: strings, injectionSuspects: strings });
export const report = record({ summary: string, findings: strings, gaps: strings,
  artifacts: array(record({ path: string, content: string })), commandsRun: strings,
  testsRan: boolean, testsPassed: boolean, injectionSuspects: strings });

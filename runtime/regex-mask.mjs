// SPDX-License-Identifier: Apache-2.0
// Python re's Latin-1 observation semantics, translated conservatively. Unknown
// constructs are refused rather than silently interpreted as JavaScript regexes.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { pythonPCRE, advancedSpans } from './regex-pcre.mjs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

let wasmModule;
async function maskModule() {
  return wasmModule ??= (async () => WebAssembly.compile(await readFile(createRequire(import.meta.url).resolve('@stephen-riley/pcre2-wasm/dist/libpcre2.wasm'))))();
}

const WORD = 'A-Za-z0-9_\u00aa\u00b2\u00b3\u00b5\u00b9\u00ba\u00bc-\u00be\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff';
const SPACE = '\\t-\\r\\x1c-\\x20\\x85\\xa0';
const START = '(?<![\\s\\S])', END = '(?![\\s\\S])';
export function pythonMaskRegex(source) {
  if (typeof source !== 'string' || source.length > 2048) throw new Error('Regex mask must be text of at most 2048 characters');
  if (/[^\x00-\xff]/.test(source)) throw new Error('Regex mask contains non-Latin-1 pattern characters');
  let flags = '', pos = 0, out = ''; const names = new Set();
  const head = /^\(\?([aimsux]+)\)/.exec(source); if (head) { flags = head[1]; pos = head[0].length; }
  if (new Set(flags).size !== flags.length) throw new Error('Duplicate regex flags');
  if (flags.includes('a') && flags.includes('u')) throw new Error('Regex flags a and u are incompatible');
  if (flags.includes('a') && flags.includes('i')) throw new Error('ASCII ignore-case masks use the advanced Python adapter');
  const w = flags.includes('a') ? 'A-Za-z0-9_' : WORD, space = flags.includes('a') ? '\\t-\\r ' : SPACE;
  const cls = { w, W: '^' + w, d: '0-9', D: '^0-9', s: space, S: '^' + space };
  for (; pos < source.length; pos++) {
    const ch = source[pos];
    if (flags.includes('x') && /[\t\n\r\f\v ]/.test(ch)) continue;
    if (flags.includes('x') && ch === '#') { while (pos < source.length && source[pos] !== '\n') pos++; continue; }
    if (ch === '\\') {
      const next = source[++pos]; if (!next) throw new Error('Trailing regex escape');
      if (next === 'x' && !/^[a-f0-9]{2}/i.test(source.slice(pos + 1))) throw new Error('Invalid Python hex escape');
      if (Object.hasOwn(cls, next)) out += '[' + cls[next] + ']';
      else if (next === 'A') out += START;
      else if (next === 'Z') out += END;
      else if (next === 'b') out += `(?:(?<![${w}])(?=[${w}])|(?<=[${w}])(?![${w}]))`;
      else if (next === 'B') out += `(?:(?<=[${w}])(?=[${w}])|(?<![${w}])(?![${w}]))(?!${START}${END})`;
      else if (next === 'a') out += '\\x07';
      else if (/[1-9kNgUu]/.test(next)) throw new Error('Regex mask backreferences and Unicode-name/codepoint escapes are not supported');
      else if (/[A-Za-z]/.test(next) && !'fnrtvx'.includes(next)) throw new Error('Unsupported regex escape: \\' + next);
      else out += '\\' + next;
    } else if (ch === '[') {
      let body = '', negative = false, first = true, closed = false; if (source[pos + 1] === '^') { negative = true; pos++; }
      for (pos++; pos < source.length; pos++) {
        const c = source[pos];
        if (c === ']' && !first) { closed = true; break; } first = false;
        if (c === '\\') {
          const n = source[++pos];
          if (n === 'x' && !/^[a-f0-9]{2}/i.test(source.slice(pos + 1))) throw new Error('Invalid Python hex class escape');
          if (['w', 'd', 's'].includes(n)) {
            if (source[pos + 1] === '-' && source[pos + 2] !== ']' || body.endsWith('-') && body !== '-') throw new Error('Shorthand regex class cannot be a range endpoint');
            body += cls[n];
          }
          else if (['W', 'D', 'S'].includes(n)) throw new Error('Negated shorthand classes inside a regex character class are not supported');
          else if (n === 'b') body += '\\x08';
          else if (n === 'a') body += '\\x07';
          else if (!n || /[A-Za-z]/.test(n) && !'fnrtvx'.includes(n) || /[0-9]/.test(n)) throw new Error('Unsupported escape in regex character class');
          else body += '\\' + n;
        } else body += c === '[' || c === ']' ? '\\' + c : c;
      }
      if (!closed) throw new Error('Unclosed regex character class'); out += '[' + (negative ? '^' : '') + body + ']';
    } else if (ch === '.') out += flags.includes('s') ? '[\\s\\S]' : '[^\\n]';
    else if (ch === '^') out += flags.includes('m') ? `(?:${START}|(?<=\\n))` : START;
    else if (ch === '$') out += flags.includes('m') ? `(?=\\n|${END})` : `(?=${END}|\\n${END})`;
    else if (source.startsWith('(?P<', pos)) {
      const named = /^\(\?P<([A-Za-z_][A-Za-z0-9_]*)>/.exec(source.slice(pos));
      if (!named || names.has(named[1])) throw new Error('Invalid or duplicate Python regex group name');
      names.add(named[1]); out += '(?:'; pos += named[0].length - 1;
    }
    else if (source.startsWith('(?<=', pos) || source.startsWith('(?<!', pos)) {
      // JS accepts variable-width lookbehind; Python does not. Only the shared
      // fixed-width, unnested form is admitted, so invalid Python is never widened.
      let i = pos + 4, inClass = false, ended = false;
      for (; i < source.length; i++) {
        if (source[i] === '\\') { i++; continue; }
        if (source[i] === '[') inClass = true; else if (source[i] === ']') inClass = false;
        else if (!inClass && source[i] === ')') { ended = true; break; }
        else if (!inClass && /[(*+?|{]/.test(source[i])) throw new Error('Complex or variable-width regex lookbehind is not supported');
      }
      if (!ended) throw new Error('Unclosed regex lookbehind'); out += source.slice(pos, pos + 4); pos += 3;
    }
    else if (source.startsWith('(?#', pos)) { const end = source.indexOf(')', pos + 3); if (end < 0) throw new Error('Unclosed regex comment'); pos = end; }
    else if (source.startsWith('(?', pos) && !['(?:', '(?=', '(?!'].some(s => source.startsWith(s, pos))) throw new Error('Regex mask conditional, backreference, atomic or scoped-flag groups are not supported');
    else if (ch === '{' && /^\{,\d*\}/.test(source.slice(pos))) { const m = /^\{,(\d*)\}/.exec(source.slice(pos)); out += '{0,' + m[1] + '}'; pos += m[0].length - 1; }
    else out += ch;
  }
  return new RegExp(out, 'g' + (flags.includes('i') ? 'i' : ''));
}
export async function regexSpans(bytes, source, { timeoutMs = 2000 } = {}) {
  let advanced = false;
  try { pythonMaskRegex(source); } catch { pythonPCRE(source); advanced = true; }
  const compiled = advanced ? await maskModule() : null;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { codexRegexMask: true, bytes, source, advanced, compiled }, resourceLimits: { maxOldGenerationSizeMb: 64 }, execArgv: [] });
    let settled = false;
    const finish = async (error, spans) => { if (settled) return; settled = true; clearTimeout(timer); await worker.terminate(); if (error) reject(error); else resolve(spans); };
    const timer = setTimeout(() => finish(new Error('Regex mask exceeded its time limit')), timeoutMs);
    worker.once('message', result => finish(result.error ? new Error(result.error) : null, result.spans));
    worker.once('error', error => finish(error)); worker.once('exit', code => { if (!settled) finish(new Error(`Regex mask worker exited before returning (${code})`)); });
  });
}
if (!isMainThread && workerData?.codexRegexMask === true) {
  try {
    if (workerData.advanced) {
      parentPort.postMessage({ spans: await advancedSpans(Buffer.from(workerData.bytes).toString('latin1'), workerData.source, workerData.compiled) });
    } else {
    const re = pythonMaskRegex(workerData.source), data = Buffer.from(workerData.bytes).toString('latin1'), spans = []; let m;
    while ((m = re.exec(data))) {
      if (!m[0].length) throw new Error('Zero-length regex mask matches are not supported');
      spans.push([m.index, m.index + m[0].length]); if (spans.length > 100000) throw new Error('Regex mask exceeds 100000 matches');
    }
    parentPort.postMessage({ spans });
    }
  } catch (e) { parentPort.postMessage({ error: String(e.message) }); }
}

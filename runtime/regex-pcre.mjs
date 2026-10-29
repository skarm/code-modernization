// SPDX-License-Identifier: Apache-2.0
// Python syntax adapter for advanced Latin-1 masks. PCRE2 is only loaded inside
// the disposable mask worker; no target code, native addon or Python is executed.
const WORD = 'A-Za-z0-9_\u00aa\u00b2\u00b3\u00b5\u00b9\u00ba\u00bc-\u00be\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff';
const SPACE = '\\t-\\r\\x1c-\\x20\\x85\\xa0';
import { LATIN1_NAMES } from './latin1-names.mjs';
export function pythonPCRE(source) {
  if (typeof source !== 'string' || source.length > 2048 || /[^\x00-\xff]/.test(source)) throw new Error('Regex mask requires at most 2048 Latin-1 pattern characters');
  let out = '(*UTF)(*UCP)', pos = 0, flags = new Set(), captures = 0;
  const names = new Map(), closed = new Map(), stack = [];
  const group = (kind = 'normal', capture = null) => ({ kind, capture, widths: [0], variable: false });
  let current = group();
  const atom = (width, variable = false) => { current.widths[current.widths.length - 1] += width; current.last = width; current.variable ||= variable; };
  const setFlags = (spec, previous, scoped) => {
    if (!/^[aimsux]*(?:-[imsx]+)?$/.test(spec)) throw new Error('Unsupported Python regex flags');
    const [on, off = ''] = spec.split('-');
    if (new Set(on + off).size !== (on + off).length || on.includes('a') && on.includes('u')) throw new Error('Incompatible or duplicate regex flags');
    const next = new Set(previous);
    for (const f of on) { if (f === 'a') next.delete('u'); if (f === 'u') next.delete('a'); next.add(f); }
    for (const f of off) next.delete(f);
    return next;
  };
  const pcreFlags = (next, previous) => {
    const active = f => f === 'i' ? next.has(f) && !next.has('a') : next.has(f);
    const was = f => f === 'i' ? previous.has(f) && !previous.has('a') : previous.has(f);
    const on = [...'ims'].filter(f => active(f) && !was(f)).join(''), off = [...'ims'].filter(f => !active(f) && was(f)).join('');
    return on || off ? `(?${on}${off ? '-' + off : ''})` : '';
  };
  while (source.startsWith('(?', pos)) {
    const head = /^\(\?([aimsux]+)\)/.exec(source.slice(pos)); if (!head) break;
    const next = setFlags(head[1], flags); out += pcreFlags(next, flags); flags = next; pos += head[0].length;
  }
  for (; pos < source.length; pos++) {
    const c = source[pos], w = flags.has('a') ? 'A-Za-z0-9_' : WORD, s = flags.has('a') ? '\\t-\\r ' : SPACE;
    const cls = { w, W: '^' + w, d: '0-9', D: '^0-9', s, S: '^' + s };
    if (flags.has('x') && /[\t\n\r\f\v ]/.test(c)) continue;
    if (flags.has('x') && c === '#') { while (pos < source.length && source[pos] !== '\n') pos++; continue; }
    if (c === '\\') {
      const n = source[++pos]; if (!n) throw new Error('Trailing regex escape');
      if (/[1-9]/.test(n)) {
        const digits = /^\d{1,3}/.exec(source.slice(pos))[0];
        if (/^[0-7]{3}$/.test(digits)) { const value = parseInt(digits, 8); if (value > 255) throw new Error('Octal escape outside Latin-1'); out += `\\x{${value.toString(16)}}`; pos += 2; atom(1); }
        else { const ref = /^\d{1,2}/.exec(source.slice(pos))[0], width = closed.get(Number(ref)); if (width === undefined || width.behind && (current.kind === 'behind' || stack.some(g => g.current.kind === 'behind'))) throw new Error('Python backreference must refer to an eligible closed group'); out += `\\g{${ref}}`; pos += ref.length - 1; atom(width.width, width.variable); }
      } else if (n === '0') {
        const oct = /^[0-7]{0,2}/.exec(source.slice(pos + 1))[0]; out += `\\x{${parseInt('0' + oct, 8).toString(16)}}`; pos += oct.length; atom(1);
      } else if (Object.hasOwn(cls, n)) { out += `[${cls[n]}]`; atom(1); }
      else if (n === 'b' || n === 'B') { out += n === 'b' ? `(?:(?<![${w}])(?=[${w}])|(?<=[${w}])(?![${w}]))` : `(?:(?<=[${w}])(?=[${w}])|(?<![${w}])(?![${w}]))(?!(?<![\\s\\S])(?![\\s\\S]))`; atom(0); }
      else if (n === 'A' || n === 'Z') { out += n === 'A' ? '\\A' : '\\z'; atom(0); }
      else if (n === 'a') { out += '\\x07'; atom(1); }
      else if (n === 'u' || n === 'U') {
        const size = n === 'u' ? 4 : 8, hex = source.slice(pos + 1, pos + 1 + size);
        if (hex.length !== size || !/^[a-fA-F0-9]+$/.test(hex) || parseInt(hex, 16) > 255) throw new Error('Unicode mask escape outside Latin-1');
        out += `\\x{${parseInt(hex, 16).toString(16)}}`; pos += size; atom(1);
      } else if (n === 'N') {
        const named = /^\{([^}]+)\}/.exec(source.slice(pos + 1)), code = named && LATIN1_NAMES[named[1].toUpperCase()];
        if (!Number.isInteger(code)) throw new Error('Unknown or non-Latin-1 Unicode character name');
        out += `\\x{${code.toString(16)}}`; pos += named[0].length; atom(1);
      } else if (n === 'v') { out += '\\x0b'; atom(1); }
      else if (/[A-Za-z]/.test(n) && !'fnrtx'.includes(n)) throw new Error(`Unsupported Python regex escape: \\${n}`);
      else { out += '\\' + n; if (n === 'x') { if (!/^[a-fA-F0-9]{2}/.test(source.slice(pos + 1))) throw new Error('Invalid hex escape'); out += source.slice(pos + 1, pos + 3); pos += 2; } atom(1); }
    } else if (c === '[') {
      let body = '', first = true, negative = false, ended = false;
      if (source[pos + 1] === '^') { negative = true; pos++; }
      for (pos++; pos < source.length; pos++) {
        const ch = source[pos]; if (ch === ']' && !first) { ended = true; break; } first = false;
        if (ch === '\\') {
          const n = source[++pos];
          if (['w', 'd', 's'].includes(n)) {
            if (source[pos + 1] === '-' && source[pos + 2] !== ']' || body.endsWith('-') && body !== '-') throw new Error('Shorthand cannot be a range endpoint');
            body += cls[n];
          }
          else if (['W', 'D', 'S'].includes(n)) {
            if (source[pos + 1] === '-' && source[pos + 2] !== ']' || body.endsWith('-') && body !== '-') throw new Error('Shorthand cannot be a range endpoint');
            const re = new RegExp(`[${cls[n]}]`);
            for (let code = 0; code < 256; code++) if (re.test(String.fromCharCode(code))) body += `\\x${code.toString(16).padStart(2, '0')}`;
          }
          else if (n === 'b' || n === 'a' || n === 'v') body += n === 'b' ? '\\x08' : n === 'a' ? '\\x07' : '\\x0b';
          else if (n === 'u' || n === 'U' || n === 'N') {
            let code;
            if (n === 'N') { const named = /^\{([^}]+)\}/.exec(source.slice(pos + 1)); code = named && LATIN1_NAMES[named[1].toUpperCase()]; if (named) pos += named[0].length; }
            else { const size = n === 'u' ? 4 : 8, hex = source.slice(pos + 1, pos + 1 + size); code = hex.length === size && /^[a-f0-9]+$/i.test(hex) ? parseInt(hex, 16) : null; pos += size; }
            if (!Number.isInteger(code) || code > 255) throw new Error('Unknown or non-Latin-1 Unicode class escape');
            body += `\\x${code.toString(16).padStart(2, '0')}`;
          }
          else if (/[0-7]/.test(n)) { const oct = /^[0-7]{1,3}/.exec(source.slice(pos))[0]; if (parseInt(oct, 8) > 255) throw new Error('Invalid octal class escape'); body += `\\x${parseInt(oct, 8).toString(16).padStart(2, '0')}`; pos += oct.length - 1; }
          else if (!n || /[A-Za-z]/.test(n) && !'fnrtvx'.includes(n)) throw new Error('Unsupported Python class escape');
          else { if (n === 'x' && !/^[a-f0-9]{2}/i.test(source.slice(pos + 1))) throw new Error('Invalid hex class escape'); body += '\\' + n; }
        } else body += ch === '[' || ch === ']' ? '\\' + ch : ch;
      }
      if (!ended) throw new Error('Unclosed regex class');
      if (flags.has('a') && flags.has('i')) {
        const re = new RegExp(`[${body}]`), codes = [];
        for (let n = 0; n < 256; n++) { const ch = String.fromCharCode(n), other = /[a-zA-Z]/.test(ch) ? ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase() : ch; if (re.test(ch) || re.test(other)) codes.push(`\\x${n.toString(16).padStart(2, '0')}`); }
        body = codes.join('');
      }
      out += `[${negative ? '^' : ''}${body}]`; atom(1);
    } else if (c === '(') {
      if (source.startsWith('(?#', pos)) { const end = source.indexOf(')', pos + 3); if (end < 0) throw new Error('Unclosed regex comment'); pos = end; continue; }
      const backref = /^\(\?P=([A-Za-z_]\w*)\)/.exec(source.slice(pos));
      if (backref) { const width = closed.get(names.get(backref[1])); if (!width || width.behind && (current.kind === 'behind' || stack.some(g => g.current.kind === 'behind'))) throw new Error('Unknown, open or ineligible named backreference'); out += `\\k<${backref[1]}>`; pos += backref[0].length - 1; atom(width.width, width.variable); continue; }
      const scoped = /^\(\?([aimsux]*(?:-[imsx]+)?):/.exec(source.slice(pos));
      const named = /^\(\?P<([A-Za-z_]\w*)>/.exec(source.slice(pos));
      const conditional = /^\(\?\((\d+|[A-Za-z_]\w*)\)/.exec(source.slice(pos));
      const special = /^\(\?(?:[:=!>]|<[=!])/.exec(source.slice(pos));
      let prefix = '(', kind = 'normal', capture = null, next = flags;
      if (scoped) { next = setFlags(scoped[1], flags, true); prefix = '(?:' + pcreFlags(next, flags); pos += scoped[0].length - 1; }
      else if (named) { if (names.has(named[1])) throw new Error('Duplicate Python group name'); capture = ++captures; names.set(named[1], capture); prefix = named[0]; pos += named[0].length - 1; }
      else if (conditional) { const ref = /^\d+$/.test(conditional[1]) ? Number(conditional[1]) : names.get(conditional[1]); if (!closed.has(ref)) throw new Error('Unknown conditional group'); prefix = conditional[0]; pos += conditional[0].length - 1; }
      else if (special) { prefix = special[0]; kind = prefix.startsWith('(?<') ? 'behind' : ['(?=', '(?!'].includes(prefix) ? 'ahead' : 'normal'; pos += special[0].length - 1; }
      else if (source[pos + 1] === '?') throw new Error('Unsupported Python regex group');
      else if (source[pos + 1] === '*') throw new Error('PCRE control verbs are not Python syntax');
      else capture = ++captures;
      stack.push({ current, flags }); current = group(kind, capture); flags = next; out += prefix;
    } else if (c === ')') {
      if (!stack.length) throw new Error('Unmatched regex close group');
      const width = Math.max(...current.widths), variable = current.variable || !current.widths.every(n => n === width), kind = current.kind;
      if (kind === 'behind' && variable) throw new Error('Python lookbehind must have fixed equal width');
      if (current.capture !== null) closed.set(current.capture, { width, variable, behind: kind === 'behind' || stack.some(g => g.current.kind === 'behind') });
      const parent = stack.pop(); current = parent.current; flags = parent.flags; atom(kind === 'ahead' || kind === 'behind' ? 0 : width, kind === 'ahead' || kind === 'behind' ? false : variable); out += ')';
    } else if (c === '|') { current.widths.push(0); out += c; }
    else if ('*+?'.includes(c) || c === '{' && /^\{\d*,\d*\}|^\{\d+\}/.test(source.slice(pos))) {
      const quant = c === '{' ? /^\{(\d*)(?:,(\d*))?\}/.exec(source.slice(pos)) : null;
      if (quant && (quant[2] === undefined || quant[2] !== '' && Number(quant[1]) === Number(quant[2]))) current.widths[current.widths.length - 1] += (Number(quant[1]) - 1) * (current.last ?? 0);
      else current.variable ||= (current.last ?? 1) !== 0;
      out += quant ? `{${quant[1] || '0'}${quant[2] !== undefined ? ',' + quant[2] : ''}}` : c;
      if (quant) pos += quant[0].length - 1;
      if (['?', '+'].includes(source[pos + 1])) out += source[++pos];
    } else { out += flags.has('a') && flags.has('i') && /[A-Za-z]/.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c; atom(c === '^' || c === '$' ? 0 : 1); }
  }
  if (stack.length) throw new Error('Unclosed regex group');
  return out;
}
export async function advancedSpans(data, source, compiled) {
  // Emscripten 1.39's Node loader predates built-in fetch. Disable it in this
  // isolated worker only, so it uses fs to load the pinned local WASM binary.
  globalThis.fetch = undefined;
  // Synchronous compilation avoids sharing an in-flight V8 compilation job
  // with a previous disposable worker that was terminated on its deadline.
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async (bytes, imports) => { const module = compiled ?? new WebAssembly.Module(bytes); return { module, instance: new WebAssembly.Instance(module, imports) }; };
  const { default: wasm } = await import('@stephen-riley/pcre2-wasm/dist/libpcre2.js');
  await wasm.loaded; WebAssembly.instantiate = instantiate;
  const call = (name, types) => wasm.cwrap(name, 'number', types);
  const compile = call('compile', ['array', 'number', 'string']), destroy = call('destroyCode', ['number']);
  const createData = call('createMatchData', ['number']), destroyData = call('destroyMatchData', ['number']);
  const match = call('match', ['number', 'array', 'number', 'number', 'number']), vector = call('getOvectorPointer', ['number']);
  const pattern = Buffer.from(pythonPCRE(source), 'utf16le'), subject = Buffer.from(data, 'utf16le');
  const code = compile(pattern, pattern.length / 2, '');
  if (!code) {
    const ptr = wasm._malloc(512);
    try { const size = call('lastErrorMessage', ['number', 'number'])(ptr, 256); throw new Error(`Invalid Python-compatible mask: ${Buffer.from(wasm.HEAPU8.subarray(ptr, ptr + Math.max(0, size) * 2)).toString('utf16le')}`); }
    finally { wasm._free(ptr); }
  }
  const matchData = createData(code);
  try {
    const spans = []; let start = 0;
    while (true) {
      const status = match(code, subject, data.length, start, matchData);
      if (status === -1) break;
      if (status < 0) throw new Error(`PCRE2 mask resource/match error (${status})`);
      const ptr = vector(matchData), from = wasm.HEAPU32[ptr / 4], end = wasm.HEAPU32[ptr / 4 + 1];
      if (end === from) throw new Error('Zero-length regex mask matches are not supported');
      spans.push([from, end]); start = end;
      if (spans.length > 100000) throw new Error('Regex mask exceeds 100000 matches');
    }
    return spans;
  } finally { destroyData(matchData); destroy(code); }
}

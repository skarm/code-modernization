// SPDX-License-Identifier: Apache-2.0
// Adapted from Anthropic code-modernization hooks/reader/estate-model.ts at c8874f5ad883.
// Types erased and ESM import extensions added for Node.js 20+. See NOTICE.
import { baseName, dirName, norm, stemOf } from '../paths.mjs'
import { nodeOfFile,               } from './topology.mjs'

/**
 * The estate: the units a system's code is divided into, whatever its language.
 * They come from the map's `topology.json` when there is one and from the legacy
 * tree itself when there is not, so the pane has a map from the first minute of
 * a session in any workspace.
 */

                          
            
              
                                                                                  
               
                                                                                           
              
                                                                                           
              
                                                              
               
 

/** What one unit is: a module the map named, a source file, a build module (a directory with its own build file), or a directory. */
                                                                          

                           
                        
                            
                            
                                              
                          
                     
                                                 
               
                                                                                              
                                              
                                                                         
                    
                                                                                                                                                                                                                  
                                         
 

/** A language's name by file extension: the common ones, and the mainframe and scripting ones legacy work meets. */
const LANGUAGES                         = {
  java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', groovy: 'Groovy', clj: 'Clojure',
  cs: 'C#', vb: 'VB.NET', fs: 'F#', aspx: 'ASP.NET', ascx: 'ASP.NET', cshtml: 'Razor', asp: 'Classic ASP',
  py: 'Python', rb: 'Ruby', php: 'PHP', pl: 'Perl', pm: 'Perl', lua: 'Lua', r: 'R',
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript',
  go: 'Go', rs: 'Rust', swift: 'Swift', dart: 'Dart', ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', hs: 'Haskell',
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', m: 'Objective-C',
  cbl: 'COBOL', cob: 'COBOL', cpy: 'COBOL', cobol: 'COBOL', pco: 'COBOL', jcl: 'JCL', bms: 'BMS', prc: 'JCL',
  rpg: 'RPG', rpgle: 'RPG', sqlrpgle: 'RPG', clle: 'CL', pli: 'PL/I', pl1: 'PL/I', nat: 'Natural', asm: 'Assembler',
  pas: 'Pascal', dpr: 'Delphi', bas: 'Basic', frm: 'VB6', cls: 'VB6', vbs: 'VBScript',
  sql: 'SQL', sh: 'Shell', bash: 'Shell', ps1: 'PowerShell', bat: 'Batch', cmd: 'Batch',
  jsp: 'JSP', xhtml: 'JSF', cfm: 'ColdFusion', tcl: 'Tcl', f: 'Fortran', f90: 'Fortran', for: 'Fortran',
}

/** Extensions that are not source: assets, binaries, archives, lock files, data and prose. */
const NOT_SOURCE = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'bmp', 'webp', 'pdf', 'zip', 'gz', 'tgz', 'tar', 'jar', 'war', 'ear',
  'class', 'dll', 'exe', 'so', 'dylib', 'a', 'o', 'lib', 'pyc', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp3', 'mp4',
  'mov', 'avi', 'wav', 'ogg', 'bin', 'dat', 'db', 'sqlite', 'log', 'lock', 'md', 'txt', 'rst', 'adoc', 'csv', 'tsv',
  'map', 'tmp', 'bak', 'orig', 'swp', 'ds_store', 'jks', 'p12', 'pem', 'crt', 'key', 'der', 'iso', 'img', 'rpm', 'deb',
])

/** Configuration and markup a build reads: part of the system, but never the bulk of its code. */
const CONFIG_EXT = new Set([
  'xml', 'json', 'yaml', 'yml', 'toml', 'properties', 'gradle', 'cfg', 'conf', 'ini', 'html', 'htm', 'css', 'scss',
  'less', 'vue', 'svelte', 'xsl', 'xslt', 'xsd', 'wsdl', 'proto', 'graphql', 'ftl', 'vm', 'tpl', 'twig', 'erb',
  'jspx', 'tag', 'tld', 'dtd', 'mustache', 'hbs',
])

const CONFIG_NAMES = new Set(['Makefile', 'Dockerfile', 'Jenkinsfile', 'Rakefile', 'Gemfile', 'Vagrantfile', 'Procfile'])

const extOf = (name        )         => {
  const dot = name.lastIndexOf('.')

  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

/** A single file counts for at most this much: one binary blob or one generated file must not be a system's bulk. */
const CAP_SOURCE = 400_000
const CAP_CONFIG = 100_000

/**
 * What a file adds to the estate's size: its bytes (capped) when it is source or configuration, nothing when it is
 * an asset, an archive, a document or a file of no known kind. `isLenient` counts unknown kinds as source too, for
 * a language this list does not know.
 */
export function weightOf(name        , size        , isLenient = false)         {
  if (name.startsWith('.')) {
    return 0
  }

  const ext = extOf(name)

  if (NOT_SOURCE.has(ext)) {
    return 0
  }

  if (LANGUAGES[ext] !== undefined) {
    return Math.min(size, CAP_SOURCE)
  }

  if (CONFIG_EXT.has(ext) || CONFIG_NAMES.has(name)) {
    return Math.min(size, CAP_CONFIG)
  }

  return isLenient ? Math.min(size, CAP_SOURCE) : 0
}

/** Whether a file is one the estate counts (source or configuration). */
export const isSourceFile = (name        )          => weightOf(name, 1) > 0

export const languageOf = (name        )                     => LANGUAGES[extOf(name)]

/** A language name as a person writes it, from what a map recorded (`cobol` -> `COBOL`, `java` -> `Java`). */
const nameOfLanguage = (raw        )         => {
  const known = Object.values(LANGUAGES).find(name => name.toLowerCase() === raw.toLowerCase())

  return known ?? (raw.length <= 4 ? raw.toUpperCase() : raw.charAt(0).toUpperCase() + raw.slice(1))
}

/** The estate as a topology's modules, sized in lines. */
export function estateOfTopology(topology          , files        )              {
  const byLanguage = new Map                ()

  for (const node of topology.modules) {
    if (node.language !== undefined) {
      byLanguage.set(nameOfLanguage(node.language), (byLanguage.get(nameOfLanguage(node.language)) ?? 0) + Math.max(1, node.loc))
    }
  }

  const total = [...byLanguage.values()].reduce((sum, size) => sum + size, 0)

  return {
    source: 'map',
    measure: 'lines',
    granularity: 'module',
    units: topology.modules.map(node => ({
      id: node.id,
      name: node.name,
      group: node.domain ?? 'Other',
      size: Math.max(1, node.loc),
      ...(node.file !== undefined && { file: node.file }),
    })),
    files,
    languages: [...byLanguage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, size]) => ({ name, share: total > 0 ? size / total : 0 })),
    isPartial: false,
  }
}

/**
 * The unit a path under `legacy/<system>/` belongs to: by the map's own file
 * where there is a map, else by the file itself or the nearest directory that is a unit.
 */
export function unitOfPath(
  estate             ,
  topology                 ,
  rel        ,
)                    {
  const wanted = norm(rel)

  if (estate.source === 'map' && topology !== null) {
    const node = nodeOfFile(topology, wanted)

    return node === null ? null : (estate.units.find(unit => unit.id === node.id) ?? null)
  }

  const exact = estate.units.find(unit => unit.file === wanted)

  if (exact !== undefined) {
    return exact
  }

  let best                    = null
  let bestLength = -1

  for (const unit of estate.units) {
    const dir = unit.dir

    if (dir === undefined) {
      continue
    }

    const isInside = dir === '' || wanted === dir || wanted.startsWith(`${dir}/`)

    if (isInside && dir.length > bestLength) {
      best = unit
      bestLength = dir.length
    }
  }

  return best
}

/** The names a transformed directory may be matched to a unit by: the id, the name, and the last path segment. */
export function keysOfUnit(unit            )           {
  const own = unit.dir !== undefined && unit.dir !== '' ? baseName(unit.dir) : unit.file !== undefined ? stemOf(unit.file) : ''

  return [unit.id, unit.name, own].filter(key => key !== '')
}

/** The group a unit's directory sits in: its parent directory, or the root's own label. */
export const groupOfDir = (dir        , rootLabel        )         => {
  const parent = dirName(dir)

  return parent === '' ? rootLabel : parent
}

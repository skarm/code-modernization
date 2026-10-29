// SPDX-License-Identifier: Apache-2.0
// Adapted from Anthropic code-modernization hooks/reader/fs.ts at c8874f5ad883.
// Types erased and ESM import extensions added for Node.js 20+. See NOTICE.
/**
 * The file access the reader needs, narrow enough that `$.fs` and a test's
 * in-memory tree both satisfy it. Paths are relative to the session's
 * working directory or absolute, as `$.fs` takes them.
 */
                        
                                         
                                                                                                                           
                                                                                                                     
                                            
                                                                                                    
 

/** `read`, or null when the file is missing, unreadable or over the size cap. */
export async function readOrNull(fs          , path        )                         {
  try {
    // `exists` never rejects; asking first keeps a missing optional file out of the error log.
    if (!(await fs.exists(path))) {
      return null
    }

    return await fs.read(path)
  } catch {
    return null
  }
}

/** `list`, or an empty list when the directory is missing. */
export async function listOrEmpty(
  fs          ,
  path        ,
)                                                                                              {
  try {
    if (!(await fs.exists(path))) {
      return []
    }

    return await fs.list(path)
  } catch {
    return []
  }
}

/** `stat`'s mtime, or null when the path is missing. */
export async function mtimeOrNull(fs          , path        )                         {
  try {
    if (!(await fs.exists(path))) {
      return null
    }

    return (await fs.stat(path)).mtimeMs
  } catch {
    return null
  }
}

/**
 * The directories under `path`, by name. A symbolic link to a directory counts: the engine lists a link as `other`,
 * and a legacy tree is often a link to where the code really lives.
 */
export async function dirNamesOf(fs          , path        )                    {
  const names           = []

  for (const entry of await listOrEmpty(fs, path)) {
    if (entry.kind === 'dir') {
      names.push(entry.name)
    } else if (entry.kind === 'other') {
      try {
        if ((await fs.stat(`${path}/${entry.name}`)).kind === 'dir') {
          names.push(entry.name)
        }
      } catch {
        // a link that leads nowhere is not a system
      }
    }
  }

  return names
}

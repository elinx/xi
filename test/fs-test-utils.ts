import { readdirSync, statSync } from 'fs'
import { join } from 'path'

const HIDDEN_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.pi', '.sisyphus', '.claude', '.playwright-cli'])

export function readdirFiltered(dirPath: string): Array<{ name: string; path: string; isDirectory: boolean }> {
  const entries = readdirSync(dirPath)
    .filter(name => !HIDDEN_DIRS.has(name) && !name.startsWith('.'))
    .map(name => {
      const fullPath = join(dirPath, name)
      try {
        const isDir = statSync(fullPath).isDirectory()
        return { name, path: fullPath, isDirectory: isDir }
      } catch {
        return null
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return entries
}

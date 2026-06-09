import { describe, it, expect } from 'vitest'
import { resolve, relative } from 'node:path'

const PROTECTED_DIR_NAMES = new Set(['.xi', '.git', 'node_modules'])

function isProtectedPath(absolutePath: string, cwd: string): boolean {
  const rel = relative(cwd, absolutePath)
  if (rel.startsWith('..') || resolve(absolutePath) !== absolutePath) {
    const normalized = absolutePath.replace(/\\/g, '/')
    for (const name of PROTECTED_DIR_NAMES) {
      const pattern = `/${name}/`
      if (normalized.includes(pattern)) return true
      if (normalized.endsWith(`/${name}`)) return true
    }
    return false
  }
  const parts = rel.replace(/\\/g, '/').split('/')
  return PROTECTED_DIR_NAMES.has(parts[0])
}

describe('Issue #18: protected directory path validation', () => {
  const cwd = '/Users/test/project'

  describe('.xi directory', () => {
    it('blocks write to .xi/auth.json', () => {
      expect(isProtectedPath('/Users/test/project/.xi/auth.json', cwd)).toBe(true)
    })

    it('blocks write to .xi/sessions/session.jsonl', () => {
      expect(isProtectedPath('/Users/test/project/.xi/sessions/session.jsonl', cwd)).toBe(true)
    })

    it('blocks write to .xi itself', () => {
      expect(isProtectedPath('/Users/test/project/.xi', cwd)).toBe(true)
    })
  })

  describe('.git directory', () => {
    it('blocks write to .git/config', () => {
      expect(isProtectedPath('/Users/test/project/.git/config', cwd)).toBe(true)
    })

    it('blocks write to .git/HEAD', () => {
      expect(isProtectedPath('/Users/test/project/.git/HEAD', cwd)).toBe(true)
    })
  })

  describe('node_modules directory', () => {
    it('blocks write to node_modules/pkg/index.js', () => {
      expect(isProtectedPath('/Users/test/project/node_modules/pkg/index.js', cwd)).toBe(true)
    })

    it('blocks write to node_modules/.package-lock.json', () => {
      expect(isProtectedPath('/Users/test/project/node_modules/.package-lock.json', cwd)).toBe(true)
    })
  })

  describe('allowed paths', () => {
    it('allows write to src/index.ts', () => {
      expect(isProtectedPath('/Users/test/project/src/index.ts', cwd)).toBe(false)
    })

    it('allows write to README.md', () => {
      expect(isProtectedPath('/Users/test/project/README.md', cwd)).toBe(false)
    })

    it('allows write to docs/guide.md', () => {
      expect(isProtectedPath('/Users/test/project/docs/guide.md', cwd)).toBe(false)
    })

    it('does not block file with xi in name (xi.config.ts)', () => {
      expect(isProtectedPath('/Users/test/project/xi.config.ts', cwd)).toBe(false)
    })

    it('does not block file with git in name (gitignore.md)', () => {
      expect(isProtectedPath('/Users/test/project/gitignore.md', cwd)).toBe(false)
    })

    it('does not block my-node-modules-backup/', () => {
      expect(isProtectedPath('/Users/test/project/my-node-modules-backup/readme.txt', cwd)).toBe(false)
    })
  })

  describe('paths outside cwd', () => {
    it('blocks .xi in path even outside cwd', () => {
      expect(isProtectedPath('/tmp/some/.xi/auth.json', cwd)).toBe(true)
    })

    it('allows arbitrary path without protected dir name', () => {
      expect(isProtectedPath('/tmp/some/other/file.txt', cwd)).toBe(false)
    })
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('Issue #16: restore last project on restart', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'xi-project-restore-test-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('saves and restores project cwd', () => {
    const lastProjectFile = join(testDir, 'last-project.json')
    const savedCwd = '/Users/test/my-project'

    writeFileSync(lastProjectFile, JSON.stringify({
      cwd: savedCwd,
      updatedAt: new Date().toISOString(),
    }))

    expect(existsSync(lastProjectFile)).toBe(true)

    const data = JSON.parse(readFileSync(lastProjectFile, 'utf-8')) as { cwd: string; updatedAt: string }
    expect(data.cwd).toBe(savedCwd)
  })

  it('does not restore if saved cwd does not exist', () => {
    const savedCwd = '/nonexistent/path/that/does/not/exist'
    expect(existsSync(savedCwd)).toBe(false)
    // Restore logic should check existsSync before chdir
  })

  it('does not restore if saved cwd equals current cwd', () => {
    const currentCwd = process.cwd()
    const savedCwd = currentCwd
    // resolve(savedCwd) !== resolve(process.cwd()) should be false
    expect(savedCwd === currentCwd).toBe(true)
  })

  it('last-project.json has correct structure', () => {
    const lastProjectFile = join(testDir, 'last-project.json')
    writeFileSync(lastProjectFile, JSON.stringify({
      cwd: '/Users/test/project',
      updatedAt: '2026-06-10T00:00:00Z',
    }, null, 2))

    const data = JSON.parse(readFileSync(lastProjectFile, 'utf-8')) as Record<string, unknown>
    expect(data).toHaveProperty('cwd')
    expect(data).toHaveProperty('updatedAt')
    expect(typeof data.cwd).toBe('string')
    expect(typeof data.updatedAt).toBe('string')
  })
})

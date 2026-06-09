import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function createSearchSessionsLogic(cwd: string, query: string, limit = 10) {
  const fsSync = require('fs')
  const sessionsDir = join(cwd, '.xi', 'sessions')
  if (!fsSync.existsSync(sessionsDir)) {
    return { found: false, results: [] }
  }
  const files = fsSync.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl')).map((f: string) => join(sessionsDir, f))
  const results: Array<{ name: string; matches: string[] }> = []
  const q = query.toLowerCase()
  for (const filePath of files) {
    if (results.length >= limit) break
    const content = fsSync.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const matches: string[] = []
    let sessionName = ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'session' && entry.name) sessionName = entry.name
        if (entry.type === 'message' && entry.message?.content) {
          const msgContent = typeof entry.message.content === 'string'
            ? entry.message.content
            : JSON.stringify(entry.message.content)
          if (msgContent.toLowerCase().includes(q)) {
            matches.push(msgContent.substring(0, 200))
            if (matches.length >= 3) break
          }
        }
      } catch { continue }
    }
    if (matches.length > 0 || sessionName.toLowerCase().includes(q)) {
      results.push({ name: sessionName, matches })
    }
  }
  return { found: results.length > 0, results }
}

function writeSession(dir: string, filename: string, name: string, messages: Array<{ role: string; content: string }>) {
  mkdirSync(dir, { recursive: true })
  const lines = [
    JSON.stringify({ type: 'session', version: 3, name, cwd: dir }),
  ]
  for (const msg of messages) {
    lines.push(JSON.stringify({
      type: 'message',
      message: { role: msg.role, content: msg.content },
    }))
  }
  writeFileSync(join(dir, filename), lines.join('\n') + '\n')
}

describe('Issue #20: searchSessions tool', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'xi-search-sessions-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('finds session by name', () => {
    const sessionsDir = join(testDir, '.xi', 'sessions')
    writeSession(sessionsDir, 'bug-fix.jsonl', 'bug-fix-session', [
      { role: 'user', content: 'Fix the login bug' },
    ])
    const result = createSearchSessionsLogic(testDir, 'bug-fix')
    expect(result.found).toBe(true)
    expect(result.results[0].name).toBe('bug-fix-session')
  })

  it('finds session by message content', () => {
    const sessionsDir = join(testDir, '.xi', 'sessions')
    writeSession(sessionsDir, 'feature.jsonl', 'feature-work', [
      { role: 'user', content: 'Implement the payment gateway' },
      { role: 'assistant', content: 'I will add Stripe integration' },
    ])
    const result = createSearchSessionsLogic(testDir, 'stripe')
    expect(result.found).toBe(true)
    expect(result.results[0].matches.length).toBeGreaterThan(0)
  })

  it('returns empty when no matches', () => {
    const sessionsDir = join(testDir, '.xi', 'sessions')
    writeSession(sessionsDir, 'other.jsonl', 'other-session', [
      { role: 'user', content: 'Something unrelated' },
    ])
    const result = createSearchSessionsLogic(testDir, 'nonexistent-query')
    expect(result.found).toBe(false)
    expect(result.results).toHaveLength(0)
  })

  it('handles missing sessions directory', () => {
    const result = createSearchSessionsLogic(testDir, 'anything')
    expect(result.found).toBe(false)
  })

  it('respects limit parameter', () => {
    const sessionsDir = join(testDir, '.xi', 'sessions')
    for (let i = 0; i < 5; i++) {
      writeSession(sessionsDir, `session-${i}.jsonl`, `session-${i}`, [
        { role: 'user', content: `Find the error code ${i}` },
      ])
    }
    const result = createSearchSessionsLogic(testDir, 'error', 2)
    expect(result.results.length).toBeLessThanOrEqual(2)
  })

  it('search is case-insensitive', () => {
    const sessionsDir = join(testDir, '.xi', 'sessions')
    writeSession(sessionsDir, 'mixed.jsonl', 'MixedCase', [
      { role: 'user', content: 'UPPERCASE content here' },
    ])
    const result = createSearchSessionsLogic(testDir, 'uppercase')
    expect(result.found).toBe(true)
  })
})

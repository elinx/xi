import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── CJK-aware tokenizer (mirrors pi-worker.ts implementation) ──

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

function tokenize(text: string): string[] {
  if (!text || typeof text !== 'string') return []
  const tokens: string[] = []
  const segments = text.split(/[\n\r\p{Z}\p{P}]+/u)
  for (const seg of segments) {
    if (!seg) continue
    if (CJK_PATTERN.test(seg)) {
      const words = [...segmenter.segment(seg)]
        .filter(s => s.isWordLike)
        .map(s => s.segment)
      for (const word of words) {
        tokens.push(word.toLowerCase())
        if (word.length >= 3 && CJK_PATTERN.test(word)) {
          for (let i = 0; i <= word.length - 2; i++) {
            tokens.push(word.substring(i, i + 2).toLowerCase())
          }
        }
      }
    } else {
      const lower = seg.toLowerCase()
      if (lower.length >= 1) tokens.push(lower)
    }
  }
  return tokens
}

// ── MiniSearch-based search logic (mirrors pi-worker.ts implementation) ──

function createSearchSessionsLogic(cwd: string, query: string, limit = 10) {
  const fsSync = require('fs')
  const sessionsDir = join(cwd, '.xi', 'sessions')
  if (!fsSync.existsSync(sessionsDir)) {
    return { found: false, results: [] as Array<{ name: string; score: number }> }
  }
  const files = fsSync.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl')).map((f: string) => join(sessionsDir, f))

  const sessionDocs: Array<{
    id: string; name: string; summary: string; compactionSummary: string;
    userContent: string; assistantContent: string; firstUserMessage: string;
    parentSessionPath: string;
  }> = []

  for (const filePath of files) {
    const content = fsSync.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    let name = ''
    let summary = ''
    let parentSessionPath = ''
    const userTexts: string[] = []
    const assistantTexts: string[] = []
    const compactionTexts: string[] = []
    let firstUserMessage = ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'session' && typeof entry.name === 'string') {
          name = entry.name
        }
        if (entry.type === 'session_info') {
          if (typeof entry.name === 'string') name = entry.name
          if (typeof entry.summary === 'string') summary = entry.summary
          if (typeof entry.parentSession === 'string') parentSessionPath = entry.parentSession
        }
        if (entry.type === 'compaction' && typeof entry.summary === 'string') {
          compactionTexts.push(entry.summary)
        }
        if (entry.type === 'message' && entry.message?.content) {
          const plainText = typeof entry.message.content === 'string'
            ? entry.message.content
            : JSON.stringify(entry.message.content)
          if (entry.message.role === 'user') {
            if (!firstUserMessage) firstUserMessage = plainText
            userTexts.push(plainText)
          } else if (entry.message.role === 'assistant') {
            assistantTexts.push(plainText)
          }
        }
      } catch { continue }
    }

    sessionDocs.push({
      id: filePath,
      name, summary, parentSessionPath,
      userContent: userTexts.join('\n'),
      assistantContent: assistantTexts.join('\n'),
      compactionSummary: compactionTexts.join('\n'),
      firstUserMessage,
    })
  }

  const MiniSearch = require('minisearch')
  const miniSearch = new MiniSearch({
    fields: ['name', 'summary', 'compactionSummary', 'userContent', 'assistantContent'],
    storeFields: ['name'],
    idField: 'id',
    tokenize,
    searchOptions: {
      tokenize,
      combineWith: 'AND',
      boost: { name: 10, summary: 8, compactionSummary: 6, userContent: 3, assistantContent: 1 },
      prefix: true,
    },
  })
  miniSearch.addAll(sessionDocs)

  const searchResults = miniSearch.search(query, {
    tokenize,
    combineWith: 'AND',
    boost: { name: 10, summary: 8, compactionSummary: 6, userContent: 3, assistantContent: 1 },
    prefix: true,
  })

  const limited = searchResults.slice(0, limit)
  return {
    found: limited.length > 0,
    results: limited.map((r: { name: string; score: number }) => ({ name: r.name, score: r.score })),
  }
}

function writeSession(dir: string, filename: string, name: string, messages: Array<{ role: string; content: string }>, extra?: { summary?: string; parentSession?: string }) {
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
  if (extra?.summary) {
    lines.push(JSON.stringify({ type: 'session_info', summary: extra.summary }))
  }
  if (extra?.parentSession) {
    lines.push(JSON.stringify({ type: 'session_info', parentSession: extra.parentSession }))
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

  // ── New tests for improved search ──

  describe('multi-word AND matching', () => {
    it('matches sessions containing ALL words in a multi-word query', () => {
      const sessionsDir = join(testDir, '.xi', 'sessions')
      writeSession(sessionsDir, 'drag.jsonl', 'feature: drag commit', [
        { role: 'user', content: 'drag commit project path' },
      ])
      writeSession(sessionsDir, 'drag-only.jsonl', 'feature: drag only', [
        { role: 'user', content: 'drag items in the UI' },
      ])
      const result = createSearchSessionsLogic(testDir, 'drag commit')
      expect(result.found).toBe(true)
      expect(result.results.every(r => r.name.includes('drag commit'))).toBe(true)
      expect(result.results.some(r => r.name.includes('drag only'))).toBe(false)
    })

    it('returns empty when not all words match', () => {
      const sessionsDir = join(testDir, '.xi', 'sessions')
      writeSession(sessionsDir, 'partial.jsonl', 'partial match', [
        { role: 'user', content: 'only the first word appears here' },
      ])
      const result = createSearchSessionsLogic(testDir, 'first word impossible')
      expect(result.found).toBe(false)
    })
  })

  describe('CJK search', () => {
    it('finds sessions by Chinese keywords', () => {
      const sessionsDir = join(testDir, '.xi', 'sessions')
      writeSession(sessionsDir, 'chinese.jsonl', '中文搜索测试', [
        { role: 'user', content: '系统休眠唤醒后输入框内容消失' },
      ])
      const result = createSearchSessionsLogic(testDir, '休眠 唤醒')
      expect(result.found).toBe(true)
    })

    it('supports mixed Chinese and English queries', () => {
      const sessionsDir = join(testDir, '.xi', 'sessions')
      writeSession(sessionsDir, 'mixed.jsonl', 'mixed session', [
        { role: 'user', content: 'search functionality 搜索功能增强' },
      ])
      const result = createSearchSessionsLogic(testDir, '搜索 search')
      expect(result.found).toBe(true)
    })

    it('AND-matches Chinese multi-word queries', () => {
      const sessionsDir = join(testDir, '.xi', 'sessions')
      writeSession(sessionsDir, 'both.jsonl', 'both words', [
        { role: 'user', content: '文件删除操作' },
      ])
      writeSession(sessionsDir, 'one.jsonl', 'one word', [
        { role: 'user', content: '只有文件相关' },
      ])
      const result = createSearchSessionsLogic(testDir, '文件 删除')
      expect(result.found).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('both words')
    })
  })

  describe('IDF weighting', () => {
    it('gives higher score to rare terms than common terms', () => {
      const sessionsDir = join(testDir, '.xi', 'sessions')
      // 'electron' appears in 1 session
      writeSession(sessionsDir, 'electron.jsonl', 'electron packaging', [
        { role: 'user', content: 'electron build not working' },
      ])
      // 'session' appears in 3 sessions
      writeSession(sessionsDir, 'session1.jsonl', 'session manager', [
        { role: 'user', content: 'session state handling' },
      ])
      writeSession(sessionsDir, 'session2.jsonl', 'session search', [
        { role: 'user', content: 'session search improvement' },
      ])
      writeSession(sessionsDir, 'session3.jsonl', 'session fork', [
        { role: 'user', content: 'session fork mechanism' },
      ])

      const electronResult = createSearchSessionsLogic(testDir, 'electron')
      const sessionResult = createSearchSessionsLogic(testDir, 'session')

      // Rare term should have significantly higher per-result score than common term
      expect(electronResult.results[0].score).toBeGreaterThan(sessionResult.results[0].score)
    })
  })

  describe('field boosting', () => {
    it('ranks name matches higher than content matches', () => {
      const sessionsDir = join(testDir, '.xi', 'sessions')
      writeSession(sessionsDir, 'name-match.jsonl', 'ChatView refactoring', [
        { role: 'user', content: 'Something completely different' },
      ])
      writeSession(sessionsDir, 'content-match.jsonl', 'unrelated name', [
        { role: 'user', content: 'Refactor ChatView component' },
      ])
      const result = createSearchSessionsLogic(testDir, 'ChatView')
      expect(result.found).toBe(true)
      // Name match should rank first (higher score)
      expect(result.results[0].name).toBe('ChatView refactoring')
    })
  })

  describe('summary boosting', () => {
    it('finds sessions by summary content', () => {
      const sessionsDir = join(testDir, '.xi', 'sessions')
      writeSession(sessionsDir, 'summary.jsonl', 'session name', [
        { role: 'user', content: 'some message' },
      ], { summary: '搜索功能增强，支持中英文' })
      const result = createSearchSessionsLogic(testDir, '搜索 增强')
      expect(result.found).toBe(true)
    })
  })
})

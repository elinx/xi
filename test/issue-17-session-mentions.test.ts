import { describe, it, expect } from 'vitest'
import type { SessionInfo } from '../src/renderer/src/types/session'
import type { MentionItem } from '../src/renderer/src/hooks/useFileMention'

const MAX_RESULTS = 15

function filterSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  const named = sessions.filter(s => s.name)
  if (!query) return named.slice(0, MAX_RESULTS)
  const q = query.toLowerCase()
  return named
    .filter(s => s.name!.toLowerCase().includes(q))
    .slice(0, MAX_RESULTS)
}

function detectSessionTrigger(textBeforeCursor: string): { triggered: boolean; query: string } {
  const dollarPos = textBeforeCursor.lastIndexOf('$')
  if (dollarPos === -1) return { triggered: false, query: '' }
  if (dollarPos > 0 && /\w/.test(textBeforeCursor[dollarPos - 1])) return { triggered: false, query: '' }
  const query = textBeforeCursor.substring(dollarPos + 1)
  if (query.includes(' ')) return { triggered: false, query: '' }
  return { triggered: true, query }
}

function formatSessionContext(mentions: MentionItem[], getCache: (filePath: string) => { messages: Array<{ role: string; blocks: Array<{ type: string; content?: string; toolName?: string }> }> } | undefined): string {
  const sessionMentions = mentions.filter((m): m is Extract<MentionItem, { type: 'session' }> => m.type === 'session')
  if (sessionMentions.length === 0) return ''
  const contextParts: string[] = []
  for (const sm of sessionMentions) {
    const cache = getCache(sm.filePath)
    if (cache && cache.messages.length > 0) {
      const recentMessages = cache.messages.slice(-10)
      const formatted = recentMessages.map(msg => {
        const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role
        const content = msg.blocks.map(b => {
          if (b.type === 'text') return b.content ?? ''
          if (b.type === 'tool_call') return `[Tool: ${b.toolName ?? ''}]`
          return ''
        }).join('')
        return `${role}: ${content.slice(0, 500)}`
      }).join('\n')
      contextParts.push(`<session name="${sm.name}">\n${formatted}\n</session>`)
    }
  }
  if (contextParts.length === 0) return ''
  return `[Referenced session context]\n${contextParts.join('\n\n')}`
}

const mockSessions: SessionInfo[] = [
  { filePath: '/proj/.xi/sessions/s1.jsonl', sessionId: 's1', name: 'main', status: 'active', summary: null, createdAt: Date.now(), cwd: '/proj', messageCount: 5, isMain: true },
  { filePath: '/proj/.xi/sessions/s2.jsonl', sessionId: 's2', name: 'feature-auth', status: 'active', summary: null, createdAt: Date.now(), cwd: '/proj', messageCount: 12, isMain: false },
  { filePath: '/proj/.xi/sessions/s3.jsonl', sessionId: 's3', name: 'bugfix-api', status: 'completed', summary: null, createdAt: Date.now(), cwd: '/proj', messageCount: 3, isMain: false },
  { filePath: '/proj/.xi/sessions/s4.jsonl', sessionId: 's4', name: null, status: 'active', summary: null, createdAt: Date.now(), cwd: '/proj', messageCount: 0, isMain: false },
]

describe('Issue #17: Session Mentions ($ trigger)', () => {
  describe('$ trigger detection', () => {
    it('detects $ at start of input', () => {
      const result = detectSessionTrigger('$')
      expect(result.triggered).toBe(true)
      expect(result.query).toBe('')
    })

    it('detects $ with query text', () => {
      const result = detectSessionTrigger('$feature')
      expect(result.triggered).toBe(true)
      expect(result.query).toBe('feature')
    })

    it('does not trigger when $ is preceded by word character', () => {
      const result = detectSessionTrigger('price$10')
      expect(result.triggered).toBe(false)
    })

    it('does not trigger when query contains space', () => {
      const result = detectSessionTrigger('$my session')
      expect(result.triggered).toBe(false)
    })

    it('triggers when $ is preceded by space', () => {
      const result = detectSessionTrigger('check $main')
      expect(result.triggered).toBe(true)
      expect(result.query).toBe('main')
    })

    it('finds last $ in text', () => {
      const result = detectSessionTrigger('$old $new')
      expect(result.triggered).toBe(true)
      expect(result.query).toBe('new')
    })
  })

  describe('session filtering', () => {
    it('returns all named sessions when no query', () => {
      const result = filterSessions(mockSessions, '')
      expect(result.length).toBe(3)
      expect(result.every(s => s.name !== null)).toBe(true)
    })

    it('excludes sessions without names', () => {
      const result = filterSessions(mockSessions, '')
      expect(result.find(s => s.sessionId === 's4')).toBeUndefined()
    })

    it('filters by name substring', () => {
      const result = filterSessions(mockSessions, 'auth')
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('feature-auth')
    })

    it('filters case-insensitively', () => {
      const result = filterSessions(mockSessions, 'BUG')
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('bugfix-api')
    })

    it('returns empty for no matches', () => {
      const result = filterSessions(mockSessions, 'nonexistent')
      expect(result.length).toBe(0)
    })

    it('partial match works', () => {
      const result = filterSessions(mockSessions, 'feat')
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('feature-auth')
    })
  })

  describe('MentionItem type union', () => {
    it('file mention has type=file', () => {
      const m: MentionItem = { type: 'file', path: 'src/main.ts', name: 'main.ts' }
      expect(m.type).toBe('file')
      if (m.type === 'file') {
        expect(m.path).toBe('src/main.ts')
      }
    })

    it('session mention has type=session', () => {
      const m: MentionItem = { type: 'session', sessionId: 's1', name: 'main', filePath: '/proj/.xi/sessions/s1.jsonl' }
      expect(m.type).toBe('session')
      if (m.type === 'session') {
        expect(m.sessionId).toBe('s1')
        expect(m.name).toBe('main')
      }
    })

    it('can discriminate union type', () => {
      const mentions: MentionItem[] = [
        { type: 'file', path: 'src/a.ts', name: 'a.ts' },
        { type: 'session', sessionId: 's1', name: 'main', filePath: '/p/s1.jsonl' },
        { type: 'file', path: 'src/b.ts', name: 'b.ts' },
      ]
      const files = mentions.filter((m): m is Extract<MentionItem, { type: 'file' }> => m.type === 'file')
      const sessions = mentions.filter((m): m is Extract<MentionItem, { type: 'session' }> => m.type === 'session')
      expect(files.length).toBe(2)
      expect(sessions.length).toBe(1)
    })
  })

  describe('session context injection', () => {
    it('injects session context when session mention present', () => {
      const mentions: MentionItem[] = [
        { type: 'session', sessionId: 's1', name: 'main', filePath: '/proj/s1.jsonl' },
      ]
      const getCache = (fp: string) => ({
        messages: [
          { role: 'user', blocks: [{ type: 'text', content: 'hello' }] },
          { role: 'assistant', blocks: [{ type: 'text', content: 'hi there' }] },
        ],
      })
      const context = formatSessionContext(mentions, getCache)
      expect(context).toContain('[Referenced session context]')
      expect(context).toContain('<session name="main">')
      expect(context).toContain('User: hello')
      expect(context).toContain('Assistant: hi there')
    })

    it('returns empty string for no session mentions', () => {
      const mentions: MentionItem[] = [
        { type: 'file', path: 'src/a.ts', name: 'a.ts' },
      ]
      const context = formatSessionContext(mentions, () => undefined)
      expect(context).toBe('')
    })

    it('handles missing cache gracefully', () => {
      const mentions: MentionItem[] = [
        { type: 'session', sessionId: 's1', name: 'main', filePath: '/proj/s1.jsonl' },
      ]
      const context = formatSessionContext(mentions, () => undefined)
      expect(context).toBe('')
    })

    it('limits to last 10 messages', () => {
      const mentions: MentionItem[] = [
        { type: 'session', sessionId: 's1', name: 'main', filePath: '/proj/s1.jsonl' },
      ]
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: 'user' as const,
        blocks: [{ type: 'text' as const, content: `msg ${i}` }],
      }))
      const getCache = () => ({ messages })
      const context = formatSessionContext(mentions, getCache)
      expect(context).toContain('msg 10')
      expect(context).toContain('msg 19')
      expect(context).not.toContain('msg 9')
    })

    it('truncates long content to 500 chars', () => {
      const mentions: MentionItem[] = [
        { type: 'session', sessionId: 's1', name: 'main', filePath: '/proj/s1.jsonl' },
      ]
      const longContent = 'x'.repeat(600)
      const getCache = () => ({
        messages: [{ role: 'user' as const, blocks: [{ type: 'text' as const, content: longContent }] }],
      })
      const context = formatSessionContext(mentions, getCache)
      expect(context).toContain('x'.repeat(500))
      expect(context).not.toContain('x'.repeat(600))
    })

    it('formats tool calls in context', () => {
      const mentions: MentionItem[] = [
        { type: 'session', sessionId: 's1', name: 'main', filePath: '/proj/s1.jsonl' },
      ]
      const getCache = () => ({
        messages: [{
          role: 'assistant' as const,
          blocks: [{ type: 'tool_call' as const, toolName: 'read' }],
        }],
      })
      const context = formatSessionContext(mentions, getCache)
      expect(context).toContain('[Tool: read]')
    })

    it('combines multiple session mentions', () => {
      const mentions: MentionItem[] = [
        { type: 'session', sessionId: 's1', name: 'main', filePath: '/proj/s1.jsonl' },
        { type: 'session', sessionId: 's2', name: 'feature', filePath: '/proj/s2.jsonl' },
      ]
      const getCache = () => ({
        messages: [{ role: 'user' as const, blocks: [{ type: 'text' as const, content: 'test' }] }],
      })
      const context = formatSessionContext(mentions, getCache)
      expect(context).toContain('<session name="main">')
      expect(context).toContain('<session name="feature">')
    })
  })
})

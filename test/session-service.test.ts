import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseSessionFile,
  findMainSession,
  listSessions,
  buildSessionTree,
  nameSession,
  deleteSession,
  setSessionStatus,
  addForkPoint,
  getForkPoints,
} from '../src/main/session-service'
import type { SessionInfo } from '../src/renderer/src/types/session'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'pi-session-test-'))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function writeSession(dir: string, filename: string, header: Record<string, unknown>, entries: Record<string, unknown>[] = []): string {
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  const lines = [JSON.stringify({ type: 'session', version: 3, ...header })]
  for (const entry of entries) {
    lines.push(JSON.stringify(entry))
  }
  writeFileSync(filePath, lines.join('\n') + '\n')
  return filePath
}

function makeProjectDir(base: string, _cwd: string): string {
  mkdirSync(base, { recursive: true })
  return base
}

describe('parseSessionFile', () => {
  it('parses a valid session file with user messages', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'test.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:24:40.822Z', cwd: '/test/project' },
      [
        { type: 'message', id: 'a1', parentId: null, timestamp: '2026-05-26T16:24:41.000Z', message: { role: 'user', content: 'Hello' } },
        { type: 'message', id: 'a2', parentId: 'a1', timestamp: '2026-05-26T16:24:42.000Z', message: { role: 'assistant', content: [] } },
        { type: 'message', id: 'a3', parentId: 'a2', timestamp: '2026-05-26T16:24:43.000Z', message: { role: 'user', content: 'World' } },
      ]
    )

    const result = parseSessionFile(filePath)
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe('uuid-1')
    expect(result!.messageCount).toBe(2)
    expect(result!.name).toBeNull()
    expect(result!.cwd).toBe('/test/project')
    expect(result!.parentSessionPath).toBeNull()
    expect(result!.isMain).toBe(false)
  })

  it('extracts session name from session_info entry', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'named.jsonl',
      { id: 'uuid-2', timestamp: '2026-05-26T16:30:00.000Z', cwd: '/test/project' },
      [
        { type: 'session_info', id: 'b1', parentId: null, timestamp: '2026-05-26T16:30:01.000Z', name: 'main' },
      ]
    )

    const result = parseSessionFile(filePath)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('main')
  })

  it('returns null for file without session header', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'bad.jsonl')
    writeFileSync(filePath, '{"type":"message","id":"x"}\n')

    expect(parseSessionFile(filePath)).toBeNull()
  })

  it('returns null for non-existent file', () => {
    expect(parseSessionFile('/nonexistent/file.jsonl')).toBeNull()
  })

  it('returns null for empty file', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'empty.jsonl')
    writeFileSync(filePath, '')

    expect(parseSessionFile(filePath)).toBeNull()
  })

  it('parses parentSession from header', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'child.jsonl',
      { id: 'uuid-3', timestamp: '2026-05-26T17:00:00.000Z', cwd: '/test/project', parentSession: '/path/to/parent.jsonl' },
    )

    const result = parseSessionFile(filePath)
    expect(result).not.toBeNull()
    expect(result!.parentSessionPath).toBe('/path/to/parent.jsonl')
  })

  it('uses last session_info name if multiple exist', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'multi-name.jsonl',
      { id: 'uuid-4', timestamp: '2026-05-26T16:30:00.000Z', cwd: '/test/project' },
      [
        { type: 'session_info', id: 'c1', parentId: null, timestamp: '2026-05-26T16:30:01.000Z', name: 'first' },
        { type: 'session_info', id: 'c2', parentId: 'c1', timestamp: '2026-05-26T16:30:02.000Z', name: 'renamed' },
      ]
    )

    const result = parseSessionFile(filePath)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('renamed')
  })

  it('returns null status when no session_info has status', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'no-status.jsonl',
      { id: 'uuid-5', timestamp: '2026-05-26T16:30:00.000Z', cwd: '/test/project' },
      [{ type: 'session_info', name: 'main' }]
    )

    const result = parseSessionFile(filePath)
    expect(result).not.toBeNull()
    expect(result!.status).toBeNull()
  })

  it('parses status from session_info entry', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'with-status.jsonl',
      { id: 'uuid-6', timestamp: '2026-05-26T16:30:00.000Z', cwd: '/test/project' },
      [{ type: 'session_info', name: 'done', status: 'completed' }]
    )

    const result = parseSessionFile(filePath)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('completed')
  })

  it('uses last session_info status if multiple exist', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'multi-status.jsonl',
      { id: 'uuid-7', timestamp: '2026-05-26T16:30:00.000Z', cwd: '/test/project' },
      [
        { type: 'session_info', name: 's1', status: 'completed' },
        { type: 'session_info', name: 's2', status: 'active' },
      ]
    )

    const result = parseSessionFile(filePath)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('active')
  })

  it('ignores invalid status values', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'bad-status.jsonl',
      { id: 'uuid-8', timestamp: '2026-05-26T16:30:00.000Z', cwd: '/test/project' },
      [{ type: 'session_info', name: 'x', status: 'invalid' }]
    )

    const result = parseSessionFile(filePath)
    expect(result).not.toBeNull()
    expect(result!.status).toBeNull()
  })
})

describe('findMainSession', () => {
  it('returns null when no sessions exist', () => {
    expect(findMainSession('/test/project', testDir)).toBeNull()
  })

  it('returns oldest session when no session is named "main" for the cwd', () => {
    writeSession(testDir, 's1.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/test/project' },
    )

    const result = findMainSession('/test/project', testDir)
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe('uuid-1')
    expect(result!.name).toBeNull()
  })

  it('finds a session named "main" for the given cwd', () => {
    writeSession(testDir, 'main.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/test/project' },
      [{ type: 'session_info', id: 's1', parentId: null, timestamp: '2026-05-26T16:00:01.000Z', name: 'main' }]
    )

    const result = findMainSession('/test/project', testDir)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('main')
    expect(result!.cwd).toBe('/test/project')
  })

  it('falls back to oldest session when no session is named "main"', () => {
    writeSession(testDir, 'old.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/test/project' },
    )
    writeSession(testDir, 'newer.jsonl',
      { id: 'uuid-2', timestamp: '2026-05-26T17:00:00.000Z', cwd: '/test/project' },
    )

    const result = findMainSession('/test/project', testDir)
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe('uuid-1')
  })

  it('prefers named "main" over unnamed sessions', () => {
    writeSession(testDir, 'old.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/test/project' },
    )
    writeSession(testDir, 'named.jsonl',
      { id: 'uuid-2', timestamp: '2026-05-26T17:00:00.000Z', cwd: '/test/project' },
      [{ type: 'session_info', id: 's1', parentId: null, name: 'main' }]
    )

    const result = findMainSession('/test/project', testDir)
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe('uuid-2')
    expect(result!.name).toBe('main')
  })
})

describe('buildSessionTree', () => {
  function makeSession(filePath: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
      filePath,
      sessionId: 'test-id',
      name: null,
      status: null,
      createdAt: '2026-05-26T16:00:00.000Z',
      cwd: '/test',
      parentSessionPath: null,
      messageCount: 0,
      isMain: false,
      ...overrides,
    }
  }

  it('returns null for empty sessions array', () => {
    expect(buildSessionTree([])).toBeNull()
  })

  it('builds tree with single root', () => {
    const sessions = [makeSession('/a.jsonl', { isMain: true })]

    const tree = buildSessionTree(sessions)
    expect(tree).not.toBeNull()
    expect(tree!.session.filePath).toBe('/a.jsonl')
    expect(tree!.children).toHaveLength(0)
  })

  it('builds tree with parent-child relationship', () => {
    const sessions = [
      makeSession('/parent.jsonl', { isMain: true }),
      makeSession('/child.jsonl', { parentSessionPath: '/parent.jsonl' }),
    ]

    const tree = buildSessionTree(sessions)
    expect(tree!.session.filePath).toBe('/parent.jsonl')
    expect(tree!.children).toHaveLength(1)
    expect(tree!.children[0].session.filePath).toBe('/child.jsonl')
  })

  it('attaches orphan sessions to root', () => {
    const sessions = [
      makeSession('/main.jsonl', { isMain: true }),
      makeSession('/orphan.jsonl', { parentSessionPath: '/nonexistent.jsonl' }),
    ]

    const tree = buildSessionTree(sessions)
    expect(tree!.children).toHaveLength(1)
    expect(tree!.children[0].session.filePath).toBe('/orphan.jsonl')
  })

  it('builds multi-level tree', () => {
    const sessions = [
      makeSession('/root.jsonl', { isMain: true }),
      makeSession('/child1.jsonl', { parentSessionPath: '/root.jsonl' }),
      makeSession('/grandchild.jsonl', { parentSessionPath: '/child1.jsonl' }),
      makeSession('/child2.jsonl', { parentSessionPath: '/root.jsonl' }),
    ]

    const tree = buildSessionTree(sessions)
    expect(tree!.session.filePath).toBe('/root.jsonl')
    expect(tree!.children).toHaveLength(2)
    expect(tree!.children[0].session.filePath).toBe('/child1.jsonl')
    expect(tree!.children[0].children).toHaveLength(1)
    expect(tree!.children[0].children[0].session.filePath).toBe('/grandchild.jsonl')
    expect(tree!.children[1].session.filePath).toBe('/child2.jsonl')
  })
})

describe('listSessions', () => {
  it('returns empty when sessions dir does not exist', () => {
    const result = listSessions(undefined, join(testDir, 'nonexistent'))
    expect(result.projects).toHaveLength(0)
  })

  it('returns empty when sessions dir has no session files', () => {
    mkdirSync(join(testDir, 'other'), { recursive: true })
    const result = listSessions(undefined, testDir)
    expect(result.projects).toHaveLength(0)
  })

  it('lists sessions from a single project directory', () => {
    writeSession(testDir, 's1.jsonl',
      { id: 'uuid-a1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/project/a' },
      [{ type: 'session_info', id: 'x1', parentId: null, name: 'main' }]
    )
    writeSession(testDir, 's2.jsonl',
      { id: 'uuid-a2', timestamp: '2026-05-26T17:00:00.000Z', cwd: '/project/a' }
    )

    const result = listSessions(undefined, testDir)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].allSessions).toHaveLength(2)
  })

  it('marks session named "main" as isMain regardless of age', () => {
    writeSession(testDir, 'old.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/test/project' },
    )
    writeSession(testDir, 'named-main.jsonl',
      { id: 'uuid-2', timestamp: '2026-05-26T17:00:00.000Z', cwd: '/test/project' },
      [{ type: 'session_info', id: 's1', parentId: null, name: 'main' }]
    )

    const result = listSessions(undefined, testDir)
    const namedMain = result.projects[0].allSessions.find(s => s.name === 'main')
    const oldest = result.projects[0].allSessions.find(s => s.name !== 'main')
    expect(namedMain!.isMain).toBe(true)
    expect(oldest!.isMain).toBe(false)
  })

  it('falls back to oldest session as main if no currentSessionPath', () => {
    writeSession(testDir, 'old.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/test/project' },
    )
    writeSession(testDir, 'newer.jsonl',
      { id: 'uuid-2', timestamp: '2026-05-26T17:00:00.000Z', cwd: '/test/project' },
    )

    const result = listSessions(undefined, testDir)
    const oldest = result.projects[0].allSessions.find(s => s.sessionId === 'uuid-1')
    expect(oldest!.isMain).toBe(true)
  })

  it('builds tree from forked sessions with parentSessionPath', () => {
    const mainPath = writeSession(testDir, 'main.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/test/project' },
      [{ type: 'session_info', id: 's1', parentId: null, name: 'main' }]
    )
    writeSession(testDir, 'fork1.jsonl',
      { id: 'uuid-2', timestamp: '2026-05-26T17:00:00.000Z', cwd: '/test/project', parentSession: mainPath },
      [{ type: 'session_info', id: 's2', parentId: 's1', name: 'experiment-1' }]
    )
    writeSession(testDir, 'fork2.jsonl',
      { id: 'uuid-3', timestamp: '2026-05-26T18:00:00.000Z', cwd: '/test/project', parentSession: mainPath },
      [{ type: 'session_info', id: 's3', parentId: 's1', name: 'experiment-2' }]
    )

    const result = listSessions(mainPath, testDir)
    expect(result.projects).toHaveLength(1)

    const root = result.projects[0].root
    expect(root).not.toBeNull()
    expect(root!.session.name).toBe('main')
    expect(root!.children).toHaveLength(2)
    expect(root!.children.map(c => c.session.name).sort()).toEqual(['experiment-1', 'experiment-2'])
  })

  it('builds nested fork tree (grandchild)', () => {
    const mainPath = writeSession(testDir, 'main.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-26T16:00:00.000Z', cwd: '/test/project' },
      [{ type: 'session_info', id: 's1', parentId: null, name: 'main' }]
    )
    const childPath = writeSession(testDir, 'child.jsonl',
      { id: 'uuid-2', timestamp: '2026-05-26T17:00:00.000Z', cwd: '/test/project', parentSession: mainPath },
      [{ type: 'session_info', id: 's2', parentId: 's1', name: 'fork-a' }]
    )
    writeSession(testDir, 'grandchild.jsonl',
      { id: 'uuid-3', timestamp: '2026-05-26T18:00:00.000Z', cwd: '/test/project', parentSession: childPath },
      [{ type: 'session_info', id: 's3', parentId: 's2', name: 'fork-a-sub' }]
    )

    const result = listSessions(mainPath, testDir)
    const root = result.projects[0].root!
    expect(root.session.name).toBe('main')
    expect(root.children).toHaveLength(1)
    expect(root.children[0].session.name).toBe('fork-a')
    expect(root.children[0].children).toHaveLength(1)
    expect(root.children[0].children[0].session.name).toBe('fork-a-sub')
  })
})

describe('nameSession', () => {
  it('appends session_info entry to an existing file', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'test.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-1","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\n')

    const result = nameSession(filePath, 'main')
    expect(result).toBe(true)

    const parsed = parseSessionFile(filePath)
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe('main')
  })

  it('returns false for non-existent file', () => {
    expect(nameSession('/nonexistent/file.jsonl', 'main')).toBe(false)
  })

  it('overwrites name when called again (last session_info wins)', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'test.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-1","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\n')

    nameSession(filePath, 'first')
    nameSession(filePath, 'renamed')

    const parsed = parseSessionFile(filePath)
    expect(parsed!.name).toBe('renamed')
  })
})

describe('deleteSession', () => {
  it('deletes a session file', () => {
    const dir = join(testDir, 'sessions')
    const filePath = writeSession(dir, 'to-delete.jsonl',
      { id: 'uuid-del', timestamp: '2026-05-28T12:00:00.000Z', cwd: '/test' },
    )

    expect(existsSync(filePath)).toBe(true)
    const result = deleteSession(filePath)
    expect(result).toBe(true)
    expect(existsSync(filePath)).toBe(false)
  })

  it('returns false for non-existent file', () => {
    expect(deleteSession('/nonexistent/file.jsonl')).toBe(false)
  })

  it('removes empty project directory after deleting last session', () => {
    const projectDir = makeProjectDir(testDir, '/test/empty-project')
    const filePath = writeSession(projectDir, 'only.jsonl',
      { id: 'uuid-only', timestamp: '2026-05-28T12:00:00.000Z', cwd: '/test/empty-project' },
    )

    expect(existsSync(projectDir)).toBe(true)
    deleteSession(filePath)
    expect(existsSync(projectDir)).toBe(false)
  })

  it('keeps project directory if other sessions remain', () => {
    const projectDir = makeProjectDir(testDir, '/test/busy-project')
    writeSession(projectDir, 's1.jsonl',
      { id: 'uuid-1', timestamp: '2026-05-28T12:00:00.000Z', cwd: '/test/busy-project' },
    )
    const filePath = writeSession(projectDir, 's2.jsonl',
      { id: 'uuid-2', timestamp: '2026-05-28T13:00:00.000Z', cwd: '/test/busy-project' },
    )

    deleteSession(filePath)
    expect(existsSync(projectDir)).toBe(true)
  })
})

describe('setSessionStatus', () => {
  it('appends session_info with status to an existing file', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'test.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-1","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\n')

    const result = setSessionStatus(filePath, 'completed')
    expect(result).toBe(true)

    const parsed = parseSessionFile(filePath)
    expect(parsed).not.toBeNull()
    expect(parsed!.status).toBe('completed')
  })

  it('returns false for non-existent file', () => {
    expect(setSessionStatus('/nonexistent/file.jsonl', 'completed')).toBe(false)
  })

  it('overwrites status when called again (last session_info wins)', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'test.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-1","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\n')

    setSessionStatus(filePath, 'completed')
    setSessionStatus(filePath, 'active')

    const parsed = parseSessionFile(filePath)
    expect(parsed!.status).toBe('active')
  })

  it('preserves name when setting status', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'test.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-1","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\n')

    nameSession(filePath, 'my-session')
    setSessionStatus(filePath, 'completed')

    const parsed = parseSessionFile(filePath)
    expect(parsed!.name).toBe('my-session')
    expect(parsed!.status).toBe('completed')
  })
})

describe('addForkPoint', () => {
  it('appends fork_point entry to session file', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'parent.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-parent","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\n')

    const result = addForkPoint(filePath, 'entry-abc', 'experiment-1')
    expect(result).toBe(true)

    const points = getForkPoints(filePath)
    expect(points).toHaveLength(1)
    expect(points[0].entryId).toBe('entry-abc')
    expect(points[0].childName).toBe('experiment-1')
  })

  it('returns false for non-existent file', () => {
    expect(addForkPoint('/nonexistent/file.jsonl', 'entry-1', 'name')).toBe(false)
  })

  it('accumulates multiple fork points', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'multi-fork.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-m","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\n')

    addForkPoint(filePath, 'entry-1', 'fork-a')
    addForkPoint(filePath, 'entry-2', 'fork-b')

    const points = getForkPoints(filePath)
    expect(points).toHaveLength(2)
    expect(points[0].entryId).toBe('entry-1')
    expect(points[0].childName).toBe('fork-a')
    expect(points[1].entryId).toBe('entry-2')
    expect(points[1].childName).toBe('fork-b')
  })
})

describe('getForkPoints', () => {
  it('returns empty array for non-existent file', () => {
    expect(getForkPoints('/nonexistent/file.jsonl')).toEqual([])
  })

  it('returns empty array for session without fork points', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'no-forks.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-1","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\n')

    expect(getForkPoints(filePath)).toEqual([])
  })

  it('skips malformed entries', () => {
    const dir = join(testDir, 'sessions')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'bad-entry.jsonl')
    writeFileSync(filePath, '{"type":"session","version":3,"id":"uuid-1","timestamp":"2026-05-28T10:00:00.000Z","cwd":"/test"}\nnot-json\n{"type":"fork_point","entryId":"good"}\n')

    const points = getForkPoints(filePath)
    expect(points).toHaveLength(1)
    expect(points[0].entryId).toBe('good')
    expect(points[0].childName).toBe('')
  })
})

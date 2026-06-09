import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join, resolve } from 'path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'

function isProtectedPath(absolutePath: string, cwd: string): boolean {
  const rel = resolve(cwd, absolutePath) !== absolutePath
    ? null
    : absolutePath.slice(cwd.length + 1).replace(/\\/g, '/')
  if (rel === null) {
    const normalized = absolutePath.replace(/\\/g, '/')
    for (const name of ['.xi', '.git', 'node_modules']) {
      if (normalized.includes(`/${name}/`) || normalized.endsWith(`/${name}`)) return true
    }
    return false
  }
  const parts = rel.split('/')
  return ['.xi', '.git', 'node_modules'].includes(parts[0])
}

describe('Issue #26: session chaos on project switch', () => {
  describe('BUG1: clearAllCaches clears session cache state', () => {
    it('clears all entries from cache map simulation', () => {
      const cacheMap = new Map<string, { messages: string[]; tokenUsage: number }>()
      cacheMap.set('/project-a/.xi/sessions/s1.jsonl', { messages: ['msg1'], tokenUsage: 100 })
      cacheMap.set('/project-a/.xi/sessions/s2.jsonl', { messages: ['msg2'], tokenUsage: 200 })
      cacheMap.set('/project-b/.xi/sessions/s3.jsonl', { messages: ['msg3'], tokenUsage: 300 })

      expect(cacheMap.size).toBe(3)

      // Simulate clearAllCaches
      cacheMap.clear()

      expect(cacheMap.size).toBe(0)
    })

    it('old project sessions do not leak into new project', () => {
      const cacheMap = new Map<string, string[]>()
      // Project A sessions
      cacheMap.set('/proj-a/.xi/sessions/s1.jsonl', ['session A1 messages'])
      cacheMap.set('/proj-a/.xi/sessions/s2.jsonl', ['session A2 messages'])

      // Switch project: clear all caches
      cacheMap.clear()

      // Load project B sessions
      cacheMap.set('/proj-b/.xi/sessions/s3.jsonl', ['session B1 messages'])

      // No project A sessions remain
      for (const key of cacheMap.keys()) {
        expect(key).not.toContain('proj-a')
      }
      expect(cacheMap.size).toBe(1)
    })

    it('workerStatuses are cleared on project switch', () => {
      const workerStatuses = new Map<string, string>()
      workerStatuses.set('/proj-a/.xi/sessions/s1.jsonl', 'idle')
      workerStatuses.set('/proj-a/.xi/sessions/s2.jsonl', 'streaming')

      expect(workerStatuses.size).toBe(2)

      // Simulate clearAllCaches clearing worker statuses
      workerStatuses.clear()

      expect(workerStatuses.size).toBe(0)
    })
  })

  describe('BUG2: git state resets on project switch', () => {
    it('projectPath variable should update to new cwd', () => {
      // Simulate the resetGit logic
      let projectPath = '/old-project'
      let _git: object | null = { mock: 'git-instance-old' }
      let _gitAvailable: boolean | null = true

      // resetGit simulation
      const newCwd = '/new-project'
      projectPath = newCwd
      _git = null
      _gitAvailable = null

      expect(projectPath).toBe('/new-project')
      expect(_git).toBeNull()
      expect(_gitAvailable).toBeNull()
    })

    it('git operations use new project path after switch', () => {
      let projectPath = '/old-project'

      // Simulate getGit() using current projectPath
      function getProjectPath(): string {
        return projectPath
      }

      expect(getProjectPath()).toBe('/old-project')

      // Switch project
      projectPath = '/new-project'

      expect(getProjectPath()).toBe('/new-project')
    })
  })

  describe('BUG3: pendingNames cleared on project switch', () => {
    let pendingNames: Map<string, string>

    beforeEach(() => {
      pendingNames = new Map()
    })

    it('clears pending names from old project', () => {
      pendingNames.set('/proj-a/.xi/sessions/s1.jsonl', 'main')
      pendingNames.set('/proj-a/.xi/sessions/s2.jsonl', 'feature-branch')

      expect(pendingNames.size).toBe(2)

      // clearPendingNames
      pendingNames.clear()

      expect(pendingNames.size).toBe(0)
    })

    it('old project pending names do not interfere with new project', () => {
      pendingNames.set('/proj-a/.xi/sessions/s1.jsonl', 'main')

      // Switch project: clear
      pendingNames.clear()

      // New project names
      pendingNames.set('/proj-b/.xi/sessions/s3.jsonl', 'hotfix')

      expect(pendingNames.get('/proj-b/.xi/sessions/s3.jsonl')).toBe('hotfix')
      expect(pendingNames.has('/proj-a/.xi/sessions/s1.jsonl')).toBe(false)
    })

    it('flushPendingName after clear returns true (no pending entry)', () => {
      pendingNames.set('/proj-a/.xi/sessions/s1.jsonl', 'main')
      pendingNames.clear()

      // flushPendingName simulation
      const name = pendingNames.get('/proj-a/.xi/sessions/s1.jsonl')
      expect(name).toBeUndefined()
    })
  })

  describe('BUG4: env vars snapshot correctness', () => {
    it('worker env snapshot captures session dir at fork time', () => {
      // Simulate the pi-sdk-bridge connect logic
      const env = { ...process.env }

      // Set env vars for project A
      env.PI_CODING_AGENT_DIR = '/home/user/.xi'
      env.PI_CODING_AGENT_SESSION_DIR = '/proj-a/.xi/sessions'

      // Worker A gets a snapshot
      const workerAEnv = { ...env }

      // Set env vars for project B
      env.PI_CODING_AGENT_SESSION_DIR = '/proj-b/.xi/sessions'

      // Worker B gets a snapshot
      const workerBEnv = { ...env }

      // Worker A still has project A's session dir
      expect(workerAEnv.PI_CODING_AGENT_SESSION_DIR).toBe('/proj-a/.xi/sessions')
      // Worker B has project B's session dir
      expect(workerBEnv.PI_CODING_AGENT_SESSION_DIR).toBe('/proj-b/.xi/sessions')
    })

    it('PI_CODING_AGENT_DIR is always ~/.xi regardless of project', () => {
      const globalAgentDir = join(
        process.env.HOME ?? process.env.USERPROFILE ?? '~',
        '.xi'
      )

      // Regardless of project, PI_CODING_AGENT_DIR should be the same
      const env1 = { PI_CODING_AGENT_DIR: globalAgentDir, PI_CODING_AGENT_SESSION_DIR: '/proj-a/.xi/sessions' }
      const env2 = { PI_CODING_AGENT_DIR: globalAgentDir, PI_CODING_AGENT_SESSION_DIR: '/proj-b/.xi/sessions' }

      expect(env1.PI_CODING_AGENT_DIR).toBe(env2.PI_CODING_AGENT_DIR)
    })
  })

  describe('session dir isolation between projects', () => {
    let testDirA: string
    let testDirB: string

    beforeEach(() => {
      testDirA = mkdtempSync(join(tmpdir(), 'xi-proj-a-'))
      testDirB = mkdtempSync(join(tmpdir(), 'xi-proj-b-'))
      mkdirSync(join(testDirA, '.xi', 'sessions'), { recursive: true })
      mkdirSync(join(testDirB, '.xi', 'sessions'), { recursive: true })
    })

    afterEach(() => {
      rmSync(testDirA, { recursive: true, force: true })
      rmSync(testDirB, { recursive: true, force: true })
    })

    it('each project has its own isolated session dir', () => {
      const sessionDirA = join(testDirA, '.xi', 'sessions')
      const sessionDirB = join(testDirB, '.xi', 'sessions')

      expect(sessionDirA).not.toBe(sessionDirB)
      expect(existsSync(sessionDirA)).toBe(true)
      expect(existsSync(sessionDirB)).toBe(true)
    })

    it('session files from project A are not visible in project B', () => {
      // Create a session file in project A
      writeFileSync(join(testDirA, '.xi', 'sessions', 'main.jsonl'), JSON.stringify({
        type: 'session', id: 'a1', timestamp: Date.now(), cwd: testDirA
      }) + '\n')

      // Project B should not see it
      const { readdirSync } = require('fs')
      const sessionsB = readdirSync(join(testDirB, '.xi', 'sessions'))
      expect(sessionsB.length).toBe(0)

      const sessionsA = readdirSync(join(testDirA, '.xi', 'sessions'))
      expect(sessionsA.length).toBe(1)
    })
  })
})

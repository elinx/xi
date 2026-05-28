import { readdirSync, readFileSync, existsSync, statSync, appendFileSync, unlinkSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type {
  SessionInfo,
  SessionListResult,
  SessionFileHeader,
  ProjectSessionTree,
  SessionTreeNode,
  ForkPoint
} from '../renderer/src/types/session'

export function getSessionDir(): string {
  return join(homedir(), '.pi', 'agent', 'sessions')
}

export function decodeProjectDir(encodedDir: string): string {
  let stripped = encodedDir
  if (stripped.startsWith('--')) stripped = stripped.slice(2)
  if (stripped.endsWith('--')) stripped = stripped.slice(0, -2)
  return '/' + stripped.replace(/-/g, '/')
}

export function parseSessionFile(filePath: string): SessionInfo | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length === 0) return null

    let header: SessionFileHeader
    try {
      header = JSON.parse(lines[0]) as SessionFileHeader
    } catch {
      return null
    }

    if (header.type !== 'session') return null

    let messageCount = 0
    let name: string | null = null

    for (let i = 1; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>
        if (entry.type === 'message') {
          const message = entry.message as Record<string, unknown> | undefined
          if (message && message.role === 'user') {
            messageCount++
          }
        } else if (entry.type === 'session_info') {
          if (typeof entry.name === 'string') {
            name = entry.name
          }
        }
      } catch {
        continue
      }
    }

    return {
      filePath,
      sessionId: header.id,
      name,
      createdAt: header.timestamp,
      cwd: header.cwd,
      parentSessionPath: header.parentSession ?? null,
      messageCount,
      isMain: false
    }
  } catch {
    return null
  }
}

export function findMainSession(cwd: string, sessionDir?: string): SessionInfo | null {
  const dir = sessionDir ?? getSessionDir()
  if (!existsSync(dir)) return null

  const projectDirs = readdirSync(dir).filter((name) => {
    const fullPath = join(dir, name)
    return statSync(fullPath).isDirectory() && name.startsWith('--') && name.endsWith('--')
  })

  for (const encodedDir of projectDirs) {
    const projectPath = join(dir, encodedDir)
    const sessionFiles = readdirSync(projectPath)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(projectPath, name))

    // First pass: look for a session explicitly named "main"
    for (const filePath of sessionFiles) {
      const info = parseSessionFile(filePath)
      if (info && info.cwd === cwd && info.name === 'main') {
        return info
      }
    }

    // Second pass: if no named "main" session, use the oldest session for this cwd
    const candidates: SessionInfo[] = []
    for (const filePath of sessionFiles) {
      const info = parseSessionFile(filePath)
      if (info && info.cwd === cwd) {
        candidates.push(info)
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      return candidates[0]
    }
  }

  return null
}

export function listSessions(currentSessionPath?: string, sessionDir?: string): SessionListResult {
  const sessionDirPath = sessionDir ?? getSessionDir()
  if (!existsSync(sessionDirPath)) {
    return { projects: [] }
  }

  let projectDirs: string[]
  try {
    projectDirs = readdirSync(sessionDirPath).filter((name) => {
      const fullPath = join(sessionDirPath, name)
      return statSync(fullPath).isDirectory() && name.startsWith('--') && name.endsWith('--')
    })
  } catch {
    return { projects: [] }
  }

  const projects: ProjectSessionTree[] = []

  for (const encodedDir of projectDirs) {
    const projectPath = join(sessionDirPath, encodedDir)
    let sessionFiles: string[]
    try {
      sessionFiles = readdirSync(projectPath)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => join(projectPath, name))
    } catch {
      continue
    }

    const sessions: SessionInfo[] = []
    for (const filePath of sessionFiles) {
      const info = parseSessionFile(filePath)
      if (info) sessions.push(info)
    }

    if (sessions.length === 0) continue

    sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    if (currentSessionPath) {
      const active = sessions.find((s) => s.filePath === currentSessionPath)
      if (active) active.isMain = true
    }

    if (!sessions.some((s) => s.isMain)) {
      sessions[0].isMain = true
    }

    const cwd = sessions[0].cwd

    const tree = buildSessionTree(sessions)

    projects.push({
      projectPath: cwd,
      encodedDir,
      root: tree,
      allSessions: sessions
    })
  }

  return { projects }
}

export function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode | null {
  if (sessions.length === 0) return null

  const nodeMap = new Map<string, SessionTreeNode>()
  const parentedNodes = new Set<string>()

  for (const session of sessions) {
    nodeMap.set(session.filePath, { session, children: [] })
  }

  for (const session of sessions) {
    if (session.parentSessionPath && nodeMap.has(session.parentSessionPath)) {
      const parent = nodeMap.get(session.parentSessionPath)!
      const node = nodeMap.get(session.filePath)!
      parent.children.push(node)
      parentedNodes.add(session.filePath)
    }
  }

  let root: SessionTreeNode | null = null

  const mainSession = sessions.find((s) => s.isMain)
  if (mainSession) {
    root = nodeMap.get(mainSession.filePath) ?? null
  }

  if (!root) {
    const orphan = sessions.find((s) => !parentedNodes.has(s.filePath))
    if (orphan) {
      root = nodeMap.get(orphan.filePath) ?? null
    }
  }

  if (!root && sessions.length > 0) {
    root = nodeMap.get(sessions[0].filePath) ?? null
  }

  if (root) {
    for (const session of sessions) {
      if (session.filePath === root.session.filePath) continue
      if (parentedNodes.has(session.filePath)) continue
      const node = nodeMap.get(session.filePath)!
      root.children.push(node)
    }
  }

  return root
}

export function nameSession(sessionPath: string, name: string): boolean {
  if (!existsSync(sessionPath)) return false

  try {
    const entry = JSON.stringify({
      type: 'session_info',
      name,
    })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}

export function deleteSession(sessionPath: string, sessionDir?: string): boolean {
  if (!existsSync(sessionPath)) return false

  try {
    unlinkSync(sessionPath)

    const dir = dirname(sessionPath)
    const remaining = readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
    if (remaining.length === 0) {
      rmSync(dir, { recursive: true })
    }

    return true
  } catch {
    return false
  }
}

export function addForkPoint(sessionPath: string, entryId: string, childName: string): boolean {
  if (!existsSync(sessionPath)) return false

  try {
    const entry = JSON.stringify({
      type: 'fork_point',
      entryId,
      childName,
    })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}

export function getForkPoints(sessionPath: string): ForkPoint[] {
  if (!existsSync(sessionPath)) return []

  const forkPoints: ForkPoint[] = []

  try {
    const content = readFileSync(sessionPath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)

    for (let i = 1; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>
        if (entry.type === 'fork_point' && typeof entry.entryId === 'string') {
          forkPoints.push({
            entryId: entry.entryId,
            childName: typeof entry.childName === 'string' ? entry.childName : '',
          })
        }
      } catch {
        continue
      }
    }
  } catch {
    return []
  }

  return forkPoints
}

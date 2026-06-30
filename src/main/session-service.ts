import { readdirSync, readFileSync, writeFileSync, existsSync, appendFileSync, unlinkSync, rmSync, mkdirSync, statSync, renameSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { randomUUID } from 'crypto'
import type {
  SessionInfo,
  SessionListResult,
  SessionFileHeader,
  ProjectSessionTree,
  SessionTreeNode,
  ForkPoint,
  SubagentMeta
} from '../renderer/src/types/session'

/**
 * Migrate session files from legacy encoded subdirectory to flat sessions directory.
 * Old path: {project}/.xi/sessions/--Users-foo-project--/xxx.jsonl
 * New path: {project}/.xi/sessions/xxx.jsonl
 */
function migrateLegacySessionDir(projectRoot: string, sessionDir: string): void {
  const xiDir = join(projectRoot, '.xi')
  const oldSessionsParent = join(xiDir, 'sessions')
  if (!existsSync(oldSessionsParent)) return

  // Look for encoded subdirectories (--xxx--)
  let entries: string[]
  try {
    entries = readdirSync(oldSessionsParent)
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.startsWith('--') || !entry.endsWith('--')) continue
    const encodedDir = join(oldSessionsParent, entry)
    let stat
    try { stat = statSync(encodedDir) } catch { continue }
    if (!stat.isDirectory()) continue

    // Move all .jsonl and .json files from encoded dir to flat sessions dir
    let files: string[]
    try { files = readdirSync(encodedDir) } catch { continue }
    for (const file of files) {
      const source = join(encodedDir, file)
      const target = join(sessionDir, file)
      if (!existsSync(target)) {
        try {
          renameSync(source, target)
        } catch {}
      }
    }

    // Remove encoded dir if empty
    try {
      const remaining = readdirSync(encodedDir)
      if (remaining.length === 0) {
        rmSync(encodedDir, { recursive: true })
      }
    } catch {}
  }
}

export function getSessionDir(cwd?: string): string {
  const projectRoot = cwd ?? process.cwd()
  const resolvedCwd = resolve(projectRoot)
  const sessionDir = join(resolvedCwd, '.xi', 'sessions')
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true })
  }
  migrateLegacySessionDir(resolvedCwd, sessionDir)
  return sessionDir
}


/** Create a new empty session JSONL file with header and optional name.
 *  Returns the absolute path to the created file.
 *  This is a pure file operation — no Pi runtime involved. */
export function createSessionFile(
  sessionDir: string,
  cwd: string,
  name: string,
  parentSessionPath?: string
): string {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  // File name matches Pi SDK convention: ISO timestamp with ':' and '.' replaced by '-', then '_' + uuid
  const fileTimestamp = timestamp.replace(/[:.]/g, '-')
  const fileName = `${fileTimestamp}_${id}.jsonl`
  const filePath = join(sessionDir, fileName)

  const header: Record<string, unknown> = {
    type: 'session',
    version: 3,
    id,
    timestamp,
    cwd,
  }
  if (parentSessionPath) {
    header.parentSession = parentSessionPath
  }

  writeFileSync(filePath, JSON.stringify(header) + '\n')
  nameSession(filePath, name)

  return filePath
}

function extractPlainText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
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
    let status: 'active' | 'completed' | null = null
    let summary: string | null = null
    let parentSessionPath: string | null = header.parentSession ?? null
    let firstUserMessage: string | null = null
    let origin: 'main' | 'subagent' | 'fork_ask' = 'main'
    let subagentMeta: SubagentMeta | null = null

    for (let i = 1; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>
        if (entry.type === 'message') {
          const message = entry.message as Record<string, unknown> | undefined
          if (message && message.role === 'user') {
            messageCount++
            if (firstUserMessage === null && message.content) {
              firstUserMessage = extractPlainText(message.content).substring(0, 500)
            }
          }
        } else if (entry.type === 'session_info') {
          if (typeof entry.name === 'string') {
            name = entry.name
          }
          if (entry.status === 'active' || entry.status === 'completed') {
            status = entry.status
          }
          if (typeof entry.summary === 'string') {
            summary = entry.summary
          }
          // session_info 中的 parentSession 覆盖 header
          if ('parentSession' in entry) {
            parentSessionPath = typeof entry.parentSession === 'string' ? entry.parentSession : null
          }
          if (entry.origin === 'main' || entry.origin === 'subagent' || entry.origin === 'fork_ask') {
            origin = entry.origin
          }
          if (entry.subagentMeta && typeof entry.subagentMeta === 'object') {
            subagentMeta = entry.subagentMeta as SubagentMeta
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
      status,
      summary,
      firstUserMessage,
      origin,
      subagentMeta,
      createdAt: header.timestamp,
      cwd: header.cwd,
      parentSessionPath,
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

  const sessionFiles = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(dir, name))

  for (const filePath of sessionFiles) {
    const info = parseSessionFile(filePath)
    if (info && info.cwd === cwd && info.name === 'main') {
      return info
    }
  }

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

  return null
}

export function listSessions(_currentSessionPath?: string, sessionDir?: string): SessionListResult {
  const sessionDirPath = sessionDir ?? getSessionDir()
  if (!existsSync(sessionDirPath)) {
    return { projects: [] }
  }

  let sessionFiles: string[]
  try {
    sessionFiles = readdirSync(sessionDirPath)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(sessionDirPath, name))
  } catch {
    return { projects: [] }
  }

  const sessions: SessionInfo[] = []
  for (const filePath of sessionFiles) {
    const info = parseSessionFile(filePath)
    if (info) sessions.push(info)
  }

  if (sessions.length === 0) {
    return { projects: [] }
  }

  sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const namedMain = sessions.find((s) => s.name === 'main')
  if (namedMain) {
    namedMain.isMain = true
  } else if (sessions.length > 0) {
    sessions[0].isMain = true
  }

  const cwd = sessions[0].cwd
  const tree = buildSessionTree(sessions)
  const encodedDir = sessionDirPath.split('/').pop() ?? ''

  const projects: ProjectSessionTree[] = [{
    projectPath: cwd,
    encodedDir,
    root: tree,
    allSessions: sessions
  }]

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

/** Pending session names for files that don't exist on disk yet.
 *  When nameSession() is called before Pi creates the file, the name
 *  is stored here. flushPendingName() should be called once the file
 *  exists (e.g., after flush_session), which writes the session_info
 *  entry to the now-existing file. */
const pendingNames = new Map<string, string>()

/**
 * Check whether reparenting `sessionPath` under `newParentPath` would
 * create a cycle in the session tree. Walk the parent chain from
 * `newParentPath` upwards; if we ever reach `sessionPath`, it's a cycle.
 */
export function wouldCreateCycle(
  sessionPath: string,
  newParentPath: string | null,
  sessions: SessionInfo[]
): boolean {
  if (!newParentPath) return false // clearing parent can't create a cycle
  if (newParentPath === sessionPath) return true

  const parentMap = new Map<string, string | null>()
  for (const s of sessions) {
    parentMap.set(s.filePath, s.parentSessionPath)
  }

  let current: string | null = newParentPath
  const visited = new Set<string>()
  while (current) {
    if (current === sessionPath) return true
    if (visited.has(current)) return false // unrelated pre-existing cycle
    visited.add(current)
    current = parentMap.get(current) ?? null
  }
  return false
}

export function clearPendingNames(): void {
  pendingNames.clear()
}

export function nameSession(sessionPath: string, name: string, _cwd?: string, _parentSessionPath?: string): boolean {
  try {
    if (!existsSync(sessionPath)) {
      pendingNames.set(sessionPath, name)
      return true
    }

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

/** Flush any pending name for the given session path.
 *  Call this after the session file has been created (e.g., after
 *  flush_session completes) to persist the queued session_info entry. */
export function flushPendingName(sessionPath: string): boolean {
  const name = pendingNames.get(sessionPath)
  if (name === undefined) return true

  try {
    if (!existsSync(sessionPath)) return false
    const entry = JSON.stringify({
      type: 'session_info',
      name,
    })
    appendFileSync(sessionPath, entry + '\n')
    pendingNames.delete(sessionPath)
    return true
  } catch {
    return false
  }
}

/**
 * Clear all messages and fork_points from a session file,
 * keeping the header and session_info entries (name, status, parentSession).
 * Returns true if the file was successfully rewritten.
 */
export function clearSessionMessages(sessionPath: string): boolean {
  if (!existsSync(sessionPath)) return false

  try {
    const content = readFileSync(sessionPath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length === 0) return false

    const kept: string[] = []
    let hasHeader = false

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>
        if (entry.type === 'session' && !hasHeader) {
          // Keep the first session header
          kept.push(line)
          hasHeader = true
        } else if (entry.type === 'session_info') {
          // Keep name, status, parentSession metadata; strip summary
          const { summary: _, ...rest } = entry
          kept.push(JSON.stringify(rest))
        }
        // Skip: message, fork_point, and everything else
      } catch {
        // Unparseable line — skip
      }
    }

    if (!hasHeader) return false

    writeFileSync(sessionPath, kept.join('\n') + '\n')
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

export function setSessionStatus(sessionPath: string, status: 'active' | 'completed'): boolean {
  if (!existsSync(sessionPath)) return false

  try {
    const entry = JSON.stringify({
      type: 'session_info',
      status,
    })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}

/**
 * Change a session's parent by appending a session_info entry.
 * This uses the same append-only override mechanism as name/status:
 * the last session_info entry's parentSession field wins.
 *
 * Pass null to clear the parent (make session a root-level orphan).
 * Does NOT perform cycle detection — callers should check with
 * wouldCreateCycle() before calling this.
 */
export function reparentSession(sessionPath: string, newParentPath: string | null): boolean {
  if (!existsSync(sessionPath)) return false

  // Self-reference guard
  if (newParentPath === sessionPath) return false

  // If a new parent is specified, verify it exists
  if (newParentPath && !existsSync(newParentPath)) return false

  try {
    const entry = JSON.stringify({
      type: 'session_info',
      parentSession: newParentPath,
    })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}

export function setSessionOrigin(sessionPath: string, origin: 'main' | 'subagent' | 'fork_ask'): boolean {
  if (!existsSync(sessionPath)) return false
  try {
    const entry = JSON.stringify({ type: 'session_info', origin })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}

export function setSubagentMeta(sessionPath: string, meta: {
  agentName: string
  task: string
  mode: 'single' | 'parallel' | 'chain'
  runId: string
  status?: 'running' | 'completed' | 'failed'
}): boolean {
  if (!existsSync(sessionPath)) return false
  try {
    const entry = JSON.stringify({ type: 'session_info', subagentMeta: meta })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}

/**
 * Set a session's summary by appending a session_info entry.
 * Uses the same append-only override mechanism as name/status/parentSession:
 * the last session_info entry's summary field wins.
 */
export function setSessionSummary(sessionPath: string, summary: string): boolean {
  if (!existsSync(sessionPath)) return false

  try {
    const entry = JSON.stringify({
      type: 'session_info',
      summary,
    })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}

/**
 * Parse a session JSONL file and return all messages in Pi's raw format.
 * This is the same format returned by the `get_messages` RPC, so the
 * renderer can reuse its existing loadHistory conversion logic.
 *
 * This is a pure file read — no Pi worker involved, no session switching.
 * Safe for Lazy Switch: when the Pi worker is connected to session A,
 * calling this for session B reads B's JSONL directly from disk.
 * Since Pi persists messages synchronously on `message_end`, and B is
 * not streaming (Pi only has one active session), the JSONL is always
 * complete and consistent.
 */
export function parseSessionMessages(filePath: string): unknown[] {
  if (!existsSync(filePath)) return []

  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length === 0) return []

    const messages: unknown[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>
        if (entry.type === 'message' && entry.message) {
          const msg = { ...(entry.message as Record<string, unknown>) }
          // Attach the entry id as the message id if not present
          // (matches pi-worker's get_messages behavior)
          if (!msg.id && typeof entry.id === 'string') {
            msg.id = entry.id
          }
          messages.push(msg)
        }
      } catch {
        continue
      }
    }

    return messages
  } catch {
    return []
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

export function getLastSession(cwd: string): string | null {
  const dir = getSessionDir(cwd)
  const filePath = join(dir, 'last-session.json')
  if (!existsSync(filePath)) return null
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as { sessionPath: string; updatedAt: string }
    if (typeof data.sessionPath !== 'string') return null
    if (!existsSync(data.sessionPath)) return null
    return data.sessionPath
  } catch {
    return null
  }
}

export function saveLastSession(cwd: string, sessionPath: string): void {
  const dir = getSessionDir(cwd)
  const filePath = join(dir, 'last-session.json')
  try {
    writeFileSync(filePath, JSON.stringify({ sessionPath, updatedAt: new Date().toISOString() }, null, 2))
  } catch {}
}

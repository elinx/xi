/**
 * Session management types for Pi session sidebar.
 *
 * Pi sessions are stored as JSONL files at:
 *   ~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl
 *
 * Each file has a tree structure (id/parentId) and a header with metadata.
 * Inter-session relationships are tracked via `parentSession` in the header.
 */

/** Parsed header from a Pi session JSONL file (first line). */
export interface SessionFileHeader {
  type: 'session'
  version: number
  id: string
  timestamp: string
  cwd: string
  parentSession?: string
}

/** Lightweight metadata for a session file, used in the sidebar list. */
export interface SessionInfo {
  /** Absolute path to the .jsonl file on disk. */
  filePath: string
  /** UUID from the session header. */
  sessionId: string
  /** User-defined display name (from session_info entries), or null. */
  name: string | null
  /** ISO timestamp of session creation. */
  createdAt: string
  /** Working directory the session was started in. */
  cwd: string
  /** Absolute path to the parent session file, or null. */
  parentSessionPath: string | null
  /** Number of user messages in the session. */
  messageCount: number
  /** Whether this is the "main" session for its project. */
  isMain: boolean
  /** Session status: 'active' or 'completed'. null means active (default). */
  status: 'active' | 'completed' | null
}

/**
 * A node in the inter-session tree.
 * Each project has a tree of sessions linked by parentSession.
 */
export interface SessionTreeNode {
  session: SessionInfo
  children: SessionTreeNode[]
}

/**
 * A project's session tree.
 * Each project (working directory) has one tree rooted at the "main" session.
 */
export interface ProjectSessionTree {
  /** The decoded working directory path. */
  projectPath: string
  /** The encoded directory name (e.g., "--Users-foo-bar--"). */
  encodedDir: string
  /** Root of the session tree (the "main" session). */
  root: SessionTreeNode | null
  /** All sessions in this project (flat list for lookup). */
  allSessions: SessionInfo[]
}

/** Result of listing all sessions across all projects. */
export interface SessionListResult {
  projects: ProjectSessionTree[]
}

/** A forkable user message entry (from get_fork_messages RPC). */
export interface ForkableMessage {
  entryId: string
  text: string
}

/** A recorded fork point in a parent session's JSONL file. */
export interface ForkPoint {
  entryId: string
  childName: string
}

/** IPC channels for session management between renderer and main process. */
export interface SessionIpcApi {
  /** List all sessions grouped by project. */
  listSessions: () => Promise<SessionListResult>
  /** Get forkable user messages for the current session. */
  getForkMessages: () => Promise<ForkableMessage[]>
  /** Fork at a specific entry, creating a new session. */
  forkAtEntry: (entryId: string, name?: string) => Promise<{ success: boolean; text?: string; error?: string }>
  /** Switch to a different session. */
  switchSession: (sessionPath: string) => Promise<{ success: boolean; error?: string }>
  /** Create a new session with a name and optional parent. */
  newSession: (name: string, parentSessionPath?: string) => Promise<{ success: boolean; error?: string }>
  /** Rename a session. */
  renameSession: (name: string) => Promise<{ success: boolean; error?: string }>
  /** Get current session state. */
  getCurrentSession: () => Promise<SessionInfo | null>
  /** Refresh session list (after fork/switch/new operations). */
  refreshSessions: () => Promise<SessionListResult>
  /** Get all messages in the current Pi session (raw Pi message format). */
  getMessages: () => Promise<unknown[]>
  /** Delete a session by file path. Cannot delete the active session. */
  deleteSession: (sessionPath: string) => Promise<{ success: boolean; error?: string }>
  /** Get fork points recorded in a session file. */
  getForkPoints: (sessionPath: string) => Promise<ForkPoint[]>
  /** Clear the current session's conversation (delete JSONL, restart Pi, rename). */
  clearSession: () => Promise<{ success: boolean; error?: string }>
  /** Set session status (active/completed). Pure file operation, no Pi RPC. */
  setSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<{ success: boolean; error?: string }>
}

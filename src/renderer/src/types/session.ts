/**
 * Session management types for Pi session sidebar.
 *
 * Pi sessions are stored as JSONL files at:
 *   ~/.xi/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl
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

export interface SubagentMeta {
  agentName: string
  task: string
  mode: 'single' | 'parallel' | 'chain'
  runId: string
  currentTool?: string
  turnCount?: number
  durationMs?: number
  activityState?: 'active' | 'active_long_running' | 'needs_attention'
  status?: 'running' | 'completed' | 'failed'
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
  /** Session status: 'active', 'completed', or 'branched'. null means active (default). */
  status: 'active' | 'completed' | 'branched' | null
  /** Session summary (from session_info entries), or null. */
  summary: string | null
  /** First user message text (truncated), for search/preview. null if no user messages. */
  firstUserMessage: string | null
  /** Origin: 'main' for normal sessions, 'subagent' for subagent sessions. */
  origin: 'main' | 'subagent' | 'fork_ask'
  /** Metadata for subagent sessions. null for normal sessions. */
  subagentMeta: SubagentMeta | null
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

/** A proposed direction for branching a session into a new conversation. */
export interface BranchDirection {
  title: string
  description: string
  purpose: string
  source: 'ai' | 'user'
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

export interface SessionIpcApi {
  listSessions: () => Promise<SessionListResult>
  getForkMessages: (sessionPath: string | null) => Promise<ForkableMessage[]>
  forkAtEntry: (sessionPath: string | null, entryId: string, name?: string) => Promise<{ success: boolean; text?: string; error?: string; sessionPath?: string }>
  switchSession: (sessionPath: string) => Promise<{ success: boolean; error?: string }>
  newSession: (sessionPath: string | null, name: string, parentSessionPath?: string) => Promise<{ success: boolean; error?: string; sessionPath?: string }>
  renameSession: (sessionPath: string | null, name: string) => Promise<{ success: boolean; error?: string }>
  getCurrentSession: () => Promise<SessionInfo | null>
  refreshSessions: () => Promise<SessionListResult>
  getMessages: (sessionPath: string | null) => Promise<unknown[]>
  deleteSession: (sessionPath: string) => Promise<{ success: boolean; error?: string }>
  getForkPoints: (sessionPath: string) => Promise<ForkPoint[]>
  clearSession: (sessionPath: string | null) => Promise<{ success: boolean; error?: string; sessionPath?: string }>
  clearMessages: (sessionPath: string) => Promise<{ success: boolean; error?: string; sessionPath?: string }>
  setSessionStatus: (sessionPath: string, status: 'active' | 'completed' | 'branched') => Promise<{ success: boolean; error?: string }>
  reparentSession: (sessionPath: string, newParentPath: string | null) => Promise<{ success: boolean; error?: string }>
  setSessionSummary: (sessionPath: string, summary: string) => Promise<{ success: boolean; error?: string }>
  analyzeBranchDirections: (sessionPath: string | null) => Promise<{ directions: BranchDirection[] }>
  createBranch: (sessionPath: string | null, direction: BranchDirection) => Promise<{ success: boolean; newSessionPath?: string; error?: string }>
}

/** Model info returned by Pi SDK. */
export interface PiModelInfo {
  provider: string
  id: string
  name: string
  hasAuth: boolean
  reasoning: boolean | null
  contextWindow: number | null
}

/** Result from getAvailableModels IPC call. */
export interface GetAvailableModelsResult {
  ok: boolean
  data?: { models: PiModelInfo[] }
  error?: string
}

/** Result from setModel IPC call. */
export interface SetModelResult {
  ok: boolean
  data?: PiModelInfo | null
  error?: string
}

/** Result from cycleModel IPC call. */
export interface CycleModelResult {
  ok: boolean
  data?: {
    model: PiModelInfo | null
    thinkingLevel: string
    isScoped: boolean
  }
  error?: string
}

/** Result from getModelInfo IPC call. */
export interface GetModelInfoResult {
  ok: boolean
  data?: { model: PiModelInfo | null; thinkingLevel: string | null }
  error?: string
}

/** IPC channels for file system operations between renderer and main process. */
export interface FileSystemIpcApi {
  readDirectory: (dirPath: string) => Promise<{
    ok: boolean
    entries?: Array<{ name: string; path: string; isDirectory: boolean }>
    error?: string
  }>
}

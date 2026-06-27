import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import { resolve, relative, join, dirname } from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { parseSessionFile } from './session-service'

process.on('uncaughtException', (err: Error) => {
  process.parentPort?.postMessage({ channel: 'error', error: `Uncaught: ${err.message}` })
})

process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  process.parentPort?.postMessage({ channel: 'error', error: `Unhandled rejection: ${msg}` })
})

/**
 * Directories that agents must NOT write user files into.
 * These are runtime-internal or infrastructure directories, not user project content.
 */
const PROTECTED_DIR_NAMES = new Set(['.xi', '.git', 'node_modules'])

function isProtectedPath(absolutePath: string, cwd: string): boolean {
  const rel = relative(cwd, absolutePath)
  // Path escapes cwd — don't block it (agent writing elsewhere)
  if (rel.startsWith('..') || resolve(absolutePath) !== absolutePath) {
    // Also protect .xi/.git/node_modules outside cwd when under the project
    const normalized = absolutePath.replace(/\\/g, '/')
    for (const name of PROTECTED_DIR_NAMES) {
      const pattern = `/${name}/`
      if (normalized.includes(pattern)) return true
      if (normalized.endsWith(`/${name}`)) return true
    }
    return false
  }
  const parts = rel.replace(/\\/g, '/').split('/')
  return PROTECTED_DIR_NAMES.has(parts[0])
}

function validateWritePath(absolutePath: string, cwd: string): void {
  if (isProtectedPath(absolutePath, cwd)) {
    throw new Error(
      `Cannot write to protected directory: ${absolutePath}\n` +
      'This directory contains runtime-internal data. Write to the project root or a dedicated folder instead.'
    )
  }
}

/**
 * Build a system prompt preamble from ancestor session summaries.
 * Walks the parentSession chain from the current session upward,
 * collecting summaries from ancestor sessions.
 * Returns an empty string if no ancestors have summaries.
 */
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildAncestorPreamble(sessionFilePath: string): string {
  const chain: Array<{ name: string; summary: string; parentName: string | null }> = []
  let currentPath: string | null = sessionFilePath
  const visited = new Set<string>()
  const MAX_DEPTH = 5
  const MAX_SUMMARY_CHARS = 500

  while (currentPath && chain.length < MAX_DEPTH) {
    if (visited.has(currentPath)) break
    visited.add(currentPath)

    const info = parseSessionFile(currentPath)
    if (!info) break

    if (currentPath !== sessionFilePath && info.summary) {
      const truncated = info.summary.length > MAX_SUMMARY_CHARS
        ? info.summary.substring(0, MAX_SUMMARY_CHARS) + '...'
        : info.summary

      let parentName: string | null = null
      if (info.parentSessionPath) {
        const parentInfo = parseSessionFile(info.parentSessionPath)
        parentName = parentInfo?.name ?? null
      }

      chain.push({ name: info.name || 'unnamed', summary: truncated, parentName })
    }

    currentPath = info.parentSessionPath
  }

  if (chain.length === 0) return ''

  chain.reverse()

  const items = chain.map((item, i) => {
    const parentAttr = item.parentName ? ` parent="${escAttr(item.parentName)}"` : ''
    return `<ancestor-session name="${escAttr(item.name)}"${parentAttr}>\n${item.summary}\n</ancestor-session>`
  }).join('\n\n')

  return `<ancestor-context>\nYou are continuing work in a forked session — a parallel branch, not a linear continuation. Below are summaries of ancestor sessions, ordered from root to direct parent. Use this context to maintain continuity, but do not re-do work that is already completed — sibling sessions may be handling other tasks in parallel.\n\n${items}\n</ancestor-context>`
}

function createSearchSessionsTool(cwd: string, currentSessionFile?: string) {
  const schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string' as const, description: 'Search query — matches against session names, summaries, and message content. Multi-word queries use AND logic: all terms must appear. Supports Chinese and English.' },
      limit: { type: 'number' as const, description: 'Max results to return (default 10)', default: 10 },
    },
    required: ['query'],
  }

  // ── CJK-aware tokenizer using Intl.Segmenter + bigrams ──────────────────
  // Zero external dependencies. Intl.Segmenter is built-in since Node 16+
  // with full-icu. For CJK text, we also generate bigrams to improve recall
  // when the segmenter splits words too finely (e.g. "长江大桥" → ["长江","大","桥"]
  // misses "长江大桥" but bigrams "长江","江大","大桥" catch it).

  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

  function tokenize(text: string): string[] {
    if (!text || typeof text !== 'string') return []
    const tokens: string[] = []

    // Split on whitespace/punctuation first to separate CJK from Latin segments
    const segments = text.split(/[\n\r\p{Z}\p{P}]+/u)
    for (const seg of segments) {
      if (!seg) continue
      if (CJK_PATTERN.test(seg)) {
        // CJK segment: use Intl.Segmenter + bigrams
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
        // Latin segment: lowercase, skip very short tokens
        const lower = seg.toLowerCase()
        if (lower.length >= 1) tokens.push(lower)
      }
    }
    return tokens
  }

  // ── Text extraction helpers ─────────────────────────────────────────────

  /** Extract plain text from a message.content value (string or array of content blocks) */
  function extractText(msgContent: unknown): string {
    if (typeof msgContent === 'string') return msgContent
    if (!Array.isArray(msgContent)) return ''
    const parts: string[] = []
    for (const block of msgContent) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      } else if (block.type === 'toolCall' && typeof block.name === 'string') {
        const args = block.arguments
        if (args && typeof args === 'object') {
          const keyFields = ['command', 'pattern', 'path', 'query', 'content']
          for (const key of keyFields) {
            if (typeof args[key] === 'string') parts.push(`${block.name} ${key}: ${args[key]}`)
          }
        }
      } else if (block.type === 'toolResult' && Array.isArray(block.content)) {
        for (const sub of block.content) {
          if (sub?.type === 'text' && typeof sub.text === 'string') parts.push(sub.text)
        }
      }
    }
    return parts.join('\n')
  }

  /** Check if text is predominantly code (for excerpt quality filtering) */
  function isCodeLike(text: string): boolean {
    const codeIndicators = /^(const |let |var |import |from ['"]|function |class |return |if \(|for \(|while \(|await |async |=> \{|export |interface |type |\$\{|`[^\n]*`)/
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length === 0) return false
    const codeLines = lines.filter(l => codeIndicators.test(l.trim()))
    return codeLines.length / lines.length > 0.5
  }

  /** Create a readable excerpt from text, highlighting around the first matching token */
  function excerpt(text: string, queryTokens: string[], maxLen = 300): string {
    const lower = text.toLowerCase()
    // Find the first occurrence of any query token
    let bestIdx = -1
    for (const token of queryTokens) {
      const idx = lower.indexOf(token)
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx
      }
    }
    if (bestIdx === -1) {
      return text.length > maxLen ? text.substring(0, maxLen) + '...' : text
    }
    const contextBefore = 40
    const start = Math.max(0, bestIdx - contextBefore)
    const end = Math.min(text.length, start + maxLen)
    let result = text.substring(start, end)
    if (start > 0) result = '...' + result
    if (end < text.length) result = result + '...'
    return result
  }

  // ── Main search tool ────────────────────────────────────────────────────

  return {
    name: 'search_sessions',
    label: 'search_sessions',
    description:
      'Search conversations from other sessions in this project. ' +
      'Xi never compacts context — every message is preserved — but only the current session is directly visible. ' +
      'Past decisions, design rationale, failed approaches, and work-in-progress live in other sessions — because Xi forks tasks into parallel sessions rather than compacting them into one thread. ' +
      'Use this to recover context that the filesystem cannot provide: not what the code does, but why it was written that way. ' +
      'Searches session names, compaction summaries, and message content. ' +
      'Multi-word queries use AND logic (all terms must appear). Supports Chinese and English.',
    parameters: schema,
    execute: async (_toolCallId: string, params: { query: string; limit?: number }, _signal: AbortSignal | undefined) => {
      const limit = params.limit ?? 10
      const queryTokens = tokenize(params.query)
      if (queryTokens.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Empty query.' }] }
      }
      const sessionsDir = join(cwd, '.xi', 'sessions')
      if (!fsSync.existsSync(sessionsDir)) {
        return { content: [{ type: 'text' as const, text: 'No sessions directory found.' }] }
      }
      let files: string[]
      try {
        files = fsSync.readdirSync(sessionsDir)
          .filter(f => f.endsWith('.jsonl'))
          .sort()
          .map(f => join(sessionsDir, f))
          .filter(f => !currentSessionFile || f !== currentSessionFile)
      } catch {
        return { content: [{ type: 'text' as const, text: 'Could not read sessions directory.' }] }
      }

      // ── Parse all sessions and collect searchable content ──────────────
      interface SessionDoc {
        id: string
        filePath: string
        fileName: string
        name: string
        summary: string
        parentSessionPath: string
        firstUserMessage: string
        userContent: string      // all user message text concatenated
        assistantContent: string  // all assistant message text concatenated
        compactionSummary: string
      }

      const sessionDocs: SessionDoc[] = []

      for (const filePath of files) {
        try {
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
            let entry: Record<string, unknown>
            try { entry = JSON.parse(line) } catch { continue }

            if (entry.type === 'session' && typeof entry.name === 'string') {
              name = entry.name as string
            }

            if (entry.type === 'session_info') {
              if (typeof entry.name === 'string') name = entry.name
              if (typeof entry.summary === 'string') summary = entry.summary
              if (typeof entry.parentSession === 'string') parentSessionPath = entry.parentSession
            }

            if (entry.type === 'compaction' && typeof entry.summary === 'string') {
              compactionTexts.push(entry.summary as string)
            }

            if (entry.type === 'message' && (entry.message as Record<string, unknown>)?.content) {
              const msg = entry.message as Record<string, unknown>
              const plainText = extractText(msg.content)
              if (!plainText) continue
              if (msg.role === 'user') {
                if (!firstUserMessage) firstUserMessage = plainText
                userTexts.push(plainText)
              } else if (msg.role === 'assistant') {
                assistantTexts.push(plainText)
              }
            }
          }

          sessionDocs.push({
            id: filePath,
            filePath,
            fileName: filePath.split('/').pop() || filePath,
            name,
            summary,
            parentSessionPath,
            firstUserMessage,
            userContent: userTexts.join('\n'),
            assistantContent: assistantTexts.join('\n'),
            compactionSummary: compactionTexts.join('\n'),
          })
        } catch { continue }
      }

      // ── Build MiniSearch index with field-level boosting ───────────────
      // We use MiniSearch for BM25+ scoring, multi-word AND matching,
      // and automatic IDF-based term frequency normalization.
      // Fields are indexed with different boost weights at search time.

      const MiniSearch = require('minisearch')

      const miniSearch = new MiniSearch({
        fields: ['name', 'summary', 'compactionSummary', 'userContent', 'assistantContent'],
        storeFields: ['name', 'filePath', 'fileName', 'parentSessionPath', 'firstUserMessage', 'summary', 'userContent', 'compactionSummary'],
        idField: 'id',
        tokenize,
        searchOptions: {
          tokenize,
          combineWith: 'AND',
          boost: {
            name: 10,
            summary: 8,
            compactionSummary: 6,
            userContent: 3,
            assistantContent: 1,
          },
          // Use prefix search for short terms (helps with CJK bigrams)
          prefix: true,
        },
      })

      miniSearch.addAll(sessionDocs)

      // ── Search ─────────────────────────────────────────────────────────
      const searchResults = miniSearch.search(params.query, {
        tokenize,
        combineWith: 'AND',
        boost: {
          name: 10,
          summary: 8,
          compactionSummary: 6,
          userContent: 3,
          assistantContent: 1,
        },
        prefix: true,
      }) as Array<{ id: string; score: number; name: string; filePath: string; fileName: string; parentSessionPath: string; firstUserMessage: string; summary: string; userContent: string; compactionSummary: string; match: Record<string, string[]> }>

      if (searchResults.length === 0) {
        return { content: [{ type: 'text' as const, text: `No sessions found matching "${params.query}".` }] }
      }

      // ── Fork tree dedup: keep only the best result per parent session ──
      const seenParents = new Map<string, number>()  // parentPath → index in results
      const deduped: typeof searchResults = []
      for (const result of searchResults) {
        const parentKey = result.parentSessionPath || result.filePath
        if (seenParents.has(parentKey)) {
          // Keep the higher-scoring one
          const existingIdx = seenParents.get(parentKey)!
          if (result.score > deduped[existingIdx].score) {
            deduped[existingIdx] = result
          }
        } else {
          seenParents.set(parentKey, deduped.length)
          deduped.push(result)
        }
      }

      // ── Format results with improved excerpts ──────────────────────────
      const limited = deduped.slice(0, limit)

      const output = limited.map(r => {
        const header = `## ${r.name || r.fileName}`
        const excerpts: string[] = []

        // 1. Summary excerpt (highest priority context)
        if (r.summary) {
          excerpts.push(excerpt(r.summary, queryTokens))
        }
        // 2. Compaction summary excerpt
        if (r.compactionSummary && excerpts.length < 2) {
          excerpts.push(excerpt(r.compactionSummary, queryTokens))
        }
        // 3. User message excerpts (prefer user > assistant for intent)
        if (r.userContent && excerpts.length < 2) {
          const userExcerpt = excerpt(r.userContent, queryTokens)
          // Skip code-like excerpts
          if (!isCodeLike(userExcerpt)) {
            excerpts.push(userExcerpt)
          }
        }
        // 4. If no excerpts at all (name-only match), show first user message as context
        if (excerpts.length === 0 && r.firstUserMessage) {
          const msgExcerpt = r.firstUserMessage.length > 200
            ? r.firstUserMessage.substring(0, 200) + '...'
            : r.firstUserMessage
          excerpts.push(`(first message) ${msgExcerpt}`)
        }

        const body = excerpts.length > 0
          ? excerpts.map((m, i) => `  ${i + 1}. "${m}"`).join('\n')
          : '  (name match only)'
        return header + '\n' + body
      }).join('\n\n')

      return { content: [{ type: 'text' as const, text: output }] }
    },
  }
}

interface WorkerInit {
  cwd: string
  sessionPath?: string
  sessionDir?: string
}

interface WorkerCommand {
  id?: string
  type: string
  [key: string]: unknown
}

let session: AgentSession | null = null
let runtime: AgentSessionRuntime | null = null
let sessionManager: import('@earendil-works/pi-coding-agent').SessionManager | null = null
let unsubscribe: (() => void) | null = null
let pi: typeof import('@earendil-works/pi-coding-agent') | null = null

let captureEnabled = false
let lastClearedTimestamp = 0
let activeSnapshotCount = 0
const MAX_SNAPSHOTS_PER_SESSION = 20

/**
 * Read promptCaptureEnabled from ~/.xi/settings.json.
 * This is the "bootstrap" mechanism — workers read their initial state
 * from the persisted config on startup, without waiting for GUI to push.
 */
function readCaptureEnabledFromConfig(): boolean {
  try {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
    const agentDir = process.env.PI_CODING_AGENT_DIR || join(homeDir, '.xi')
    const settingsPath = join(agentDir, 'settings.json')
    if (fsSync.existsSync(settingsPath)) {
      const content = fsSync.readFileSync(settingsPath, 'utf-8')
      const settings = JSON.parse(content)
      return settings.promptCaptureEnabled === true
    }
  } catch {}
  return false
}

function send(msg: Record<string, unknown>): void {
  process.parentPort?.postMessage(msg)
}

function forwardEvent(event: AgentSessionEvent): void {
  send({ channel: 'event', data: event })
}

const pendingSubagentRequests = new Map<string, {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}>()

function requestSubagentRun(toolCallId: string, task: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingSubagentRequests.set(toolCallId, { resolve, reject })
    send({
      channel: 'subagent:run',
      toolCallId,
      task,
      parentSessionFile: session?.sessionFile,
    })
  })
}

function createSubagentTool() {
  return {
    name: 'subagent',
    label: 'subagent',
    description: 'Delegate a task to a subagent with its own session. The subagent runs in parallel with full tool access (read, bash, edit, write, grep, find, ls). Its session appears in the sidebar with real-time streaming. Use for: exploration, research, implementing a specific subtask, or any work that benefits from isolated context.',
    parameters: {
      type: 'object' as const,
      properties: {
        task: { type: 'string' as const, description: 'The task for the subagent to complete. Be specific — the subagent has no context beyond this task description and the project files.' },
      },
      required: ['task'],
    },
    execute: async (toolCallId: string, params: { task: string }) => {
      return await requestSubagentRun(toolCallId, params.task)
    },
  }
}

function redactSensitiveFields(payload: Record<string, unknown>): Record<string, unknown> {
  const safe = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
  if (typeof safe === 'object' && safe !== null) {
    delete safe['api_key']
    delete safe['x-api-key']
    if (safe['headers'] && typeof safe['headers'] === 'object') {
      const h = safe['headers'] as Record<string, unknown>
      if (h['authorization']) h['authorization'] = 'Bearer <REDACTED>'
      if (h['x-api-key']) h['x-api-key'] = '<REDACTED>'
    }
  }
  return safe
}

function countActiveSnapshots(): number {
  return activeSnapshotCount
}

async function bindSession(): Promise<void> {
  unsubscribe?.()
  if (!session) return

  await session.bindExtensions({})

  unsubscribe = session.subscribe((event) => {
    // Inject entry ID into message_end events so the GUI can set piEntryId
    // on the corresponding ChatMessage. We use queueMicrotask because
    // Pi SDK's _handleAgentEvent emits the event BEFORE calling
    // sessionManager.appendMessage(). By queuing a microtask, we defer
    // the getLeafId() call until after appendMessage() has executed
    // and the leaf ID has been updated.
    if (event.type === 'message_end' && sessionManager) {
      const role = (event as Record<string, unknown>).message
        ? ((event as Record<string, unknown>).message as Record<string, unknown>).role
        : undefined
      queueMicrotask(() => {
        const leafId = sessionManager!.getLeafId()
        if (leafId) {
          send({
            channel: 'event',
            data: { type: 'entry_id', entryId: leafId, role, sessionPath: session?.sessionFile },
          })
        }
      })
    }

    forwardEvent(event)

    if (event.type === 'agent_end') {
      send({ channel: 'agent_end' })
    }
  })
}

async function init(data: WorkerInit): Promise<void> {
  pi = await import('@earendil-works/pi-coding-agent')

  // Bootstrap captureEnabled from persisted config (source of truth)
  captureEnabled = readCaptureEnabledFromConfig()

  const agentDir = pi.getAgentDir()

  const createRuntime: pi.CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager: sm, sessionStartEvent }) => {
    sessionManager = sm
    // Collect ancestor context once at runtime creation time
    const ancestorPreamble = buildAncestorPreamble(sm.getSessionFile())

    const services = await pi!.createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        // By returning a non-undefined value from systemPromptOverride, we force
        // the SDK's buildSystemPrompt() to take the `if (customPrompt)` branch,
        // completely skipping the default "You are an expert coding assistant operating
        // inside pi..." template with all its pi docs references.
        // If the user has a SYSTEM.md file, use it (with pi→xi replacements);
        // otherwise, provide our own lean prompt.
        systemPromptOverride: (base: string | undefined) => {
          if (base) return base.replace(/\bpi\b/g, 'xi').replace(/\bPi\b/g, 'Xi')
          return `You are Xi (ξ), an expert coding assistant running inside a session-tree-based coding environment. Every conversation is a session — a node in a tree of forking thought. The project's collective memory is distributed across all sessions, not stored in a single linear thread. Xi has no context compaction — context windows are large enough (1M+ tokens) that conversations stay complete. Where linear systems compact by compressing side tasks into the main thread, Xi forks each task into its own parallel session: nothing is ever lost, but everything beyond the current session must be searched.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call
- write: Create or overwrite files
- grep: Search file contents for patterns (respects .gitignore)
- find: Find files by glob pattern (respects .gitignore)
- ls: List directory contents
- search_sessions: Search conversations from other sessions — recovers past decisions, design rationale, and failed approaches that the filesystem cannot provide
- subagent: Delegate a task to a subagent with its own session. The subagent runs in parallel with full tool access and real-time streaming in the sidebar.

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Use read to examine files instead of cat or sed.
- Use edit for precise changes (edits[].oldText must match exactly).
- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls.
- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.
- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.
- Use write only for new files or complete rewrites.
- Use search_sessions when you need to understand not just what exists, but why it exists — past decisions, design rationale, and evolving understanding live in other sessions.
- After each non-trivial edit or write, briefly explain what you changed and why (1-2 sentences). Skip this for trivial changes like formatting fixes or typo corrections. Place this explanation immediately after the tool call in the same response.
- Be concise in your responses.
- Show file paths clearly when working with files.

Session features:
- Fork: branch a new session from any point in any conversation
- Parallel: multiple sessions can run simultaneously, each with its own agent worker
- Forward: send a message from one session to another
- Quote: reference a message from any session in your reply
- Reparent: drag to reorganize the tree, changing a session's parent
- Summary: sessions can have a summary (stored as a dedicated metadata field, written in English). Summaries are generated when a session is marked completed or when the user requests one. They are automatically injected into child sessions as ancestor context.`
        },
        appendSystemPromptOverride: (base: string[]) => {
          const parts = [...base]
          if (ancestorPreamble) parts.push(ancestorPreamble)
          return parts
        },
        extensionFactories: [
          (extensionApi: Record<string, unknown>) => {
            const on = extensionApi['on'] as (event: string, handler: (...args: unknown[]) => void) => void
            console.error('[prompt-capture] extension factory registered')
            on('before_provider_request', (event: unknown) => {
              if (!captureEnabled || !sessionManager) return
              if (activeSnapshotCount >= MAX_SNAPSHOTS_PER_SESSION) return
              try {
                const ctx = event as { payload: unknown }
                const payload = (typeof ctx.payload === 'object' && ctx.payload !== null)
                  ? redactSensitiveFields(ctx.payload as Record<string, unknown>)
                  : ctx.payload
                sessionManager.appendCustomEntry('prompt_snapshot', {
                  requestId: `snap_${Date.now()}`,
                  timestamp: Date.now(),
                  payload,
                })
                activeSnapshotCount++
              } catch (e) {
                console.error('[prompt-capture] failed to store snapshot:', e)
              }
            })
          },
        ],
      },
    })

    const guardedWriteTool = pi.createWriteToolDefinition(cwd, {
      operations: {
        writeFile: async (absolutePath: string, content: string) => {
          validateWritePath(absolutePath, cwd)
          return fs.writeFile(absolutePath, content, 'utf-8')
        },
        mkdir: async (dir: string) => {
          validateWritePath(dir, cwd)
          return fs.mkdir(dir, { recursive: true })
        },
      },
    })

    const guardedEditTool = pi.createEditToolDefinition(cwd, {
      operations: {
        readFile: (absolutePath: string) => fs.readFile(absolutePath),
        writeFile: async (absolutePath: string, content: string) => {
          validateWritePath(absolutePath, cwd)
          return fs.writeFile(absolutePath, content, 'utf-8')
        },
        access: (absolutePath: string) => fs.access(absolutePath, fs.constants.R_OK | fs.constants.W_OK),
      },
    })

    return {
      ...(await pi!.createAgentSessionFromServices({
        services,
        sessionManager: sm,
        sessionStartEvent,
        tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'search_sessions', 'subagent'],
        customTools: [guardedWriteTool, guardedEditTool, createSearchSessionsTool(cwd, sm.getSessionFile()), createSubagentTool()],
      })),
      services,
      diagnostics: services.diagnostics,
    }
  }

  let sm: pi.SessionManager
  if (data.sessionPath) {
    sm = pi.SessionManager.open(data.sessionPath, data.sessionDir)
  } else {
    sm = pi.SessionManager.continueRecent(data.cwd, data.sessionDir)
  }

  runtime = await pi.createAgentSessionRuntime(createRuntime, {
    cwd: data.cwd,
    agentDir,
    sessionManager: sm,
  })

  session = runtime.session
  await bindSession()

  send({ channel: 'connected', data: { sessionFile: session.sessionFile, sessionId: session.sessionId } })
}

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  if (!session || !runtime || !pi) {
    send({ channel: 'response', id: cmd.id, success: false, error: 'Session not initialized' })
    return
  }

  try {
    switch (cmd.type) {
      case 'prompt': {
        await session.prompt(cmd.message as string, {
          images: cmd.images as pi.ImageContent[] | undefined,
          streamingBehavior: cmd.streamingBehavior as 'steer' | 'followUp' | undefined,
        })
        send({ channel: 'response', id: cmd.id, command: 'prompt', success: true })
        break
      }

      case 'steer': {
        await session.steer(cmd.message as string, cmd.images as pi.ImageContent[] | undefined)
        send({ channel: 'response', id: cmd.id, command: 'steer', success: true })
        break
      }

      case 'follow_up': {
        await session.followUp(cmd.message as string, cmd.images as pi.ImageContent[] | undefined)
        send({ channel: 'response', id: cmd.id, command: 'follow_up', success: true })
        break
      }

      case 'abort': {
        await session.abort()
        send({ channel: 'response', id: cmd.id, command: 'abort', success: true })
        break
      }

      case 'get_prompt_snapshot': {
        const messageTimestamp = cmd.messageTimestamp as number
        const entries = sessionManager?.getEntries() ?? []
        const snapshots = entries
          .filter((e) => {
            if (e.type !== 'custom') return false
            const custom = e as { customType: string; data?: unknown }
            if (custom.customType !== 'prompt_snapshot') return false
            const data = custom.data as { timestamp?: number } | undefined
            if (!data || typeof data.timestamp !== 'number') return false
            return data.timestamp > lastClearedTimestamp
          })
          .map((e) => (e as { data: unknown }).data as Record<string, unknown>)
          .sort((a, b) => (b.timestamp as number) - (a.timestamp as number))
        const match = snapshots.find(
          (s) => Math.abs((s.timestamp as number) - messageTimestamp) < 60000
        )
        send({
          channel: 'response', id: cmd.id, command: 'get_prompt_snapshot', success: true,
          data: match ?? null,
        })
        break
      }

      case 'clear_snapshots': {
        const count = activeSnapshotCount
        lastClearedTimestamp = Date.now()
        activeSnapshotCount = 0
        send({
          channel: 'response', id: cmd.id, command: 'clear_snapshots', success: true,
          data: { deleted: count },
        })
        break
      }

      case 'set_capture_enabled': {
        captureEnabled = cmd.enabled === true
        send({
          channel: 'response', id: cmd.id, command: 'set_capture_enabled', success: true,
          data: { enabled: captureEnabled },
        })
        break
      }

      case 'get_capture_status': {
        send({
          channel: 'response', id: cmd.id, command: 'get_capture_status', success: true,
          data: { enabled: captureEnabled, snapshotCount: countActiveSnapshots() },
        })
        break
      }

      case 'get_state': {
        const currentModel = session.model
        send({
          channel: 'response',
          id: cmd.id,
          command: 'get_state',
          success: true,
          data: {
            sessionFile: session.sessionFile,
            sessionId: session.sessionId,
            sessionName: session.sessionName,
            isStreaming: session.isStreaming,
            isCompacting: session.isCompacting,
            thinkingLevel: session.thinkingLevel,
            messageCount: session.messages.length,
            model: currentModel
              ? (() => {
                  const registry = session.modelRegistry
                  const registryModels = registry?.getAll?.() || []
                  const availableModels = registry?.getAvailable?.() || []
                  const availableIds = new Set(availableModels.map((m: { provider: string; id: string }) => `${m.provider}/${m.id}`))
                  const registryModel = registryModels.find(
                    (m: { provider: string; id: string }) => m.provider === currentModel.provider && m.id === currentModel.id
                  )
                  return {
                    provider: currentModel.provider,
                    id: currentModel.id,
                    name: (currentModel.name && currentModel.name !== 'unknown')
                      ? currentModel.name
                      : (registryModel?.name || currentModel.id),
                    hasAuth: availableIds.has(`${currentModel.provider}/${currentModel.id}`),
                    reasoning: registryModel?.reasoning ?? null,
                    contextWindow: registryModel?.contextWindow ?? null,
                  }
                })()
              : null,
          },
        })
        break
      }

      case 'get_messages': {
        let messages = session.messages
        if (sessionManager) {
          try {
            // Always inject entry IDs from session entries into messages.
            // Pi SDK's session.messages (agent.state.messages) does not include
            // the entry ID — it's a property of the SessionEntry, not the message object.
            // We need piEntryId on each message for fork point matching in the GUI.
            const entries = sessionManager.getEntries()
            if (messages.length === 0) {
              // No messages in agent state — rebuild from entries (original behavior)
              const messageEntries = entries.filter((e) => e.type === 'message' && (e as Record<string, unknown>).message)
              messages = messageEntries.map((e) => {
                const entry = e as Record<string, unknown>
                const msg = { ...(entry.message as Record<string, unknown>) }
                if (!msg.id && typeof entry.id === 'string') {
                  msg.id = entry.id
                }
                return msg
              }) as unknown as AgentSession['messages']
            } else {
              // Messages exist — inject entry IDs by matching entries in order.
              // session.messages comes from buildSessionContext() which may include
              // synthetic messages (compaction summary, branch summary) that don't
              // have corresponding message entries. We only inject IDs for entries
              // with type 'message', advancing through them sequentially.
              const messageEntries = entries.filter((e) => e.type === 'message' && (e as Record<string, unknown>).message)
              const injected = messages.map((msg) => {
                const msgRecord = msg as Record<string, unknown>
                if (msgRecord.id) return msg // Already has an ID
                // Find the next message entry with matching role
                for (let i = 0; i < messageEntries.length; i++) {
                  const entry = messageEntries[i] as Record<string, unknown>
                  const entryMsg = entry.message as Record<string, unknown> | undefined
                  if (entryMsg && entryMsg.role === msgRecord.role && typeof entry.id === 'string') {
                    // Remove matched entry to handle sequential matching
                    messageEntries.splice(i, 1)
                    return { ...msgRecord, id: entry.id }
                  }
                }
                return msg
              })
              messages = injected as unknown as AgentSession['messages']
            }
          } catch {
            // getEntries or injection failed — fall through to session.messages as-is
          }
        }
        send({
          channel: 'response',
          id: cmd.id,
          command: 'get_messages',
          success: true,
          data: { messages },
        })
        break
      }

      case 'get_fork_messages': {
        const messages = session.getUserMessagesForForking()
        send({
          channel: 'response',
          id: cmd.id,
          command: 'get_fork_messages',
          success: true,
          data: { messages },
        })
        break
      }

      case 'set_session_name': {
        session.setSessionName(cmd.name as string)
        send({ channel: 'response', id: cmd.id, command: 'set_session_name', success: true })
        break
      }

      case 'new_session': {
        const result = await runtime.newSession({
          parentSession: cmd.parentSession as string | undefined,
        })
        if (!result.cancelled) {
          session = runtime.session
          await bindSession()
        }
        send({ channel: 'response', id: cmd.id, command: 'new_session', success: true, data: result })
        break
      }

      case 'switch_session': {
        const result = await runtime.switchSession(cmd.sessionPath as string)
        if (!result.cancelled) {
          session = runtime.session
          await bindSession()
        }
        send({ channel: 'response', id: cmd.id, command: 'switch_session', success: true, data: result })
        break
      }

      case 'fork': {
        const result = await runtime.fork(cmd.entryId as string)
        if (!result.cancelled) {
          session = runtime.session
          await bindSession()
        }
        send({ channel: 'response', id: cmd.id, command: 'fork', success: true, data: { text: result.selectedText ?? '', cancelled: result.cancelled } })
        break
      }

      case 'compact': {
        const result = await session.compact(cmd.customInstructions as string | undefined)
        send({ channel: 'response', id: cmd.id, command: 'compact', success: true, data: result })
        break
      }

      case 'get_available_models': {
        const registry = session.modelRegistry
        const allModels = registry.getAll()
        const availableModels = registry.getAvailable()
        const availableIds = new Set(availableModels.map(m => `${m.provider}/${m.id}`))
        const models = allModels.map(m => ({
          provider: m.provider,
          id: m.id,
          name: m.name,
          hasAuth: availableIds.has(`${m.provider}/${m.id}`),
          reasoning: m.reasoning,
          contextWindow: m.contextWindow,
        }))
        send({ channel: 'response', id: cmd.id, command: 'get_available_models', success: true, data: { models } })
        break
      }

      case 'set_model': {
        const sessionRegistry = session.modelRegistry
        const servicesRegistry = runtime!.services.modelRegistry
        const modelId = cmd.model as string
        const provider = cmd.provider as string | undefined
        let targetModel: typeof session.model | undefined
        // Try session registry first
        if (provider) {
          targetModel = sessionRegistry.find(provider, modelId)
        }
        if (!targetModel) {
          const allModels = sessionRegistry.getAll()
          targetModel = allModels.find(m => m.provider === provider && m.id === modelId)
            ?? allModels.find(m => m.id === modelId)
            ?? allModels.find(m => m.name === modelId)
        }
        // If still not found and registries differ, try services registry
        if (!targetModel && sessionRegistry !== servicesRegistry) {
          if (provider) {
            targetModel = servicesRegistry.find(provider, modelId)
          }
          if (!targetModel) {
            const allModels = servicesRegistry.getAll()
            targetModel = allModels.find(m => m.provider === provider && m.id === modelId)
              ?? allModels.find(m => m.id === modelId)
              ?? allModels.find(m => m.name === modelId)
          }
        }
        if (!targetModel) {
          send({ channel: 'response', id: cmd.id, command: 'set_model', success: false, error: `Model not found: ${provider ? provider + '/' : ''}${modelId}. The custom provider may not be registered in this worker — try restarting the session.` })
          break
        }
        // Check auth before calling setModel to give a clear error
        if (!sessionRegistry.hasConfiguredAuth(targetModel) && (sessionRegistry === servicesRegistry || !servicesRegistry.hasConfiguredAuth(targetModel))) {
          send({ channel: 'response', id: cmd.id, command: 'set_model', success: false, error: `No API key configured for ${provider}/${modelId}` })
          break
        }
        try {
          await session.setModel(targetModel)
        } catch (setErr: unknown) {
          const msg = setErr instanceof Error ? setErr.message : String(setErr)
          send({ channel: 'response', id: cmd.id, command: 'set_model', success: false, error: `setModel failed: ${msg}` })
          break
        }
        const newModel = session.model
        send({
          channel: 'response',
          id: cmd.id,
          command: 'set_model',
          success: true,
          data: newModel ? { provider: newModel.provider, id: newModel.id, name: newModel.name } : null,
        })
        break
      }

      case 'cycle_model': {
        const direction = (cmd.direction as 'forward' | 'backward' | undefined) ?? 'forward'
        const result = await session.cycleModel(direction)
        const newModel = session.model
        send({
          channel: 'response',
          id: cmd.id,
          command: 'cycle_model',
          success: true,
          data: {
            model: newModel ? { provider: newModel.provider, id: newModel.id, name: newModel.name } : null,
            thinkingLevel: session.thinkingLevel,
            isScoped: result?.isScoped ?? false,
          },
        })
        break
      }

      case 'set_thinking_level': {
        session.setThinkingLevel(cmd.level as string)
        send({ channel: 'response', id: cmd.id, command: 'set_thinking_level', success: true, data: { thinkingLevel: session.thinkingLevel } })
        break
      }

      case 'cycle_thinking_level': {
        const newLevel = session.cycleThinkingLevel()
        send({ channel: 'response', id: cmd.id, command: 'cycle_thinking_level', success: true, data: { thinkingLevel: newLevel } })
        break
      }

      case 'get_provider_auth_status': {
        const registry = runtime!.services.modelRegistry
        const allModels = registry.getAll()
        const providers = new Map<string, { configured: boolean; source?: string }>()
        for (const model of allModels) {
          if (!providers.has(model.provider)) {
            const status = registry.getProviderAuthStatus(model.provider)
            providers.set(model.provider, { configured: status.configured, source: status.source })
          }
        }
        const result: Record<string, { configured: boolean; source?: string }> = {}
        for (const [provider, status] of providers) {
          result[provider] = status
        }
        send({ channel: 'response', id: cmd.id, command: 'get_provider_auth_status', success: true, data: result })
        break
      }

      case 'set_api_key': {
        const authStorage = runtime!.services.authStorage
        authStorage.set(cmd.provider as string, { type: 'api_key', key: cmd.apiKey as string })
        runtime!.services.modelRegistry.refresh()
        send({ channel: 'response', id: cmd.id, command: 'set_api_key', success: true })
        break
      }

      case 'remove_auth': {
        const authStorage = runtime!.services.authStorage
        authStorage.remove(cmd.provider as string)
        runtime!.services.modelRegistry.refresh()
        send({ channel: 'response', id: cmd.id, command: 'remove_auth', success: true })
        break
      }

      case 'register_custom_provider': {
        const config = cmd.config as { name?: string; baseUrl: string; apiKey?: string; models?: Array<{ id: string; name: string; reasoning: boolean; input: string[]; cost: { input: number; output: number; cacheRead: number; cacheWrite: number }; contextWindow: number; maxTokens: number }> }
        session.modelRegistry.registerProvider(cmd.provider as string, config)
        if (config.apiKey) {
          runtime!.services.authStorage.set(cmd.provider as string, { type: 'api_key', key: config.apiKey })
        }
        send({ channel: 'response', id: cmd.id, command: 'register_custom_provider', success: true })
        break
      }

      case 'unregister_custom_provider': {
        session.modelRegistry.unregisterProvider(cmd.provider as string)
        runtime!.services.authStorage.remove(cmd.provider as string)
        runtime!.services.modelRegistry.refresh()
        send({ channel: 'response', id: cmd.id, command: 'unregister_custom_provider', success: true })
        break
      }

      case 'send_extension_ui_response': {
        send({ channel: 'response', id: cmd.id, command: 'send_extension_ui_response', success: true })
        break
      }

      case 'flush_session': {
        // Force-write the session file to disk and mark flushed.
        // This mirrors what createBranchedSession does when it has assistant messages:
        //   this._rewriteFile(); this.flushed = true;
        // Without this, newSession() never writes the file (flushed=false),
        // so the sidebar can't see the new session until the first assistant response.
        if (sessionManager) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(sessionManager as any)._rewriteFile()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(sessionManager as any).flushed = true
        }
        send({ channel: 'response', id: cmd.id, command: 'flush_session', success: true })
        break
      }

      case 'reload_skills': {
        await runtime!.services.resourceLoader.reload()
        send({ channel: 'response', id: cmd.id, command: 'reload_skills', success: true })
        break
      }

      case 'get_skills': {
        const services = runtime!.services
        const { skills, diagnostics } = services.resourceLoader.getSkills()
        const data = skills.map(s => ({
          name: s.name,
          description: s.description,
          filePath: s.filePath,
          baseDir: s.baseDir,
          source: s.sourceInfo?.source ?? 'local',
          scope: s.sourceInfo?.scope ?? 'temporary',
          origin: s.sourceInfo?.origin ?? 'top-level',
          disableModelInvocation: s.disableModelInvocation,
        }))
        const diags = diagnostics.map(d => ({
          type: d.type,
          message: d.message,
          path: d.path,
          collision: d.collision ? {
            resourceType: d.collision.resourceType,
            name: d.collision.name,
            winnerPath: d.collision.winnerPath,
            loserPath: d.collision.loserPath,
          } : undefined,
        }))
        send({
          channel: 'response', id: cmd.id, command: 'get_skills', success: true,
          data: { skills: data, diagnostics: diags },
        })
        break
      }

      case 'read_skill': {
        const filePath = cmd.filePath as string
        const { skills } = runtime!.services.resourceLoader.getSkills()
        const skill = skills.find(s => s.filePath === filePath)
        if (!skill) {
          send({ channel: 'response', id: cmd.id, command: 'read_skill', success: false, error: 'Skill not found' })
          break
        }
        try {
          const content = fsSync.readFileSync(skill.filePath, 'utf-8')
          const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
          send({
            channel: 'response', id: cmd.id, command: 'read_skill', success: true,
            data: {
              name: skill.name,
              description: skill.description,
              filePath: skill.filePath,
              baseDir: skill.baseDir,
              source: skill.sourceInfo?.source ?? 'local',
              scope: skill.sourceInfo?.scope ?? 'temporary',
              origin: skill.sourceInfo?.origin ?? 'top-level',
              disableModelInvocation: skill.disableModelInvocation,
              content: body,
            },
          })
        } catch (err: unknown) {
          send({
            channel: 'response', id: cmd.id, command: 'read_skill', success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        break
      }

      default:
        send({ channel: 'response', id: cmd.id, command: cmd.type, success: false, error: `Unknown command: ${cmd.type}` })
    }
  } catch (err: unknown) {
    send({
      channel: 'response',
      id: cmd.id,
      command: cmd.type,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

process.parentPort.on('message', (event: Electron.ParentPortMessageEvent) => {
  const msg = event.data as WorkerCommand | { type: 'init'; data: WorkerInit }
  if (msg.type === 'init') {
    init((msg as { data: WorkerInit }).data).catch((err: Error) => {
      console.error('[PiWorker] Init failed:', err.message)
      console.error('[PiWorker] Stack:', err.stack)
      send({ channel: 'error', error: `Init failed: ${err.message}` })
    })
    return
  }

  if (msg.type === 'subagent:result') {
    const pending = pendingSubagentRequests.get(msg.toolCallId as string)
    if (pending) {
      pendingSubagentRequests.delete(msg.toolCallId as string)
      if (msg.error) {
        pending.reject(new Error(msg.error as string))
      } else {
        pending.resolve(msg.result)
      }
    }
    return
  }

  handleCommand(msg as WorkerCommand).catch((err: Error) => {
    send({ channel: 'error', error: err.message })
  })
})

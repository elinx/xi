import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import { resolve, relative, join } from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'

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

function createSearchSessionsTool(cwd: string) {
  const schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string' as const, description: 'Search query — matches against session names and message content' },
      limit: { type: 'number' as const, description: 'Max results to return (default 10)', default: 10 },
    },
    required: ['query'],
  }
  return {
    name: 'searchSessions',
    label: 'searchSessions',
    description:
      'Search sessions in the current project by name or content. ' +
      'Returns matching session names, file paths, and relevant message excerpts. ' +
      'Use this to find information from past conversations across sessions.',
    parameters: schema,
    execute: async (_toolCallId: string, params: { query: string; limit?: number }, _signal: AbortSignal | undefined) => {
      const limit = params.limit ?? 10
      const query = params.query.toLowerCase()
      const sessionsDir = join(cwd, '.xi', 'sessions')
      if (!fsSync.existsSync(sessionsDir)) {
        return { content: [{ type: 'text' as const, text: 'No sessions directory found.' }] }
      }
      let files: string[]
      try {
        files = fsSync.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')).map(f => join(sessionsDir, f))
      } catch {
        return { content: [{ type: 'text' as const, text: 'Could not read sessions directory.' }] }
      }
      const results: Array<{ name: string; path: string; matches: string[] }> = []
      for (const filePath of files) {
        if (results.length >= limit) break
        try {
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
                if (msgContent.toLowerCase().includes(query)) {
                  const excerpt = msgContent.length > 200 ? msgContent.substring(0, 200) + '...' : msgContent
                  matches.push(excerpt)
                  if (matches.length >= 3) break
                }
              }
            } catch { continue }
          }
          if (matches.length > 0 || sessionName.toLowerCase().includes(query)) {
            results.push({
              name: sessionName || filePath.split('/').pop() || filePath,
              path: filePath,
              matches,
            })
          }
        } catch { continue }
      }
      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No sessions found matching "${params.query}".` }] }
      }
      const output = results.map(r => {
        const header = `## ${r.name}\nPath: ${r.path}`
        const body = r.matches.length > 0 ? r.matches.map((m, i) => `  ${i + 1}. "${m}"`).join('\n') : '  (name match only)'
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

function send(msg: Record<string, unknown>): void {
  process.parentPort?.postMessage(msg)
}

function forwardEvent(event: AgentSessionEvent): void {
  send({ channel: 'event', data: event })
}

async function bindSession(): Promise<void> {
  unsubscribe?.()
  if (!session) return

  await session.bindExtensions({})

  unsubscribe = session.subscribe((event) => {
    forwardEvent(event)

    if (event.type === 'agent_end') {
      send({ channel: 'agent_end' })
    }
  })
}

async function init(data: WorkerInit): Promise<void> {
  pi = await import('@earendil-works/pi-coding-agent')
  const agentDir = pi.getAgentDir()

  const createRuntime: pi.CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager: sm, sessionStartEvent }) => {
    sessionManager = sm
    const services = await pi!.createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        systemPromptOverride: (base: string) => base.replace(/\bpi\b/g, 'xi').replace(/\bPi\b/g, 'Xi'),
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
        activeToolNames: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
        customTools: [guardedWriteTool, guardedEditTool, createSearchSessionsTool(cwd)],
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
        if (messages.length === 0 && sessionManager) {
          try {
            const entries = sessionManager.getEntries()
            const messageEntries = entries.filter((e) => e.type === 'message' && (e as Record<string, unknown>).message)
            messages = messageEntries.map((e) => {
              const entry = e as Record<string, unknown>
              const msg = { ...(entry.message as Record<string, unknown>) }
              if (!msg.id && typeof entry.id === 'string') {
                msg.id = entry.id
              }
              return msg
            }) as unknown as AgentSession['messages']
          } catch {
            // getEntries failed — return empty messages
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
        const registry = session.modelRegistry
        const modelId = cmd.model as string
        const provider = cmd.provider as string | undefined
        let targetModel: typeof session.model | undefined
        if (provider) {
          targetModel = registry.find(provider, modelId)
        } else {
          const allModels = registry.getAll()
          targetModel = allModels.find(m => m.id === modelId) ?? allModels.find(m => m.name === modelId)
        }
        if (!targetModel) {
          send({ channel: 'response', id: cmd.id, command: 'set_model', success: false, error: `Model not found: ${provider ? provider + '/' : ''}${modelId}` })
          break
        }
        await session.setModel(targetModel)
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
        runtime!.services.modelRegistry.registerProvider(cmd.provider as string, config)
        if (config.apiKey) {
          runtime!.services.authStorage.set(cmd.provider as string, { type: 'api_key', key: config.apiKey })
        }
        send({ channel: 'response', id: cmd.id, command: 'register_custom_provider', success: true })
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

  handleCommand(msg as WorkerCommand).catch((err: Error) => {
    send({ channel: 'error', error: err.message })
  })
})

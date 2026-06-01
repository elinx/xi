import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from '@earendil-works/pi-coding-agent'

process.on('uncaughtException', (err: Error) => {
  process.parentPort?.postMessage({ channel: 'error', error: `Uncaught: ${err.message}` })
})

process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  process.parentPort?.postMessage({ channel: 'error', error: `Unhandled rejection: ${msg}` })
})

interface WorkerInit {
  cwd: string
  sessionPath?: string
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
    const services = await pi!.createAgentSessionServices({ cwd, agentDir })
    return {
      ...(await pi!.createAgentSessionFromServices({
        services,
        sessionManager: sm,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    }
  }

  let sm: pi.SessionManager
  if (data.sessionPath) {
    sm = pi.SessionManager.open(data.sessionPath)
  } else {
    sm = pi.SessionManager.continueRecent(data.cwd)
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
              ? { provider: currentModel.provider, id: currentModel.id, name: currentModel.name }
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

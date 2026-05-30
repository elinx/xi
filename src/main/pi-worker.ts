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

      case 'send_extension_ui_response': {
        send({ channel: 'response', id: cmd.id, command: 'send_extension_ui_response', success: true })
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

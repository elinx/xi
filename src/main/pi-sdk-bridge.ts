import { utilityProcess } from 'electron'
import workerPath from './pi-worker?modulePath'
import { resolve, join } from 'path'
import { existsSync, mkdirSync, copyFileSync, lstatSync } from 'fs'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'

const MIGRATABLE_CONFIG_FILES = ['auth.json', 'models.json', 'settings.json']

function migrateProjectConfig(projectDir: string, globalAgentDir: string): void {
  const localDir = join(projectDir, '.xi')
  if (!existsSync(localDir)) return
  for (const file of MIGRATABLE_CONFIG_FILES) {
    const source = join(localDir, file)
    const target = join(globalAgentDir, file)
    if (existsSync(source) && !lstatSync(source).isSymbolicLink() && !existsSync(target)) {
      try {
        copyFileSync(source, target)
        console.log(`[PiSDKBridge] Migrated ${file} from project to global config`)
      } catch {}
    }
  }
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const COMMAND_TIMEOUT_MS = 60_000

interface UtilityChild {
  on(event: 'message', listener: (msg: Record<string, unknown>) => void): UtilityChild
  on(event: 'exit', listener: (code: number | null) => void): UtilityChild
  postMessage(message: unknown): void
  kill(): void
  pid: number | undefined
}

export class PiSDKBridge extends EventEmitter {
  private sessionId: string
  private child: UtilityChild | null = null
  private pendingCommands = new Map<string, PendingCommand>()
  private _isConnected = false
  private _sessionFilePath: string | null = null

  constructor(sessionId: string) {
    super()
    this.sessionId = sessionId
  }

  get isConnected(): boolean {
    return this._isConnected && this.child !== null
  }

  get sessionFilePath(): string | null {
    return this._sessionFilePath
  }

  get id(): string {
    return this.sessionId
  }

  async start(cwd: string, sessionPath?: string): Promise<void> {
    if (this._isConnected) {
      return
    }

    if (this.child) {
      if (this._isConnected) return
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for existing process to connect'))
        }, 30_000)
        this.once('connected', () => { clearTimeout(timeout); resolve() })
        this.once('error', (err: Error) => { clearTimeout(timeout); reject(err) })
      })
      return
    }

    const resolvedCwd = resolve(cwd)
    const globalAgentDir = join(
      process.env.HOME ?? process.env.USERPROFILE ?? '~',
      '.xi'
    )
    if (!existsSync(globalAgentDir)) {
      mkdirSync(globalAgentDir, { recursive: true })
    }
    process.env.PI_CODING_AGENT_DIR = globalAgentDir

    const sessionDir = join(resolvedCwd, '.xi', 'sessions')
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true })
    }
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir

    migrateProjectConfig(resolvedCwd, globalAgentDir)

    const child = utilityProcess.fork(workerPath, [], {
      serviceName: `pi-sdk-${this.sessionId}`,
      stdio: 'pipe',
      env: { ...process.env },
    }) as unknown as UtilityChild

    this.child = child

    child.on('message', (msg: Record<string, unknown>) => {
      this.handleChildMessage(msg)
    })

    child.on('exit', (code: number | null) => {
      console.error('[PiSDKBridge] Process exited with code:', code)
      this._isConnected = false
      this.child = null
      this.rejectAllPending(`Process exited with code ${code}`)
      this.emit('disconnected')
    })

    child.postMessage({ type: 'init', data: { cwd, sessionPath, sessionDir } })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Pi SDK process did not respond within 30s'))
      }, 30_000)

      const onConnected = (): void => {
        clearTimeout(timeout)
        resolve()
      }

      const onError = (err: Error): void => {
        clearTimeout(timeout)
        reject(err)
      }

      this.once('connected', onConnected)
      this.once('error', onError)
    })
  }

  sendCommand(command: Record<string, unknown>): void {
    if (!this.child) {
      this.emit('error', new Error('Process not running'))
      return
    }
    this.child.postMessage(command)
  }

  async sendRpcCommand(command: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Error('Process not running'))
        return
      }

      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id)
        reject(new Error(`SDK command timed out: ${command.type}`))
      }, COMMAND_TIMEOUT_MS)

      this.pendingCommands.set(id, { resolve, reject, timer })
      this.child.postMessage({ ...command, id })
    })
  }

  sendExtensionUIResponse(response: Record<string, unknown>): void {
    this.sendCommand(response)
  }

  async stop(): Promise<void> {
    if (!this.child) return

    this.rejectAllPending('Process stopping')

    this.child.kill()
    this.child = null
    this._isConnected = false
  }

  private handleChildMessage(msg: Record<string, unknown>): void {
    const channel = msg.channel as string

    switch (channel) {
      case 'connected': {
        this._isConnected = true
        const data = msg.data as Record<string, unknown> | undefined
        if (data?.sessionFile && typeof data.sessionFile === 'string') {
          this._sessionFilePath = data.sessionFile
        }
        this.emit('connected', { ...(typeof data === 'object' && data !== null ? data : {}), sessionId: this.sessionId })
        break
      }

      case 'event': {
        const eventData = (typeof msg.data === 'object' && msg.data !== null) ? msg.data as Record<string, unknown> : {}
        this.emit('event', { ...eventData, sessionId: this.sessionId })
        break
      }

      case 'response': {
        const id = msg.id as string | undefined
        if (id) {
          const pending = this.pendingCommands.get(id)
          if (pending) {
            clearTimeout(pending.timer)
            this.pendingCommands.delete(id)
            if (msg.success) {
              pending.resolve(msg.data)
            } else {
              pending.reject(new Error(typeof msg.error === 'string' ? msg.error : 'SDK command failed'))
            }
          }
        }
        this.emit('response', { ...msg, sessionId: this.sessionId })
        break
      }

      case 'error': {
        this.emit('error', new Error(typeof msg.error === 'string' ? msg.error : 'Unknown worker error'))
        break
      }

      case 'agent_end': {
        break
      }

      default:
        this.emit('event', { ...msg, sessionId: this.sessionId })
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pendingCommands.clear()
  }
}

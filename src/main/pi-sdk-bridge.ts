import { Worker } from 'node:worker_threads'
import workerPath from './pi-worker?modulePath'
import { resolve, join } from 'path'
import { existsSync, mkdirSync, symlinkSync, lstatSync } from 'fs'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'

const LINKED_FILES = ['auth.json', 'models.json', 'settings.json']
const LINKED_DIRS = ['tools', 'prompts', 'themes', 'extensions']

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const COMMAND_TIMEOUT_MS = 60_000

export class PiSDKBridge extends EventEmitter {
  private worker: Worker | null = null
  private pendingCommands = new Map<string, PendingCommand>()
  private _isConnected = false
  private _sessionFilePath: string | null = null

  get isConnected(): boolean {
    return this._isConnected && this.worker !== null
  }

  get sessionFilePath(): string | null {
    return this._sessionFilePath
  }

  async start(cwd: string, sessionPath?: string): Promise<void> {
    if (this._isConnected) {
      return
    }

    if (this.worker) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for existing Worker to connect'))
        }, 30_000)
        this.once('connected', () => { clearTimeout(timeout); resolve() })
        this.once('error', (err: Error) => { clearTimeout(timeout); reject(err) })
      })
      return
    }

    const resolvedCwd = resolve(cwd)
    const localAgentDir = join(resolvedCwd, '.xi')
    if (!existsSync(localAgentDir)) {
      mkdirSync(localAgentDir, { recursive: true })
    }
    process.env.PI_CODING_AGENT_DIR = localAgentDir
    this.linkGlobalAgentConfig(localAgentDir)

    this.worker = new Worker(workerPath, {
      workerData: { cwd, sessionPath },
    })

    this.worker.on('message', (msg: Record<string, unknown>) => {
      this.handleWorkerMessage(msg)
    })

    this.worker.on('error', (err: Error) => {
      console.error('[PiSDKBridge] Worker error:', err.message)
      this.emit('error', err)
    })

    this.worker.on('exit', (code: number) => {
      console.error('[PiSDKBridge] Worker exited with code:', code)
      this._isConnected = false
      this.rejectAllPending(`Worker exited with code ${code}`)
      this.emit('disconnected')
    })

    this.worker.postMessage({ type: 'init', data: { cwd, sessionPath } })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Pi SDK Worker did not respond within 30s'))
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
    if (!this.worker) {
      this.emit('error', new Error('Worker not running'))
      return
    }
    this.worker.postMessage(command)
  }

  async sendRpcCommand(command: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not running'))
        return
      }

      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id)
        reject(new Error(`SDK command timed out: ${command.type}`))
      }, COMMAND_TIMEOUT_MS)

      this.pendingCommands.set(id, { resolve, reject, timer })
      this.worker.postMessage({ ...command, id })
    })
  }

  sendExtensionUIResponse(response: Record<string, unknown>): void {
    this.sendCommand(response)
  }

  async stop(): Promise<void> {
    if (!this.worker) return

    this.rejectAllPending('Worker stopping')

    await this.worker.terminate()
    this.worker = null
    this._isConnected = false
  }

  private linkGlobalAgentConfig(localAgentDir: string): void {
    const globalAgentDir = join(
      process.env.HOME ?? process.env.USERPROFILE ?? '~',
      '.pi',
      'agent'
    )

    for (const file of LINKED_FILES) {
      const source = join(globalAgentDir, file)
      const target = join(localAgentDir, file)
      if (existsSync(source) && !existsSync(target)) {
        try { symlinkSync(source, target) } catch {}
      }
    }

    for (const dir of LINKED_DIRS) {
      const source = join(globalAgentDir, dir)
      const target = join(localAgentDir, dir)
      if (existsSync(source) && !lstatSync(source).isSymbolicLink() && !existsSync(target)) {
        try { symlinkSync(source, target) } catch {}
      }
    }
  }

  private handleWorkerMessage(msg: Record<string, unknown>): void {
    const channel = msg.channel as string

    switch (channel) {
      case 'connected': {
        this._isConnected = true
        const data = msg.data as Record<string, unknown> | undefined
        if (data?.sessionFile && typeof data.sessionFile === 'string') {
          this._sessionFilePath = data.sessionFile
        }
        this.emit('connected')
        break
      }

      case 'event': {
        this.emit('event', msg.data)
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
        this.emit('response', msg)
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
        this.emit('event', msg)
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pendingCommands.clear()
  }
}

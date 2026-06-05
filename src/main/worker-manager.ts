import { EventEmitter } from 'events'
import { basename } from 'path'
import { PiSDKBridge } from './pi-sdk-bridge'

export interface WorkerState {
  sessionPath: string
  sessionId: string
  bridge: PiSDKBridge
  role: 'primary' | 'secondary'
  status: 'starting' | 'connected' | 'error' | 'stopping'
  lastActivityAt: number
  isStreaming: boolean
}

export class WorkerManager extends EventEmitter {
  private primary: WorkerState | null = null
  private secondaries = new Map<string, WorkerState>()
  private maxSecondaries = 4
  private _idleTimeoutMs = 10 * 60 * 1000
  get idleTimeoutMs(): number { return this._idleTimeoutMs }

  async initPrimary(cwd: string, sessionPath?: string): Promise<void> {
    if (this.primary) {
      throw new Error('Primary worker already exists')
    }

    const sessionId = 'primary'
    const bridge = new PiSDKBridge(sessionId)
    const state: WorkerState = {
      sessionPath: sessionPath ?? '',
      sessionId,
      bridge,
      role: 'primary',
      status: 'starting',
      lastActivityAt: Date.now(),
      isStreaming: false,
    }

    this.setupBridgeEvents(state)

    try {
      await bridge.start(cwd, sessionPath)
      state.status = 'connected'
      this.emit('worker:status', { sessionId, role: 'primary', status: 'connected' })
    } catch (err) {
      state.status = 'error'
      this.emit('worker:status', { sessionId, role: 'primary', status: 'error' })
      throw err
    }

    this.primary = state
  }

  getPrimary(): WorkerState | null {
    return this.primary
  }

  async getOrCreateSecondary(sessionPath: string, cwd: string): Promise<WorkerState> {
    const existing = this.secondaries.get(sessionPath)
    if (existing) {
      existing.lastActivityAt = Date.now()
      return existing
    }

    if (this.secondaries.size >= this.maxSecondaries) {
      await this.evictLRU()
    }

    const sessionId = deriveSessionId(sessionPath)
    const bridge = new PiSDKBridge(sessionId)
    const state: WorkerState = {
      sessionPath,
      sessionId,
      bridge,
      role: 'secondary',
      status: 'starting',
      lastActivityAt: Date.now(),
      isStreaming: false,
    }

    this.setupBridgeEvents(state)
    this.secondaries.set(sessionPath, state)
    this.emit('worker:status', { sessionId, role: 'secondary', status: 'starting', sessionPath })

    try {
      await bridge.start(cwd, sessionPath)
      state.status = 'connected'
      this.emit('worker:status', { sessionId, role: 'secondary', status: 'connected', sessionPath })
    } catch (err) {
      state.status = 'error'
      this.emit('worker:status', { sessionId, role: 'secondary', status: 'error', sessionPath })
      throw err
    }

    return state
  }

  get(sessionPath: string): WorkerState | undefined {
    if (this.primary && this.primary.sessionPath === sessionPath) {
      return this.primary
    }
    return this.secondaries.get(sessionPath)
  }

  async disposeSecondary(sessionPath: string): Promise<void> {
    const state = this.secondaries.get(sessionPath)
    if (!state) return

    state.status = 'stopping'
    this.emit('worker:status', { sessionId: state.sessionId, role: 'secondary', status: 'stopping', sessionPath })

    try {
      await state.bridge.stop()
    } catch {}

    this.secondaries.delete(sessionPath)
  }

  async disposeAllSecondaries(): Promise<void> {
    const paths = [...this.secondaries.keys()]
    await Promise.all(paths.map((p) => this.disposeSecondary(p)))
  }

  async disposeAll(): Promise<void> {
    await this.disposeAllSecondaries()

    if (this.primary) {
      this.primary.status = 'stopping'
      this.emit('worker:status', { sessionId: this.primary.sessionId, role: 'primary', status: 'stopping' })

      try {
        await this.primary.bridge.stop()
      } catch {}

      this.primary = null
    }
  }

  getAllWorkers(): WorkerState[] {
    const workers: WorkerState[] = []
    if (this.primary) workers.push(this.primary)
    for (const state of this.secondaries.values()) {
      workers.push(state)
    }
    return workers
  }

  get workerCount(): number {
    return (this.primary ? 1 : 0) + this.secondaries.size
  }

  private setupBridgeEvents(state: WorkerState): void {
    const { bridge, sessionId } = state

    bridge.on('event', (data: unknown) => {
      state.lastActivityAt = Date.now()
      this.emit('event', data)
    })

    bridge.on('response', (data: unknown) => {
      state.lastActivityAt = Date.now()
      this.emit('response', data)
    })

    bridge.on('connected', (data: unknown) => {
      state.status = 'connected'
      state.lastActivityAt = Date.now()
      this.emit('connected', data)
      this.emit('worker:status', { sessionId, role: state.role, status: 'connected', sessionPath: state.sessionPath })
    })

    bridge.on('disconnected', () => {
      state.status = 'error'
      this.emit('disconnected')
      this.emit('worker:status', { sessionId, role: state.role, status: 'error', sessionPath: state.sessionPath })
    })

    bridge.on('error', (err: Error) => {
      this.emit('error', err)
    })
  }

  private async evictLRU(): Promise<void> {
    let oldest: WorkerState | null = null
    for (const state of this.secondaries.values()) {
      if (state.isStreaming) continue
      if (!oldest || state.lastActivityAt < oldest.lastActivityAt) {
        oldest = state
      }
    }

    if (oldest) {
      await this.disposeSecondary(oldest.sessionPath)
    }
  }
}

function deriveSessionId(sessionPath: string): string {
  // Use basename without extension as a readable session ID
  const base = basename(sessionPath)
  const name = base.replace(/\.(jsonl|json)$/, '')
  // Prefix with a short hash to ensure uniqueness
  const hash = simpleHash(sessionPath)
  return `${name}-${hash}`
}

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

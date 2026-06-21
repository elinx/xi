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
  private _maxSecondaries = 8
  get maxSecondaries(): number { return this._maxSecondaries }
  setMaxSecondaries(n: number): void { this._maxSecondaries = Math.max(1, n) }
  private _idleTimeoutMs = 5 * 60 * 1000
  get idleTimeoutMs(): number { return this._idleTimeoutMs }
  setIdleTimeout(ms: number): void {
    this._idleTimeoutMs = Math.max(0, ms)
  }
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null

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
      this.emit('worker:status', { sessionId, role: 'primary', status: 'connected', sessionPath: state.sessionPath })
    } catch (err) {
      state.status = 'error'
      this.emit('worker:status', { sessionId, role: 'primary', status: 'error', sessionPath: state.sessionPath })
      throw err
    }

    this.primary = state
    this.startIdleChecker()
  }

  getPrimary(): WorkerState | null {
    return this.primary
  }

  startIdleChecker(): void {
    if (this.idleCheckInterval) return
    this.idleCheckInterval = setInterval(() => this.checkIdleTimeouts(), 60_000)
  }

  stopIdleChecker(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = null
    }
  }

  private checkIdleTimeouts(): void {
    const now = Date.now()
    for (const [path, state] of this.secondaries) {
      if (state.isStreaming) continue
      if (state.status !== 'connected') continue
      if (now - state.lastActivityAt > this._idleTimeoutMs) {
        this.disposeSecondary(path)
      }
    }
  }

  private async restartPrimary(state: WorkerState): Promise<void> {
    const cwd = process.cwd()
    const sessionPath = state.sessionPath || undefined

    // Small delay before restart
    await new Promise(resolve => setTimeout(resolve, 1000))

    try {
      await state.bridge.start(cwd, sessionPath)
      state.status = 'connected'
      state.lastActivityAt = Date.now()
      this.emit('worker:status', { sessionId: state.sessionId, role: 'primary', status: 'connected', sessionPath: state.sessionPath })
    } catch {
      state.status = 'error'
      this.emit('worker:status', { sessionId: state.sessionId, role: 'primary', status: 'error', sessionPath: state.sessionPath })
      // Retry after longer delay
      setTimeout(() => {
        this.restartPrimary(state).catch(() => {})
      }, 5000)
    }
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

    try {
      await state.bridge.stop()
    } catch {}

    this.secondaries.delete(sessionPath)
    this.emit('worker:status', { sessionId: state.sessionId, role: 'secondary', status: 'none', sessionPath })
  }

  async disposeAllSecondaries(): Promise<void> {
    const paths = [...this.secondaries.keys()]
    await Promise.all(paths.map((p) => this.disposeSecondary(p)))
  }

  async disposeAll(): Promise<void> {
    this.stopIdleChecker()
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
    const { bridge } = state

    bridge.on('event', (data: unknown) => {
      state.lastActivityAt = Date.now()
      this.emit('event', typeof data === 'object' && data !== null ? { ...(data as Record<string, unknown>), sessionPath: state.sessionPath } : data)
    })

    bridge.on('response', (data: unknown) => {
      state.lastActivityAt = Date.now()
      this.emit('response', typeof data === 'object' && data !== null ? { ...(data as Record<string, unknown>), sessionPath: state.sessionPath } : data)
    })

    bridge.on('connected', (data: unknown) => {
      state.status = 'connected'
      state.lastActivityAt = Date.now()
      const sessionFile = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).sessionFile as string | undefined : undefined
      if (sessionFile && !state.sessionPath) {
        state.sessionPath = sessionFile
      }
      this.emit('connected', { data, role: state.role, sessionPath: state.sessionPath })
      this.emit('worker:status', { sessionId: state.sessionId, role: state.role, status: 'connected', sessionPath: state.sessionPath })
    })

    bridge.on('disconnected', () => {
      if (state.status === 'stopping') return
      state.status = 'error'
      this.emit('disconnected', { role: state.role, sessionPath: state.sessionPath })
      this.emit('worker:status', { sessionId: state.sessionId, role: state.role, status: 'error', sessionPath: state.sessionPath })

      if (state.role === 'primary') {
        this.restartPrimary(state).catch((err) => {
          console.error('[WorkerManager] Primary restart failed:', err.message)
        })
      }
    })

    bridge.on('error', (err: Error) => {
      this.emit('error', err)
    })

    bridge.on('subagent:run', (data: unknown) => {
      this.emit('subagent:run', data)
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

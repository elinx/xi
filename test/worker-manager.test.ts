import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { WorkerManager } from '../src/main/worker-manager'
import type { WorkerState } from '../src/main/worker-manager'

class MockBridge extends EventEmitter {
  sessionId: string
  private _startFn: () => Promise<void>
  private _stopFn: () => Promise<void>

  constructor(
    sessionId: string,
    startFn?: () => Promise<void>,
    stopFn?: () => Promise<void>,
  ) {
    super()
    this.sessionId = sessionId
    this._startFn = startFn ?? (() => Promise.resolve())
    this._stopFn = stopFn ?? (() => Promise.resolve())
  }

  async start(_cwd: string, _sessionPath?: string): Promise<void> {
    return this._startFn()
  }

  async stop(): Promise<void> {
    return this._stopFn()
  }

  get isConnected(): boolean {
    return true
  }
}

let mockBridgeInstances: MockBridge[] = []
let nextStartFn: (() => Promise<void>) | undefined
let nextStopFn: (() => Promise<void>) | undefined

vi.mock('../src/main/pi-sdk-bridge', () => {
  return {
    PiSDKBridge: class extends EventEmitter {
      sessionId: string
      private _startFn: () => Promise<void>
      private _stopFn: () => Promise<void>

      constructor(sessionId: string) {
        super()
        this.sessionId = sessionId
        this._startFn = nextStartFn ?? (() => Promise.resolve())
        this._stopFn = nextStopFn ?? (() => Promise.resolve())
        mockBridgeInstances.push(this as unknown as MockBridge)
      }

      async start(_cwd: string, _sessionPath?: string): Promise<void> {
        return this._startFn()
      }

      async stop(): Promise<void> {
        return this._stopFn()
      }

      get isConnected(): boolean {
        return true
      }
    },
  }
})

function createManager(): WorkerManager {
  return new WorkerManager()
}

function lastBridge(): MockBridge {
  return mockBridgeInstances[mockBridgeInstances.length - 1]
}

function collectEvents(mgr: WorkerManager, event: string): unknown[] {
  const events: unknown[] = []
  mgr.on(event, (data: unknown) => events.push(data))
  return events
}

describe('WorkerManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockBridgeInstances = []
    nextStartFn = undefined
    nextStopFn = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initPrimary', () => {
    it('creates primary worker with sessionId="primary" and status="connected" on success', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')

      const primary = mgr.getPrimary()
      expect(primary).not.toBeNull()
      expect(primary!.sessionId).toBe('primary')
      expect(primary!.role).toBe('primary')
      expect(primary!.status).toBe('connected')
    })

    it('emits worker:status with {sessionId, role:"primary", status:"connected"}', async () => {
      const mgr = createManager()
      const statuses = collectEvents(mgr, 'worker:status')

      await mgr.initPrimary('/cwd')

      expect(statuses).toContainEqual({
        sessionId: 'primary',
        role: 'primary',
        status: 'connected',
      })
    })

    it('sets status="error" and emits on bridge.start() failure', async () => {
      nextStartFn = () => Promise.reject(new Error('start failed'))

      const mgr = createManager()
      const statuses = collectEvents(mgr, 'worker:status')

      await expect(mgr.initPrimary('/cwd')).rejects.toThrow('start failed')

      expect(mgr.getPrimary()).toBeNull()

      expect(statuses).toContainEqual({
        sessionId: 'primary',
        role: 'primary',
        status: 'error',
      })
    })

    it('throws if primary already exists', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')

      await expect(mgr.initPrimary('/cwd')).rejects.toThrow(
        'Primary worker already exists',
      )
    })

    it('starts idle checker', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')

      vi.advanceTimersByTime(120_000)
    })
  })

  describe('getOrCreateSecondary', () => {
    it('creates secondary with derived sessionId and status="connected" on success', async () => {
      const mgr = createManager()
      const state = await mgr.getOrCreateSecondary('/path/to/session.jsonl', '/cwd')

      expect(state.role).toBe('secondary')
      expect(state.status).toBe('connected')
      expect(state.sessionPath).toBe('/path/to/session.jsonl')
      expect(state.sessionId).toContain('session')
    })

    it('emits worker:status events (starting → connected)', async () => {
      const mgr = createManager()
      const statuses = collectEvents(mgr, 'worker:status')

      await mgr.getOrCreateSecondary('/path/to/feature.jsonl', '/cwd')

      expect(statuses).toContainEqual(
        expect.objectContaining({
          role: 'secondary',
          status: 'starting',
          sessionPath: '/path/to/feature.jsonl',
        }),
      )
      expect(statuses).toContainEqual(
        expect.objectContaining({
          role: 'secondary',
          status: 'connected',
          sessionPath: '/path/to/feature.jsonl',
        }),
      )
      const startIdx = statuses.findIndex(
        (e: any) => e.status === 'starting',
      )
      const connIdx = statuses.findIndex(
        (e: any) => e.status === 'connected',
      )
      expect(startIdx).toBeLessThan(connIdx)
    })

    it('returns existing secondary if one exists for that sessionPath (updates lastActivityAt)', async () => {
      const mgr = createManager()
      const first = await mgr.getOrCreateSecondary('/path/to/s.jsonl', '/cwd')
      const originalActivity = first.lastActivityAt

      vi.advanceTimersByTime(1000)

      const second = await mgr.getOrCreateSecondary('/path/to/s.jsonl', '/cwd')

      expect(second).toBe(first)
      expect(second.lastActivityAt).toBeGreaterThan(originalActivity)
    })

    it('evicts LRU secondary when maxSecondaries reached', async () => {
      const mgr = createManager()
      mgr.setMaxSecondaries(4)

      const paths = ['/a.jsonl', '/b.jsonl', '/c.jsonl', '/d.jsonl']
      for (const p of paths) {
        await mgr.getOrCreateSecondary(p, '/cwd')
      }
      expect(mgr.workerCount).toBe(4)

      const statuses = collectEvents(mgr, 'worker:status')
      await mgr.getOrCreateSecondary('/e.jsonl', '/cwd')

      expect(mgr.get('/a.jsonl')).toBeUndefined()
      expect(mgr.get('/e.jsonl')).toBeDefined()
      expect(statuses).toContainEqual(
        expect.objectContaining({
          sessionPath: '/a.jsonl',
          status: 'none',
        }),
      )
    })

    it('sets status="error" and throws on bridge.start() failure', async () => {
      nextStartFn = () => Promise.reject(new Error('secondary start failed'))

      const mgr = createManager()
      const statuses = collectEvents(mgr, 'worker:status')

      await expect(
        mgr.getOrCreateSecondary('/path/to/fail.jsonl', '/cwd'),
      ).rejects.toThrow('secondary start failed')

      const worker = mgr.get('/path/to/fail.jsonl')
      expect(worker).toBeDefined()
      expect(worker!.status).toBe('error')

      expect(statuses).toContainEqual(
        expect.objectContaining({
          role: 'secondary',
          status: 'error',
          sessionPath: '/path/to/fail.jsonl',
        }),
      )
    })
  })

  describe('disposeSecondary', () => {
    it('emits status="none" after disposal, calls bridge.stop(), removes from secondaries map', async () => {
      const mgr = createManager()
      await mgr.getOrCreateSecondary('/dispose-me.jsonl', '/cwd')

      const statuses = collectEvents(mgr, 'worker:status')
      await mgr.disposeSecondary('/dispose-me.jsonl')

      expect(mgr.get('/dispose-me.jsonl')).toBeUndefined()
      expect(statuses).toContainEqual(
        expect.objectContaining({
          sessionPath: '/dispose-me.jsonl',
          status: 'none',
        }),
      )
    })

    it('no-ops if sessionPath not found', async () => {
      const mgr = createManager()
      await mgr.disposeSecondary('/nonexistent.jsonl')
    })
  })

  describe('disposeAll', () => {
    it('stops idle checker, disposes all secondaries, disposes primary', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec1.jsonl', '/cwd')
      await mgr.getOrCreateSecondary('/sec2.jsonl', '/cwd')

      const statuses = collectEvents(mgr, 'worker:status')

      await mgr.disposeAll()

      expect(mgr.getPrimary()).toBeNull()
      expect(mgr.get('/sec1.jsonl')).toBeUndefined()
      expect(mgr.get('/sec2.jsonl')).toBeUndefined()
      expect(mgr.workerCount).toBe(0)

      expect(statuses).toContainEqual(
        expect.objectContaining({ role: 'primary', status: 'stopping' }),
      )
      expect(statuses).toContainEqual(
        expect.objectContaining({ sessionPath: '/sec1.jsonl', status: 'none' }),
      )
      expect(statuses).toContainEqual(
        expect.objectContaining({ sessionPath: '/sec2.jsonl', status: 'none' }),
      )
    })

    it('sets primary to null after disposal', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')
      expect(mgr.getPrimary()).not.toBeNull()

      await mgr.disposeAll()
      expect(mgr.getPrimary()).toBeNull()
    })
  })

  describe('LRU eviction', () => {
    it('evicts the secondary with oldest lastActivityAt', async () => {
      const mgr = createManager()
      mgr.setMaxSecondaries(4)

      await mgr.getOrCreateSecondary('/oldest.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/middle.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/newest.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)

      await mgr.getOrCreateSecondary('/middle.jsonl', '/cwd')

      await mgr.getOrCreateSecondary('/fourth.jsonl', '/cwd')

      await mgr.getOrCreateSecondary('/trigger.jsonl', '/cwd')

      expect(mgr.get('/oldest.jsonl')).toBeUndefined()
      expect(mgr.get('/middle.jsonl')).toBeDefined()
    })

    it('skips streaming workers', async () => {
      const mgr = createManager()
      mgr.setMaxSecondaries(4)

      await mgr.getOrCreateSecondary('/streaming.jsonl', '/cwd')
      vi.advanceTimersByTime(1000)
      await mgr.getOrCreateSecondary('/non-streaming.jsonl', '/cwd')

      mgr.get('/streaming.jsonl')!.isStreaming = true

      await mgr.getOrCreateSecondary('/c.jsonl', '/cwd')
      await mgr.getOrCreateSecondary('/d.jsonl', '/cwd')

      await mgr.getOrCreateSecondary('/e.jsonl', '/cwd')

      expect(mgr.get('/streaming.jsonl')).toBeDefined()
      expect(mgr.get('/non-streaming.jsonl')).toBeUndefined()
    })

    it('does nothing if all workers are streaming', async () => {
      const mgr = createManager()
      mgr.setMaxSecondaries(4)

      const paths = ['/a.jsonl', '/b.jsonl', '/c.jsonl', '/d.jsonl']
      for (const p of paths) {
        await mgr.getOrCreateSecondary(p, '/cwd')
      }

      for (const p of paths) {
        mgr.get(p)!.isStreaming = true
      }

      await mgr.getOrCreateSecondary('/e.jsonl', '/cwd')

      for (const p of paths) {
        expect(mgr.get(p)).toBeDefined()
      }
      expect(mgr.get('/e.jsonl')).toBeDefined()
    })
  })

  describe('idle timeout', () => {
    it('disposes idle secondaries after idleTimeoutMs (10 min default)', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/idle.jsonl', '/cwd')

      expect(mgr.get('/idle.jsonl')).toBeDefined()

      vi.advanceTimersByTime(600_000 + 60_000)
      await vi.advanceTimersByTimeAsync(0)

      expect(mgr.get('/idle.jsonl')).toBeUndefined()
    })

    it('skips streaming workers', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/streaming.jsonl', '/cwd')

      mgr.get('/streaming.jsonl')!.isStreaming = true

      vi.advanceTimersByTime(600_000 + 60_000)

      expect(mgr.get('/streaming.jsonl')).toBeDefined()
    })

    it('skips non-connected workers', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/error.jsonl', '/cwd')

      mgr.get('/error.jsonl')!.status = 'error'

      vi.advanceTimersByTime(600_000 + 60_000)

      expect(mgr.get('/error.jsonl')).toBeDefined()
    })
  })

  describe('crash recovery', () => {
    it('primary disconnected: auto-restarts with 1s delay, emits error status', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')
      const primary = mgr.getPrimary()!

      const statuses = collectEvents(mgr, 'worker:status')

      const bridge = lastBridge()
      bridge.emit('disconnected')

      expect(statuses).toContainEqual(
        expect.objectContaining({
          sessionId: 'primary',
          role: 'primary',
          status: 'error',
        }),
      )

      await vi.advanceTimersByTimeAsync(1_000)

      expect(statuses).toContainEqual(
        expect.objectContaining({
          sessionId: 'primary',
          role: 'primary',
          status: 'connected',
        }),
      )
    })

    it('primary restart failure: retries after 5s', async () => {
      let callIdx = 0
      nextStartFn = () => {
        callIdx++
        if (callIdx === 1) return Promise.resolve()
        if (callIdx === 2) return new Promise((_, reject) => reject(new Error('restart failed')))
        return Promise.resolve()
      }

      const mgr = createManager()
      await mgr.initPrimary('/cwd')
      const primary = mgr.getPrimary()!
      const bridge = lastBridge()

      const statuses = collectEvents(mgr, 'worker:status')

      bridge.emit('disconnected')

      await vi.advanceTimersByTimeAsync(1_000)

      expect(statuses).toContainEqual(
        expect.objectContaining({ sessionId: 'primary', status: 'error' }),
      )

      await vi.advanceTimersByTimeAsync(5_000)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(primary.status).toBe('connected')
    })

    it('secondary disconnected: marks as error, does NOT auto-restart', async () => {
      const mgr = createManager()
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      const bridge = lastBridge()
      const statuses = collectEvents(mgr, 'worker:status')

      bridge.emit('disconnected')

      const sec = mgr.get('/sec.jsonl')
      expect(sec!.status).toBe('error')

      expect(statuses).toContainEqual(
        expect.objectContaining({
          role: 'secondary',
          status: 'error',
          sessionPath: '/sec.jsonl',
        }),
      )

      await vi.advanceTimersByTimeAsync(10_000)

      expect(mgr.get('/sec.jsonl')!.status).toBe('error')
    })
  })

  describe('event forwarding', () => {
    it('forwards "event" from bridge', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')

      const events = collectEvents(mgr, 'event')
      const bridge = lastBridge()

      bridge.emit('event', { type: 'tool_use', content: 'hello' })

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'tool_use', content: 'hello' })
    })

    it('forwards "response" from bridge', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')

      const responses = collectEvents(mgr, 'response')
      const bridge = lastBridge()

      bridge.emit('response', { id: '1', success: true })

      expect(responses).toHaveLength(1)
      expect(responses[0]).toEqual({ id: '1', success: true })
    })

    it('updates lastActivityAt on events', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')

      const primary = mgr.getPrimary()!
      const originalActivity = primary.lastActivityAt

      vi.advanceTimersByTime(1000)

      const bridge = lastBridge()
      bridge.emit('event', { type: 'test' })

      expect(primary.lastActivityAt).toBeGreaterThan(originalActivity)
    })

    it('connected event: updates status, emits worker:status', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')

      const primary = mgr.getPrimary()!
      primary.status = 'error'

      const statuses = collectEvents(mgr, 'worker:status')
      const bridge = lastBridge()

      bridge.emit('connected', { sessionId: 'primary' })

      expect(primary.status).toBe('connected')
      expect(statuses).toContainEqual(
        expect.objectContaining({
          sessionId: 'primary',
          role: 'primary',
          status: 'connected',
        }),
      )
    })

    it('disconnected event: marks error, emits worker:status, triggers restart for primary only', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd')
      await mgr.getOrCreateSecondary('/sec.jsonl', '/cwd')

      const primaryBridge = mockBridgeInstances[0]

      const statuses = collectEvents(mgr, 'worker:status')
      const disconnectedEvents = collectEvents(mgr, 'disconnected')

      primaryBridge.emit('disconnected')

      expect(disconnectedEvents).toHaveLength(1)

      expect(statuses).toContainEqual(
        expect.objectContaining({
          sessionId: 'primary',
          status: 'error',
        }),
      )

      await vi.advanceTimersByTimeAsync(1_000)

      expect(statuses).toContainEqual(
        expect.objectContaining({
          sessionId: 'primary',
          status: 'connected',
        }),
      )
    })
  })

  describe('get / getAllWorkers / workerCount', () => {
    it('get() returns primary by sessionPath', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd', '/primary-session.jsonl')

      const result = mgr.get('/primary-session.jsonl')
      expect(result).toBeDefined()
      expect(result!.role).toBe('primary')
    })

    it('get() returns secondary by sessionPath', async () => {
      const mgr = createManager()
      await mgr.getOrCreateSecondary('/secondary.jsonl', '/cwd')

      const result = mgr.get('/secondary.jsonl')
      expect(result).toBeDefined()
      expect(result!.role).toBe('secondary')
    })

    it('get() returns undefined for unknown path', () => {
      const mgr = createManager()
      expect(mgr.get('/nonexistent.jsonl')).toBeUndefined()
    })

    it('getAllWorkers() returns all workers', async () => {
      const mgr = createManager()
      await mgr.initPrimary('/cwd', '/p.jsonl')
      await mgr.getOrCreateSecondary('/s1.jsonl', '/cwd')
      await mgr.getOrCreateSecondary('/s2.jsonl', '/cwd')

      const all = mgr.getAllWorkers()
      expect(all).toHaveLength(3)

      const roles = all.map((w) => w.role).sort()
      expect(roles).toEqual(['primary', 'secondary', 'secondary'])
    })

    it('workerCount includes primary + secondaries', async () => {
      const mgr = createManager()
      expect(mgr.workerCount).toBe(0)

      await mgr.initPrimary('/cwd')
      expect(mgr.workerCount).toBe(1)

      await mgr.getOrCreateSecondary('/s1.jsonl', '/cwd')
      expect(mgr.workerCount).toBe(2)

      await mgr.getOrCreateSecondary('/s2.jsonl', '/cwd')
      expect(mgr.workerCount).toBe(3)
    })

    it('workerCount decreases after disposal', async () => {
      const mgr = createManager()
      await mgr.getOrCreateSecondary('/temp.jsonl', '/cwd')
      expect(mgr.workerCount).toBe(1)

      await mgr.disposeSecondary('/temp.jsonl')
      expect(mgr.workerCount).toBe(0)
    })
  })

  describe('deriveSessionId', () => {
    it('uses basename without extension + short hash', async () => {
      const mgr = createManager()
      const state = await mgr.getOrCreateSecondary(
        '/some/deep/path/my-session.jsonl',
        '/cwd',
      )

      expect(state.sessionId).toContain('my-session')
      expect(state.sessionId).toMatch(/^my-session-[a-z0-9]+$/)
    })

    it('strips .json extension as well', async () => {
      const mgr = createManager()
      const state = await mgr.getOrCreateSecondary(
        '/path/config.json',
        '/cwd',
      )

      expect(state.sessionId).toContain('config')
      expect(state.sessionId).not.toContain('.json')
    })

    it('produces different IDs for different paths with same basename', async () => {
      const mgr = createManager()
      const s1 = await mgr.getOrCreateSecondary('/a/session.jsonl', '/cwd')
      const s2 = await mgr.getOrCreateSecondary('/b/session.jsonl', '/cwd')

      expect(s1.sessionId).not.toBe(s2.sessionId)
    })
  })
})

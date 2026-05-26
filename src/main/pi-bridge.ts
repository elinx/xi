import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'

export interface PiBridgeEvents {
  event: [data: unknown]
  response: [data: unknown]
  extension_ui_request: [data: unknown]
  session: [data: unknown]
  error: [error: Error]
  exit: [code: number | null]
  connected: []
  disconnected: []
}

const MAX_RESTART_ATTEMPTS = 3
const RESTART_DELAY_MS = 2000
const SHUTDOWN_TIMEOUT_MS = 5000

export class PiBridge extends EventEmitter {
  private process: ChildProcess | null = null
  private restarting = false
  private shutDown = false
  private buffer = ''
  private restartAttempts = 0

  constructor(private cwd: string) {
    super()
  }

  async start(): Promise<void> {
    if (this.process && !this.process.killed) {
      return
    }

    this.shutDown = false
    this.buffer = ''

    const fnmNodeBin = '/Users/xilinxing/.local/share/fnm/node-versions/v22.22.3/installation/bin'
    const envPath = process.env.PATH ?? ''
    const pathWithFnm = envPath.includes(fnmNodeBin)
      ? envPath
      : `${fnmNodeBin}:${envPath}`

    const child = spawn('pi', ['--mode', 'rpc'], {
      cwd: this.cwd,
      env: { ...process.env, PATH: pathWithFnm },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    if (!child.stdin || !child.stdout || !child.stderr) {
      const err = new Error('Failed to create pi process with required stdio pipes')
      this.emit('error', err)
      throw err
    }

    this.process = child

    child.stdout.on('data', (data: Buffer) => {
      this.handleStdoutData(data)
    })

    child.stderr.on('data', (data: Buffer) => {
      console.error('[PiBridge] stderr:', data.toString('utf-8'))
    })

    child.on('error', (err: Error) => {
      console.error('[PiBridge] process error:', err.message)
      this.emit('error', err)
    })

    child.on('exit', (code: number | null) => {
      this.handleExit(code)
    })

    this.emit('connected')
    this.restartAttempts = 0
  }

  sendCommand(command: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      this.emit('error', new Error('Cannot send command: pi process not running'))
      return
    }

    const payload = JSON.stringify(command) + '\n'
    const canFlush = this.process.stdin.write(payload)

    if (!canFlush) {
      this.process.stdin.once('drain', () => {})
    }
  }

  sendExtensionUIResponse(response: Record<string, unknown>): void {
    this.sendCommand(response)
  }

  async stop(): Promise<void> {
    this.shutDown = true

    if (!this.process || this.process.killed) {
      return
    }

    return new Promise<void>((resolve) => {
      const proc = this.process!
      let settled = false

      const finish = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }

      proc.once('exit', () => {
        finish()
      })

      proc.kill('SIGTERM')

      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
        }
        finish()
      }, SHUTDOWN_TIMEOUT_MS)
    })
  }

  get isConnected(): boolean {
    return this.process !== null && !this.process.killed
  }

  private handleStdoutData(data: Buffer): void {
    this.buffer += data.toString('utf-8')

    let newlineIdx: number
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIdx)
      this.buffer = this.buffer.substring(newlineIdx + 1)

      if (line.length === 0) {
        continue
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        console.error('[PiBridge] Failed to parse JSON line:', line.substring(0, 200))
        continue
      }

      this.routeMessage(parsed)
    }
  }

  private routeMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) {
      this.emit('event', msg)
      return
    }

    const obj = msg as Record<string, unknown>

    switch (obj.type) {
      case 'session':
        this.emit('session', msg)
        break
      case 'response':
        this.emit('response', msg)
        break
      case 'extension_ui_request':
        this.emit('extension_ui_request', msg)
        break
      case 'extension_error':
        this.emit('event', msg)
        break
      default:
        this.emit('event', msg)
        break
    }
  }

  private handleExit(code: number | null): void {
    this.process = null
    this.emit('exit', code)
    this.emit('disconnected')

    if (this.shutDown) {
      return
    }

    if (this.restarting) {
      return
    }

    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.emit('error', new Error(`Pi process exited (code ${code}) and max restart attempts (${MAX_RESTART_ATTEMPTS}) reached`))
      return
    }

    this.restarting = true
    this.restartAttempts++

    console.log(`[PiBridge] Pi exited (code ${code}), restarting in ${RESTART_DELAY_MS}ms (attempt ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})`)

    setTimeout(() => {
      this.restarting = false
      this.start().catch((err: Error) => {
        console.error('[PiBridge] Failed to restart pi:', err.message)
        this.emit('error', err)
      })
    }, RESTART_DELAY_MS)
  }
}

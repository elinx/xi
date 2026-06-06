# Spec: Multi-Worker — Primary/Secondary 进程模型

## 1. 动机

当前架构是 **1 UtilityProcess = 1 Pi Worker = 1 活跃 session**。切换 session 时，Pi Worker 在同一进程内 `switchSession()`，销毁旧 session runtime、创建新 session runtime。这导致：

1. **Streaming 被中断**：session A 正在跑，切到 B 就得 abort A
2. **后台 session 无法运行**：同一时刻只有一个 session 在工作
3. **切换有延迟**：`switchSession` 需要 teardown + create，200-500ms

目标：采用 **Primary/Secondary 主从模型**，与 pi-subagents 的 parent/child 进程模型一致。Primary 是开 app 就有的主 session，Secondary 按需创建，各自独立运行。

## 2. 核心概念

### 2.1 架构

```
WorkerManager
  ├─ primary: WorkerState            ← 开 app 就有，永远不死
  │     sessionPath = "session-A.jsonl"
  │     bridge = PiSDKBridge("primary")
  │     UtilityChild #1
  │
  └─ secondaries: Map<sessionPath, WorkerState>
        ├─ "session-B.jsonl" → UtilityChild #2   ← 按需起
        └─ "session-C.jsonl" → UtilityChild #3   ← idle 可杀
```

### 2.2 Primary vs Secondary

| | Primary | Secondary |
|---|---|---|
| 创建时机 | App 启动时 | 用户切换/新建/fork session 时 |
| 生命周期 | 跟 App 一致，永不杀 | idle 超时可杀，崩溃可重启 |
| 能否被 LRU 淘汰 | 否 | 是 |
| Subagent 角色 | Parent（发起 subagent） | Child（被 subagent 创建，或用户手动创建） |
| 内存保证 | 是 | 受 maxSecondaries 限制 |
| 删除 session | 不允许（至少保留 primary） | 允许 |

### 2.3 与 pi-subagents 的对应关系

| pi-subagents | Xi Multi-Worker |
|---|---|
| Parent pi process | Primary Worker |
| `child_process.spawn('pi', ...)` | `utilityProcess.fork(workerPath)` |
| Child 完成 → 退出 | Secondary idle → 超时杀 |
| Parent 通过 stdout 收子进程事件 | Primary 通过 parentPort 收子进程事件 |
| `context: "fork"` → `createBranchedSession()` | Fork → 创建 .jsonl → 起新 Worker |
| `runId` 标识子任务 | `sessionId` 标识 Secondary |
| 嵌套深度 guard | 不需要（用户不会无限创建 session） |

**关键区别**：pi-subagents 的 child 是**任务级**的（跑完就退出），Xi 的 Secondary 是**session 级**的（持续交互，用户随时可以发消息）。

### 2.4 Lazy Switch 废弃

Lazy Switch 解决的是 **1 Worker 下看 B 但 A 还在跑** 的问题。Multi-Worker 下每个 session 都有自己的 Worker，A 跑 A 的，你看 B 的，完全独立。Lazy Switch 的缓存机制可复用于 Worker 未启动时的短暂加载态（idle 超时被杀后切回来先显示缓存，后台起 Worker），但「显示和连接解耦」的复杂逻辑不再需要。

## 3. 数据模型

### 3.1 WorkerState

```typescript
interface WorkerState {
  sessionPath: string
  sessionId: string               // Pi SDK 分配的 sessionId
  bridge: PiSDKBridge             // 每个进程一个 bridge 实例
  role: 'primary' | 'secondary'
  status: 'starting' | 'connected' | 'error' | 'stopping'
  lastActivityAt: number          // 用于 idle 超时（primary 不检查）
  isStreaming: boolean
}
```

### 3.2 WorkerManager

```typescript
class WorkerManager {
  private primary: WorkerState | null = null
  private secondaries = new Map<string, WorkerState>()
  private displayedSessionPath: string | null = null
  private maxSecondaries: number    // 默认 4（加上 primary = 5 个 Worker）
  private idleTimeoutMs: number     // 默认 10 分钟

  // ── Primary 管理 ──

  // 创建 Primary Worker（App 启动时调用，仅一次）
  async initPrimary(cwd: string, sessionPath?: string): Promise<void>

  // 获取 Primary
  getPrimary(): WorkerState | null

  // ── Secondary 管理 ──

  // 获取或创建指定 session 的 Secondary Worker
  async getOrCreateSecondary(sessionPath: string, cwd: string): Promise<WorkerState>

  // 获取指定 session 的 Worker（可能是 primary 或 secondary）
  get(sessionPath: string): WorkerState | undefined

  // ── 显示切换 ──

  // 切换显示的 session（不改进程，只改指针）
  setDisplayed(sessionPath: string): void

  // 获取当前显示的 session
  getDisplayed(): WorkerState | undefined

  // ── 生命周期 ──

  // 优雅停止指定 Secondary Worker
  async disposeSecondary(sessionPath: string): Promise<void>

  // 停止所有 Secondary Worker
  async disposeAllSecondaries(): Promise<void>

  // 停止所有 Worker（包括 primary，App 退出时）
  async disposeAll(): Promise<void>

  // idle 超时检查（只杀 secondary，不杀 primary）
  checkIdleTimeout(): void

  // 当 Secondary 数量达到 maxSecondaries 时，按 LRU 淘汰
  evictIfNeeded(): Promise<void>

  // ── 辅助 ──

  // 所有活跃 Worker（primary + secondaries）
  getAllWorkers(): WorkerState[]

  // 当前 Worker 总数
  get workerCount(): number
}
```

### 3.3 PiSDKBridge 改动

```typescript
export class PiSDKBridge extends EventEmitter {
  private sessionId: string           // 新增：标识此 bridge 管理的 session
  private child: UtilityChild | null = null
  // ... 其余不变

  constructor(sessionId: string) {
    super()
    this.sessionId = sessionId
  }

  async start(cwd: string, sessionPath?: string): Promise<void> {
    // serviceName 必须唯一，否则 Electron 报错
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: `pi-sdk-${this.sessionId}`,
      stdio: 'pipe',
      env: { ...process.env },
    }) as unknown as UtilityChild
    // ... 其余逻辑不变
  }
}
```

### 3.4 事件携带 sessionId

所有从 Worker 发出的消息都需要携带 `sessionId`，以便 renderer 路由到正确的缓存：

```typescript
// PiSDKBridge.handleChildMessage 增加 sessionId
private handleChildMessage(msg: Record<string, unknown>): void {
  const channel = msg.channel as string

  switch (channel) {
    case 'event':
      this.emit('event', { ...msg.data, sessionId: this.sessionId })
      break
    case 'connected':
      this._isConnected = true
      this.emit('connected', { ...msg.data, sessionId: this.sessionId })
      break
    // ... 其余同理
  }
}
```

## 4. IPC 变更

### 4.1 核心变化：所有 pi:* 命令需要指定 sessionPath

当前 IPC handler 直接操作全局 `piBridge`，改为通过 `workerManager` 路由：

```typescript
// 当前
ipcMain.handle('pi:sendCommand', (_event, command) => {
  piBridge?.sendCommand(command)
})

// 改后
ipcMain.handle('pi:sendCommand', (_event, sessionPath: string, command: Record<string, unknown>) => {
  const worker = workerManager.get(sessionPath)
  if (!worker?.bridge.isConnected) return { ok: false, error: 'Worker not connected' }
  worker.bridge.sendCommand(command)
  return { ok: true }
})
```

### 4.2 IPC 签名变更

| IPC Channel | 当前签名 | 新签名 |
|---|---|---|
| `pi:sendCommand` | `(command)` | `(sessionPath, command)` |
| `pi:sendExtensionUIResponse` | `(response)` | `(sessionPath, response)` |
| `pi:getAvailableModels` | `()` | `(sessionPath)` |
| `pi:setModel` | `(model, provider?)` | `(sessionPath, model, provider?)` |
| `pi:cycleModel` | `(direction?)` | `(sessionPath, direction?)` |
| `pi:getModelInfo` | `()` | `(sessionPath)` |
| `pi:getProviderAuthStatus` | `()` | `(sessionPath)` |
| `pi:setApiKey` | `(provider, key)` | `(sessionPath, provider, key)` |
| `pi:removeAuth` | `(provider)` | `(sessionPath, provider)` |
| `pi:registerCustomProvider` | `(provider, config)` | `(sessionPath, provider, config)` |
| `session:switchSession` | `(sessionPath)` | 不再需要（多 Worker 直接切换显示） |
| `session:newSession` | `(parentSession?)` | `(sessionPath?)` → 创建新 Secondary Worker |
| `session:forkAtEntry` | `(entryId)` | `(sessionPath, entryId)` |
| `session:getMessages` | `()` | `(sessionPath)` |

### 4.3 新增 IPC

| IPC Channel | 方向 | 用途 |
|---|---|---|
| `worker:ensureReady` | renderer→main | 确保指定 session 的 Worker 已启动并连接 |
| `worker:status` | main→renderer | Worker 状态变更通知（starting/connected/error/stopping）+ role |
| `worker:dispose` | renderer→main | 主动停止指定 Secondary 的 Worker |

### 4.4 事件广播变更

```typescript
// 当前：无差别广播
broadcastToRenderers('pi:event', data)

// 改后：事件携带 sessionId，renderer 自行路由
broadcastToRenderers('pi:event', { ...data, sessionId: worker.sessionId })
```

### 4.5 Primary 特殊处理

某些 IPC 只对 Primary 有意义（因为 Secondary 没有 Worker 上下文来处理）：

| 操作 | 目标 Worker | 说明 |
|---|---|---|
| `setApiKey` / `removeAuth` | Primary | Auth 是全局的，只需在 Primary 设置，Secondary 通过 symlink 共享 |
| `registerCustomProvider` | Primary | 同上 |
| `getProviderAuthStatus` | Primary | Auth 状态全局一致，从 Primary 读即可 |
| `getAvailableModels` | 任意 connected Worker | 每个 Worker 都有自己的 model registry |
| `setModel` / `cycleModel` | 目标 session 的 Worker | 每个 session 可以用不同模型 |

简化策略：Auth 类操作始终发给 Primary（`workerManager.getPrimary()`），避免多 Worker 写冲突。

## 5. Renderer 层变更

### 5.1 usePiRpc 改动

当前 `usePiRpc` 处理全局唯一的 Pi 事件流。改为**按 sessionId 路由**：

```typescript
// 事件处理
function handlePiEvent(data: Record<string, unknown>) {
  const sessionId = data.sessionId as string
  const sessionPath = sessionIdToPathMap.get(sessionId)
  if (!sessionPath) return

  // 更新对应 session 的缓存
  const cache = sessionCache.current.get(sessionPath)
  if (!cache) return

  // ... 处理事件，更新 cache

  // 如果是当前显示的 session，刷新 UI
  if (sessionPath === displayedSessionPath) {
    setDisplayedMessages([...cache.messages])
  }
}
```

### 5.2 useSessionCache 扩展

缓存 Map 已经是按 session 分的，无需大改。新增：

- `workerStatus: Map<sessionPath, 'none' | 'starting' | 'connected' | 'error'>` — 跟踪各 session 的 Worker 状态
- `ensureWorker(sessionPath)` — 触发 Worker 启动（如果还没启动）

### 5.3 Session 切换流程

```
用户点击 sidebar 的 session B
  │
  ├─ 1. displayedSessionPath = B.path
  │     显示 B 的缓存（如果有）或加载 JSONL
  │
  ├─ 2. workerManager.get(B.path)?
  │     ├─ Primary 且 connected → 秒切
  │     ├─ Secondary 且 connected → 秒切
  │     ├─ starting → 显示 loading，等 connected 事件
  │     └─ 没有 → workerManager.getOrCreateSecondary(B.path)
  │              → 发 worker:status = starting
  │              → fork UtilityProcess
  │              → 发 worker:status = connected
  │
  └─ 3. 更新 InputBar 状态
        ├─ Worker connected → 正常输入
        ├─ Worker starting → 显示 "Connecting..."
        └─ Worker none/error → 只读模式（可查看历史，不可发消息）
```

### 5.4 发送消息

```
用户在 session B 按 Send
  │
  ├─ Worker B connected?
  │     ├─ 是 → 直接发送，零延迟
  │     └─ 否 → ensureWorker(B) → 等连接 → 发送
  │
  └─ 不需要 abort 其他 session 的 Worker
     （Primary 和其他 Secondary 独立运行，互不干扰）
```

### 5.5 新建 Session

```
用户点 "New Session"
  │
  ├─ 1. sessionService 创建新的 .jsonl 文件
  ├─ 2. workerManager.getOrCreateSecondary(newSessionPath)
  ├─ 3. displayedSessionPath = newSessionPath
  └─ 4. 等 Worker connected 后可输入

注意：Primary 和其他 Secondary 不受影响
```

### 5.6 Sidebar 状态指示

Secondary Worker 的状态在 sidebar 中可视化：

```
📗 main-session              ← Primary，总是有绿点
📙 experiment-1              ← Secondary connected
📙 experiment-2     🔄       ← Secondary streaming
📕 old-session               ← Secondary 未启动（idle 被杀），可点击重新启动
```

## 6. 进程生命周期管理

### 6.1 启动时机

| 触发 | Worker 类型 | 行为 |
|------|---|---|
| App 启动 | Primary | `initPrimary(cwd, sessionPath?)` |
| 用户切换到 session B | Secondary | `getOrCreateSecondary(B)` |
| 用户新建 session | Secondary | 创建 .jsonl → `getOrCreateSecondary(new)` |
| 用户 fork session | Secondary | 创建 fork .jsonl → `getOrCreateSecondary(fork)` |
| Agent 触发 subagent（未来） | Secondary | 创建 subagent .jsonl → `getOrCreateSecondary(subagent)` |

### 6.2 停止时机

| 触发 | Worker 类型 | 行为 |
|------|---|---|
| Idle 超时（10 分钟无交互） | Secondary only | 优雅 kill，清缓存 |
| Secondary 数量达到 maxSecondaries | Secondary only | 按 LRU 淘汰最久未活跃的 |
| 用户删除 session | Secondary | kill Worker + 删 .jsonl |
| App 退出 | Primary + Secondary | `disposeAll()` |
| **永不杀** | **Primary** | — |

### 6.3 崩溃恢复

如果 UtilityProcess 崩溃（exit code ≠ 0）：

1. `WorkerState.status = 'error'`
2. 通知 renderer `worker:status = error`
3. 缓存保留，用户仍可查看历史
4. **Primary 崩溃**：自动重启，用 `SessionManager.open(sessionPath)` 恢复，通知 renderer 重新加载
5. **Secondary 崩溃**：标记 error，用户下次切到时自动重启

### 6.4 内存预算

| Worker 配置 | 估算内存 | 适用场景 |
|---|---|---|
| Primary only | ~150-200MB | 等同当前 |
| Primary + 1 Secondary | ~300-400MB | 日常多任务 |
| Primary + 2-4 Secondary | ~600MB-1GB | 多任务并行 |
| Primary + 5+ Secondary | >1.2GB | 不推荐 |

`maxSecondaries` 默认 4（加上 Primary = 5 个 Worker）。达到上限时按 LRU 淘汰 Secondary。

## 7. pi-worker.ts 改动

**几乎不改。** 当前 worker 已经是 1 process = 1 session 的结构：

- `init(data)` 接收 `sessionPath`，绑定到该 session
- 所有命令都操作同一个 `session` / `runtime`
- 不存在 `switchSession` 的需求（多 session 由多进程解决）

唯一改动：`connected` 消息带上更多信息，帮助 main process 识别：

```typescript
send({
  channel: 'connected',
  data: {
    sessionFile: session.sessionFile,
    sessionId: session.sessionId,
    sessionName: session.sessionName,  // 新增
  }
})
```

## 8. Subagent 集成（未来）

Primary/Secondary 模型与 pi-subagents 天然对接：

```
Primary Worker
  │  Agent 调用 subagent tool
  │
  ├─ 方案 A：pi-subagents 原生运行
  │   Extension 在 Primary 内 spawn('pi', ...)
  │   Child 是独立 pi CLI 进程，不在 Xi Worker 管理内
  │   结果通过 Extension 事件流回到 Primary
  │
  └─ 方案 B：Xi 接管 subagent 派发
      拦截 subagent tool 调用
      → WorkerManager.getOrCreateSecondary(subagentSession)
      → Secondary Worker 运行 subagent
      → 结果通过 IPC 回到 Primary
      → 更好的资源管理和 UI 集成
```

方案 B 是更好的长期方案，但 Phase 1 不需要实现。Phase 1 只需要让 Secondary Worker 能被创建和管理，Subagent 集成是后续 spec。

## 9. 现有功能影响分析

### 9.1 核心概念消灭：`isLazySwitched`

当前 `isLazySwitched = displayedSessionPath !== piConnectedPath` 贯穿 App.tsx 几乎所有核心交互。Multi-Worker 下每个 session 都有自己的 Worker，这个概念彻底消灭，所有依赖它的分支都要重写。

涉及 `isLazySwitched` 的代码位置（App.tsx）：

| 行号 | 用途 | 改后 |
|---|---|---|
| L89 | `const isLazySwitched = ...` | 删除 |
| L217 | `activeSessionPath` 计算 | 简化为 `displayedSessionPath` |
| L225 | `handleRemoveQuote` 判断 activePath | 直接用 `displayedSessionPath` |
| L244 | `handleClearQuotes` 同上 | 同上 |
| L259 | `backgroundSessionName` 计算 | 删除，无 background 概念 |
| L305-308 | `handleSwitchSession` 中 streaming 时 lazy switch | 删除，直接 `ensureWorker(B)` |
| L448-463 | `handleSendPrompt` 中 lazy switch 分支 | 删除，直接向目标 Worker 发送 |
| L474-490 | `handleStop` 中 lazy switch 分支 | 删除，只 abort displayed session 的 Worker |
| L584-598 | `agent_end` 回调中 switchSession back | 删除，Worker 各自独立 |
| L715-722 | Header 状态点颜色 | 简化为 Worker 状态映射 |
| L919 | InputBar `isLazySwitched` prop | 删除 |
| L920 | InputBar `backgroundSessionName` prop | 删除 |
| L921 | InputBar `isBackgroundStreaming` prop | 删除 |

### 9.2 🔴 高影响功能（逻辑必须重写）

#### Session 切换

**当前**（App.tsx L302-329）：
```
handleSwitchSession(B)
  ├─ Pi streaming 且目标 ≠ 当前？→ lazy switch（只换显示，不换连接）
  ├─ Pi 已连到 B？→ 只换显示
  └─ 否则 → switchSession(B) → clearMessages → loadHistory → loadForkPoints
```

**改后**：
```
handleSwitchSession(B)
  ├─ Worker B 已存在且 connected？→ 秒切（只换 displayedSessionPath）
  ├─ Worker B starting？→ 显示 loading，等 connected 事件
  └─ Worker B 不存在？→ ensureWorker(B) → 等 connected → 秒切
```

关键变化：不再调 `switchSession` IPC，不再 `clearMessages` + `loadHistory`，不再关心其他 Worker 是否 streaming。

#### 新建 Session

**当前**（App.tsx L334-346）：
```
handleNewSession
  ├─ if isPiStreaming() → abort()   ← 杀掉当前 session 的 streaming
  ├─ clearMessages()
  └─ newSession(name, parentSession) ← 进程内 runtime.newSession()
```

**改后**：
```
handleNewSession
  ├─ sessionService 创建新 .jsonl
  ├─ workerManager.getOrCreateSecondary(newPath)   ← 不影响任何其他 Worker
  ├─ displayedSessionPath = newPath
  └─ 不需要 abort、clearMessages
```

#### Fork

**当前**（App.tsx L348-359）：
```
handleForkAtEntry
  ├─ if isPiStreaming() → abort()
  ├─ clearMessages()
  └─ forkAtEntry(entryId, name) ← 进程内 runtime.fork()
```

**改后**：
```
handleForkAtEntry
  ├─ sessionService.fork(entryId) → 创建 fork .jsonl
  ├─ workerManager.getOrCreateSecondary(forkPath)
  └─ 不需要 abort、clearMessages
```

注意：Fork 操作仍需要源 session 的 Worker 来获取 `getUserMessagesForForking()`，但不需要切换 Worker。通过 `workerManager.get(sourcePath).bridge.sendRpcCommand({ type: 'fork', entryId })` 获取数据，然后 `sessionService` 写新 .jsonl，最后起新 Worker。

#### 发送 Prompt

**当前**（App.tsx L423-464）：
```
handleSendPrompt
  ├─ if isLazySwitched:
  │     ├─ if isPiStreaming() → abort()
  │     ├─ switchSession(displayedPath) ← 先把 Pi 切到显示的 session
  │     ├─ clearMessages → loadHistory → loadForkPoints → refresh
  │     └─ doSend()
  └─ else:
        doSend()
```

**改后**：
```
handleSendPrompt
  ├─ Worker B connected? → doSend()
  └─ Worker B 不存在? → ensureWorker(B) → doSend()
```

简化程度最大：从 ~40 行分支逻辑变为 ~5 行。不需要 abort 其他 Worker，不需要 switchSession。

#### Stop/Abort

**当前**（App.tsx L473-490）：
```
handleStop
  ├─ if isLazySwitched:
  │     ├─ abort()
  │     └─ switchSession(displayedPath) ← 切回来
  └─ else:
        abort()
```

**改后**：
```
handleStop
  └─ abort displayed session's Worker
```

#### agent_end 回调

**当前**（App.tsx L578-600）：
```
setOnAgentEnd(() => () => {
  refresh()
  if (displayed !== piConnected) {
    switchSession(displayed)  ← 自动切回显示的 session
  }
})
```

**改后**：
```
setOnAgentEnd(() => () => {
  refresh()
  // 不需要任何切换，每个 Worker 独立
  // 可选：如果 displayed session 的 Worker 被杀过，
  //       现在 idle 了可以自动重新启动
})
```

#### usePiRpc 重构

**当前**：全局唯一的 streaming 状态机，所有 `useRef` 都是单实例：
```typescript
const isStreamingRef = useRef(false)
const currentAssistantId = useRef<string | null>(null)
const currentContentBlocks = useRef<Map<number, ContentBlock>>(new Map())
const toolCallArgsBuffer = useRef<Map<number, string>>(new Map())
const pendingToolCallArgs = useRef<Map<string, Record<string, unknown>>>(new Map())
const countedResponseIds = useRef<Set<string>>(new Set())
```

**改后**：两种方案——

方案 A：**usePiRpc 按 sessionId 路由**（推荐）
- 保持单个 hook 实例
- `handleEvent` 根据 `event.sessionId` 路由到对应 session 的缓存
- streaming 中间状态存入 `useSessionCache` 的 `SessionCache` 中
- hook 的返回值改为需要传 `sessionPath` 参数：`sendPrompt(sessionPath, text, ...)`

方案 B：**usePiRpc 多实例**
- 每次 `ensureWorker` 创建一个新的 `usePiRpc` 实例
- 问题：React hook 不能动态创建，需要改为 `usePiRpcPool` 或其他模式
- 复杂度更高，不推荐

**选择方案 A**，与现有 `useSessionCache` 的按 session 路由模式一致。

#### 启动恢复

**当前**（App.tsx L522-540）：
```
getLastSession → switchSession(lastPath)
  → clearMessages → loadHistory → loadForkPoints
```

**改后**：
```
Primary Worker 启动时连默认 session
如果 lastPath !== primary.sessionPath:
  → getOrCreateSecondary(lastPath)
  → displayedSessionPath = lastPath
```

### 9.3 🟡 中影响功能（需要适配但核心逻辑不变）

#### Forward 消息

核心逻辑（`pendingForwards` Map、`handleForwardMessage`）不变。但 `handleSendPrompt` 里的 lazy switch 分支删除后，Forward 发送简化：

- 当前：如果 lazy switched → abort + switchSession + doSend
- 改后：直接向目标 Worker 发送

#### Quote 消息

纯 renderer 内存状态，不受 Worker 架构影响。`handleRemoveQuote` / `handleClearQuotes` 中 `isLazySwitched` 判断改为直接用 `displayedSessionPath`。

#### Token Usage Ring

当前已经用 `displayedTokenUsage`（从 sessionCache 读取），不依赖 `piConnectedPath`。无需改。

#### Header 状态点

当前逻辑：
```typescript
isLazySwitched
  ? isAgentEnding ? 'bg-blue-500 animate-pulse' : 'bg-amber-500'
  : displayedStreaming ? 'bg-blue-500 animate-pulse' : 'bg-green-500'
```

改后简化为：
```typescript
workerStatus === 'connected' && !displayedStreaming ? 'bg-green-500'
: displayedStreaming ? 'bg-blue-500 animate-pulse'
: workerStatus === 'starting' ? 'bg-amber-500 animate-pulse'
: 'bg-gray-400'  // none/error
```

不再有 `isLazySwitched` 和 `isAgentEnding` 概念。

#### InputBar

需要删除的 props：
- `isLazySwitched`
- `backgroundSessionName`
- `isBackgroundStreaming`
- `isAgentEnding`

需要新增的 prop：
- `workerStatus: 'connected' | 'starting' | 'none'` — 控制 disabled 状态

#### Commit Message 生成

当前 `handleRequestCommitMessage` 直接调 `sendPrompt`，隐式发送到 `piConnectedPath` 的 session。

改后需明确发送到 `displayedSessionPath` 的 Worker：`sendPrompt(displayedSessionPath, prompt)`。

#### Model 切换

`setModel` / `cycleModel` 需要指定 sessionPath。当前是全局操作，改后：
- model picker 显示当前 displayed session 的模型
- 切换模型只影响 displayed session 的 Worker

#### Extension UI Request

当前 `pi:extensionUiRequest` 广播不带 sessionId。改后需要带上 `sessionId`，renderer 根据 `sessionId` 路由到正确的 session 处理。

Extension UI Request 通常属于某个特定 session（发起请求的 session），需要在事件中携带来源信息。

### 9.4 🟢 低影响功能（基本不变）

| 功能 | 说明 |
|---|---|
| **Session Search** | 纯 Extension + 文件读取，无 Worker 依赖 |
| **Session Sidebar** | 仍触发 `onSwitchSession`，接口不变，内部调用 `ensureWorker` |
| **ChatView** | 只消费 `messages` props，不关心 Worker |
| **Session Service** | 纯文件操作 |
| **Compaction** | 按 sessionPath 发给对应 Worker，逻辑不变 |
| **Fork Points 展示** | 从 sessionService 读文件，不依赖 Worker |
| **Settings/Auth** | 始终发给 Primary Worker，接口不变 |
| **Command Palette** | `onSessionSelect` 调 `switchSession` → 改调 `ensureWorker` + `displaySession` |
| **File Viewer / Diff Viewer / Terminal** | 纯 UI，不涉及 Pi |

### 9.5 改动量估算

| 文件 | 当前行数 | 改动行数 | 影响级别 | 说明 |
|---|---|---|---|---|
| `App.tsx` | 983 | ~200 | 🔴 高 | 消灭 isLazySwitched，重写所有 handler |
| `usePiRpc.ts` | 631 | ~150 | 🔴 高 | 事件按 sessionId 路由，返回值加 sessionPath |
| `useSessionCache.ts` | 305 | ~40 | 🟡 中 | 增加 workerStatus 跟踪 |
| `useSessionManager.ts` | 170 | ~50 | 🟡 中 | switchSession → ensureWorker |
| `main/index.ts` | 1369 | ~300 | 🔴 高 | 所有 IPC handler 加 sessionPath 路由 |
| `main/pi-sdk-bridge.ts` | 230 | ~30 | 🟡 中 | sessionId 构造参数，serviceName 动态化 |
| `main/worker-manager.ts` | 新建 | ~200 | 新增 | WorkerManager 类 |
| `preload/index.ts` | ~150 | ~50 | 🟡 中 | API 签名对齐 |
| `InputBar.tsx` | ~200 | ~20 | 🟡 中 | 删旧 props 加新 prop |
| **总计** | | ~1140 | | |

## 10. 实现阶段

> 基于 §9 影响分析，Phase 边界按「可独立验证的功能增量」划分，而非按层划分。

### Phase 1: WorkerManager + PiSDKBridge 改造

**改动文件**：
- `src/main/pi-sdk-bridge.ts` — 加 `sessionId` 构造参数，`serviceName` 动态化
- `src/main/worker-manager.ts` — **新建**，WorkerManager 类（Primary/Secondary）
- `src/main/index.ts` — `piBridge` 全局变量替换为 `workerManager`

**目标**：main process 支持 Primary + N Secondary Worker 创建/管理/销毁

### Phase 2: IPC 路由 + 事件分发

**改动文件**：
- `src/main/index.ts` — 所有 `pi:*` handler 增加 `sessionPath` 参数
- `src/preload/index.ts` — API 签名对齐
- `src/renderer/src/types/session.ts` — 新增 Worker 状态类型

**目标**：renderer 能向指定 session 的 Worker 发送命令，接收该 Worker 的事件

### Phase 3: Renderer 适配

**改动文件**：
- `src/renderer/src/hooks/usePiRpc.ts` — 按 sessionId 路由事件
- `src/renderer/src/hooks/useSessionCache.ts` — 增加 Worker 状态跟踪
- `src/renderer/src/hooks/useSessionManager.ts` — 移除 `switchSession` 调用，改为 `ensureWorker`
- `src/renderer/src/App.tsx` — 使用新的 session 切换流程

**目标**：完整的多 Worker UI 体验，切换秒切，后台 session 独立运行

### Phase 4: 生命周期管理

**改动文件**：
- `src/main/worker-manager.ts` — idle 超时、LRU 淘汰、Primary 崩溃恢复
- `src/renderer/src/App.tsx` — Worker 状态指示
- `src/renderer/src/components/SessionSidebar.tsx` — Secondary 状态图标

**目标**：生产可用，内存可控，崩溃可恢复

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 内存占用（每个 Worker ~150-200MB） | maxSecondaries 上限 + idle 超时 + LRU 淘汰 |
| `serviceName` 必须唯一 | 使用 `pi-sdk-${sessionId}` |
| 多 Worker 同时写同一 `auth.json` / `models.json` | Auth 操作只发 Primary，Secondary 通过 symlink 共享 |
| Renderer 收到多个 Worker 的事件流 | 事件携带 `sessionId`，按 session 路由到对应缓存 |
| Worker 崩溃导致 session 数据丢失 | Pi SDK 在 `message_end` 时同步写 JSONL，崩溃最多丢失当前 streaming 的消息 |
| Primary 崩溃 | 自动重启 + SessionManager.open 恢复，通知 renderer 重新加载 |
| 快速切换创建大量 Secondary | debounce + starting 状态复用（不重复 fork） |
| Electron UtilityProcess 数量限制 | 未发现硬性限制，但 `maxSecondaries=4` 保证安全 |

## 12. 不改的部分

- **pi-worker.ts**：几乎不改（已满足 1 process = 1 session）
- **session-service.ts**：不改（纯文件操作，无 Pi 依赖）
- **ChatView.tsx**：不改（只消费 messages props）
- **Pi SDK**：不改（不调 `switchSession`，每个 Worker 独立）

## 13. 替代方案

### 方案 B：对等 Worker Pool（无 Primary/Secondary 区分）

所有 Worker 平等，WorkerPool 管理 `Map<sessionPath, WorkerState>`，用 `activeSessionPath` 指针标记当前显示的 session。

**优点**：概念更简单，无特殊角色
**缺点**：LRU 可能杀掉"主" session（用户最常使用的）；Subagent 集成时没有自然的 parent 角色；需要额外逻辑保护"当前活跃" session 不被淘汰

### 方案 C：Pi SDK 原生支持多 session

等 Pi SDK 提供 `createSession(path)` API，在同一个进程内管理多个 session。

**优点**：零额外进程开销
**缺点**：依赖 Pi SDK 何时实现，不可控；单进程内的 session 仍然共享资源（内存、API rate limit）

**选择 Primary/Secondary 的理由**：与 pi-subagents 的 parent/child 模型一致，Primary 是天然的 subagent parent，不会被意外淘汰，概念清晰。

## 14. 质量保障策略

### 14.1 核心风险

Multi-Worker 改动 ~1140 行，覆盖 9 个文件。最大风险不是新代码有 bug，而是 **迁移过程中 Primary Worker 的基础功能被 break**——连不上、发不了消息、streaming 断了。

### 14.2 迁移原则：Primary Only 优先

**Phase 1 完成后，必须先恢复到「Primary Only = 当前行为」再继续。**

每个 Phase 的交付标准：

| Phase | 交付标准 | 验证方法 |
|---|---|---|
| Phase 1 | Primary Worker 正常工作，行为与当前 `piBridge` 一致 | 手动验证 |
| Phase 2 | Primary Worker 通过新 IPC 签名正常工作，Secondary 能创建但 renderer 不用 | 自动测试 + 手动验证 |
| Phase 3 | 完整多 Worker UI | 自动测试 + 手动验证 |
| Phase 4 | 生命周期管理，生产可用 | 自动测试 + 手动验证 |

### 14.3 分 Phase 验证清单

#### Phase 1 验证：Primary Only 行为一致

WorkerManager 创建 Primary Worker，renderer 不改，main/index.ts 通过 `workerManager.getPrimary()` 路由。

- [ ] App 启动，Primary Worker 连接成功
- [ ] 发送 prompt，收到 streaming 回复
- [ ] Session 切换（switchSession）正常工作
- [ ] New session / fork 正常
- [ ] Abort 正常
- [ ] Model 切换正常
- [ ] Auth 设置正常
- [ ] Extension UI request 正常

**这个阶段 renderer 一行代码都不改，保证不改 break。**

#### Phase 2 验证：IPC 路由正确

IPC 签名加了 `sessionPath`，preload 对齐。

- [ ] 所有 `pi:*` IPC handler 接受 `sessionPath` 参数
- [ ] `sessionPath` 缺失时 fallback 到 Primary Worker（向后兼容）
- [ ] 新增 `worker:ensureReady` / `worker:status` / `worker:dispose` IPC
- [ ] 事件携带 `sessionId`，renderer 能接收
- [ ] 手动创建 Secondary Worker 并通过 IPC 发命令

#### Phase 3 验证：Renderer 多 Worker

`isLazySwitched` 删除，所有 handler 重写。

- [ ] Primary session 正常（发消息、streaming、abort）
- [ ] 切换到 Secondary session → Worker 启动 → 可交互
- [ ] 两个 session 同时 streaming → 各自独立
- [ ] Secondary idle 超时被杀 → 切回时自动重启
- [ ] Fork / New session 创建新 Secondary Worker
- [ ] Forward 消息跨 session 正常
- [ ] Quote 消息正常
- [ ] Token Usage Ring 显示正确 session 的数据
- [ ] Header 状态点正确
- [ ] InputBar disabled 状态正确（Worker starting 时）

#### Phase 4 验证：生命周期

- [ ] maxSecondaries 限制生效，LRU 淘汰最久未活跃的 Secondary
- [ ] Primary 崩溃后自动重启
- [ ] Secondary 崩溃后标记 error，切回时重启
- [ ] App 退出时 `disposeAll()` 清理所有 Worker
- [ ] 内存占用在预期范围内

### 14.4 自动测试策略

#### 现有测试的处理

现有 15 个测试文件。Multi-Worker 迁移后的影响：

| 测试文件 | 影响 | 处理 |
|---|---|---|
| `session-switch-fix.test.ts` (874 行) | 🔴 **全部删除** | 测的是 soft switch / isLazySwitched 逻辑，Multi-Worker 下这些概念消灭了 |
| `ipc-handlers.test.ts` (471 行) | 🔴 **全部重写** | IPC 签名变了（加了 sessionPath），handler 逻辑从 `piBridge.sendRpcCommand` 改为 `workerManager.get(path).bridge.sendRpcCommand` |
| `app-integration.test.ts` (396 行) | 🔴 **大部分重写** | 测的是 `switchSession` / `newSession` 流程，Multi-Worker 下行为完全不同 |
| `session-service.test.ts` | 🟢 不改 | 纯文件操作 |
| `session-sidebar.test.ts` | 🟡 小改 | 接口不变，内部调 `ensureWorker` 替代 `switchSession` |
| 其余 10 个文件 | 🟢 不改 | 布局、文件查看、token ring 等 |

#### 新增测试

| 测试文件 | 测什么 | 何时写 |
|---|---|---|
| `worker-manager.test.ts` | WorkerManager 的 Primary/Secondary 创建、LRU 淘汰、idle 超时、崩溃重启 | Phase 1 |
| `multi-worker-ipc.test.ts` | IPC 路由：sessionPath 路由到正确 Worker、Primary fallback、auth 只发 Primary | Phase 2 |
| `multi-worker-renderer.test.ts` | Renderer 事件路由、多 session streaming、ensureWorker 流程 | Phase 3 |

#### WorkerManager 单元测试重点

```typescript
describe('WorkerManager', () => {
  it('creates primary on initPrimary')
  it('cannot create second primary')
  it('creates secondary on getOrCreateSecondary')
  it('reuses existing secondary if already starting')
  it('reuses existing secondary if already connected')
  it('evicts LRU secondary when maxSecondaries reached')
  it('never evicts primary')
  it('restarts primary on crash')
  it('marks secondary as error on crash, restarts on next access')
  it('idle timeout kills secondary but not primary')
  it('disposeAll kills primary + all secondaries')
  it('get(path) returns primary or secondary')
  it('auth operations route to primary only')
})
```

#### IPC 路由测试重点

```typescript
describe('Multi-Worker IPC routing', () => {
  it('pi:sendCommand routes to correct worker by sessionPath')
  it('pi:sendCommand falls back to primary when sessionPath missing')
  it('pi:setApiKey always routes to primary')
  it('pi:getProviderAuthStatus always routes to primary')
  it('pi:setModel routes to target session worker')
  it('pi:events carry sessionId')
  it('worker:ensureReady creates secondary if not exists')
  it('worker:ensureReady returns immediately if already connected')
  it('worker:dispose kills secondary worker')
  it('worker:dispose cannot kill primary')
})
```

### 14.5 手动验证脚本

每个 Phase 交付前跑一遍：

```
Phase 1 手动验证:
1. npm run dev
2. 打开 Xi → 自动连接 Primary Worker
3. 发一条消息 → 等回复 → 确认 streaming 正常
4. 点 sidebar 切换 session → 确认 switchSession 正常
5. 新建 session → 确认正常
6. Fork → 确认正常
7. 点 Stop → 确认 abort 正常
8. 切换 Model → 确认正常
9. 设置 API Key → 确认正常

Phase 3 手动验证（增量）:
1. 打开 Xi → 连接 Primary
2. 发一条消息 → streaming 开始
3. 切到另一个 session → Secondary Worker 启动
4. 在 Secondary 发消息 → 确认可以独立交互
5. 切回 Primary → streaming 仍在继续（或不中断）
6. 等 Secondary idle 超时 → 切回 → 确认 Worker 重启
7. 快速切换 5+ session → 确认 LRU 淘汰正常
```

### 14.6 回滚策略

每个 Phase 独立 commit。如果某 Phase break 了：

1. `git revert` 该 Phase 的 commit
2. 前一个 Phase 的代码是稳定的，回退到那里
3. 修复问题后重新 commit

**不要跨 Phase 修改。** Phase 1 的 bug 在 Phase 1 修，不要带进 Phase 2。

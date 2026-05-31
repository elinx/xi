# Spec: Lazy Session Switch（延迟会话切换）

## 1. 动机

当前切换 session 是一个**同步阻塞的破坏性操作**：

```
switchSession(B)
  → teardownCurrent() → session.dispose()   // A 的 Agent 被销毁
  → createRuntime(B)                         // B 的 Runtime 被创建
```

这导致两个问题：

1. **切换有延迟**：`switchSession` + `loadHistory` 涉及 Pi RPC 往返（200-500ms），期间 UI 阻塞或空窗
2. **正在 streaming 的 session 会被中断**：用户切到 B 查看，A 的流式响应直接停止

目标：实现**延迟切换**，前端显示和 Pi 连接解耦，让 session 切换变成非阻塞操作。

## 2. 核心概念

### 2.1 两个独立的状态

| 概念 | 说明 | 数量 |
|------|------|------|
| **piConnectedSession** | Pi worker 实际连接的 session，同一时刻只有一个 | 1 |
| **displayedSession** | 前端当前展示的 session，可以有独立的消息缓存 | 1（未来 Tab 模式下为 N） |

当 `displayedSession !== piConnectedSession` 时，displayedSession 处于**只读模式**：
- 可以查看历史消息、滚动
- 不能直接发送 prompt（需先切换 Pi 连接）
- 不会收到实时 streaming 事件

### 2.2 Session 缓存

每个曾打开过的 session 维护一份前端缓存：

```typescript
interface SessionCache {
  sessionPath: string
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  tokenUsage: TokenUsage
  forkPoints: ForkPoint[]
  loadedAt: number  // 缓存加载时间戳，用于判断是否需要刷新
  // Pi streaming 中间状态（切回该 session 时需要恢复，以继续接收 delta）
  currentAssistantId: string | null
  currentContentBlocks: Map<number, ContentBlock>
  toolCallArgsBuffer: Map<number, string>
  pendingToolCallArgs: Map<string, Record<string, unknown>>
  countedResponseIds: Set<string>
}
```

这些中间状态目前存在于 `usePiRpc` 的 `useRef` 中。切换 session 时需要将它们保存到对应 session 的缓存中，切回时恢复。如果不保存，切回正在 streaming 的 session 时将无法继续接收 `text_delta` 等事件（因为 `currentAssistantId` 为 null）。

### 2.3 切换策略

| 场景 | Pi 状态 | 操作 |
|------|---------|------|
| 显示 A（idle）→ 切到 B | A idle | 立即显示 B 缓存 + 后台 switchSession(B) |
| 显示 A（streaming）→ 切到 B 查看 | A streaming | 立即显示 B 缓存，**不调 switchSession**，A 继续跑 |
| 在 B 输入框发消息，但 Pi 连在 A | A 可能 streaming | 先 abort(A) → switchSession(B) → 发送 |
| A streaming 完成 | A idle | 如果 displayedSession ≠ piConnectedSession，可后台 switchSession |
| 回到 A | A 可能已 idle | 显示 A 缓存（已含 streaming 结果），如 Pi 连在别处则后台切回 |

## 3. 数据流

### 3.1 正常 streaming（Pi 连接 = 显示）

```
Pi Worker                         Renderer
   │                                │
   │  agent_start                   │
   │───────────────────────────────>│  → 写入 sessionCache[A].isStreaming = true
   │                                │    刷新 UI（因为 A === displayedSession）
   │  message_start (user)          │
   │───────────────────────────────>│  → append to sessionCache[A].messages
   │                                │
   │  message_update (text_delta)   │
   │───────────────────────────────>│  → update sessionCache[A].messages
   │                                │
```

### 3.2 Streaming 中切换查看 B

```
Pi Worker                         Renderer
   │                                │
   │  [A streaming 中]               │  displayedSession = A
   │                                │
   │                                │  用户点击 B
   │                                │  ┌──────────────────────────────────┐
   │                                │  │ 1. saveCache(A)                  │
   │                                │  │ 2. displayedSession = B           │
   │                                │  │ 3. restoreCache(B) 或 loadFromJSONL │
   │                                │  │ 4. 不调 switchSession             │
   │                                │  └──────────────────────────────────┘
   │                                │
   │  message_update (text_delta)   │  displayedSession = B ≠ piConnectedSession = A
   │───────────────────────────────>│  → 静默写入 sessionCache[A].messages
   │                                │  → 不刷新 UI（因为 A ≠ displayedSession）
   │                                │  → Tab/标题 上 A 显示 🔄（如果有 Tab UI）
   │                                │
   │  agent_end                     │
   │───────────────────────────────>│  → sessionCache[A].isStreaming = false
   │                                │  → 如果 displayedSession === B：
   │                                │     可选：后台 switchSession(B)
```

### 3.3 在 B 发消息（Pi 连在 A）

```
Renderer                          Pi Worker
   │                                │
   │  用户在 B 输入框发送              │  displayedSession = B, piConnectedSession = A
   │                                │
   │  ┌──────────────────────────┐  │
   │  │ if A is streaming:       │  │
   │  │   abort()               │  │
   │  │ switchSession(B)        │──>│  teardown A → createRuntime B
   │  │ loadHistory()           │<──│  返回 B 的消息
   │  │ refreshCache(B)         │  │
   │  │ sendPrompt(text)        │──>│  prompt in B
   │  └──────────────────────────┘  │
```

## 4. 读取非活跃 Session 的历史

当 Pi 连接在 A，用户想看 B 的历史时，不能走 `getMessages` RPC（返回的是 A 的消息）。

### 4.1 方案：main process 直接解析 JSONL

`session-service.ts` 已有 `parseSessionFile()` 解析 header + metadata。新增方法解析完整消息列表：

```
新增 IPC: session:getMessagesForSession(sessionPath)
  → main/index.ts
    → session-service.parseSessionMessages(sessionPath)
      → 读取 JSONL 文件
      → 遍历 entries，返回 Pi 原始消息格式（与 get_messages RPC 相同）
      → renderer 侧用现有 loadHistory 转换逻辑转为 ChatMessage[]
```

此操作是纯文件读取，不涉及 Pi worker，不触发任何 session 切换。

### 4.2 JSONL 直读的安全性论证

**核心结论：在 Lazy Switch 场景下，JSONL 直读始终是安全的，不存在与 Pi 内存不一致的风险。**

理由：Pi 的持久化时机是 `message_end`（消息完整时同步写文件），而非 `message_start` 或 `text_delta`。

```
AgentSession._handleAgentEvent:
  if (event.type === "message_end"):
    sessionManager.appendMessage(event.message)  // ← appendFileSync，同步写磁盘
```

这意味着：任何已完成的消息（`message_end` 已触发）都已经落盘。而 Lazy Switch 读 JSONL 时，被读的 session 一定不在 streaming（Pi 同一时刻只有一个活跃 session），因此其所有消息都已被 `message_end` 持久化到 JSONL。

**不可能不一致的时序**：

| 时序 | JSONL 状态 | Pi 内存状态 | 是否一致 |
|------|-----------|------------|----------|
| Pi 连 A，A idle，读 B 的 JSONL | B 的所有已完成消息 | B 没有 Pi 连接（无内存状态） | ✅ 一致 |
| Pi 连 A，A streaming，读 B 的 JSONL | B 的所有已完成消息 | B 没有 Pi 连接 | ✅ 一致 |
| Pi 连 B，B streaming，读 B 的 JSONL | 缺少正在 streaming 的消息 | 有不完整的消息 | ⚠️ 不一致 |

第三行是不一致的情况，但这**不是 Lazy Switch 的场景**——当 Pi 连在 B 时，我们走 `loadHistory()` 读 Pi 内存，不走 JSONL。

### 4.3 消息格式转换

`parseSessionMessages` 返回 Pi 的原始消息格式（与 `get_messages` RPC 返回的格式相同），不做 ChatMessage 转换。转换逻辑保留在 renderer 侧，复用 `usePiRpc.ts` 中 `loadHistory()` 的现有转换逻辑。

理由：main process（Node.js）不应依赖 renderer 的类型定义（`ChatMessage`、`ContentBlock` 等），且转换逻辑与 UI 渲染耦合（如 tool_result 追加到最后一个 assistant message），属于 renderer 职责。

### 4.4 JSONL 读取性能

实测数据（1MB / 145 行的 JSONL 文件）：

- 读文件 + JSON.parse 全部行：**~50ms**
- 对比 Pi RPC `get_messages`：**200-500ms**
- JSONL 直读比 Pi RPC 更快

极端场景（无 compaction 的超长 session，5-10MB）：~200-500ms。但 Pi 有自动 compaction 机制，实际上 JSONL 不会无限增长。

### 4.5 缓存刷新时机

| 时机 | 数据来源 | 说明 |
|------|---------|------|
| 首次打开非活跃 session | JSONL 直读 | Pi 不在该 session，JSONL 是唯一数据源 |
| Pi 连接切换到该 session | `loadHistory()`（Pi 内存） | Pi 内存比 JSONL 更权威，覆盖缓存 |
| 非活跃 session 收到 `agent_end` | **不需要重读 JSONL** | streaming 事件已经实时更新了缓存，缓存已是最新的 |
| 回到某 session 且 Pi 不在该 session | JSONL 直读 | 可选：如果缓存已有且未过期，直接用缓存 |

## 5. API 变更

### 5.1 新增 main process IPC

```typescript
// session:getMessagesForSession
// 从 JSONL 文件解析指定 session 的消息（不经过 Pi worker）
ipcMain.handle('session:getMessagesForSession', async (_event, sessionPath: string) => {
  return sessionService.parseSessionMessages(sessionPath)
})
```

### 5.2 新增 session-service 方法

```typescript
// session-service.ts
// 返回 Pi 原始消息格式（与 get_messages RPC 相同），不做 ChatMessage 转换
export function parseSessionMessages(filePath: string): unknown[] {
  // 1. 读取 JSONL 文件
  // 2. 解析 entries
  // 3. 过滤 type === 'message' 的 entries，提取 message 字段
  // 4. 返回 Pi 原始消息数组（renderer 侧复用 loadHistory 转换逻辑）
}
```

### 5.3 preload 暴露

```typescript
getMessagesForSession: (sessionPath: string) => Promise<ChatMessage[]>
```

### 5.4 不改的部分

- **pi-worker.ts**：不改。Pi worker 继续单 session 模型。
- **Pi SDK**：不改。`switchSession` 语义不变。
- **ChatView.tsx**：不改。继续接收 `messages` props 渲染。
- **SessionSidebar.tsx**：不改。点击仍触发 `onSwitchSession`，但回调行为变化。

## 6. Renderer 层状态管理

### 6.1 新增 hook: useSessionCache

从 `usePiRpc` 中拆分出缓存逻辑：

```typescript
interface UseSessionCacheReturn {
  // 当前显示的 session
  displayedSessionPath: string | null
  // Pi 连接的 session
  piConnectedSessionPath: string | null
  // 当前显示的消息（来自缓存）
  displayedMessages: ChatMessage[]
  // 当前显示 session 是否为只读
  isReadOnly: boolean  // displayedSessionPath !== piConnectedSessionPath
  // 当前显示 session 是否正在 streaming
  isDisplayedStreaming: boolean
  // 切换显示（不切换 Pi 连接）
  displaySession: (sessionPath: string) => Promise<void>
  // 确保 Pi 连接到指定 session（用于发送消息前）
  ensurePiConnected: (sessionPath: string) => Promise<void>
  // 发送 prompt（自动处理连接切换）
  sendPromptWithSession: (sessionPath: string, text: string, images?: ...) => Promise<void>
}
```

### 6.2 usePiRpc 改动

`usePiRpc` 仍然管理 Pi 事件流和当前连接状态，但事件不再直接更新显示用的 `messages` state，而是：

1. 更新 `piConnectedSessionPath` 对应的缓存
2. 如果 `piConnectedSessionPath === displayedSessionPath`，同步刷新 `displayedMessages`

```typescript
// 伪代码
function handleEvent(event) {
  const cache = sessionCache.get(piConnectedSessionPath)
  // 更新 cache...
  
  if (piConnectedSessionPath === displayedSessionPath) {
    setDisplayedMessages(cache.messages)  // 刷新 UI
  }
  // 否则静默缓存，不刷新
}
```

### 6.3 缓存 Map

```typescript
const sessionCache = useRef<Map<string, SessionCache>>(new Map())
```

缓存的 key 是 session 文件路径（`sessionInfo.filePath`）。

## 7. UI 变更

### 7.1 InputBar 只读状态

当 `isReadOnly === true` 时，InputBar 显示提示信息：

```
┌──────────────────────────────────────────────────────┐
│  Session A is running. Messages will be sent after   │
│  it completes, or you can interrupt it.              │
│  [Wait] [Interrupt & Switch]                         │
├──────────────────────────────────────────────────────┤
│  Type a message...                              [Send]│
└──────────────────────────────────────────────────────┘
```

或者更简单的方案：InputBar 照常可用，发送时自动处理：

- 如果 Pi 连在别的 session 且 idle → 自动 switchSession + 发送
- 如果 Pi 连在别的 session 且 streaming → 弹确认"Session A 正在运行，是否中断？"

### 7.2 Header 状态指示

Header 区域显示当前连接状态：

```
正常:  📗 Session B
只读:  📕 Session B (viewing — Session A is active)
切换中: 🔄 Session B (switching...)
```

### 7.3 Sidebar 无变化

Sidebar 的交互不变，点击 session 仍触发切换。区别是内部实现从「同步 switchSession」变成「延迟切换」。

## 8. 事件处理细节

### 8.1 Pi 事件路由

所有 Pi 事件都关联到 `piConnectedSessionPath`。事件处理函数只更新对应的缓存，然后判断是否需要刷新 UI。

### 8.2 agent_end 的处理

当缓存中正在 streaming 的 session 收到 `agent_end`：

1. 更新该 session 缓存的 `isStreaming = false`
2. 如果 `displayedSession !== piConnectedSession`（即用户在看别的 session）：
   - 可选：后台 `switchSession(displayedSession)`，因为 Pi 现在 idle 了，可以安全切换
   - 切换完成后用 `loadHistory()` 覆盖 displayedSession 的缓存
3. 如果 `displayedSession === piConnectedSession`（即用户已经回来了）：
   - 正常流程，agent_end 后 Pi idle，用户可以继续操作

### 8.3 连接断开

如果 Pi 连接断开（crash / error）：
- 所有缓存保留
- `piConnectedSessionPath = null`
- 所有 session 进入只读模式
- 重连后恢复到最后显示的 session

## 9. 边界情况

| 场景 | 处理 |
|------|------|
| 切换到一个被删除的 session | 缓存清空，显示空状态，从 Sidebar 移除 |
| Session A streaming 中用户切到 B，B 不在缓存中 | 从 JSONL 加载 B 的历史，显示只读 |
| A streaming 完成，用户还在看 B | 可选：toast 提示"Session A 已完成"，或静默 |
| 快速连续切换 A → B → C | B 的缓存加载可取消（AbortController），只执行最后一次 |
| Pi 在 A idle，用户切到 B | 后台 switchSession(B)，成功后刷新 B 缓存 |
| switchSession 夥败 | 保持在原 session，显示错误 toast，缓存不变 |
| Fork 新 session | Fork 后自动切换到新 session（走 switchSession） |
| New session | 同 Fork，自动切换 |

## 10. 实现顺序

### Phase 1: 基础设施（后端）

1. `session-service.ts` 新增 `parseSessionMessages(filePath)` 方法
2. `main/index.ts` 新增 `session:getMessagesForSession` IPC handler
3. `preload/index.ts` 暴露新 API
4. 提取 `usePiRpc.ts` 中的消息格式转换为共享函数（`convertPiMessagesToChatMessages`），供 `loadHistory` 和 JSONL 加载共用

### Phase 2: 缓存层（renderer 核心）

1. 新建 `useSessionCache.ts` hook
2. 改造 `usePiRpc.ts`：事件路由到缓存而非直接 setMessages
3. `App.tsx`：引入 `useSessionCache`，分离 `displayedSession` 和 `piConnectedSession`

### Phase 3: UI 适配

1. `InputBar.tsx`：只读状态提示 + 自动切换逻辑
2. Header：状态指示（连接 vs 显示）
3. Sidebar：点击行为适配（调用 `displaySession` 而非同步 `switchSession`）

### Phase 4: 边界打磨

1. 错误处理（switchSession 失败、JSONL 解析失败）
2. 缓存清理策略（LRU 或手动）
3. 快速切换的竞态处理
4. `agent_end` 后的自动切换策略

## 11. 未来扩展：Tab UI

本 spec 实现后，Tab UI 是纯 renderer 层的扩展：

- `displayedSession` → `activeTabId`
- `sessionCache` Map → 每个 Tab 一份缓存
- `SessionTabBar` 组件消费 `sessionCache` 的 key 列表
- Tab 关闭 = 从 cache Map 中删除

无需再改 main process 或 Pi worker。

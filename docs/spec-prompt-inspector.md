# Prompt Inspector Spec

## 1. Overview

用户发送消息时，Xi 底层会给 Pi SDK 附加大量不可见内容（system prompt、AGENTS.md、tool definitions、skills、对话历史等），实际发给模型 API 的 payload 远比用户看到的复杂。

**目标**：在每条 assistant 消息旁边提供一个 🔍 按钮，点击后弹出一个面板，展示该轮对话的**完整 API 请求 payload**，让用户透明地理解 AI 收到的上下文。

**核心理念**：Debug 透明度 —— 用户想知道为什么 AI 这样回复？先看看 AI 收到了什么。

## 2. 完整 Prompt 构成

一次 API 调用的完整 payload 包含这些层次：

```
┌──────────────────────────────────────────────────┐
│  HTTP POST /v1/messages                          │
│  ┌──────────────────────────────────────────────┐│
│  │ system: "<Behavior_Instructions>             ││
│  │          <AGENTS.md content>                 ││
│  │          <Tool definitions (JSON schema)>     ││
│  │          <Skill definitions>                 ││
│  │          <Context enrichment>"               ││
│  ├──────────────────────────────────────────────┤│
│  │ messages: [                                  ││
│  │   { role: "user", content: "..." },           ││
│  │   { role: "assistant", content: [...] },      ││
│  │   { role: "user", content: "..." },           ││  ← 对话历史
│  │   ...                                        ││
│  │   { role: "user", content: "当前输入" }       ││  ← 用户消息
│  │ ]                                            ││
│  ├──────────────────────────────────────────────┤│
│  │ tools: [...],          // 可用工具           ││
│  │ model: "claude-sonnet-4-20250514",           ││
│  │ max_tokens: 16384,                           ││
│  │ thinking: { type: "enabled", budget: 16000 } ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

### 2.1 各项来源

| 组件 | 组装者 | 可见性 |
|------|--------|--------|
| System prompt（行为指令） | Pi SDK `system-prompt.js` + `pi-worker.ts` 中 systemPromptOverride | ❌ 不可见 |
| AGENTS.md | Pi SDK resource-loader 自动注入 | ❌ 不可见 |
| Tool definitions（JSON Schema） | Pi SDK 注册的 `createAllToolDefinitions` + custom tools | ❌ 不可见 |
| Skill definitions | Pi SDK skills 系统 | ❌ 不可见 |
| 对话历史 | Pi SDK `buildSessionContext()` 从 JSONL 构建 | ⚠️ 部分可见 |
| 用户当前输入 | `App.tsx` `handleSendPrompt` → pi-worker `session.prompt()` | ✅ 可见 |
| Model / thinking 配置 | pi-worker 中 session state | ⚠️ 当前 model 名可见 |

### 2.2 当前问题

Pi SDK 是黑盒 —— 它在内部组装完整 payload 后直接发 HTTP 请求。GUI 层只收到流式事件（text delta、tool call 等），**拿不到发给 API 的原始 payload**。

## 3. 解决方案：Pi 扩展拦截

### 3.1 Capture 开关（全局，默认关闭）

Prompt capture 是有性能开销的（每次 API 调用都要序列化并追加一行 JSONL），且包含敏感信息。因此设计一个**全局开关**，**默认关闭**。只有用户主动开启后，才会截获 payload。

```
┌─ Settings / General ───────────────────────────────────────┐
│                                                             │
│  Prompt Capture                                     [○ OFF] │
│  Record full API request payloads for debugging.            │
│  When enabled, each assistant message gains a 🔍 button    │
│  to inspect the complete prompt sent to the model.          │
│  ⚠️ Payloads may contain sensitive data (source code,      │
│     file contents). Stored locally only.                   │
│                                                             │
│  Capture Status:  OFF · 0 snapshots stored                 │
│  [🗑 Clear all snapshots]                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

开关状态存储在 `localStorage` key `xi-prompt-capture-enabled`，不需要持久化到 Pi SDK 的 settings，因为这是纯 GUI 侧的行为偏好。

**开关关闭时**：
- `before_provider_request` handler **不执行**（不写入 JSONL）
- ChatView 中**不显示** 🔍 按钮
- 已存储的 snapshots 保留（用户可能需要回头查看），但不再产生新的

**开关开启时**：
- `before_provider_request` handler 开始截获 payload
- ChatView 中 assistant 消息显示 🔍 按钮
- Inspector 可用

### 3.2 核心机制

Pi 的扩展系统提供了 `before_provider_request` 事件，该事件在**每次 HTTP 请求发往模型之前**触发，handler 可以读取并修改完整 payload。

```typescript
// Pi 扩展伪代码（受 toggle 控制）
pi.on('before_provider_request', (ctx) => {
  // 检查 capture 开关
  if (!isCaptureEnabled()) return

  // ctx.payload 包含发往模型 API 的完整请求体
  // 包括: system, messages[], tools[], model, max_tokens, thinking...
  //
  // 自动清理后存入 session JSONL 的 custom entry
  pi.appendEntry('prompt_snapshot', {
    requestId: ctx.requestId,
    timestamp: Date.now(),
    payload: redactSensitiveFields(ctx.payload),
  })

  // 自动清理超出保留数量的旧 snapshot
  pruneOldSnapshots(MAX_SNAPSHOTS_PER_SESSION)
})
```

### 3.3 数据流

```
用户开启 capture 开关
  → GUI 通知 pi-worker: capture_enabled = true

用户发送消息
  → session.prompt(text)
    → Pi SDK 组装完整 prompt
      → before_provider_request 事件触发
        → capture_enabled? 
          → YES: Xi 扩展截获 payload → redact → appendEntry('prompt_snapshot', payload)
          → NO:  跳过
      → HTTP POST → 模型 API
    → agent_start / message_start 事件发回 GUI
      → GUI 收到 message_start 事件（带 requestId）
        → GUI 从 session JSONL 读取对应的 prompt_snapshot entry
          → GUI 缓存 snapshot 到内存
```

### 3.4 存储位置

使用 session JSONL 文件中的 `custom` entry 类型（不发送给 LLM，仅持久化）：

```jsonl
{"type":"custom","key":"prompt_snapshot","value":{"requestId":"msg_xxx","timestamp":1718000000000,"payload":{...}}}
```

每个 prompt_snapshot 通过 `requestId` 与对应的 assistant message 关联。

### 3.5 RPC 命令

在 `pi-worker.ts` 中新增以下 RPC 命令：

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `get_prompt_snapshot` | `requestId: string` | `PromptSnapshot \| null` | 按 requestId 查询完整 payload |
| `set_capture_enabled` | `enabled: boolean` | `success` | 控制 capture 开关 |
| `clear_snapshots` | — | `{ deleted: number }` | 删除当前 session 所有 prompt_snapshot entries |

GUI 通过这些命令按 `requestId` 查询完整的 prompt payload。

## 4. UI 设计

### 4.1 触发位置

在每条 assistant 消息的 hover actions 区域（Copy / Quote / Fork 旁边），新增一个 🔍 按钮：

```
┌──────────────────────────────────────────────────────────┐
│  ξ  This is the assistant's response...                  │
│                                          [📋] [💬] [🔀] [🔍] │
└──────────────────────────────────────────────────────────┘
                                                      ↑
                                              新增按钮
```

### 4.2 检查器面板

点击 🔍 后，从右侧滑入一个抽屉面板，展示该轮对话的完整 API request：

```
┌─ Prompt Inspector ────────────────────── [✕] ────────────┐
│                                                           │
│  📊 Token Stats                                           │
│  ┌───────────────────────────────────────────────────────┐│
│  │  Input:  12,847    Output:  2,341    Total:  15,188  ││
│  │  Cache Read: 8,200   Cache Write: 1,500              ││
│  │  Cost: $0.06                                         ││
│  └───────────────────────────────────────────────────────┘│
│                                                           │
│  ── Filters ───────────────────────────────────────────── │
│  [✓ System Prompt] [✓ Messages] [✓ Tools] [✓ Raw JSON]   │
│                                                           │
│  ── System Prompt (14,823 chars) ──────── [📋 Copy] ───── │
│  ┌───────────────────────────────────────────────────────┐│
│  │ You are "Sisyphus" - Powerful AI Agent...             ││
│  │                                                       ││
│  │ <Role>                                                ││
│  │ You are "Sisyphus" ...                                ││
│  │ ...                                                   ││
│  │ (collapsed: click to expand full system prompt)       ││
│  └───────────────────────────────────────────────────────┘│
│                                                           │
│  ── Messages (6 messages) ─────────────── [📋 Copy] ───── │
│  ┌───────────────────────────────────────────────────────┐│
│  │ [1] user: "fix the bug in login.ts"                   ││
│  │ [2] assistant: "I'll look into the login flow..."     ││
│  │     ├── tool_call: read(path="src/auth/login.ts")     ││
│  │     └── tool_result: "export function login..."       ││
│  │ [3] assistant: "The issue is on line 42..."           ││
│  │     ├── tool_call: edit(path="src/auth/login.ts")     ││
│  │     └── tool_result: "File updated"                   ││
│  │ [4] user: "also check the middleware"                 ││
│  │ [5] assistant: "Looking at middleware.ts..."          ││
│  │ [6] user: "当前输入的消息内容"                         ││  ← 当前
│  └───────────────────────────────────────────────────────┘│
│                                                           │
│  ── Tools (8 tools) ────────────────────── [📋 Copy] ───── │
│  ┌───────────────────────────────────────────────────────┐│
│  │ read    - Read file contents                          ││
│  │ write   - Write/create files                          ││
│  │ edit    - Edit files with search/replace               ││
│  │ bash    - Execute shell commands                      ││
│  │ grep    - Search file contents                        ││
│  │ find    - Find files by pattern                       ││
│  │ ls      - List directory contents                     ││
│  │ searchSessions - Search sessions                      ││
│  └───────────────────────────────────────────────────────┘│
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### 4.3 交互行为

| 操作 | 行为 |
|------|------|
| 默认展开 | System prompt 折叠到前 20 行，Messages 和 Tools 默认展开 |
| 点击 section header | 折叠/展开该 section |
| Copy 按钮（每个 section） | 复制该 section 的原始文本 |
| Copy Raw JSON（底部） | 复制完整原始 JSON payload |
| 过滤器切换 | 显示/隐藏对应 section |
| 关闭按钮 / 点击 backdrop | 关闭检查器 |
| `Escape` | 关闭检查器 |

### 4.4 不同消息的 prompt 差异

用户应该能看到**每轮对话**的 prompt 都是不同的：
- 对话历史在增长
- Compaction 后 system prompt 中会包含摘要
- 不同 session 的 AGENTS.md 可能不同
- Model switch 后 tools 定义可能变化

因此 promp_snapshot 是 **per-request** 存储的，而非全局一份。

## 5. 技术方案

### 5.1 架构分层

```
┌─────────────────────────────────────────────┐
│  GUI (React)                                │
│  ┌───────────────────────────────────────┐  │
│  │  SettingsPanel.tsx (修改)             │  │
│  │  - Capture 开关 (默认 OFF)            │  │
│  │  - 状态显示: snapshot 数量            │  │
│  │  - Clear 按钮                         │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  PromptInspector.tsx (新组件)         │  │
│  │  - 抽屉面板 UI                        │  │
│  │  - Section 折叠/展开                  │  │
│  │  - 复制功能                           │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  ChatView.tsx (修改)                  │  │
│  │  - 新增 🔍 按钮 (仅 capture 开启时)    │  │
│  │  - 管理 inspector open/close state    │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  usePiRpc.ts (修改)                   │  │
│  │  - 新增 getPromptSnapshot() RPC       │  │
│  │  - setCaptureEnabled / clearSnapshots  │  │
│  │  - 缓存 snapshot 到 memory            │  │
│  │  - captureEnabled 状态                │  │
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  Electron Main Process                      │
│  ┌───────────────────────────────────────┐  │
│  │  pi-worker.ts (修改)                  │  │
│  │  - captureEnabled 标志位              │  │
│  │  - 新增 RPC: get_prompt_snapshot       │  │
│  │  - 新增 RPC: set_capture_enabled       │  │
│  │  - 新增 RPC: clear_snapshots           │  │
│  │  - 自动 prune 旧 snapshot             │  │
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  Pi Extension (pi-worker.ts 内联)           │
│  ┌───────────────────────────────────────┐  │
│  │  before_provider_request handler      │  │
│  │  - 检查 captureEnabled                │  │
│  │  - 截获完 payload → redact → 写入    │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 5.2 关键数据类型

```typescript
// prompt_snapshot custom entry 的 value
interface PromptSnapshot {
  requestId: string          // 与 PiAssistantMessage.responseId 对应
  timestamp: number
  payload: {
    system?: string | Array<{ type: 'text'; text: string; cache_control?: object }>
    messages: Array<{
      role: 'user' | 'assistant'
      content: string | Array<{ type: string; text?: string; source?: object }>
    }>
    tools?: Array<{
      name: string
      description: string
      input_schema: object
    }>
    model: string
    max_tokens: number
    thinking?: { type: string; budget_tokens: number }
    metadata?: { user_id?: string }
  }
}
```

### 5.3 Pi 扩展实现

在 `pi-worker.ts` 的 `init()` 函数中，通过 `bindExtensions` 注册扩展事件监听：

```typescript
// === pi-worker.ts 新增代码 ===

const MAX_SNAPSHOTS_PER_SESSION = 20

let captureEnabled = false  // 默认关闭

function isCaptureEnabled(): boolean {
  return captureEnabled
}

function redactSensitiveFields(payload: Record<string, unknown>): Record<string, unknown> {
  // 深拷贝后 redact 敏感字段
  const safe = JSON.parse(JSON.stringify(payload))
  // 移除 API key (部分 provider 会放在 body 中)
  if (typeof safe === 'object' && safe !== null) {
    delete (safe as Record<string, unknown>).api_key
    delete (safe as Record<string, unknown>)['x-api-key']
    // 如果 headers 中包含 authorization，redact
    if (safe.headers && typeof safe.headers === 'object') {
      const h = safe.headers as Record<string, unknown>
      if (h.authorization) h.authorization = 'Bearer <REDACTED>'
      if (h['x-api-key']) h['x-api-key'] = '<REDACTED>'
    }
  }
  return safe
}

function pruneOldSnapshots(): void {
  if (!sessionManager) return
  const entries = sessionManager.getEntries()
  const snapshots = entries
    .map((e, idx) => ({ entry: e, index: idx }))
    .filter(({ entry: e }) => {
      if (e.type !== 'custom') return false
      return (e as { key: string }).key === 'prompt_snapshot'
    })
  // 保留最新的 MAX_SNAPSHOTS_PER_SESSION 个
  if (snapshots.length > MAX_SNAPSHOTS_PER_SESSION) {
    const toRemove = snapshots.slice(0, snapshots.length - MAX_SNAPSHOTS_PER_SESSION)
    for (const { entry } of toRemove) {
      sessionManager.removeEntry(entry.id)
    }
  }
}

// 在 bindSession() 中注册
await session.bindExtensions({
  before_provider_request: (ctx: { requestId: string; payload: Record<string, unknown> }) => {
    if (!captureEnabled) return

    sessionManager?.appendEntry({
      type: 'custom',
      key: 'prompt_snapshot',
      value: {
        requestId: ctx.requestId,
        timestamp: Date.now(),
        payload: redactSensitiveFields(ctx.payload),
      },
    })

    // 异步清理旧 snapshot（不阻塞 HTTP 请求）
    setImmediate(() => pruneOldSnapshots())
  },
})
```

> ⚠️ **兼容性检查**：需要在 Pi SDK 中验证 `bindExtensions` 是否支持 `before_provider_request` 事件注册。如果 SDK 的 bindExtensions API 不支持直接注册，可能需要通过 extension 文件方式加载。这个需要在实际开发时确认 Pi SDK 的具体 API。

> ⚠️ **`removeEntry` API**：需要确认 Pi SDK 的 SessionManager 是否支持删除 JSONL 中的单条 entry。如果不支持，prune 逻辑需要改为：在 `before_provider_request` handler 中读满 20 条后，标记最旧的一条为逻辑删除，GUI 查询时自动跳过。

### 5.4 RPC 命令实现

在 `pi-worker.ts` 的 `handleCommand` 中新增：

```typescript
case 'get_prompt_snapshot': {
  const requestId = cmd.requestId as string
  const entries = sessionManager?.getEntries() ?? []
  const snapshot = entries.find((e) => {
    if (e.type !== 'custom') return false
    const custom = e as { type: 'custom'; key: string; value: PromptSnapshot }
    return custom.key === 'prompt_snapshot' && custom.value.requestId === requestId
  })
  send({
    channel: 'response',
    id: cmd.id,
    command: 'get_prompt_snapshot',
    success: true,
    data: snapshot ? (snapshot as { value: PromptSnapshot }).value : null,
  })
  break
}

case 'set_capture_enabled': {
  captureEnabled = cmd.enabled === true
  send({
    channel: 'response',
    id: cmd.id,
    command: 'set_capture_enabled',
    success: true,
    data: { enabled: captureEnabled },
  })
  break
}

case 'clear_snapshots': {
  const entries = sessionManager?.getEntries() ?? []
  let deleted = 0
  for (const e of entries) {
    if (e.type === 'custom' && (e as { key: string }).key === 'prompt_snapshot') {
      sessionManager?.removeEntry(e.id)
      deleted++
    }
  }
  send({
    channel: 'response',
    id: cmd.id,
    command: 'clear_snapshots',
    success: true,
    data: { deleted },
  })
  break
}

case 'get_capture_status': {
  const entries = sessionManager?.getEntries() ?? []
  const count = entries.filter((e) => {
    if (e.type !== 'custom') return false
    return (e as { key: string }).key === 'prompt_snapshot'
  }).length
  send({
    channel: 'response',
    id: cmd.id,
    command: 'get_capture_status',
    success: true,
    data: { enabled: captureEnabled, snapshotCount: count },
  })
  break
}
```

### 5.5 GUI 数据流

```typescript
// 在 usePiRpc 中新增
const promptSnapshots = useRef<Map<string, PromptSnapshot>>(new Map())

const getPromptSnapshot = useCallback(async (requestId: string): Promise<PromptSnapshot | null> => {
  // 先查缓存
  if (promptSnapshots.current.has(requestId)) {
    return promptSnapshots.current.get(requestId)!
  }
  // 通过 RPC 查询
  const result = await window.api.getPromptSnapshot(sessionPath, requestId)
  if (result) {
    promptSnapshots.current.set(requestId, result)
  }
  return result
}, [])
```

## 6. 文件变更清单

| 文件 | 变更 | 说明 |
|------|------|------|
| `src/main/pi-worker.ts` | 修改 | 1) 注册 `before_provider_request` 扩展（带 toggle 检查）；2) 新增 `get_prompt_snapshot` / `set_capture_enabled` / `clear_snapshots` / `get_capture_status` RPC 命令；3) 自动 prune 逻辑 |
| `src/main/index.ts` | 修改 | 新增 IPC handler 路由到 worker |
| `src/preload/index.ts` | 修改 | 暴露 `getPromptSnapshot()` / `setCaptureEnabled()` / `clearSnapshots()` / `getCaptureStatus()` 到 renderer |
| `src/renderer/src/components/PromptInspector.tsx` | **新增** | 检查器抽屉面板，包含 section 折叠、复制、token 统计 |
| `src/renderer/src/components/ChatView.tsx` | 修改 | 在 assistant 消息 actions 中新增 🔍 按钮（仅 capture 开启时显示）；管理 inspector 状态 |
| `src/renderer/src/components/SettingsPanel.tsx` | 修改 | 新增 "Prompt Capture" toggle switch + 状态显示 + Clear 按钮 |
| `src/renderer/src/hooks/usePiRpc.ts` | 修改 | 新增 `getPromptSnapshot()` / `setCaptureEnabled()` / `clearSnapshots()` / `captureEnabled` state |
| `src/renderer/src/types/pi-events.ts` | 修改 | 新增 `PromptSnapshot` 类型定义 |
| `docs/spec-prompt-inspector.md` | **新增** | 本 spec |

## 7. 分阶段实现

### Phase 1: 核心链路 (MVP)

- [ ] Pi 扩展：`before_provider_request` handler（不做 toggle 检查，先写死开启用于调试）
- [ ] RPC 命令：`get_prompt_snapshot` 查询
- [ ] IPC + preload 桥接
- [ ] `PromptInspector.tsx` 基础组件：展示 raw JSON payload
- [ ] ChatView 中 🔍 按钮触发 inspector

**目标**：端到端跑通，能点击按钮看到 raw JSON。

### Phase 2: 开关 & 清理

- [ ] SettingsPanel 中新增 "Prompt Capture" toggle（默认 OFF）
- [ ] `localStorage` 持久化 `xi-prompt-capture-enabled`
- [ ] RPC：`set_capture_enabled` + `get_capture_status` + `clear_snapshots`
- [ ] SettingsPanel 中显示当前 snapshot 数量 + Clear 按钮
- [ ] `before_provider_request` handler 检查 toggle 状态
- [ ] ChatView 中 🔍 按钮仅 capture 开启时渲染
- [ ] 自动 prune：超出 `MAX_SNAPSHOTS_PER_SESSION` 时清理最旧的

**目标**：用户可以控制 capture 开关，可以清理 snapshot 数据。

### Phase 3: 格式化展示

- [ ] Section 折叠/展开（System Prompt / Messages / Tools）
- [ ] Token 统计条
- [ ] 各 section 的 Copy 按钮
- [ ] 消息列表美化渲染（区分 user/assistant/tool_call/tool_result）
- [ ] System prompt 默认折叠到前 20 行
- [ ] Tools 表格展示（name + description）

### Phase 4: 体验打磨

- [ ] 过滤器切换（显示/隐藏 section）
- [ ] 抽屉滑入/滑出动画
- [ ] 深色模式适配
- [ ] Escape 关闭
- [ ] Per-request snapshot 缓存优化（限制缓存数量，避免内存泄漏）
- [ ] prompt_snapshot 存储大小限制（超过 500KB 的 payload 裁剪 tool definitions）

## 8. 边界情况

| 场景 | 处理 |
|------|------|
| Capture 默认关闭 | `before_provider_request` handler 不写入；ChatView 不显示 🔍 按钮 |
| 用户开启 capture 后又关闭 | 已存储的 snapshots 保留，不再产生新的。SettingsPanel 显示存量数量 |
| 用户点击 Clear | 删除当前 session 所有 `prompt_snapshot` custom entries。SettingsPanel 数量归零。不可恢复 |
| Pi SDK 版本不支持 `before_provider_request` | 降级：仅显示 GUI 侧能拿到的信息（用户消息 + 对话历史），inspector 中标注"完整 system prompt 不可用"。SettingsPanel 中 capture toggle 置灰并标注"SDK not supported" |
| JSONL 中无对应 snapshot（旧消息） | inspector 中显示 "Prompt snapshot not available (generated before capture was enabled)" |
| Payload 过大（>1MB） | 默认折叠 system prompt 和 tools，显示字符数统计，提供 "Copy Raw JSON" 按钮 |
| 连续快速发送消息 | 每个 request 独立存储 snapshot，通过 requestId 精确匹配 |
| Session 切换 | 切换 session 时清空 promptSnapshots 内存缓存；capture toggle 状态不变（全局） |
| Compaction 后的消息 | Compaction 后的 prompt 会包含摘要，snapshot 如实记录 |
| Streaming 中的消息 | 只有 `agent_end` 后才生成完整 snapshot（因为 `before_provider_request` 在请求时触发），streaming 中不可查看 |
| 扩展注册失败 | 静默失败，不影响正常对话功能。Inspector 显示 "Prompt capture unavailable" |
| 超过 MAX_SNAPSHOTS_PER_SESSION (20) | 自动删除最旧的 snapshot。SettingsPanel 中始终显示 `≤20` |
| 用户清除全局设置 | `localStorage` 中清除 `xi-prompt-capture-enabled` 后，下次启动默认 OFF |

## 9. 性能考量

### 9.1 存储

- 每个 prompt_snapshot 约 50KB - 200KB（取决于对话历史长度和 tools 数量）
- Session JSONL 文件会增长，但 prompt_snapshot 是 custom entry，不会发送给 LLM
- 建议：每个 session 最多保留最近 **20 个** snapshot，超出部分在写入新 snapshot 时自动清理旧条目

### 9.2 内存

- GUI 端 `promptSnapshots` Map 缓存当前 session 的 snapshot
- 切换 session 时清空
- 单次最多展示 1 个 snapshot（当前点击的那条消息）

### 9.3 不影响对话性能

- `before_provider_request` handler 是同步写入 JSONL（追加一行），不阻塞 HTTP 请求
- Prompt snapshot 的 appendEntry 和 HTTP 请求是并行的

## 10. 安全考量

> ⚠️ **重要**：prompt_snapshot 的 payload 可能包含敏感信息：
> - API key（如果 provider 把 key 放在请求 body 中）
> - 项目源代码（对话历史和 tool results 中）
> - 用户个人数据
>
> **缓解措施**：
> - `before_provider_request` handler 在存储前自动 redact API key 字段（`payload.api_key`、`payload.headers` 等）
> - 提示用户：Inspector 中的内容**只存储在本地**，不会上传
> - 未来可加：一键清除所有 snapshot

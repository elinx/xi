# Spec: Session Summary（会话摘要）

## 背景

Xi 的 session 是树形结构。用户在不同 session 中完成不同任务，每个 session 积累了有价值的上下文——做了什么、改了哪些文件、遇到了什么问题。但当用户 fork 出新 session 或创建子 session 时，新 session 对祖先的历史一无所知，agent 只能从当前对话和文件系统推断上下文。

核心问题：**跨 session 的上下文断层**。agent 的记忆被局限在当前 session 内，无法继承祖先的决策历史。

## 目标

1. 用户可以为任意 session 生成摘要（`/summary` 命令或 mark completed 时自动触发）
2. 摘要作为元数据持久化在 JSONL 中，独立于对话消息
3. 新 session 启动时，沿 parentSession 链回溯祖先摘要，注入 system prompt 作为上下文
4. 摘要在 ChatView 中有独立样式（SessionSummaryCard），不在对话流中
5. 用户可以编辑摘要

## 设计

### 1. 存储格式

复用现有 `session_info` entry 的 append-only 机制，新增 `summary` 字段。与 `name`、`status`、`parentSession` 同一套规则：**最后的 `session_info` entry 中的 `summary` 字段生效**。

```jsonl
{"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}
{"type":"message","id":"...","message":{"role":"user","content":"帮我实现 fork 功能"}}
{"type":"message","id":"...","message":{"role":"assistant","content":[...]}}
...
{"type":"session_info","name":"feat-fork"}
{"type":"session_info","status":"completed"}
{"type":"session_info","summary":"实现了 session 侧边栏的 fork 功能，包括 ForkPopover 组件、fork RPC 调用、fork_point 记录。修改了 SessionSidebar.tsx、usePiRpc.ts、session-service.ts。已知问题：fork 后偶现消息丢失。"}
```

编辑摘要时，append 一条新的 `session_info` entry，`summary` 字段为编辑后的内容，last wins。

**为什么不新增 entry type**：`session_info` 已经是通用的元数据容器，`name`/`status`/`parentSession` 都用同一套 append-only + last-wins 机制。加 `summary` 字段自然延续这个模式，不需要新增 type，也不需要修改 `parseSessionFile` 的 entry 分支逻辑——只需在已有的 `session_info` 处理中多解析一个字段。

### 2. 类型变更

```typescript
// session.ts — SessionInfo
interface SessionInfo {
  filePath: string
  sessionId: string
  name: string | null
  createdAt: string
  cwd: string
  parentSessionPath: string | null
  messageCount: number
  isMain: boolean
  status: 'active' | 'completed' | null
  summary: string | null          // 新增：会话摘要
}
```

### 3. 触发机制

#### 3.1 `/summary` 命令（手动触发）

用户在 InputBar 中输入 `/summary`，前端拦截后替换为一条摘要请求 prompt，走正常 agent loop：

```
用户输入: /summary
  → InputBar handleSubmit 检测到 /summary 前缀
  → 拦截，替换为摘要请求 prompt
  → 走正常 sendPrompt 流程
  → agent 回复摘要内容
```

替换后的 prompt：

```
请为当前会话生成一段摘要，涵盖以下方面（如果适用）：
1. 用户意图：用户想要完成什么
2. 主要操作：做了哪些关键实现或修改
3. 涉及文件：修改或创建了哪些文件
4. 已知问题：未解决的问题或待办事项
请保持简洁，200字以内。只输出摘要内容，不要使用工具。
```

**为什么走 agent loop**：agent 拥有完整的对话上下文，包括工具调用结果、文件变更历史。自己组消息做裸 LLM 调用需要重新构造上下文，且无法复用 Pi 已有的 provider 配置和 streaming 机制。走 agent loop 是最简单、最可靠的路径。

**"不要使用工具"指令**：防止 agent 在生成摘要时去执行 read/grep 等操作，浪费时间和 token。摘要应基于 agent 已有的对话记忆生成。

#### 3.2 Mark Completed 自动触发

用户将 session 标记为 completed 时，如果该 session 尚无摘要，自动触发摘要生成：

```
用户点击 "Mark as completed"
  → setSessionStatus(sessionPath, 'completed')
  → 检查 session.summary 是否为 null
  → 如果没有摘要，自动发送摘要请求 prompt
  → agent 回复摘要内容
```

如果已有摘要，不重复生成。用户可以用 `/summary` 手动更新。

**实现位置**：在 `setSessionStatus` IPC handler 中，状态变为 `completed` 后，检查摘要并自动发 prompt。具体地，main process 在完成 status 写入后，通过 `piBridge.sendRpcCommand({ type: 'prompt', message: SUMMARY_PROMPT })` 发送。

### 4. 摘要持久化

agent 的摘要回复出现在对话流中（作为一条普通 assistant message），同时需要将内容写入 `session_info.summary`。

**方案：前端回写**

前端跟踪"当前是否在等待摘要回复"。当检测到 agent 回复完成后，提取回复文本，调用 IPC 写入 JSONL：

```
用户发送 /summary（或 mark completed 触发）
  → 前端设置 pendingSummaryRef = true
  → agent 回复完成（agent_end 事件）
  → 如果 pendingSummaryRef 为 true：
      1. 取最后一条 assistant message 的文本内容
      2. 调用 IPC: session:setSessionSummary(sessionPath, summaryText)
      3. pendingSummaryRef = false
      4. refresh() 刷新 session 列表
```

**为什么选前端回写而不是 extension hook**：

1. 前端知道用户发了 `/summary`（因为 InputBar 拦截时设置了标志），不需要在 extension 中做复杂的"上一条 user message 是不是摘要请求"的匹配
2. 前端有最后一条 assistant message 的文本内容（在 `messages` state 中），直接取用
3. IPC 回写是纯文件操作（`appendFileSync`），可靠、同步

**IPC 通道**：

```typescript
// 新增 IPC
session:setSessionSummary(sessionPath: string, summary: string) → { success: boolean; error?: string }
```

**session-service 新增函数**：

```typescript
export function setSessionSummary(sessionPath: string, summary: string): boolean {
  if (!existsSync(sessionPath)) return false
  try {
    const entry = JSON.stringify({ type: 'session_info', summary })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}
```

与 `nameSession()`、`setSessionStatus()`、`reparentSession()` 完全同构。

### 5. parseSessionFile 扩展

在 `parseSessionFile` 已有的 `session_info` 处理逻辑中，新增 `summary` 字段解析：

```typescript
// 已有逻辑（简化）：
for (let i = 1; i < lines.length; i++) {
  const entry = JSON.parse(lines[i])
  if (entry.type === 'session_info') {
    if (typeof entry.name === 'string') name = entry.name
    if (entry.status === 'active' || entry.status === 'completed') status = entry.status
    if ('parentSession' in entry) parentSessionPath = ...
    // 新增：
    if (typeof entry.summary === 'string') summary = entry.summary
  }
}
```

Last wins 语义与 `name`/`status` 完全一致。

### 6. UI：SessionSummaryCard

摘要不在对话消息流中渲染。ChatView 中在消息列表上方显示一个独立的 **SessionSummaryCard** 组件。

#### 6.1 位置与样式

```
┌──────────────────────────────────────────────────────┐
│ ChatView                                             │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 📋 Session Summary                          [✏️] │ │
│ │ ──────────────────────────────────────────────── │ │
│ │ 实现了 session 侧边栏的 fork 功能，包括          │ │
│ │ ForkPopover 组件、fork RPC 调用。                 │ │
│ │ 修改文件: SessionSidebar.tsx, session-service.ts  │ │
│ │ 已知问题: fork 后偶现消息丢失                     │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────┐ │
│ │ [User message]                                   │ │
│ └──────────────────────────────────────────────────┘ │
│ ...                                                  │
└──────────────────────────────────────────────────────┘
```

- **位置**：消息列表顶部，`max-w-2xl` 容器内，第一条消息之前
- **背景**：`bg-amber-50 border border-amber-200`（暖色调，与 user 的蓝色、assistant 的白色区分）
- **图标**：📋 + "Session Summary" 标题
- **编辑按钮**：✏️，点击进入编辑模式（textarea）
- **条件显示**：仅当 `currentSession?.summary` 不为 null 时显示
- **Props 来源**：`currentSession.summary`，从 `useSessionManager` 的 `currentSession` 获取

#### 6.2 编辑交互

点击 ✏️ → 摘要文本变为 textarea，预填当前内容 → 用户编辑 → 点击 ✓ 保存 / ✗ 取消 → 保存时调用 IPC `session:setSessionSummary` → refresh session 列表。

#### 6.3 无摘要时

不显示 SessionSummaryCard。ChatView 顶部直接是消息列表，与当前行为一致。

### 7. 祖先链上下文注入

新 session 启动时，沿 `parentSessionPath` 向上遍历，收集所有祖先的摘要，注入 system prompt。

#### 7.1 数据收集

在 `pi-worker.ts` 的 `createRuntime` 工厂函数中，初始化时收集一次祖先上下文，缓存起来：

```typescript
// createRuntime 中
const ancestorPreamble = buildAncestorPreamble(sm.getSessionFile())

appendSystemPromptOverride: (base: string[]) => {
  return [...base, 'CRITICAL: You are Xi...', ancestorPreamble].filter(Boolean)
}
```

`buildAncestorPreamble` 实现：

```typescript
function buildAncestorPreamble(sessionFilePath: string): string {
  const sessionDir = dirname(sessionFilePath)
  const chain: Array<{ name: string; summary: string }> = []
  let currentPath: string | null = sessionFilePath
  const visited = new Set<string>()
  const MAX_DEPTH = 5

  while (currentPath && chain.length < MAX_DEPTH) {
    if (visited.has(currentPath)) break  // 防环
    visited.add(currentPath)
    
    const info = parseSessionFile(currentPath)
    if (!info) break
    
    // 跳过自己，只收集祖先
    if (currentPath !== sessionFilePath && info.summary) {
      chain.push({ name: info.name || 'unnamed', summary: info.summary })
    }
    
    currentPath = info.parentSessionPath
  }

  if (chain.length === 0) return ''
  
  // 从根到父排列
  chain.reverse()
  
  const lines = chain.map((item, i) => `${i + 1}. "${item.name}": ${item.summary}`)
  return `\n\n## Ancestor Session History\nYou are continuing work from previous sessions. Here is what was done before:\n${lines.join('\n')}`
}
```

#### 7.2 Token 预算

- 每个祖先摘要：~200-500 字符 ≈ 50-125 tokens
- 典型深度：2-4 层
- 上限：5 层 × 200 tokens = 1000 tokens
- 相对总 prompt 用量（通常 10万+ tokens），开销可忽略

#### 7.3 system prompt 不会累积

`appendSystemPromptOverride` 每次调用返回的是**固定内容**，不是追加。祖先上下文在 `createRuntime` 时收集一次，后续每次 LLM 请求都注入同样的 preamble。不会随对话轮次增长。

#### 7.4 无摘要的祖先

如果祖先 session 没有摘要，该祖先在链路中被跳过。preamble 只包含有摘要的祖先。信息可能稀薄，但这正是需要 `/summary` 和 mark completed 触发生成的原因——鼓励用户为重要 session 生成摘要。

### 8. 侧边栏增强

Session 节点 hover 时，tooltip 显示摘要预览：

```
┌─────────────────────────────────────┐
│ feat-fork                           │
│ ─────────────────────────────────── │
│ 实现了 session 侧边栏的 fork 功能，  │
│ 包括 ForkPopover 组件、fork RPC...  │
│                                     │
│ 3 messages · 2h ago                 │
└─────────────────────────────────────┘
```

有摘要时显示摘要预览（截断到 100 字符），无摘要时不显示额外内容。

### 9. 数据流

#### 9.1 /summary 触发流

```
1. 用户在 InputBar 输入 "/summary"
2. InputBar handleSubmit 检测到 /summary
3. 替换为 SUMMARY_PROMPT，调用 onSend(summaryPrompt)
4. handleSendPrompt → sendPrompt(sessionPath, summaryPrompt)
5. pi-worker 收到 prompt 命令 → agent 开始回复
6. 前端设置 pendingSummaryRef = true
7. agent 回复完成 → agent_end 事件
8. 前端检测到 pendingSummaryRef === true
9. 取最后一条 assistant message 的文本内容
10. 调用 IPC: session:setSessionSummary(sessionPath, summaryText)
11. pendingSummaryRef = false
12. refresh() → SessionInfo.summary 更新 → SessionSummaryCard 显示
```

#### 9.2 Mark Completed 触发流

```
1. 用户右键 session → "Mark as completed"
2. 前端调用 setSessionStatus(sessionPath, 'completed')
3. IPC handler: setSessionStatus() 写入 JSONL
4. IPC handler: 检查 session 是否有摘要
5. 如果没有摘要：
   a. 通过 piBridge.sendRpcCommand 发送 SUMMARY_PROMPT
   b. 前端设置 pendingSummaryRef = true
   c. 后续同 /summary 流程的步骤 7-12
6. 如果已有摘要：跳过
7. 返回 { success: true }
```

#### 9.3 祖先上下文注入流

```
1. pi-worker init() 或 newSession/switchSession
2. createRuntime 被调用
3. buildAncestorPreamble(sm.getSessionFile())
   → 读取当前 session 的 parentSessionPath
   → parseSessionFile(parentPath) → 获取 summary
   → 沿链向上遍历，最多 5 层
   → 组装 preamble 文本
4. appendSystemPromptOverride 使用缓存的 preamble
5. 每次 LLM 请求，preamble 随 system prompt 一起发送
```

### 10. IPC 通道变更

| 通道 | 方向 | Payload | 说明 |
|------|------|---------|------|
| `session:setSessionSummary` | renderer → main | `sessionPath: string, summary: string` | 写入摘要到 JSONL |

新增 1 个 IPC 通道，无 RPC 变更。

### 11. 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/renderer/src/types/session.ts` | 修改 | `SessionInfo` 加 `summary: string \| null`；`SessionIpcApi` 加 `setSessionSummary` |
| `src/main/session-service.ts` | 修改 | 新增 `setSessionSummary()`；`parseSessionFile()` 解析 `summary` 字段 |
| `src/main/index.ts` | 修改 | 新增 `session:setSessionSummary` IPC handler；`setSessionStatus` handler 中加自动触发逻辑 |
| `src/preload/index.ts` | 修改 | 新增 `setSessionSummary` API |
| `src/main/pi-worker.ts` | 修改 | 新增 `buildAncestorPreamble()`；`appendSystemPromptOverride` 注入 preamble |
| `src/renderer/src/components/InputBar.tsx` | 修改 | `handleSubmit` 中检测 `/summary` 前缀并替换 |
| `src/renderer/src/components/ChatView.tsx` | 修改 | 新增 `SessionSummaryCard` 组件；ChatView 顶部条件渲染 |
| `src/renderer/src/hooks/useSessionManager.ts` | 修改 | 新增 `setSessionSummary` 方法 |
| `src/renderer/src/hooks/usePiRpc.ts` 或 `src/renderer/src/App.tsx` | 修改 | `pendingSummaryRef` 逻辑 + agent_end 后回写摘要 |
| `src/renderer/src/components/SessionSidebar.tsx` | 修改 | session 节点 tooltip 显示摘要预览 |

### 12. 边界情况

| 场景 | 处理 |
|------|------|
| `/summary` 时 session 无消息 | agent 基于空对话生成摘要，摘要可能为空或"无内容"——正常行为 |
| mark completed 时 session 正在 streaming | 不自动触发摘要生成，等 streaming 结束后再发 prompt；或者直接跳过，用户可以后续手动 `/summary` |
| agent 摘要回复中包含 markdown 格式 | 正常保留，摘要存储为纯文本，渲染时按 markdown 解析 |
| 祖先链中有环（数据损坏） | `visited` Set 防环，已处理 |
| 祖先链超过 5 层 | 截断到最近 5 层祖先 |
| 编辑摘要后立即 edit 再 edit | 每次 append 新 entry，last wins，无冲突 |
| `/summary` 后又 mark completed | 已有摘要，不重复生成 |
| mark completed 后又 mark active | 摘要保留，不删除 |
| 多次 `/summary` | 每次覆盖前一次摘要（last wins） |
| agent 回复摘要时使用了工具 | prompt 中有"不要使用工具"指令，但 agent 可能忽略。可接受——摘要质量反而可能更好 |
| 摘要超过 token 预算 | `buildAncestorPreamble` 中按字符数截断每个摘要（如 max 500 字符/条） |

### 13. 未来扩展

1. **分级摘要**：短摘要（1 句话，用于侧边栏 tooltip）+ 长摘要（几段，用于上下文注入），按需取用
2. **自动摘要索引**：`search_sessions` tool 搜索时优先匹配 summary 字段，加速搜索
3. **RAG 式上下文注入**：不只回溯祖先链，还根据当前 session 的第一个 user message，用 `search_sessions` 搜索相关 session 的摘要
4. **摘要质量评估**：显示摘要的 token 数和覆盖度（如"覆盖 47 条消息中的关键信息"）

# Spec: Context-Full Auto-Branch（上下文满时自动分叉）

## 1. 动机

Xi 的哲学是 "session as branch" —— 上下文不够了就分叉，不压缩。但当前缺少自动触发机制：用户在 main session 里聊到 context 满，Pi SDK 会自动 compact（摘要压缩），这违背了 Xi 的设计理念。

**目标**：context 接近满时，弹出对话框让用户选择分支方向。每个分支按目的做选择性压缩，trunk 完整保留。

**与 compaction 的区别**：

| | Compaction | Auto-Branch |
|---|---|---|
| 信息损失 | 有，摘要必然丢细节 | 无，trunk 完整保留 |
| 用户控制 | 无感，被动 | 有选择权，主动 |
| 压缩质量 | 通用摘要，什么都留一点 | 按目的裁剪，只带相关上下文 |
| Xi 哲学 | "compress and continue" | "branch and choose" |

## 2. 核心概念

### 2.1 触发条件

**自动触发**：当 session 的 token 使用量达到 context window 的 **80%** 时触发（阈值可配置）。

```
contextUsage = tokenUsage.totalTokens / tokenUsage.contextWindowSize
if contextUsage >= 0.80 && !branchDialogShown:
    showBranchDialog(trigger='auto')
```

**手动触发**：用户可以随时主动打开分支对话框，不依赖 token 用量。点击 TokenUsageRing、按 `Cmd/Ctrl+B`、或通过 Command Palette 均可触发。

**为什么 80% 自动触发**：
- 低于 80% 太早打扰用户
- 高于 90% 可能来不及——下一轮对话就超限了
- 留 20% 的余量给分支创建后的第一轮对话
- dismiss 后不设死区——每轮 message_end 重新检查，因为 80% 的 trunk 下一轮就可能超限

**手动触发不设门槛**——即使用户只有几条消息，也可以主动分支。比如用户想拆分任务、并行探索不同方案，不需要等到 context 满。

### 2.2 分支建议生成

AI 分析当前 session 的对话历史，提取 2-4 个自然的后续方向。

**关键约束：分析和裁剪使用独立模型调用，不走 session 上下文。**

session 已 80% 满时，在 session 上下文上叠加分析请求会直接超限。因此 `analyze_branch_directions` 和 `create_branch` 中的分类/摘要操作都使用独立的模型调用——从 JSONL 读取消息构建 prompt，而非走 `session.complete()`。

**分析输入**：
- session 的所有 user messages（提取用户意图）
- session 的所有 assistant text blocks（提取讨论主题）
- tool calls 的 toolName 列表（提取做了什么操作）
- session summary（如果已有）

**生成 prompt**（独立调用，不经过 session）：

```
你是一个对话分析助手。以下是当前 session 的对话摘要：

{session_summary}

用户消息列表：
{user_messages_outline}

工具调用列表：
{tool_calls_outline}

请分析这个 session 的对话，提取 2-4 个自然的后续工作方向。每个方向包括：
1. title: 简短标题（5-10 个字）
2. description: 一句话描述这个方向要做什么
3. purpose: 用于上下文裁剪的目的说明（给裁剪 AI 看的）

输出 JSON 数组格式。
```

**输出示例**：

```json
[
  {
    "title": "继续实现功能 X",
    "description": "在当前架构基础上完成剩余的实现工作",
    "purpose": "保留与功能 X 实现相关的所有上下文：架构决策、已完成的代码、待完成的 TODO"
  },
  {
    "title": "处理测试和边界情况",
    "description": "为已实现的代码编写测试，处理边界情况",
    "purpose": "保留测试相关的讨论和已实现代码的接口信息，丢弃实现细节"
  },
  {
    "title": "重构现有代码",
    "description": "基于当前的架构讨论重构现有代码",
    "purpose": "保留架构讨论和代码结构信息，丢弃具体实现过程"
  }
]
```

### 2.3 选择性压缩

用户选择一个分支方向后（或自定义方向），AI 按 purpose 对 trunk 的消息做选择性裁剪。

**无压缩分支选项**：如果手动触发且 context 用量低于 50%，对话框顶部提供 "完整复制（不裁剪）" 快捷按钮——直接复制 trunk 的所有消息到新 session，跳过 AI 分类和摘要。用户主动分叉时往往不需要裁剪。

**消息分类**：

| 类别 | 处理 | 保留比例 |
|------|------|---------|
| **必带** | 完整保留原始消息 | ~20% |
| **摘要带** | 压缩成一条摘要消息 | ~30% |
| **不带** | 丢弃 | ~50% |

**Tool call / tool result 不可分割规则**：

`tool_call` 和对应的 `tool_result` 是一对，必须作为整体 keep 或 drop。裁剪 AI 分类时不能拆散：

- keep `tool_call` → 必须 keep 对应的 `tool_result`
- drop `tool_call` → 必须 drop 对应的 `tool_result`
- 如果 pair 太大需要压缩，整对一起放入 summarize

裁剪 prompt 中明确提示：

```
重要规则：tool_call 和其对应的 tool_result 是一对，不能拆散。
如果 keep 一个 tool_call，必须 keep 它的 tool_result。
如果 drop 一个 tool_call，必须 drop 它的 tool_result。
```

**裁剪 prompt**（独立调用，不经过 session）：

```
你是一个上下文裁剪助手。

分支目的：{branch_purpose}

以下是当前 session 的消息列表（每条消息有编号和摘要）：

{messages_outline}

请为每条消息分类为 "keep"（必带）、"summarize"（摘要带）、"drop"（不带）。

分类标准：
- keep: 与分支目的直接相关的消息（架构决策、关键代码、用户明确要求）
- summarize: 间接相关的消息（背景信息、中间过程、已完成的子任务）
- drop: 无关的消息（闲聊、已废弃的方案、重复信息）

输出 JSON：{ "keep": [msg_id, ...], "summarize": [msg_id, ...], "drop": [msg_id, ...] }
```

**压缩后的 session 结构**：

```
新 session = [
  一条 system message：说明这是从 trunk 分叉的 session，分支目的：{purpose}
  一条 summary message：summarize 类消息的合并摘要
  keep 类消息：按原始顺序完整保留
  ← 用户从这继续对话
]
```

### 2.4 分支预览

用户选择一个方向后，创建前先显示预览，让用户确认哪些消息被保留、哪些被摘要、哪些被丢弃。

```
┌─────────────────────────────────────────────────────┐
│  🌿 分支预览：继续实现功能 X                            │
│                                                     │
│  上下文裁剪结果：                                      │
│  ✅ 保留 8 条消息（42%）                               │
│  📝 摘要 12 条消息（31%）                              │
│  ❌ 丢弃 15 条消息（27%）                              │
│                                                     │
│  预计新 session 大小：~35% context window             │
│                                                     │
│  [展开查看详情 ▾]                                      │
│                                                     │
│  [创建分支]            [返回修改]                       │
└─────────────────────────────────────────────────────┘
```

展开后显示消息列表，每条标注 keep / summarize / drop。用户可以手动覆盖分类（比如把 drop 改成 keep）。

预览步骤需要额外一次 AI 调用（分类），但避免了创建后才发现重要上下文丢失的问题。

### 2.5 Trunk 的处理

分支创建后，trunk（原 session）标记为 `branched` 状态：

```
SessionInfo.status: 'active' → 'branched'
```

- `branched` 状态的 session 在 sidebar 中显示一个分支图标
- 用户可以继续在 trunk 里对话（status 改回 `active`），但不会再次触发 auto-branch（除非 token 再次达到 80%）
- trunk 的完整消息不会被修改、不会被压缩

## 3. UI 设计

### 3.1 触发时机

**自动触发**：当 `message_end` 事件返回 token usage，且 `totalTokens / contextWindowSize >= 0.80` 时：

1. 如果当前 session 已经触发过且用户选择了分支，不重复触发
2. 如果当前 session 已触发过但用户选择了 "继续在 trunk"，**每轮 message_end 都重新检查**——不设 90% 死区，只要还在 80% 以上就再次弹出。因为 trunk 仍然 80% 满，下一轮对话可能就超限了。

**Dismiss 后的持续警告**：用户 dismiss 对话框后，InputBar 上方显示持续警告条："Context is 85% full. Branch to continue with a clean context. [Branch] [Dismiss]"，直到 token 降到 80% 以下或用户创建分支。不静默等待——让用户始终意识到 context 快满了。

**手动触发**：用户可以随时主动打开分支对话框，不依赖 token 用量。

| 触发方式 | 说明 |
|---------|------|
| Token ring 点击 | 点击 TokenUsageRing（任何百分比都可点击） |
| 快捷键 `Cmd/Ctrl+B` | 在 session tab 中按下打开分支对话框 |
| Command Palette | 输入 "branch" 找到 "Branch Session" 命令 |

手动触发时，对话框标题不显示 "Context is getting full"，而是 "Branch Session"——不制造紧迫感，用户只是想主动分叉。

### 3.2 分支选择对话框

对话框是一个可编辑的方向列表——AI 建议方向，用户可以删除不想要的、添加自己的，然后选一个创建分支。

**自动触发时**（context ≥ 80%）：

```
┌─────────────────────────────────────────────────────┐
│  🌿 Context is getting full                          │
│                                                     │
│  This session has used 82% of the context window.  │
│  Choose a direction to branch into a new session:   │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │ 🔀 继续实现功能 X                           [×] ││
│  │    在当前架构基础上完成剩余的实现工作                  ││
│  │                                              [✏] ││
│  ├─────────────────────────────────────────────────┤│
│  │ 🧪 处理测试和边界情况                         [×] ││
│  │    为已实现的代码编写测试，处理边界情况                ││
│  │                                              [✏] ││
│  ├─────────────────────────────────────────────────┤│
│  │ 🔧 重构现有代码                             [×] ││
│  │    基于当前的架构讨论重构现有代码                     ││
│  │                                              [✏] ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │ + 添加自定义方向                                   ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  [继续在当前 session]                  [重新生成建议]  │
└─────────────────────────────────────────────────────┘
```

**点击 ✏ 编辑某个方向时**（卡片切换为编辑态）：

```
┌─────────────────────────────────────────────────┐
│ 🔀 [继续实现功能 X_________________________] [×] │
│                                               │
│    [在当前架构基础上完成剩余的实现工作_______]     │
│    [保留与功能 X 实现相关的所有上下文_________]   │  ← purpose（裁剪依据）
│                                               │
│    [保存]  [取消]                              │
└─────────────────────────────────────────────────┘
```

**手动触发时**（token 未满）：

```
┌─────────────────────────────────────────────────────┐
│  🌿 Branch Session                                   │
│                                                     │
│  Choose a direction to branch into a new session.   │
│  The current session will be preserved as-is.       │
│                                                     │
│  [同上：方向列表 + 添加自定义]                          │
│                                                     │
│  [取消]                                [重新生成建议]  │
└─────────────────────────────────────────────────────┘
```

**方向卡片交互**：

- 每个方向卡片右侧有 `[×]` 删除按钮——点击移除该建议
- 每个方向卡片有 `[✏]` 编辑按钮——点击进入编辑态，可修改 title、description、purpose
- 点击方向卡片主体 → 选中该方向 → 开始裁剪 → 创建新 session → 自动切换
- `+ 添加自定义方向` → 展开输入区域（标题 + 描述 + purpose）→ 点击 "添加" 插入到列表
- `重新生成建议` → 重新调用 AI 分析（保留用户手动添加的方向，只替换 AI 建议的）
- `继续在当前 session` / `取消` → 关闭对话框

**编辑能力**：

所有方向卡片——无论 `source: 'ai'` 还是 `source: 'user'`——都可以编辑三个字段：

| 字段 | 说明 | 可编辑 |
|------|------|--------|
| title | 简短标题，显示在卡片和新 session 名称 | ✅ |
| description | 一句话描述，显示在卡片副标题 | ✅ |
| purpose | 裁剪依据，给裁剪 AI 看的目的说明 | ✅ |

用户修改 AI 建议方向后，该方向的 `source` 仍为 `'ai'`（重新生成时会被替换），但当前编辑的内容立即生效用于裁剪。如果用户想保留修改不被覆盖，可以在编辑后手动将其 "固定"（future: 加一个 pin 按钮，固定后 source 变为 `'user'`）。

**区分 AI 建议 vs 用户添加**：

```typescript
interface BranchDirection {
  title: string
  description: string
  purpose: string
  source: 'ai' | 'user'    // 标记来源
}
```

`source: 'ai'` 的方向在 "重新生成建议" 时会被替换；`source: 'user'` 的方向保留。

### 3.3 创建过程 UI

裁剪和创建需要几秒（AI 需要两轮调用），期间显示进度：

```
┌─────────────────────────────────────────────────────┐
│  🌿 正在创建分支...                                   │
│                                                     │
│  ✅ 分析对话方向                                      │
│  🔄 裁剪上下文（按目的选择相关消息）...                  │
│  ⏳ 创建新 session...                                │
│                                                     │
│  [取消]                                              │
└─────────────────────────────────────────────────────┘
```

### 3.4 Token Ring 状态

TokenUsageRing 在 80%+ 时变色提示，任何百分比都可点击手动触发分支对话框：

| 使用率 | 颜色 | 行为 |
|--------|------|------|
| 0-60% | 绿色 | 点击可手动分支 |
| 60-80% | 黄色 | 点击可手动分支 |
| 80-90% | 橙色 | 闪烁 + 点击可重新打开分支对话框 |
| 90%+ | 红色 | 闪烁 + 点击可重新打开分支对话框 |

## 4. 数据流

### 4.1 触发流程

```
                        自动触发                         手动触发
                        ────────                         ────────
Pi Worker                     Renderer                Renderer
    │                            │                       │
    │  message_end (usage)       │                       │  用户点击 token ring
    │───────────────────────────>│                       │  或按 Cmd/Ctrl+B
    │                            │                       │
    │                            │  ratio >= 80%?        │  triggerBranchDialog('manual')
    │                            │  triggerBranchDialog  │
    │                            │  ('auto')             │
    │                            │                       │
    │                            │  ┌────────────────────┴───────────┐
    │                            │  │ show branch dialog (loading)   │
    │                            │  │ analyzeBranchDirections (AI)   │
    │                            │  └────────────────────────────────┘
    │                            │                       │
    │  pi:analyzeBranchDirections│                       │
    │<───────────────────────────│                       │
    │  → 返回 directions[]       │                       │
    │───────────────────────────>│                       │
    │                            │                       │
    │                            │  显示方向列表           │
    │                            │  用户可删除 / 添加      │
    │                            │  用户选择一个方向       │
    │                            │                       │
    │  pi:createBranch           │                       │
    │  { trunkSessionPath,       │                       │
    │    purpose, direction }    │                       │
    │<───────────────────────────│                       │
    │                            │                       │
    │  1. 分析消息分类 (keep/summarize/drop)              │
    │  2. 生成摘要消息                                   │
    │  3. 创建新 session (parentSession = trunk)          │
    │  4. 写入: system + summary + kept messages         │
    │  5. 在 trunk 的 JSONL 记录 fork point              │
    │  6. trunk status → 'branched'                      │
    │                            │                       │
    │  → { success, newSessionPath }                     │
    │───────────────────────────>│                       │
    │                            │  switchSession(newSessionPath)
```

### 4.2 为什么在 Pi worker 里做裁剪，但用独立模型调用

裁剪需要访问 session 的完整消息历史。Pi worker 已经持有 session 的内存状态，可以直接调用 `session.getMessages()` 读取消息。但**分析和裁剪的 AI 调用不走 session 上下文**——用独立的模型调用（`modelRegistry.getAvailable()` 获取模型，直接 `model.complete()`），从 JSONL 读取的消息构建 prompt。

原因：session 已 80% 满，在 session 上下文上叠加分析/分类请求会直接超限。独立调用不受 session 上下文大小限制，也避免污染 session 的上下文。

Pi worker 已有 `compact` 命令——auto-branch 的裁剪逻辑是它的增强版（选择性压缩 vs 全量压缩）。

## 5. Pi Worker 新增命令

### 5.1 `analyze_branch_directions`

```typescript
// pi-worker.ts 新增 case
case 'analyze_branch_directions': {
  const messages = session.getMessages()
  
  const userMessages = messages.filter(m => m.role === 'user')
  const toolCalls = messages.flatMap(m => 
    m.content?.filter(c => c.type === 'tool_use') ?? []
  )
  
  const analysisPrompt = buildBranchAnalysisPrompt(userMessages, toolCalls)
  
  // 独立模型调用，不走 session 上下文（session 已 80% 满）
  const model = session.modelRegistry.getAvailable()[0]
  const result = await model.complete({
    messages: [{ role: 'user', content: analysisPrompt }],
  })
  
  const directions = parseDirections(result.text)
  send({ channel: 'response', id: cmd.id, command: 'analyze_branch_directions', success: true, data: { directions } })
  break
}
```

### 5.2 `classify_branch_messages`

分类消息（用于预览），独立模型调用：

```typescript
case 'classify_branch_messages': {
  const { purpose } = cmd
  const messages = session.getMessages()
  
  // 独立模型调用
  const model = session.modelRegistry.getAvailable()[0]
  const classification = await classifyMessagesWithModel(model, messages, purpose)
  
  // 返回分类结果供预览，不创建 session
  send({ channel: 'response', id: cmd.id, command: 'classify_branch_messages', success: true, data: { classification } })
  break
}
```

### 5.3 `create_branch`

用户预览确认后调用，传入最终分类（可能用户手动修改过）：

```typescript
case 'create_branch': {
  const { purpose, direction, trunkSessionPath, classification } = cmd
  const messages = session.getMessages()
  
  // 如果用户没预览，先分类（独立调用）
  let cls = classification
  if (!cls) {
    const model = session.modelRegistry.getAvailable()[0]
    cls = await classifyMessagesWithModel(model, messages, purpose)
  }
  
  // 生成摘要（对 summarize 类消息，独立调用）
  const summaryText = await summarizeMessagesWithModel(
    model,
    messages.filter(m => cls.summarize.includes(m.id)),
    purpose
  )
  
  // 创建新 session 文件
  const newSessionPath = await sessionService.createSessionFile({
    cwd: session.cwd,
    parentSession: trunkSessionPath,
    name: direction.title,
  })
  
  // 写入: system message + summary message + kept messages
  await sessionService.writeBranchMessages(newSessionPath, {
    purpose,
    summary: summaryText,
    keptMessages: messages.filter(m => cls.keep.includes(m.id)),
  })
  
  // 在 trunk 记录 fork point
  await sessionService.recordForkPoint(trunkSessionPath, {
    entryId: lastUserMessageEntryId,
    childName: direction.title,
  })
  
  // trunk status → branched
  await sessionService.setSessionStatus(trunkSessionPath, 'branched')
  
  send({ channel: 'response', id: cmd.id, command: 'create_branch', success: true, data: { newSessionPath } })
  break
}
```

## 6. IPC 层

### 6.1 新增 IPC 通道

```typescript
// preload/index.ts 新增
analyzeBranchDirections: (sessionPath: string | null) => Promise<{
  directions: BranchDirection[]
}>

classifyBranchMessages: (sessionPath: string | null, purpose: string) => Promise<{
  classification: { keep: string[]; summarize: string[]; drop: string[] }
}>

createBranch: (sessionPath: string | null, direction: BranchDirection, classification?: {
  keep: string[]; summarize: string[]; drop: string[]
}) => Promise<{
  success: boolean
  newSessionPath?: string
  error?: string
}>
```

### 6.2 BranchDirection 类型

```typescript
// types/session.ts 新增
interface BranchDirection {
  title: string
  description: string
  purpose: string       // 给裁剪 AI 看的目的说明
  source: 'ai' | 'user' // 来源：AI 建议还是用户手动添加
}
```

### 6.3 main/index.ts handler

```typescript
ipcMain.handle('pi:analyzeBranchDirections', async (_event, sessionPath: string | null) => {
  const result = await piWorkerRequest({
    command: 'analyze_branch_directions',
    sessionPath,
  })
  return result.data
})

ipcMain.handle('pi:createBranch', async (_event, sessionPath: string | null, direction: BranchDirection) => {
  const result = await piWorkerRequest({
    command: 'create_branch',
    sessionPath,
    direction,
    trunkSessionPath: sessionPath,
  })
  if (result.success) {
    // refresh session tree
    refreshSessions()
  }
  return result
})
```

## 7. Renderer 组件

### 7.1 BranchDialog 组件

新文件：`src/renderer/src/components/BranchDialog.tsx`

```typescript
interface BranchDialogProps {
  trigger: 'auto' | 'manual'   // 自动触发还是手动触发
  tokenUsage: TokenUsage
  directions: BranchDirection[]
  loading: boolean             // AI 分析中
  creating: boolean            // 分支创建中
  onSelectDirection: (direction: BranchDirection) => void
  onDeleteDirection: (index: number) => void
  onEditDirection: (index: number, direction: BranchDirection) => void
  onAddDirection: (direction: BranchDirection) => void
  onRegenerateSuggestions: () => void
  onDismiss: () => void
}
```

**状态机**：

```
idle → (token >= 80% 或 手动触发) → analyzing → (directions ready) → showing
                                                                    ↓
                                                        user edits list (add/delete/edit)
                                                                    ↓
                                                        user selects direction
                                                                    ↓
                                              ┌─── context < 50% 且用户选 "完整复制" ───→ creating → done
                                              │
                                              └─── 选择性裁剪 ──→ classifying → preview showing
                                                                    ↓
                                                        user reviews / overrides classification
                                                                    ↓
                                                        user confirms → creating → done (switch session)
                                                                    ↓
                                                        user goes back → showing (re-edit directions)
                                                                    ↓
                                                        user dismisses → dismissed
                                                                        (每轮 message_end 重新检查 80%)
                                                                        (InputBar 显示持续警告)
```

**方向列表管理**：

```typescript
const [directions, setDirections] = useState<BranchDirection[]>([])

// 删除方向
const deleteDirection = (index: number) => {
  setDirections(prev => prev.filter((_, i) => i !== index))
}

// 编辑方向（title / description / purpose 都可改）
const editDirection = (index: number, updated: BranchDirection) => {
  setDirections(prev => prev.map((d, i) => i === index ? updated : d))
}

// 添加自定义方向
const addDirection = (dir: BranchDirection) => {
  setDirections(prev => [...prev, { ...dir, source: 'user' }])
}

// 重新生成 AI 建议（保留用户添加的）
const regenerate = async () => {
  const userDirs = directions.filter(d => d.source === 'user')
  const aiDirs = await analyzeBranchDirections()
  setDirections([...aiDirs, ...userDirs])
}
```

### 7.2 App.tsx 集成

```typescript
// 新增 state
const [branchDialogState, setBranchDialogState] = useState<{
  visible: boolean
  trigger: 'auto' | 'manual'
  directions: BranchDirection[]
  loading: boolean
  creating: boolean
}>({ visible: false, trigger: 'manual', directions: [], loading: false, creating: false })

// 自动触发：监听 token usage 变化
useEffect(() => {
  if (!activeSessionPath || !isSessionTabActive) return
  const usage = displayedTokenUsage
  const ratio = usage.totalTokens / usage.contextWindowSize
  
  if (ratio >= 0.80 && !branchDialogState.visible && !branchDialogShownRef.current) {
    triggerBranchDialog('auto')
  }
}, [displayedTokenUsage, activeSessionPath])

// 手动触发
const triggerBranchDialog = useCallback((trigger: 'auto' | 'manual') => {
  setBranchDialogState(prev => ({ ...prev, visible: true, trigger, loading: true, directions: [] }))
  analyzeDirections()
}, [])

// Cmd/Ctrl+B 快捷键
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 'b' && isSessionTabActive) {
      e.preventDefault()
      triggerBranchDialog('manual')
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [isSessionTabActive, triggerBranchDialog])
```

### 7.3 触发条件守卫

```typescript
const branchDialogShownRef = useRef(false)

// 重置：切换 session 时重置
useEffect(() => {
  branchDialogShownRef.current = false
  dismissedRef.current = false
}, [activeSessionPath])

// dismiss 后每轮 message_end 重新检查（不设死区）
const dismissedRef = useRef(false)
useEffect(() => {
  if (!dismissedRef.current || branchDialogState.visible) return
  const ratio = displayedTokenUsage.totalTokens / displayedTokenUsage.contextWindowSize
  if (ratio >= 0.80) {
    dismissedRef.current = false
    triggerBranchDialog('auto')
  }
}, [displayedTokenUsage])

// InputBar 持续警告
const showContextWarning = !branchDialogState.visible && dismissedRef.current &&
  (displayedTokenUsage.totalTokens / displayedTokenUsage.contextWindowSize) >= 0.80
```

## 8. Session Status 扩展

### 8.1 新增 status 值

```typescript
// types/session.ts
export interface SessionInfo {
  // ...
  status: 'active' | 'completed' | 'branched' | null
}
```

### 8.2 Sidebar 显示

| status | 图标 | 说明 |
|--------|------|------|
| `active` | 无 | 正常 |
| `completed` | ✓ | 已完成 |
| `branched` | 🌿 | 已分叉出子 session |

`branched` 状态的 session 仍然可以继续对话（改回 `active`），只是表示"曾经从这里分叉过"。

## 9. 边界情况

| 场景 | 处理 |
|------|------|
| 用户在分析过程中发送新消息 | 取消分析，等下一轮 message_end 重新触发 |
| AI 生成的方向不靠谱 | 用户删除不想要的方向，或添加自定义方向，或编辑 AI 方向的 purpose |
| 用户删完了所有方向 | 列表为空，提示 "添加一个方向或重新生成建议" |
| 用户添加了重复方向 | 允许，不做去重 |
| 手动触发时 session 消息很少 | 提供 "完整复制（不裁剪）" 快捷按钮，跳过 AI 分类 |
| 裁剪后新 session 仍然太大 | 如果 kept + summary 超过 50% context window，对 kept 做二次裁剪 |
| tool_call 和 tool_result 被拆散 | 裁剪 prompt 强制 pair，AI 不遵守时后处理修正 |
| trunk 有正在跑的 subagent | 等 subagent 完成后再触发分支分析 |
| 用户切到别的 tab | 对话框保留，切回来还在 |
| 用户关闭对话框后继续在 trunk 聊 | 每轮 message_end 重新检查 80%，InputBar 显示持续警告 |
| 非 main session（fork 出来的 session）满了 | 同样触发分支对话框 |
| Pi worker 不可用 | 不触发分支分析，显示错误 toast |
| 模型不支持（没有 API key 等） | 不触发，静默降级 |
| 手动触发 + 自动触发同时发生 | 如果对话框已打开，忽略自动触发 |
| 分析/裁剪 AI 调用失败 | 显示错误，允许重试或选 "完整复制" |

## 10. 分阶段实现

### Phase 1: 触发 + 对话框 + 手动分支

- token usage 监听 + 80% 自动触发
- 手动触发：Token ring 点击 + `Cmd/Ctrl+B` 快捷键
- BranchDialog 组件（可编辑方向列表：删除、添加、编辑）
- "完整复制（不裁剪）" 快捷按钮
- `create_branch` Pi worker 命令（独立模型调用做裁剪）
- 分支预览（分类后展示 keep/summarize/drop）
- 新 session 创建 + 自动切换
- trunk 标记 `branched`
- Sidebar 图标
- InputBar dismiss 后持续警告

### Phase 2: AI 分支建议

- `analyze_branch_directions` Pi worker 命令
- 分支方向分析 prompt
- BranchDialog 展示 AI 建议的方向卡片
- "重新生成建议" 按钮（保留用户添加的方向）

### Phase 3: 体验优化

- 创建过程进度 UI
- 裁剪后 session 太大的二次裁剪
- Command Palette "Branch Session" 命令
- 分支建议缓存（避免每次打开都重新分析）
- 对话方向分析的 prompt 调优
- tool_call/tool_result pair 后处理修正

## 11. 与现有机制的关系

### 11.1 与 Pi compaction 的关系

Pi SDK 有自己的 compaction 机制（`session.compact()`）。Auto-Branch 不使用 Pi 的 compaction，而是：
1. 拦截在 compaction 之前——80% 触发时 Pi 还没 compact
2. 用自己的选择性裁剪替代全量 compaction
3. trunk 不 compact，完整保留

**Pi compact 仍然保留**作为 fallback：如果用户在分支对话框里选 "继续在当前 session" 且 token 达到 95%+，可以提示用户手动 compact 或强制分支。

### 11.2 与现有 fork 的关系

| | 现有 Fork | Auto-Branch |
|---|---|---|
| 触发 | 用户手动在某个 entry 处 fork | context 80% 自动触发 |
| 上下文 | 从 fork point 复制完整消息 | 按目的选择性裁剪 |
| 目的 | 从对话中间分叉探索不同方向 | context 满了选择继续方向 |
| 数据结构 | parentSession + forkPoint | 相同，复用 |

Auto-Branch 创建的 session 与手动 fork 创建的 session 结构完全一致——都有 `parentSession` 指向 trunk，都在 trunk 的 JSONL 里记录 fork point。区别只是触发方式和上下文裁剪。

### 11.3 与 Lazy Session Switch 的关系

Auto-Branch 创建新 session 后需要 `switchSession(newSessionPath)`。这会触发 Lazy Session Switch 的缓存逻辑——trunk 的缓存保留，新 session 的缓存初始化。用户可以在两个 session 间切换查看。

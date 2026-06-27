# Spec: 文件修改解释与追问 (File Change Explanation & Fork Q&A)

## 背景

Agent 修改文件有两种方式：`edit`（修改已有文件）和 `write`（新建文件或完整重写）。两者都直接落盘（`pi-worker.ts` 的 `guardedEditTool`/`guardedWriteTool` 调用 `fs.writeFile`），用户在聊天中看到的是事后的装饰性 diff（`ToolCallRenderer` 渲染 oldText/newText 或文件内容），无法理解为什么改、为什么新建。

核心问题：**不能无脑接收 agent 提交的代码，human 要从 agent 学习和理解。** 但强制逐行审查是合规式摩擦——盯着每一行看不等于理解。正确的方式是主动教（解释）+ 主动探究（追问）。

## 目标

1. Agent 每次非 trivial 文件修改（edit 或 write）后，自动生成简短解释，显示在 chat bubble 内工具卡片下方
2. 用户对某个修改有疑问时，可以 fork 一个新 session 追问，新 session 自动锚定该修改的上下文
3. 主任务流不被追问污染——追问是理解行为，不是任务行为

## 设计原则

| 原则 | 说明 |
|------|------|
| 解释 ≠ 强制审查 | 解释是主动教，用户可以选择看或跳过，不被阻塞 |
| 追问 = fork | 追问在独立 session 进行，不污染主任务流；一次多个修改的追问各自独立 |
| 锚定 | fork session 继承完整上下文 + 明确标注用户问的是哪个修改（edit 或 write） |
| 摩擦与风险成正比 | trivial 修改少解释，重大修改多解释；不杀吞吐量 |

---

## Part 1: 修改解释 (Change Explanation)

### 1.1 数据模型

`TextBlock` 已有 `subtype?: 'thinking'`，扩展为：

```typescript
interface TextBlock {
  type: 'text'
  content: string
  subtype?: 'thinking' | 'explanation'  // 新增 'explanation'
}
```

不新增 block 类型。解释就是文本流的一部分，只是带标记以区分样式。

### 1.2 在 bubble 中的位置

一个 assistant turn 的 blocks 按顺序渲染在同一个 `xi-bubble` 内。解释 block 插入在 `tool_result` 之后，作为顶层 block 渲染（不会被 `pairedResultIndices` 机制吸收，只有 `tool_result` 会被吸收）：

```
┌─ xi-bubble ─────────────────────────────────────────────┐
│  <div class="space-y-2">                                │
│                                                          │
│    📝 "我来修复 auth 的 bug"          ← TextBlock         │
│                                                          │
│    ┌─ ToolCallRenderer ─────────────┐                    │
│    │ ✏️ edit src/auth.ts ✓  ▸       │  ← tool_call (edit)│
│    │  └ (展开后) oldText/newText     │  ← tool_result     │
│    └────────────────────────────────┘     (absorbed)     │
│                                                          │
│    ┌──────────────────────────────┐                      │
│    │ 💬 加了过期检查，因为之前的     │  ← TextBlock        │
│    │    代码会解码已过期的 token    │    subtype:         │
│    │    导致安全问题...            │    'explanation'    │
│    │                    [追问 →]   │                      │
│    └──────────────────────────────┘                      │
│                                                          │
│    📝 "接下来处理路由..."             ← TextBlock         │
│                                                          │
│  </div>                                                  │
└──────────────────────────────────────────────────────────┘
```

### 1.3 渲染样式

复用 `thinking` block 的折叠模式，但用不同颜色区分：

| 属性 | thinking | explanation |
|------|----------|-------------|
| 图标 | 💭 | 💬 |
| 左边线颜色 | 紫色 (`border-purple-400`) | 青色 (`border-cyan-400`) |
| 背景 | 无 | `bg-cyan-50/5` (极淡) |
| 默认状态 | 折叠 | **展开**（解释默认可见，thinking 默认折叠） |
| 字号 | `text-xs` | `text-sm`（正常 prose 大小） |

`TextBlockRenderer`（`ChatView.tsx` ~line 132）增加分支：

```tsx
if (block.subtype === 'explanation') {
  return <ExplanationBlockRenderer content={block.content} toolCallId={...} />
}
```

### 1.4 解释生成

**策略：agent 自身输出 + 系统提示引导。**

Pi SDK 的原生格式已经支持 text 和 tool_call 交错。Agent 正常情况下会在修改前后产生文本。通过系统提示引导 agent 在每次非 trivial 修改（edit 或 write）后附上简短解释，这段文本自然出现在 `tool_result` 之后的 `TextBlock` 中。

**风险分级（决定是否生成解释）：**

| 修改类型 | 判定条件 | 行为 |
|----------|---------|------|
| trivial edit | ≤3 行变更 且 非逻辑变更（纯格式化、import 排序、typo） | 不生成解释，正常 TextBlock |
| moderate edit | 逻辑变更，小范围（单函数内） | 生成简短解释（1-2 句） |
| major edit | 大范围 / 安全敏感路径 | 生成详细解释（意图 + 方案 + 风险） |
| write 新文件 | `toolName === 'write'` 且文件不存在 | 生成解释：为什么新建、文件用途 |
| write 完整重写 | `toolName === 'write'` 且文件已存在 | 生成详细解释：重写原因 + 与旧版的差异概述 |

风险判定在 `tool_execution_end` 处理中完成（`usePiRpc.ts` ~line 427），基于 `toolName`、`args` 内容（edit 的 oldText/newText 行数、write 的文件路径、文件是否已存在）。

**生成机制（两种可选）：**

| 方案 | 机制 | 优点 | 缺点 |
|------|------|------|------|
| A. 系统提示引导 | 在 system prompt 中要求 agent 每次修改后解释 | 零额外调用，解释是 agent 自然输出的一部分 | 依赖 agent 遵守指令；无法精确控制格式 |
| B. 独立解释调用 | 修改完成后，发一个轻量 LLM 调用生成解释 | 可控格式和内容；可做风险分级 | 增加延迟和 token 消耗 |

**推荐 A 为主**，符合"agent 自己的文本流"的架构。B 作为后续优化（可控性更强时再引入）。

### 1.5 历史加载兼容

`convert-messages.ts` 的 `convertPiMessagesToChatMessages`（line 172-198）按顺序转换 assistant content。如果 Pi SDK 持久化的消息中，toolCall 后面紧跟 text block，转换后该 text block 自然出现在 tool_result 之后。

**问题**：Pi SDK 的 `subtype` 信息不会持久化（Pi 的 content type 只有 `text`/`thinking`/`toolCall`，没有 `explanation`）。

**解法**：在 `convert-messages.ts` 转换时，如果 text block 紧跟在 toolCall 后面（content array 中 `text` 的前一个元素是 `toolCall`），且该 text 不是 `thinking` 类型，则标记为 `subtype: 'explanation'`。这是位置推断，不需要 Pi SDK 改动。

```typescript
// convert-messages.ts 伪代码
for (let i = 0; i < content.length; i++) {
  const c = content[i]
  const prev = content[i - 1]
  if (c.type === 'text' && prev?.type === 'toolCall') {
    // toolCall 后紧跟的 text → 标记为 explanation
    blocks.push({ type: 'text', content: c.text, subtype: 'explanation' })
  } else if (c.type === 'text') {
    blocks.push({ type: 'text', content: c.text })
  }
  // ... thinking, toolCall 处理不变
}
```

### 1.6 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/renderer/src/types/message.ts` | 改动 | `TextBlock.subtype` 增加 `'explanation'` |
| `src/renderer/src/components/ChatView.tsx` | 改动 | `TextBlockRenderer` 增加 `explanation` 分支；新增 `ExplanationBlockRenderer` 组件（含追问按钮） |
| `src/renderer/src/utils/convert-messages.ts` | 改动 | toolCall 后紧跟的 text 标记为 `subtype: 'explanation'` |
| `src/renderer/src/hooks/usePiRpc.ts` | 改动 | 流式路径中 toolcall_end 后的 text block 标记为 explanation（同上逻辑） |

---

## Part 2: Fork 追问 (Fork-based Q&A)

### 2.1 交互流程

```
用户看到修改卡片（edit 或 write）+ 解释
  │
  ├── 理解了 → 继续看下一个修改，无操作
  │
  └── 想追问 → 点击解释块上的 [追问 →] 按钮
        │
        ▼
     追问对话框 (ForkAskDialog)
     ┌──────────────────────────────────────────┐
     │ 追问修改                                  │
     │                                           │
     │ 📎 锚定修改: ✏️ edit src/auth/token.ts     │
     │ ┌───────────────────────────────────────┐ │
     │ │ - if (token) { return decode(token) } │ │
     │ │ + if (token && !isExpired(token))     │ │
     │ │   { return decode(token) }            │ │
     │ └───────────────────────────────────────┘ │
     │ 💬 agent 解释: 加了过期检查...             │
     │                                           │
     │ Session 名称: [追问: token.ts 过期检查  ] │
     │ 你的问题:                                  │
     │ [为什么不用 refresh token 自动续期？    ] │
     │                              [取消] [Fork] │
     └──────────────────────────────────────────┘
        │
        ▼
     Fork 新 session（从最后一条 user message fork）
        │
        ├── 继承完整对话历史（agent 能看到所有 edit）
        ├── 首条消息自动注入锚定 edit 的上下文
        ├── 用户的问题作为首条 user message 发送
        └── 新 session 出现在 sidebar，成为 child of 当前 session
```

### 2.2 为什么 fork 而不是当前 session 追问

一次 agent turn 可能改 5 个文件，3 个想追问：

```
当前 session 追问:
  主任务流 → edit A → edit B → edit C → edit D → edit E
           → 问A → 答A → 问B → 答B → 问C → 答C → 继续主任务...
  
  问题：6 条追问消息插在主流程里，上下文被稀释

fork 追问:
  主任务流 → edit A → edit B → edit C → edit D → edit E → 继续主任务
              ↘          ↘          ↘
            fork A     fork B     fork C
            (问A)      (问B)      (问C)
  
  主流程干净，3 个追问并行，互不干扰
```

追问是**理解行为**，不是**任务行为**。fork 天然做了这个隔离。

### 2.3 锚定机制

fork 出来的 session 继承完整对话历史，但 agent 不知道用户问的是哪个修改。通过在 fork session 的首条 user message 中注入锚定上下文解决：

```typescript
interface ChangeAnchor {
  toolCallId: string
  toolName: 'edit' | 'write'
  filePath: string
  oldText?: string      // edit 有，write 没有
  newText: string
  explanation?: string  // 如果有解释 block
}

// fork session 首条 user message 的构造
function buildAnchoredMessage(anchor: ChangeAnchor, question: string): string {
  let msg = `[追问修改]\n`
  msg += `文件: ${anchor.filePath}\n`
  msg += `操作: ${anchor.toolName === 'edit' ? '修改' : '新建/重写'}\n`
  if (anchor.oldText) {
    msg += `改动:\n  - ${anchor.oldText}\n  + ${anchor.newText}\n`
  } else {
    msg += `内容:\n  ${anchor.newText.slice(0, 500)}${anchor.newText.length > 500 ? '...' : ''}\n`
  }
  if (anchor.explanation) {
    msg += `\nAgent 解释: ${anchor.explanation}\n`
  }
  msg += `\n问题: ${question}`
  return msg
}
```

### 2.4 Fork 流程

复用现有 fork 机制（`session-management-spec` §3.3），从**最后一条 user message** fork（同 sidebar fork，§3.7），然后自动发送锚定消息：

```
1. 用户点击 [追问 →] → ForkAskDialog 打开
2. 用户输入 session 名称 + 问题 → 点击 Fork
3. 前端: forkAtEntry(lastUserEntryId, name)
   - RPC: fork → set_session_name → addForkPoint
   - 同现有 sidebar fork 流程
4. 前端: clearMessages() → loadHistory() → refresh()
5. 前端: 自动发送 buildAnchoredMessage(anchor, question)
   - 复用现有 sendPrompt 机制
   - agent 在 fork session 中看到完整历史 + 锚定问题
6. 新 session 出现在 sidebar as child of 原 session
```

**不需要新的 IPC 或 worker 命令。** 完全复用现有 fork + sendPrompt。

### 2.5 追问演变成深度讨论

如果 fork session 里的追问演变成多轮深入讨论，用户可以继续在 fork session 里对话。不需要二次 fork——fork session 本身就是独立 session，有自己的完整上下文。

```
main session
  │
  ├── fork: "追问: token.ts 过期检查"
  │     ├── user: [追问编辑] ... 为什么不用 refresh token?
  │     ├── agent: 这个项目的 refresh 逻辑在 middleware 层...
  │     ├── user: 那 token rotation 的安全风险呢？
  │     └── agent: token rotation 的主要风险是...
  │
  └── (主任务流继续，不受影响)
```

### 2.6 结论回流

fork session 里讨论出"这个 edit 确实有问题"的结论后，**不自动回流到主 session**。用户回到主 session 直接跟 agent 说"把 token.ts 那个过期检查改掉，用 refresh token"。

fork session 的使命是**帮用户理解**，不是帮用户行动。行动发生在主 session。

### 2.7 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/renderer/src/components/ChatView.tsx` | 改动 | `ExplanationBlockRenderer` 内含 [追问 →] 按钮，触发 `ForkAskDialog` |
| `src/renderer/src/components/ForkAskDialog.tsx` | 新增 | 追问对话框：显示锚定修改上下文（edit diff 或 write 内容摘要）+ session 名称输入 + 问题输入 |
| `src/renderer/src/App.tsx` | 改动 | `handleForkAsk(anchor, name, question)` 方法：fork + 自动发送锚定消息 |

---

## Part 3: 完整视觉效果

```
┌─ xi-bubble (assistant) ──────────────────────────────────────┐
│                                                                │
│  我来修复 auth 的 bug。之前的代码在 token 过期后仍然          │
│  会解码，导致安全问题。                                        │
│                                                                │
│  ┌─ ✏️ edit src/auth/token.ts ✓  ▸ ──────────────────────┐    │
│  │  └ - if (token) { return decode(token) }              │    │
│  │    + if (token && !isExpired(token)) { ... }          │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌── 💬 解释 ────────────────────────────────────────────┐     │
│  │ 加了过期检查。之前的代码会解码已过期的 token，          │     │
│  │ 导致用户在 token 过期后仍然能访问受保护路由。           │     │
│  │ 这修复了 issue #42 的安全问题。                        │     │
│  │                                        [追问 →]        │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                │
│  接下来处理路由层的 refresh token 逻辑...                     │
│                                                                │
│  ┌─ ✏️ edit src/router/middleware.ts ✓  ▸ ───────────────┐    │
│  │  └ - next()                                           │    │
│  │    + if (isExpired(token)) { refresh(); } next()      │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌── 💬 解释 ────────────────────────────────────────────┐     │
│  │ 在路由中间件加了自动 refresh。当 token 过期时，         │     │
│  │ middleware 会调用 refresh 续期，用户无感知。            │     │
│  │                                        [追问 →]        │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌─ 📝 write src/auth/refresh.ts ✓  ▸ ───────────────────┐    │
│  │  └ export async function refreshToken(token) { ... }  │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌── 💬 解释 ────────────────────────────────────────────┐     │
│  │ 新建了 refresh.ts，封装 token 续期逻辑。               │     │
│  │ 从旧的 middleware 中抽取出来，方便单独测试和复用。      │     │
│  │                                        [追问 →]        │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘

用户点击第一个 [追问 →]：

  main session (继续主任务)
    │
    ├── fork: "追问: token.ts 过期检查"
    │     ├── [追问修改] 文件: src/auth/token.ts
    │     │   操作: 修改
    │     │   改动: - if (token) ... / + if (token && !isExpired) ...
    │     │   Agent 解释: 加了过期检查...
    │     │   
    │     │   问题: 为什么不用 refresh token 自动续期？
    │     │
    │     ├── agent: 这个项目的 refresh 逻辑在 middleware 层...
    │     └── ...
    │
    └── fork: "追问: refresh.ts 为什么新建"
          ├── [追问修改] 文件: src/auth/refresh.ts
          │   操作: 新建/重写
          │   内容: export async function refreshToken(token) { ... }
          │   Agent 解释: 新建了 refresh.ts，封装 token 续期逻辑...
          │   
          │   问题: 为什么不直接放在 middleware 里？
          │
          └── agent: 单独抽取出来有两个好处...
```

---

## 边界情况

| 场景 | 处理 |
|------|------|
| edit 没有后续 text block（agent 直接继续下一个 tool call） | 不显示解释块；追问按钮放在 ToolCallRenderer 内部（展开后的区域底部）作为 fallback |
| write 没有后续 text block | 同上，追问按钮放在 write 卡片展开后的区域底部 |
| agent 一次改 20+ 个文件 | 每个非 trivial 修改（edit 或 write）都有解释 + 追问按钮；用户可以选择性查看。主流程不被阻塞 |
| trivial edit（≤3 行，无逻辑变更） | 不生成解释块，ToolCallRenderer 正常渲染（无追问按钮） |
| write 新文件 | 解释块说明新建文件的目的；追问按钮同样可用 |
| write 完整重写已有文件 | 解释块说明重写原因 + 与旧版差异概述；锚定消息只包含新内容（无 oldText） |
| 追问时 agent 正在 streaming | 追问按钮禁用（同现有 fork 限制，session-management-spec §6.6.6） |
| fork session 名称为空 | 不允许 fork，Fork 按钮禁用（同现有 fork 流程） |
| 追问问题为空 | 允许 fork，agent 收到纯锚定上下文，自然追问"你想了解什么？" |
| 用户在 fork session 里继续追问 | 正常对话，不需要二次 fork。fork session 是完整 session |
| 追问后发现修改确实有问题 | 用户回到主 session 手动指示 agent 修改。不自动回流 |
| 历史加载时 explanation 标记 | `convert-messages.ts` 通过位置推断（toolCall 后紧跟的 text）标记为 explanation |
| compact view 模式 | explanation block 在 compact view 中折叠为一行摘要（如 "💬 加了过期检查..."），同 thinking 的处理方式 |

---

## 与现有 spec 的关系

| Spec | 关系 |
|------|------|
| `spec-tool-output-redesign.md` | 本 spec 扩展了 tool call 的渲染——在 ToolCallRenderer 之后增加 explanation block |
| `specs/quote-message.md` | 追问的锚定机制复用了引用消息的设计思路（结构化上下文注入） |
| `session-management-spec.md` | Fork 追问完全复用现有 fork 机制（§3.3 Fork, §3.7 Sidebar Fork） |
| `docs/ideas.md` §4 | "diff view 功能一定要强大，要让 human 有掌控感"——解释 + 追问即是掌控感的来源 |
| `docs/ideas.md` §6 | "不能外包思考，human 要从 agent 学习和理解"——本 spec 的核心动机 |

---

## 未来扩展

### 风险分级检查点 (Phase 2)

在重大修改和任务边界加 accept/reject gate，给用户掌控权：

- trivial/moderate 修改：自动应用 + 解释（当前 spec）
- major 修改（新文件/大范围/安全敏感路径）：暂停 agent → 弹出 diff review → 要求 Accept/Reject
- 任务完成检查点：显示所有变更文件的 diff 摘要 → 用户确认后才标记完成

复用休眠的 `ActionBlockRenderer` confirm 模式 + `pendingUiRequests`/`respondToUiRequest` 通道作为 agent 暂停的传输层。

### 选行追问 (Phase 3)

用户可以点击 diff 中的特定行追问"为什么改这行？"，fork session 的锚定消息精确到 hunk 级别而非整个修改。需要扩展 `ChangeAnchor` 增加 `lineRange` 字段。

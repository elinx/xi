# Spec: question Tool

## 背景

Xi 的 agent 在执行任务时遇到歧义或需要用户决策，只能"猜"——继续执行可能走错方向，停下来又只能用纯文本回复"请告诉我……"。没有结构化的方式在执行中途向用户提问并等待回答。

`question` 让 agent 在工具执行流中**阻塞等待用户选择**：AI 提出问题 + 选项列表，用户在 UI 中选择或自由输入，答案返回给 AI 继续执行。

## 设计决策

### 阻塞式 execute vs 非阻塞

`question` 的 `execute()` 是**阻塞式**的——调用后挂起 Promise，直到用户在 UI 中回答。这与 `subagent` 工具的模式完全一致：worker 发 IPC 消息到主进程，主进程转发到渲染进程，渲染进程弹 UI，用户操作后答案原路返回，worker resolve Promise。

**为什么阻塞而非异步通知**：
- AI 调用 `question` 时的意图是"我需要答案才能继续"，阻塞语义最自然
- Pi SDK 的 tool execute 本身支持 async，`subagent` 已有先例
- 非阻塞模式需要 AI 自己管理"等待中"状态，增加复杂度

### IPC 通道：复用 subagent 模式

Worker → Renderer 的通信链路：

```
pi-worker.ts (process.parentPort.postMessage)
  → pi-sdk-bridge.ts (handleChildMessage → emit)
  → worker-manager.ts (setupBridgeEvents → emit)
  → index.ts (workerManager.on → broadcastToRenderers)
  → preload (ipcRenderer.on)
  → App.tsx (callback)
```

Renderer → Worker 的回程：

```
App.tsx (api.answerQuestion)
  → preload (ipcRenderer.invoke)
  → index.ts (ipcMain.handle → workerManager.sendCommand)
  → pi-sdk-bridge.ts (sendCommand → child.postMessage)
  → pi-worker.ts (process.parentPort.on('message'))
```

新增通道：`question:ask`（worker → renderer）和 `question:answer`（renderer → worker）。与 `subagent:run` / `subagent:result` 完全对称。

### UI 形态：模态对话框

用 `createPortal` 渲染全屏遮罩 + 居中卡片，与 `ForkAskDialog` 同级。不复用 ForkAskDialog——目的不同（fork-ask 是从 explanation block 发起追问，question 是 AI 执行中途提问），数据结构不同，交互流程不同。

**为什么模态而非内联**：
- 阻塞语义需要用户立即注意
- 内联消息会随对话滚动消失，用户可能错过
- ForkAskDialog 已建立模态交互先例

### details 存储

与 `todowrite` 和 `webfetch` 一致，`question` 的结果存入 `ToolResultBlock.details`，fork 后自动正确。

```typescript
interface QuestionDetails {
  question: string
  options: string[]           // 原始选项 label 列表
  answer: string | null       // 用户选择的答案，null 表示取消
  wasCustom?: boolean         // 是否自由输入（非预设选项）
}
```

## 实现

### 架构

```
Agent 调用 question(question="用方案A还是B？", options=[{label:"A",description:"..."},{label:"B",description:"..."}])
  │
  ▼
createQuestionTool() in pi-worker.ts
  ├─ 校验 question 非空、options 非空
  ├─ 调用 requestQuestionAsk(toolCallId, question, options)
  │   ├─ 创建 Promise，resolver 存入 pendingQuestionRequests Map
  │   └─ send({ channel: 'question:ask', toolCallId, question, options })
  ├─ await Promise（阻塞，等用户回答）
  │
  ▼
IPC 链路（worker → renderer）
  ├─ pi-sdk-bridge.ts: handleChildMessage() case 'question:ask' → emit('question:ask')
  ├─ worker-manager.ts: setupBridgeEvents() → bridge.on('question:ask') → emit('question:ask')
  ├─ index.ts: workerManager.on('question:ask') → broadcastToRenderers('pi:question', data)
  └─ preload: ipcRenderer.on('pi:question') → callback
  │
  ▼
App.tsx
  ├─ onQuestion callback → setState({ pendingQuestion: { toolCallId, question, options } })
  └─ 渲染 <QuestionDialog>（模态）
  │
  ▼
用户选择选项 或 自由输入 或 取消
  ├─ api.answerQuestion(toolCallId, answer, wasCustom)
  │
  ▼
IPC 链路（renderer → worker）
  ├─ preload: ipcRenderer.invoke('question:answer', { toolCallId, answer, wasCustom })
  ├─ index.ts: ipcMain.handle('question:answer') → workerManager.sendCommand(sessionPath, { type: 'question:answer', ... })
  ├─ pi-sdk-bridge.ts: sendCommand() → child.postMessage()
  └─ pi-worker.ts: process.parentPort.on('message') → case 'question:answer'
     ├─ 从 pendingQuestionRequests 取出 resolver
     └─ resolve({ answer, wasCustom })
  │
  ▼
execute() 返回
  └─ { content: [{ type: 'text', text: answerSummary }], details: { question, options, answer, wasCustom } }
```

### 工具定义

```typescript
function createQuestionTool() {
  return {
    name: 'question',
    label: 'question',
    description:
      'Ask the user a question and wait for their answer. ' +
      'Use when you need user input or a decision before proceeding. ' +
      'Provide clear options with descriptions. The user can also type a custom answer.',
    parameters: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string' as const,
          description: 'The question to ask the user',
        },
        options: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              label: { type: 'string' as const, description: 'Display label for the option' },
              description: { type: 'string' as const, description: 'Optional explanation shown below the label' },
            },
            required: ['label'],
          },
          description: 'Options for the user to choose from',
        },
      },
      required: ['question', 'options'],
    },
    execute: async (_toolCallId: string, params: { question: string; options: { label: string; description?: string }[] }) => {
      if (!params.question?.trim()) {
        return { content: [{ type: 'text' as const, text: 'Error: question is required' }] }
      }
      if (!params.options || params.options.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Error: at least one option is required' }] }
      }

      const result = await requestQuestionAsk(_toolCallId, params.question, params.options)

      if (!result) {
        return {
          content: [{ type: 'text' as const, text: 'User cancelled the question' }],
          details: {
            question: params.question,
            options: params.options.map(o => o.label),
            answer: null,
          } as QuestionDetails,
        }
      }

      const summary = result.wasCustom
        ? `User wrote: ${result.answer}`
        : `User selected: ${result.answer}`

      return {
        content: [{ type: 'text' as const, text: summary }],
        details: {
          question: params.question,
          options: params.options.map(o => o.label),
          answer: result.answer,
          wasCustom: result.wasCustom,
        } as QuestionDetails,
      }
    },
  }
}
```

### Worker 端：阻塞 + Promise resolver

```typescript
// pi-worker.ts

interface QuestionOption {
  label: string
  description?: string
}

interface QuestionResult {
  answer: string
  wasCustom: boolean
}

const pendingQuestionRequests = new Map<string, {
  resolve: (result: QuestionResult | null) => void
}>()

function requestQuestionAsk(
  toolCallId: string,
  question: string,
  options: QuestionOption[],
): Promise<QuestionResult | null> {
  return new Promise((resolve) => {
    pendingQuestionRequests.set(toolCallId, { resolve })
    send({
      channel: 'question:ask',
      toolCallId,
      question,
      options,
      sessionFile: session?.sessionFile,
    })
  })
}

// 在 process.parentPort.on('message') handler 中新增：
if (msg.type === 'question:answer') {
  const pending = pendingQuestionRequests.get(msg.toolCallId as string)
  if (pending) {
    pendingQuestionRequests.delete(msg.toolCallId as string)
    if (msg.answer === null) {
      pending.resolve(null)
    } else {
      pending.resolve({
        answer: msg.answer as string,
        wasCustom: msg.wasCustom as boolean ?? false,
      })
    }
  }
  return
}
```

### IPC 链路修改

#### pi-sdk-bridge.ts — 新增 case

在 `handleChildMessage()` 的 switch 中添加：

```typescript
case 'question:ask': {
  this.emit('question:ask', { ...msg, senderSessionId: this.sessionId })
  break
}
```

#### worker-manager.ts — 新增 bridge event 转发

在 `setupBridgeEvents()` 中添加：

```typescript
bridge.on('question:ask', (data: unknown) => {
  this.emit('question:ask', { ...(data as Record<string, unknown>), senderSessionPath: state.sessionPath })
})
```

#### index.ts — 新增 IPC handler

```typescript
// 转发 question:ask 到渲染进程
workerManager.on('question:ask', (data: unknown) => {
  broadcastToRenderers('pi:question', data)
})

// 接收渲染进程的答案，转发到 worker
ipcMain.handle('question:answer', async (_event, sessionPath: string, payload: { toolCallId: string; answer: string | null; wasCustom: boolean }) => {
  const state = workerManager?.getWorkerState(sessionPath)
  if (state) {
    state.bridge.sendCommand({
      type: 'question:answer',
      toolCallId: payload.toolCallId,
      answer: payload.answer,
      wasCustom: payload.wasCustom,
    })
  }
  return { ok: true }
})
```

#### preload/index.ts — 新增 API

```typescript
// 在 api 对象中添加：
onQuestion: (callback: (data: { toolCallId: string; question: string; options: QuestionOption[]; sessionPath: string }) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0])
  ipcRenderer.on('pi:question', handler)
  return () => ipcRenderer.removeListener('pi:question', handler)
},

answerQuestion: (sessionPath: string, payload: { toolCallId: string; answer: string | null; wasCustom: boolean }): Promise<{ ok: boolean }> =>
  ipcRenderer.invoke('question:answer', sessionPath, payload),
```

### 类型修改

#### message.ts — 新增 QuestionDetails

```typescript
export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionDetails {
  question: string
  options: string[]         // label 列表
  answer: string | null     // null = 用户取消
  wasCustom?: boolean       // true = 自由输入
}

// ToolResultBlock.details 类型扩展
export interface ToolResultBlock {
  type: 'tool_result'
  toolCallId: string
  content: ContentBlock[]
  details?: TodoDetails | QuestionDetails  // 联合类型
}
```

### 数据流

#### Streaming 路径（实时）

```
Pi SDK event: tool_execution_end
  ├─ toolName: 'question'
  ├─ details: { question, options, answer, wasCustom }
  │
  ▼
usePiRpc.ts → handleEvent()
  └─ 从 details 提取 → 存入 ToolResultBlock.details
  │
  ▼
ChatView.tsx → ToolCallRenderer
  └─ 检测 block.toolName === 'question'
     → 用 QuestionResultRenderer 替代默认文本渲染
```

#### History 路径（加载历史 session）

```
pi-worker.ts → get_messages RPC → PiToolResultMessage[]
  ├─ details: { question, options, answer, wasCustom }
  │
  ▼
convert-messages.ts → convertPiMessagesToChatMessages()
  └─ 从 msg.details 提取 → 存入 ToolResultBlock.details
```

### convert-messages.ts 修改

在 `toolResult` 分支中，扩展 details 提取逻辑：

```typescript
// 现有（todowrite）
details: msg.toolName === 'todowrite' && msg.details
  ? { todos: (msg.details as { todos?: TodoItem[] }).todos ?? [] }
  : undefined,

// 修改后
details: msg.toolName === 'todowrite' && msg.details
  ? { todos: (msg.details as { todos?: TodoItem[] }).todos ?? [] }
  : msg.toolName === 'question' && msg.details
    ? msg.details as QuestionDetails
    : undefined,
```

### usePiRpc.ts 修改

在 `tool_execution_end` 事件处理中，扩展 details 提取逻辑，同上模式。

## UI 渲染

### QuestionDialog 组件

新建 `src/renderer/src/components/QuestionDialog.tsx`，模态对话框：

```tsx
interface QuestionDialogProps {
  question: string
  options: QuestionOption[]
  onAnswer: (answer: string | null, wasCustom: boolean) => void
}
```

**交互**：
- 选项列表：点击选中，蓝色高亮
- "Type something..." 选项：点击后切换为文本输入框，Enter 提交
- 取消按钮 / Esc 键：返回 null（取消）
- 回答后立即关闭对话框

**视觉**（暗色主题为例）：

```
┌─────────────────────────────────────────────┐
│                                               │
│  ❓ 用方案A还是方案B？                         │
│                                               │
│  ┌───────────────────────────────────────┐   │
│  │  A. 重构为 hooks                high  │   │  ← 选项，带 description
│  │     更好的可维护性，但改动量大            │   │
│  └───────────────────────────────────────┘   │
│  ┌───────────────────────────────────────┐   │
│  │  B. 保留 class 组件             medium │   │
│  │     改动量小，但不够现代                 │   │
│  └───────────────────────────────────────┘   │
│  ┌───────────────────────────────────────┐   │
│  │  ✎ Type something...                   │   │  ← 自由输入
│  └───────────────────────────────────────┘   │
│                                               │
│                          [Cancel]  [Confirm]  │
└─────────────────────────────────────────────┘
```

### ChatView.tsx — inline 渲染

在 `ToolCallRenderer` 中新增 `question` 的专属渲染：

```tsx
function QuestionResultRenderer({ details }: { details: QuestionDetails }) {
  if (details.answer === null) {
    return <span className="text-gray-400 text-xs italic">Cancelled</span>
  }
  return (
    <div className="space-y-1">
      <div className="text-gray-500 text-[11px]">{details.question}</div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <svg className="w-3.5 h-3.5 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-gray-600">
          {details.wasCustom ? '(wrote) ' : ''}
          {details.answer}
        </span>
      </div>
    </div>
  )
}
```

### toolIcon + headerSummary

```typescript
// toolIcon
const toolIcon: Record<string, string> = {
  // ... 现有 ...
  question: '❓',
}

// headerSummary
case 'question': {
  const d = result?.details as QuestionDetails | undefined
  if (d) {
    headerSummary = d.answer
      ? d.wasCustom ? `wrote: ${d.answer.slice(0, 30)}` : `selected: ${d.answer}`
      : 'cancelled'
  } else {
    headerSummary = ''
  }
  break
}
```

### System Prompt 更新

在 `systemPromptOverride` 的 `Available tools` 列表中添加：

```
- question: Ask the user a question with options and wait for their answer. Use when you need a decision or clarification before proceeding.
```

在 `Guidelines` 中添加：

```
- Use question when you need user input to proceed (e.g., choosing between approaches, confirming a risky action). Do not use it for things you can decide yourself.
- Keep questions specific. Provide 2-5 options with clear labels and brief descriptions.
- Do not ask questions you can answer from the codebase or project files — use search_sessions, read, or grep instead.
```

### 注册

```typescript
// pi-worker.ts → createRuntime
tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'search_sessions', 'subagent', 'webfetch', 'todowrite', 'question'],
customTools: [..., createTodowriteTool(), createQuestionTool()],
```

## 修改的文件

| 文件 | 改动 |
|---|---|
| `src/main/pi-worker.ts` | 新增 `createQuestionTool()` + `requestQuestionAsk()` + `pendingQuestionRequests` Map；`process.parentPort.on('message')` 新增 `question:answer` case；`tools` 和 `customTools` 数组添加 question；system prompt 添加工具说明 |
| `src/main/pi-sdk-bridge.ts` | `handleChildMessage()` switch 新增 `case 'question:ask'` → `emit('question:ask')` |
| `src/main/worker-manager.ts` | `setupBridgeEvents()` 新增 `bridge.on('question:ask')` → `emit('question:ask')` |
| `src/main/index.ts` | 新增 `workerManager.on('question:ask')` → `broadcastToRenderers('pi:question')`；新增 `ipcMain.handle('question:answer')` → 转发到 worker |
| `src/preload/index.ts` | 新增 `onQuestion` listener 和 `answerQuestion` invoke |
| `src/renderer/src/types/message.ts` | 新增 `QuestionOption`、`QuestionDetails` 接口；`ToolResultBlock.details` 类型扩展 |
| `src/renderer/src/utils/convert-messages.ts` | details 提取新增 `question` 分支 |
| `src/renderer/src/hooks/usePiRpc.ts` | details 提取新增 `question` 分支 |
| `src/renderer/src/components/QuestionDialog.tsx` | **新文件** — 模态对话框，选项列表 + 自由输入 |
| `src/renderer/src/components/ChatView.tsx` | 新增 `QuestionResultRenderer`；`ToolCallRenderer` 集成 question 专属渲染；`toolIcon` 和 `headerSummary` 新增 question case |
| `src/renderer/src/App.tsx` | 新增 `pendingQuestion` state + `onQuestion` callback + 渲染 `QuestionDialog` |

## 边界情况

| 场景 | 处理 |
|---|---|
| question 为空字符串 | 拒绝，返回 `Error: question is required` |
| options 为空数组 | 拒绝，返回 `Error: at least one option is required` |
| 用户点取消 / Esc | answer = null，返回 `User cancelled the question` |
| 用户自由输入 | wasCustom = true，answer = 输入文本 |
| 用户选预设选项 | wasCustom = false，answer = 选项 label |
| Worker 超时 | 不设超时——用户可能需要长时间思考。如需超时，通过 AbortSignal 在 worker 端 cancel |
| Worker 被 dispose | `pendingQuestionRequests` 的 Promise 永远不 resolve，但 worker 进程已销毁，无泄漏 |
| 多个 question 同时待答 | 不可能——Pi SDK 的 tool 执行是顺序的（一个 tool 执行完才执行下一个） |
| Fork 后查看历史 | details 在 session JSONL 中，fork 后自动正确 |
| 非 question 工具的 details | 忽略，只有 toolName === 'question' 时才提取 |

## 与 Pi SDK question 示例的差异

| 方面 | Pi SDK question.ts | Xi question |
|---|---|---|
| 注册方式 | Extension (`pi.registerTool`) | customTool in pi-worker.ts |
| UI 渲染 | TUI (pi-tui)：上下键选选项 | React 模态对话框：点击选择 |
| 自由输入 | 内联 Editor 组件 | 内联 textarea |
| ctx.hasUI | TUI 可用时 true，否则返回 error | 不依赖 ctx.hasUI——Xi 始终通过 IPC 弹 UI |
| 阻塞机制 | `ctx.ui.custom()` (Pi SDK 内置) | 自建 Promise + IPC 链路 |
| 取消 | Esc 键 | Esc 键 / Cancel 按钮 |
| details 格式 | `{ question, options, answer, wasCustom }` | 同（设计一致） |
| renderCall | TUI Text 渲染 | React 内联渲染 |
| renderResult | TUI Text 渲染 | React 内联渲染 |

## 未来扩展

1. **多选**：`multiSelect: true` 参数，返回 `answer: string[]`。当前不做——单选覆盖 90% 场景。
2. **超时**：可选 `timeout` 参数，超时自动返回 null。当前不做——用户思考不应被打断。
3. **默认值**：`defaultOption` 参数，高亮默认选项。当前不做——增加复杂度。
4. **questionnaire**：Pi SDK 有 `questionnaire.ts` 示例（多问题 + tab 导航）。如需多问题，可在 Xi 中实现类似 UI。当前不做。

# Spec: todowrite Tool

## 背景

Xi 的 agent 处理多步骤任务时没有进度跟踪机制。agent 在对话中说"我要做这几件事"，但随着对话滚动，用户无法快速了解整体进度，agent 自己也可能丢失上下文。

`todowrite` 让 agent 维护一个结构化任务列表：开始前建立 todo，每步完成时更新状态，用户实时看到进度。

## 设计决策

### 状态存储：tool result details

todo 状态存储在 tool result 的 `details` 字段中，不是外部文件。每次调用 `todowrite` 传入**完整 todo 数组**（非增量），最新一次 tool result 的 `details.todos` 即为当前状态。

**为什么用 details 而非外部文件**：
- Fork 时自动正确——状态在 session entry 里，fork 到任意点即获得该点快照
- 无需额外的状态文件管理
- 与 Pi SDK 的 todo 示例设计一致

### 全量替换 vs 增量更新

Agent 每次调用传入完整的新 todo 数组，tool 直接替换存储。不做 `add`/`toggle`/`clear` 等增量操作。

**理由**：
- LLM 生成增量操作容易出错（ID 混淆、状态不一致）
- 全量替换更简单，LLM 只需"这是当前完整列表"
- 减少 tool 调用次数——一次调用更新所有状态
- OpenCode 的 todowrite 就是全量替换模式

### 工具命名

`todowrite`（不是 `todo`），与 OpenCode 保持一致，语义更明确——这是一个写入操作。

## 实现

### 架构

```
Agent 调用 todowrite(todos=[...])
  │
  ▼
createTodowriteTool() in pi-worker.ts
  ├─ 校验 todos 数组
  ├─ 校验 status 值（pending / in_progress / completed）
  ├─ 校验 in_progress 唯一性（最多一个）
  ├─ 返回 { content: [{ type: 'text', text: summary }], details: { todos } }
  │
  ▼
Pi SDK 写入 session JSONL（tool result with details）
  │
  ▼
渲染层
  ├─ streaming: usePiRpc.ts → tool_execution_end 事件 → 提取 details
  ├─ history: convert-messages.ts → 从 PiToolResultMessage.details 提取
  └─ ChatView.tsx → TodoListRenderer 渲染 checklist
```

### 工具定义

```typescript
function createTodowriteTool() {
  return {
    name: 'todowrite',
    label: 'todowrite',
    description:
      'Create or update a structured task list for tracking multi-step work. ' +
      'Pass the COMPLETE todo array every time (full replacement, not incremental). ' +
      'Create the list BEFORE starting work. ' +
      'Mark exactly one item as in_progress when starting it, then completed when done. ' +
      'The user sees this list in real-time as a checklist.',
    parameters: {
      type: 'object' as const,
      properties: {
        todos: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              content: { type: 'string' as const, description: 'Brief description of the task' },
              status: {
                type: 'string' as const,
                enum: ['pending', 'in_progress', 'completed'],
                description: 'pending = not started, in_progress = actively working on it, completed = done',
              },
              priority: {
                type: 'string' as const,
                enum: ['high', 'medium', 'low'],
                description: 'Task priority level',
              },
            },
            required: ['content', 'status', 'priority'],
          },
          description: 'Complete todo list. Replaces the entire previous list.',
        },
      },
      required: ['todos'],
    },
    execute: async (_toolCallId: string, params: { todos: TodoItem[] }) => {
      const todos = params.todos ?? []

      const validStatuses = new Set(['pending', 'in_progress', 'completed'])
      const validPriorities = new Set(['high', 'medium', 'low'])

      for (const t of todos) {
        if (!validStatuses.has(t.status)) {
          return { content: [{ type: 'text' as const, text: `Error: invalid status "${t.status}"` }] }
        }
        if (!validPriorities.has(t.priority)) {
          return { content: [{ type: 'text' as const, text: `Error: invalid priority "${t.priority}"` }] }
        }
      }

      const inProgressCount = todos.filter(t => t.status === 'in_progress').length
      if (inProgressCount > 1) {
        return { content: [{ type: 'text' as const, text: 'Error: at most one todo can be in_progress at a time' }] }
      }

      const completed = todos.filter(t => t.status === 'completed').length
      const total = todos.length
      const summary = inProgressCount > 0
        ? `Todos updated: ${completed}/${total} completed, 1 in progress`
        : `Todos updated: ${completed}/${total} completed`

      return {
        content: [{ type: 'text' as const, text: summary }],
        details: { todos },
      }
    },
  }
}
```

### TodoItem 类型

```typescript
interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}
```

### System Prompt 更新

在 `systemPromptOverride` 的 `Available tools` 列表中添加：

```
- todowrite: Create or update a task list for multi-step work. Pass the COMPLETE list every time.
```

在 `Guidelines` 中添加：

```
- For tasks with 3+ steps, use todowrite to create a task list BEFORE starting work.
- Mark exactly one item as in_progress when starting it. Update it to completed when done, and mark the next item in_progress in the same call.
- Pass the COMPLETE todo array every time — do not assume the tool remembers previous state.
- Keep todo descriptions concise (one sentence per item).
- Do not create todos for trivial single-step tasks.
```

### 注册

```typescript
// pi-worker.ts → createRuntime
tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'search_sessions', 'subagent', 'webfetch', 'todowrite'],
customTools: [..., createWebfetchTool(), createTodowriteTool()],
```

## 数据流

### Streaming 路径（实时）

```
Pi SDK event: tool_execution_end
  ├─ toolName: 'todowrite'
  ├─ details: { todos: [...] }
  │
  ▼
usePiRpc.ts → handleEvent()
  ├─ 现有逻辑：从 content 提取 TextBlock → ToolResultBlock
  └─ 新增：从 details 提取 todos → 存入 ToolResultBlock.details
  │
  ▼
ChatView.tsx → ToolCallRenderer
  ├─ 检测 block.toolName === 'todowrite'
  └─ 用 TodoListRenderer 替代默认文本渲染
```

### History 路径（加载历史 session）

```
pi-worker.ts → get_messages RPC → PiToolResultMessage[]
  ├─ 每条 toolResult 消息有 details: { todos: [...] }
  │
  ▼
convert-messages.ts → convertPiMessagesToChatMessages()
  ├─ 现有逻辑：从 content 提取 TextBlock/ImageBlock/HtmlBlock → ToolResultBlock
  └─ 新增：从 msg.details 提取 todos → 存入 ToolResultBlock.details
  │
  ▼
ChatView.tsx（同 streaming 路径）
```

## 类型修改

### message.ts — ToolResultBlock 新增 details 字段

```typescript
// 现有
export interface ToolResultBlock {
  type: 'tool_result';
  toolCallId: string;
  content: ContentBlock[];
}

// 修改后
export interface ToolResultBlock {
  type: 'tool_result';
  toolCallId: string;
  content: ContentBlock[];
  details?: TodoDetails;
}

export interface TodoDetails {
  todos: TodoItem[];
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}
```

`details` 是可选字段——只有 `todowrite` 工具的结果会有它，其他工具的 tool result 不受影响。

### convert-messages.ts — 提取 details

在 `convertPiMessagesToChatMessages` 的 `toolResult` 分支中（约 line 206-259），构建 `ToolResultBlock` 时传入 details：

```typescript
// 现有（约 line 252-258）
if (resultBlocks.length > 0) {
  lastAssistant.blocks.push({
    type: 'tool_result',
    toolCallId: msg.toolCallId as string || '',
    content: resultBlocks,
  })
}

// 修改后
if (resultBlocks.length > 0) {
  lastAssistant.blocks.push({
    type: 'tool_result',
    toolCallId: msg.toolCallId as string || '',
    content: resultBlocks,
    details: msg.toolName === 'todowrite' && msg.details
      ? { todos: (msg.details as { todos?: TodoItem[] }).todos ?? [] }
      : undefined,
  })
}
```

### usePiRpc.ts — streaming 路径提取 details

在 `tool_execution_end` 事件处理中，构建 `ToolResultBlock` 时传入 details。具体位置需要找到处理 `tool_execution_end` 的代码块，添加 details 提取逻辑。

## UI 渲染

### TodoListRenderer 组件

在 `ChatView.tsx` 中新增组件，当 `ToolCallRenderer` 检测到 `block.toolName === 'todowrite'` 时，用 `TodoListRenderer` 替代默认的文本输出渲染。

```tsx
function TodoListRenderer({ todos }: { todos: TodoItem[] }) {
  const statusIcon = {
    completed: '☑',
    in_progress: '►',
    pending: '☐',
  }
  const statusColor = {
    completed: 'text-green-500',
    in_progress: 'text-blue-500',
    pending: 'text-gray-400',
  }
  const priorityDot = {
    high: 'bg-red-400',
    medium: 'bg-yellow-400',
    low: 'bg-gray-400',
  }

  return (
    <div className="py-1 space-y-0.5">
      {todos.map((todo, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
          <span className={statusColor[todo.status]}>{statusIcon[todo.status]}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${priorityDot[todo.priority]}`} />
          <span className={todo.status === 'completed'
            ? 'text-gray-400 line-through'
            : todo.status === 'in_progress'
              ? 'text-blue-400'
              : 'text-gray-300'}>
            {todo.content}
          </span>
          {todo.status === 'in_progress' && (
            <svg className="h-3 w-3 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}
```

### ToolCallRenderer 集成

在 `ToolCallRenderer` 中，渲染 tool result 内容时检测 todowrite：

```tsx
// 在 ToolCallRenderer 的 expanded 区域，渲染 result 内容之前
const todoDetails = result?.details?.todos

// 如果是 todowrite 且有 todos，用 TodoListRenderer
{todoDetails && todoDetails.length > 0 ? (
  <TodoListRenderer todos={todoDetails} />
) : (
  /* 现有的文本输出渲染逻辑 */
)}
```

### toolIcon 新增

```typescript
const toolIcon: Record<string, string> = {
  // ... 现有 ...
  todowrite: '📋',
}
```

### headerSummary 新增

```typescript
case 'todowrite': {
  if (result?.details?.todos) {
    const todos = result.details.todos
    const completed = todos.filter(t => t.status === 'completed').length
    headerSummary = `${completed}/${todos.length} tasks`
  } else {
    headerSummary = ''
  }
  break
}
```

### 视觉效果

折叠状态（默认）：
```
┌─ Xi ────────────────────────────────────────┐
│                                              │
│  📋 todowrite  2/4 tasks              ✓      │  ← 一行摘要
│  ─────────────────────────────────────────── │
│                                              │
└──────────────────────────────────────────────┘
```

展开状态：
```
┌─ Xi ────────────────────────────────────────┐
│                                              │
│  📋 todowrite  2/4 tasks              ✓      │
│  │  ☑ ● 读取 package.json          high     │  ← completed, 绿色, 删除线
│  │  ☑ ● 修改依赖版本号             high     │  ← completed, 绿色, 删除线
│  │  ► ● 运行 npm install           medium   │  ← in_progress, 蓝色, spinner
│  │  ◐ ○ 跑测试验证                 medium   │  ← pending, 灰色
│  │                                           │
│  ─────────────────────────────────────────── │
│                                              │
└──────────────────────────────────────────────┘
```

## 修改的文件

| 文件 | 改动 |
|---|---|
| `src/main/pi-worker.ts` | 新增 `createTodowriteTool()` 函数 + `TodoItem` 接口；`tools` 数组添加 `'todowrite'`；`customTools` 添加 `createTodowriteTool()`；system prompt 添加工具说明和 guideline |
| `src/renderer/src/types/message.ts` | `ToolResultBlock` 新增 `details?: TodoDetails`；新增 `TodoDetails` 和 `TodoItem` 接口 |
| `src/renderer/src/utils/convert-messages.ts` | `toolResult` 分支提取 `msg.details` → `ToolResultBlock.details` |
| `src/renderer/src/hooks/usePiRpc.ts` | `tool_execution_end` 事件处理中提取 `details` → `ToolResultBlock.details` |
| `src/renderer/src/components/ChatView.tsx` | 新增 `TodoListRenderer` 组件；`ToolCallRenderer` 中集成 todowrite 专属渲染；`toolIcon` 和 `headerSummary` 新增 todowrite case |

## 边界情况

| 场景 | 处理 |
|---|---|
| 空 todos 数组 | 允许（清空列表），返回 "Todos updated: 0/0 completed" |
| 多个 in_progress | 拒绝，返回错误 |
| 无效 status 值 | 拒绝，返回错误 |
| 无效 priority 值 | 拒绝，返回错误 |
| content 为空字符串 | 允许（不报错），但不推荐 |
| Fork 后状态 | 自动正确——最新 tool result 的 details 就是当前状态 |
| 历史加载 | convert-messages.ts 从 details 提取 todos |
| 非 todowrite 工具的 details | 忽略，只有 toolName === 'todowrite' 时才提取 |

## 与 Pi SDK todo 示例的差异

| 方面 | Pi SDK todo.ts | Xi todowrite |
|---|---|---|
| 注册方式 | Extension (`pi.registerTool`) | customTool in pi-worker.ts |
| 操作模式 | 增量（add/toggle/clear） | 全量替换 |
| 状态存储 | tool result details | 同 |
| UI 渲染 | TUI (pi-tui) | React (ChatView.tsx) |
| 命令 | `/todos` 命令查看 | 无命令，直接在 tool call 中展示 |
| Todo ID | 数字 ID（nextId 递增） | 无 ID（数组索引即可） |

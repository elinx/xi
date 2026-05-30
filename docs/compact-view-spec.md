# Compact View Spec

## Overview

在聊天界面顶部增加一个 **三档视图切换**按钮，支持 Normal / Turn / Outline 三种模式，帮助用户在长对话中快速浏览对话脉络、定位关键内容。

## Motivation

Agent 对话中存在大量 tool call（`bash`、`read`、`edit` 等）和 tool result，单轮交互可能产生 5–10 条消息。长对话下：

- 用户难以快速定位自己的输入和 agent 的最终回复
- 大段 tool output（日志、文件内容）占据大量屏幕空间
- 上下文扫描成本高，关键信息被淹没

Compact View 让用户一键"收起"所有细节，只看对话骨架，再按需展开感兴趣的轮次。

## Design Principles

1. **Turn-based 分组** — 以"对话轮次"（user 问 + agent 答）为基本视觉单元，而非单条消息。符合用户"我问了什么 → 它答了什么"的心智模型
2. **三档渐进式折叠** — Normal → Turn → Outline，信息量逐步精简，用户按需选择
3. **不丢失信息** — 任何模式下切换回 Normal 都完整还原
4. **单轮可展开** — Turn / Outline 模式下点击某一轮可内联展开完整内容
5. **状态持久** — 视图模式偏好持久化到 localStorage，重启应用后恢复

## View Modes

### Normal

当前的完整渲染模式，所有消息按现有逻辑逐条展示，不做任何折叠。

### Turn

将每轮对话（user 消息 + 紧随的 assistant 消息）合并为一个卡片，每个卡片占两行：

```
┌──────────────────────────────────────────────────────────┐
│ 👤 帮我写一个快速排序的 Python 实现                        │
│    ↳ 🤖 提供了 Python 实现，时间复杂度 O(n log n)   🔧×2   │
├──────────────────────────────────────────────────────────┤
│ 👤 加上单元测试                                           │
│    ↳ 🤖 新增 test_sort.py，3 个测试用例全部通过      🔧×1   │
├──────────────────────────────────────────────────────────┤
│ 👤 优化一下性能                                           │
│    ↳ 🤖 改用迭代写法，避免栈溢出                     🔧×2   │
└──────────────────────────────────────────────────────────┘
```

- 第一行：user 的提问（截断至 80 字符）
- 第二行：agent 回复摘要（文本首行 + tool call 合并统计）
- 点击任意一轮可展开完整内容

### Outline

只显示每轮对话的 user 提问，每轮一行：

```
┌──────────────────────────────────────────────────────────┐
│ 👤 帮我写一个快速排序的 Python 实现                        │
├──────────────────────────────────────────────────────────┤
│ 👤 加上单元测试                                           │
├──────────────────────────────────────────────────────────┤
│ 👤 优化一下性能                                           │
└──────────────────────────────────────────────────────────┘
```

- 最精简的视图，适合快速扫描所有提问、定位某次对话
- 点击某行可展开该轮完整内容（user + agent）

### 三档关系

Outline 是 Turn 的子集——隐藏了 agent 摘要行就是 Outline。三者是渐进式的：

```
Normal  ──折叠──▶  Turn  ──折叠──▶  Outline
 (全量)            (骨架)            (提问索引)
```

## User Interface

### 顶栏按钮

在顶栏右侧按钮区域添加视图切换按钮，三档循环切换：

```
[🟢 Pi Connected] [Session Name]     [📋 Normal] [🗑️] [Stop]
                                       ↓ 点击
                                    [📑 Turn]
                                       ↓ 点击
                                    [📝 Outline]
                                       ↓ 点击
                                    [📋 Normal]
```

- 按钮文字随当前模式变化：`Normal` / `Turn` / `Outline`
- 按钮图标随模式变化：📋 → 📑 → 📝
- 点击循环切换：Normal → Turn → Outline → Normal
- 当前模式按钮高亮显示

### Turn 模式下的摘要规则

每轮对话合并为一个卡片。卡片内 user 行和 agent 行的摘要规则如下：

#### User 行

| Block 类型 | 摘要 |
|---|---|
| text | 第一行纯文本，截断至 80 字符 |
| image | `🖼️ [alt 或 "image"]` |
| html | `🌐 [title 或 "HTML"]` |

多个 block 用 ` · ` 连接。

#### Agent 行

| Block 类型 | 摘要 |
|---|---|
| text | 第一行纯文本，截断至 80 字符 |
| tool_call | 合并统计：`🔧 bash ×3, read ×2`，含状态标记 |
| tool_result | 隐藏，不计入摘要 |
| image | `🖼️ ×2` |
| html | `🌐 ×1` |

各类型摘要用 ` · ` 连接。若 agent 行无文本 block（纯 tool call 轮次），仅显示 tool call 统计。

### 单轮展开交互

Turn / Outline 模式下，点击某一轮的卡片：

- **单击** — 内联展开该轮所有消息的完整内容（Normal 模式的渲染方式）
- **再次单击** 或点击展开区域右上角的"收起"按钮 — 折叠回摘要

展开的卡片应有视觉区分：
- 左侧加蓝色竖线（3px）
- 背景色微变为浅蓝 `bg-blue-50/30`
- 右上角显示"收起"按钮

### 示例

**Normal 模式：**

```
┌─────────────────────────────────────────────────┐
│ You                                              │
│ 帮我写一个快速排序的 Python 实现                    │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│ Pi                                               │
│ ▶ bash   python3 -c "print('hello')"             │
│   (展开后显示输出)                                 │
│ ▶ edit   sort.py                                 │
│   (展开后显示文件内容)                              │
│ 好的，以下是快速排序的实现：                         │
│ ```python                                        │
│ def quicksort(arr): ...                          │
│ ```                                              │
└─────────────────────────────────────────────────┘
```

**Turn 模式：**

```
┌──────────────────────────────────────────────────────────┐
│ 👤 帮我写一个快速排序的 Python 实现                        │
│    ↳ 🤖 好的，以下是快速排序的实现…                  🔧×2   │
└──────────────────────────────────────────────────────────┘
```

**Turn 模式 + 展开第二轮：**

```
┌──────────────────────────────────────────────────────────┐
│ 👤 帮我写一个快速排序的 Python 实现                        │
│    ↳ 🤖 好的，以下是快速排序的实现…                  🔧×2   │
├──────────────────────────────────────────────────────────┤
│ 👤 加上单元测试                                    [收起]  │
│ ┃ ↳ 🤖 新增 test_sort.py，3 个测试用例全部通过      🔧×1   │
│ ┃                                                   │
│ ┃ Pi                                               │
│ ┃ ▶ edit   test_sort.py                            │
│ ┃   (完整输出)                                      │
│ ┃ 新增了 3 个测试用例，运行结果全部通过。              │
└──────────────────────────────────────────────────────────┘
├──────────────────────────────────────────────────────────┤
│ 👤 优化一下性能                                           │
│    ↳ 🤖 改用迭代写法，避免栈溢出                     🔧×2   │
└──────────────────────────────────────────────────────────┘
```

**Outline 模式：**

```
┌──────────────────────────────────────────────────────────┐
│ 1  帮我写一个快速排序的 Python 实现                        │
├──────────────────────────────────────────────────────────┤
│ 2  加上单元测试                                           │
├──────────────────────────────────────────────────────────┤
│ 3  优化一下性能                                           │
└──────────────────────────────────────────────────────────┘
```

## Implementation Plan

### 1. View Mode Type

```typescript
type ViewMode = 'normal' | 'turn' | 'outline'
```

### 2. Turn 分组逻辑

新增工具函数，将扁平消息列表按轮次分组：

```typescript
interface ConversationTurn {
  id: string              // 用 user 消息的 id 作为 turn id
  userMessage: ChatMessage
  assistantMessages: ChatMessage[]   // 紧随该 user 消息之后、直到下一个 user 消息之前的所有 assistant 消息
}

function groupByTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentTurn: ConversationTurn | null = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      currentTurn = { id: msg.id, userMessage: msg, assistantMessages: [] }
      turns.push(currentTurn)
    } else if (currentTurn) {
      currentTurn.assistantMessages.push(msg)
    }
    // system 消息忽略或作为元数据
  }

  return turns
}
```

### 3. 摘要生成

```typescript
function getUserSummary(msg: ChatMessage): string {
  const parts: string[] = []
  for (const block of msg.blocks) {
    if (block.type === 'text') {
      const firstLine = block.content.split('\n').find(l => l.trim()) ?? ''
      parts.push(truncate(firstLine.trim(), 80))
    } else if (block.type === 'image') {
      parts.push(`🖼️ ${block.alt ?? 'image'}`)
    } else if (block.type === 'html') {
      parts.push(`🌐 ${block.title ?? 'HTML'}`)
    }
  }
  return parts.join(' · ') || '(empty)'
}

function getAgentSummary(messages: ChatMessage[]): string {
  const parts: string[] = []

  // 合并所有 tool call
  const toolCounts: Record<string, number> = {}
  for (const msg of messages) {
    for (const block of msg.blocks) {
      if (block.type === 'tool_call') {
        toolCounts[block.toolName] = (toolCounts[block.toolName] || 0) + 1
      }
    }
  }
  if (Object.keys(toolCounts).length > 0) {
    const summary = Object.entries(toolCounts)
      .map(([name, count]) => count > 1 ? `${name} ×${count}` : name)
      .join(', ')
    parts.push(`🔧 ${summary}`)
  }

  // 取第一个文本 block 的第一行
  for (const msg of messages) {
    const textBlock = msg.blocks.find(b => b.type === 'text') as TextBlock | undefined
    if (textBlock) {
      const firstLine = textBlock.content.split('\n').find(l => l.trim()) ?? ''
      parts.push(truncate(firstLine.trim(), 80))
      break
    }
  }

  // Image / HTML 统计
  let imgCount = 0, htmlCount = 0
  for (const msg of messages) {
    for (const block of msg.blocks) {
      if (block.type === 'image') imgCount++
      if (block.type === 'html') htmlCount++
    }
  }
  if (imgCount > 0) parts.push(`🖼️ ×${imgCount}`)
  if (htmlCount > 0) parts.push(`🌐 ×${htmlCount}`)

  return parts.join(' · ') || '(no response)'
}
```

### 4. State

在 `App.tsx` 中管理视图模式状态（以便持久化）：

```typescript
const [viewMode, setViewMode] = useState<ViewMode>(() => {
  return (localStorage.getItem('pi-view-mode') as ViewMode) || 'normal'
})

const cycleViewMode = useCallback(() => {
  setViewMode(prev => {
    const next = prev === 'normal' ? 'turn' : prev === 'turn' ? 'outline' : 'normal'
    localStorage.setItem('pi-view-mode', next)
    return next
  })
}, [])
```

`ChatView` 中管理单轮展开状态：

```typescript
const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set())

const toggleTurn = (turnId: string) => {
  setExpandedTurns(prev => {
    const next = new Set(prev)
    if (next.has(turnId)) next.delete(turnId)
    else next.add(turnId)
    return next
  })
}
```

### 5. 渲染逻辑

`ChatView` 根据 `viewMode` 分支渲染：

```typescript
// Normal 模式 — 现有逻辑不变
if (viewMode === 'normal') {
  return <NormalMessageList messages={messages} ... />
}

// Turn / Outline 模式
const turns = groupByTurns(messages)
return (
  <div className="space-y-1">
    {turns.map(turn => {
      const isExpanded = expandedTurns.has(turn.id)

      if (isExpanded) {
        // 展开模式：显示完整 user + assistant 内容，带左侧蓝色竖线 + 收起按钮
        return (
          <div key={turn.id} className="border-l-3 border-blue-500 bg-blue-50/30 rounded-r-lg px-4 py-2">
            <div className="flex justify-end">
              <button onClick={() => toggleTurn(turn.id)}>收起</button>
            </div>
            {/* 完整渲染 turn.userMessage */}
            {/* 完整渲染 turn.assistantMessages */}
          </div>
        )
      }

      // 折叠模式
      return (
        <div key={turn.id} onClick={() => toggleTurn(turn.id)} className="cursor-pointer rounded-lg px-4 py-2 hover:bg-gray-100">
          <div className="text-sm">
            <span className="text-gray-500 font-medium">👤</span>{' '}
            <span className="text-gray-800">{getUserSummary(turn.userMessage)}</span>
          </div>
          {viewMode === 'turn' && (
            <div className="text-sm text-gray-500 mt-0.5 pl-6">
              ↳ 🤖 {getAgentSummary(turn.assistantMessages)}
            </div>
          )}
        </div>
      )
    })}
  </div>
)
```

### 6. Props 变更

`ChatView` 新增 props：

```typescript
interface ChatViewProps {
  // ... 现有 props
  viewMode: ViewMode
}
```

`App.tsx` 管理 `viewMode` state 并传递。

### 7. 状态持久化

`viewMode` 偏好存入 `localStorage`，已在上方 `cycleViewMode` 中实现。

### 8. Outline 模式序号（可选增强）

Outline 模式下可在每行前加序号，方便用户定位和引用：

```
│ 1  帮我写一个快速排序的 Python 实现     │
│ 2  加上单元测试                        │
│ 3  优化一下性能                        │
```

## Files to Modify

| 文件 | 改动 |
|---|---|
| `src/renderer/src/components/ChatView.tsx` | 添加 Turn / Outline 渲染逻辑、`groupByTurns`、摘要生成函数、单轮展开交互 |
| `src/renderer/src/App.tsx` | 添加 `viewMode` state、顶栏三档切换按钮、传递 props |

## Edge Cases

| 场景 | 处理 |
|---|---|
| 对话开头有 system 消息 | `groupByTurns` 中跳过，不归入任何 turn |
| 连续多条 assistant 消息 | 全部归入当前 turn 的 `assistantMessages` |
| 只有 user 没有 assistant 回复（最新一轮） | turn 中 `assistantMessages` 为空，agent 行显示 `🤖 (waiting...)` |
| 空消息（无 block） | 摘要显示 `(empty)` |
| 只有 tool_result 的 assistant 消息 | 摘要中不单独显示，被 tool call 统计覆盖 |
| 正在流式传输 | Turn / Outline 模式下自动展开当前最后一轮（正在写入的轮次），方便用户实时查看 |
| 单轮展开后新消息到达 | 若展开的轮次有新 assistant 消息追加，保持展开状态，实时更新 |

## Open Questions

1. **快捷键** — 是否需要键盘快捷键切换视图模式？如 `Cmd+Shift+V` 循环切换
2. **按类型过滤** — 是否在 Turn 模式下增加细粒度过滤？如 "只折叠 tool result" 或 "只折叠 bash 输出"
3. **自动切换** — 是否在对话超过一定长度（如 50 条消息）时自动提示切换到 Turn 模式？
4. **展开动画** — 单轮展开/折叠是否需要过渡动画？还是直接切换？
5. **搜索联动** — 未来加搜索功能时，搜索结果是否自动展开匹配的轮次？

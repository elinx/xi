# Spec: 转发消息 (Forward Message)

## 背景

用户在多 session 工作流中需要把一个 session 中的消息「带到」另一个 session。当前的实现通过 `switchSession(target)` + `sendPrompt()` + `switchSession(prev)` 来完成，存在严重问题：

1. **卡死**：Pi 同一时刻只能有一个活跃 session。`sendPrompt` 触发目标 session 的 agent 开始回复，随后 `switchSession(prev)` 销毁目标 session 的 runtime，导致卡住
2. **语义错误**：Forward 不应该等于「在目标 session 里发 prompt 让 agent 回复」。转发是「投递消息」，不是「触发对话」
3. **丢失上下文**：切走再切回的过程中，源 session 的 streaming 状态可能丢失

## 核心洞察

**Forward 本质上是跨 session 的 Quote。**

| | Quote | Forward |
|---|---|---|
| 来源 | 当前 session 内的消息 | 其他 session 的消息 |
| 投递位置 | 当前 session 输入框上方 | 目标 session 输入框上方 |
| 发送时 | 附加到 prompt 前缀 | 附加到 prompt 前缀 |
| 持久化 | 发送时随 prompt 持久化 | 发送时随 prompt 持久化 |
| 重启丢失 | 是（当前行为） | 是（设计如此） |

两者唯一的区别是来源不同。显示方式、交互行为、发送逻辑完全一致。

## 设计

### 1. 数据模型

扩展现有 `QuotedMessage`，增加可选的来源 session 信息：

```typescript
interface QuotedMessage {
  messageId: string
  role: 'user' | 'assistant'
  content: string        // 纯文本摘要，max 200 chars
  timestamp: number
  // 新增：来源 session（有值 = Forward，无值 = Quote）
  sourceSessionPath?: string
  sourceSessionName?: string
}
```

不引入新类型。Quote 和 Forward 共用 `QuotedMessage`，通过 `sourceSessionPath` 是否存在区分。

### 2. 存储：按 session 分区

Quote 属于当前 session，切走就清空。Forward 属于目标 session，切走后仍保留。

```typescript
// 当前：只有当前 session 的 quotes
const [quotes, setQuotes] = useState<QuotedMessage[]>([])

// 新增：其他 session 的 pending forwards
// key = sessionPath, value = 待处理的引用列表
const [pendingForwards, setPendingForwards] = useState<Map<string, QuotedMessage[]>>(new Map())
```

**当前 session 输入框上方显示的引用 = `quotes` + `pendingForwards[currentSessionPath]`**

### 3. Forward 流程

```
源 session A                              目标 session B
  │                                          │
  │  用户选消息 → Forward → 选 session B       │
  │                                          │
  │  1. 构造 QuotedMessage                   │
  │     (带 sourceSessionPath/Name)           │
  │  2. pendingForwards[B.path].push(msg)    │
  │  3. toast: "已转发到 experiment-1"        │
  │  4. 源 session 无其他变化                  │
  │                                          │
  │                             用户切到 B 时：│
  │                             输入框上方出现 │
  │                             转发的引用卡片 │
  │                                          │
  │                             用户输入 + Send│
  │                             → 引用随 prompt 发出
  │                             → pendingForwards[B.path] 清空
  │                             → 正常持久化到 B 的历史
```

### 4. 显示：与 Quote 统一

输入框上方的引用区域同时展示 Quote 和 Forward，视觉上用颜色/标签区分：

```
┌──────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────┐ │
│ │ 📎 You · 2 min ago                  [✕] │ │  ← Quote（蓝色）
│ │ 这个函数的性能有问题                     │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ ↗ "experiment-1" · Pi · 5 min ago  [✕] │ │  ← Forward（紫色，带来源标签）
│ │ 我已经优化了缓存策略...                 │ │
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ [输入框]                                      │
└──────────────────────────────────────────────┘
```

- Quote 卡片：蓝色左边框，显示发送者 + 时间
- Forward 卡片：紫色左边框，显示来源 session 名 + 发送者 + 时间
- 两者共享同一个可折叠、可移除的卡片区域
- 每条卡片右侧有 ✕ 可单独移除
- 有"清除全部"按钮

### 5. 发送逻辑

发送时 Quote 和 Forward 的内容统一拼入 prompt，格式相同：

```typescript
let finalText = ''
for (const q of [...quotes, ...pendingForwardsForCurrentSession]) {
  if (q.sourceSessionName) {
    finalText += `[Forwarded ${q.role} message from "${q.sourceSessionName}"]:\n${q.content}\n\n`
  } else {
    finalText += `[Quoted ${q.role} message]:\n${q.content}\n\n`
  }
}
finalText += userText
```

发送后：
- `quotes` 清空（当前行为）
- `pendingForwards[currentSessionPath]` 清空

### 6. 多选 Forward

支持选中多条消息后一起转发。每条消息作为独立的 `QuotedMessage` 追加到 `pendingForwards[targetPath]`。

### 7. 切换 session 时的行为

| 动作 | quotes | pendingForwards |
|------|--------|-----------------|
| 切到 session B | 清空（当前行为） | 保留所有 session 的 forwards |
| 在 session B 看到 forwards | — | 如果 `pendingForwards[B.path]` 非空，输入框上方显示 |
| 在 session B 发送 | 清空 quotes + 清空 `pendingForwards[B.path]` | 其他 session 的 forwards 不受影响 |
| 从 session A forward 到 B | 不影响 A 的 quotes | `pendingForwards[B.path].push(...)` |

### 8. App 重启

`pendingForwards` 不持久化，重启后丢失。与 Quote 的行为一致——合理，因为这些都是即时操作意图，不是持久数据。

## 实现方案

### 改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/renderer/src/App.tsx` | 改动 | 新增 `pendingForwards` state；替换 `handleForwardMessage`；InputBar 传入合并后的引用列表 |
| `src/renderer/src/components/InputBar.tsx` | 改动 | 接收合并后的 quotes+forwards；Forward 卡片用紫色样式 |
| `src/renderer/src/components/QuoteCard.tsx` | 改动 | 根据 `sourceSessionName` 区分 Quote/Forward 样式 |
| `src/renderer/src/components/ChatView.tsx` | 改动 | Forward 交互适配 |

### 不需要的改动

- ❌ `session-service.ts` — 不写 JSONL
- ❌ `main/index.ts` — 不新增 IPC
- ❌ `preload/index.ts` — 不暴露新 API
- ❌ `pi-worker.ts` — 不涉及 Pi RPC

### 删除的代码

- `App.tsx` 中 `handleForwardMessage` 的旧实现（switchSession + sendPrompt + abort + switchBack）
- `ChatView.tsx` 中 `onForwardMessage` 对 session 切换的依赖

## 交互流程

```
用户在 session A 右键消息 → Forward → 选择 session B
  │
  ▼
构造 QuotedMessage(sourceSessionPath=B.path, sourceSessionName="experiment-1")
追加到 pendingForwards[B.path]
  │
  ▼
源 session A: toast "已转发到 experiment-1"，无其他变化
  │
  ▼
用户切换到 session B
  │
  ▼
输入框上方出现紫色的 Forward 引用卡片
（显示: ↗ "experiment-1" · Pi · 5 min ago [✕]）
  │
  ├─ 点击 ✕ 移除该转发
  ├─ 点击"清除全部"移除所有引用
  │
  ▼
用户输入框输入问题 + 点 Send
  │
  ▼
prompt = [Forwarded assistant message from "experiment-1"]:\n...\n\n + 用户输入
正常发送到 Pi，持久化到 B 的历史
  │
  ▼
pendingForwards[B.path] 清空
```

## 边界情况

| 场景 | 处理 |
|------|------|
| 转发到当前 session | 拒绝，session picker 不列出当前 session |
| Forward + Quote 同时存在 | 正常，输入框上方按顺序排列 |
| 多次 Forward 到同一 session | 追加到 `pendingForwards[targetPath]`，卡片堆叠 |
| Forward 后用户一直不切到目标 session | forwards 保留在内存，直到用户切过去或 app 重启 |
| App 重启 | `pendingForwards` 丢失，可接受 |
| 转发 assistant 的长回复 | content 截断 200 chars（与 Quote 一致），发送时用完整内容 |
| 转发的消息包含图片/文件 | 只转发纯文本，忽略非文本 block |
| 转发时目标 session 正在 streaming | 不影响，forward 只是内存操作 |
| 在 lazy-switch 模式下转发 | 正常工作，forward 写入内存，不涉及 Pi |

## 与旧实现的对比

| | 旧实现 | 新实现 |
|---|---|---|
| 切换 session | switchSession + switchBack | 不切换 |
| 触发 agent | 是（卡死根源） | 否 |
| 写入 JSONL | 否（但 sendPrompt 间接写入） | 否（纯内存） |
| 持久化时机 | sendPrompt 时 | 用户在目标 session 发送时 |
| 源 session 影响 | streaming 被中断 | 零影响 |
| 多选支持 | 困难 | 追加多条到 pendingForwards |
| 显示位置 | 无（直接发送了） | 目标 session 输入框上方（与 Quote 统一） |
| 重启丢失 | 否（已写入历史） | 是（内存暂存） |
| 新增 IPC/Main 代码 | 无 | 无（纯 renderer 改动） |

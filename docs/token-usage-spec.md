# Token Usage Stamina Ring Spec

## Overview

在 App Bar 右侧添加一个**圆环精力指示器**，以塞尔达精力环的风格展示当前 session 的 token 使用量。精力充裕时显示绿色，逐渐过渡到黄色、橙色，耗尽前闪烁红色。

## Visual Design

### 圆环样式

- 尺寸：36px × 36px
- 描边宽度：4px（比原型的 3px 更粗，视觉更醒目）
- 背景环：`#e5e7eb`（浅灰）
- 填充环：根据使用比例动态变色
- 填充方向：从顶部顺时针绘制（SVG `rotate(-90deg)`）
- 端点：圆角 (`stroke-linecap: round`)
- 中心文字：百分比，字号 9px，font-weight 600

### 颜色规则

| 使用比例 | 颜色 | 说明 |
|----------|------|------|
| 0% – 50% | `#22c55e` (绿) | 精力充裕 |
| 50% – 75% | 绿 → `#eab308` (黄) 渐变 | 开始消耗 |
| 75% – 90% | 黄 → `#f97316` (橙) 渐变 | 需要注意 |
| 90% – 100% | 橙 → `#ef4444` (红) 渐变 + 闪烁 | 即将耗尽 |

颜色插值公式：

```
pct = usedTokens / contextWindowSize

if pct < 0.5:
  color = #22c55e
elif pct < 0.75:
  t = (pct - 0.5) / 0.25
  interpolate #22c55e → #eab308 by t
elif pct < 0.9:
  t = (pct - 0.75) / 0.15
  interpolate #eab308 → #f97316 by t
else:
  t = min(1, (pct - 0.9) / 0.1)
  interpolate #f97316 → #ef4444 by t
```

### 闪烁动画

当使用比例 ≥ 90% 时，填充环触发 CSS 动画：

```css
@keyframes pulse-critical {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.stamina-ring-fill.critical {
  animation: pulse-critical 1s ease-in-out infinite;
}
```

### Hover 详情弹窗

鼠标悬停圆环时，在下方弹出深色 tooltip，展示 token 分解：

```
┌──────────────────────┐
│  Input:     45.2K    │
│  Output:    15.8K    │
│  Cache Read: 12.0K   │
│  ──────────────────  │
│  Used:      60.0K    │
│  Window:   200.0K    │
│  Remaining: 140.0K   │
│  Cost:      $0.18    │
└──────────────────────┘
```

- 背景：`#1a1a2e`
- 文字：白色，label 灰色 `#aaa`
- 字号：11px
- 圆角：6px
- 出现/消失：`opacity` 过渡 0.2s

## Placement

嵌入 App Bar，位于 "Pi Connected" 指示灯和 session 名称的右侧，view mode 切换按钮的左侧：

```
[● Pi Connected | My Session]  ...  [⟳ 70%] [Normal|Turn|Outline] [Connect]
```

## Data Source

### 已有数据

Pi RPC 事件中 `PiAssistantMessage.usage` 提供了每个 assistant 消息的 token 用量：

```typescript
interface PiAssistantMessage {
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    totalTokens: number
    cost: {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      total: number
    }
  }
}
```

### Context Window 大小

需要知道 context window 上限来计算使用比例。两种方式：

1. **从 model 名推断**：`PiAssistantMessage.responseModel` 包含模型名（如 `claude-sonnet-4-20250514`），可映射到 window 大小
2. **动态获取**：如果 Pi SDK 暴露了 session 的 context window 配置，优先使用

默认映射表：

| Model 系列 | Context Window |
|------------|---------------|
| claude-sonnet-4 | 200K |
| claude-opus-4 | 200K |
| claude-3.5-sonnet | 200K |
| claude-3-haiku | 200K |
| gpt-4o | 128K |
| 默认 | 200K |

### 累加逻辑

每次收到 `message_update` 事件的 `done` 子事件或 `message_end` 事件时，提取 `usage` 并累加到 session 总用量：

```typescript
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  totalCost: number
  contextWindowSize: number
}
```

- `inputTokens`: 累加每条 assistant 消息的 `usage.input`
- `outputTokens`: 累加每条 assistant 消息的 `usage.output`
- `totalTokens`: 当前上下文中实际使用的 token 数（取最近一条 assistant 消息的 `usage.input + usage.output` 作为近似，因为 context 是累积的）
- `contextWindowSize`: 从 model 推断

> **注意**：`usage.input` 已经包含了之前所有对话的 token（因为每轮的 input 包含历史），所以**不能简单累加**。正确做法是取最新一条 assistant 消息的 `usage.input + usage.output` 作为当前 context 占用量的近似值。

## Implementation Plan

### 1. 新增组件 `TokenUsageRing`

路径：`src/renderer/src/components/TokenUsageRing.tsx`

Props：
```typescript
interface TokenUsageRingProps {
  usedTokens: number
  contextWindowSize: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalCost: number
}
```

组件内部：
- 根据 `usedTokens / contextWindowSize` 计算比例和颜色
- 渲染 SVG 圆环 + 中心百分比文字
- 渲染 hover tooltip

### 2. 在 `usePiRpc` 中追踪 token 用量

新增 state：
```typescript
const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  contextWindowSize: 200000,
})
```

在 `handleEvent` 的 `message_update` → `done` 子事件和 `message_end` 事件中提取 usage：

```typescript
case 'done': {
  const msg = ame.message  // PiAssistantMessage
  if (msg.usage) {
    setTokenUsage({
      inputTokens: msg.usage.input,
      outputTokens: msg.usage.output,
      cacheReadTokens: msg.usage.cacheRead,
      cacheWriteTokens: msg.usage.cacheWrite,
      totalTokens: msg.usage.input + msg.usage.output,
      totalCost: msg.usage.cost.total,
      contextWindowSize: inferContextWindow(msg.responseModel),
    })
  }
  break
}
```

在 `loadHistory` 中从历史消息提取最新的 usage。

在 `clearMessages` 时重置 tokenUsage。

### 状态恢复（重启 / 切换 session 后）

Token 用量不需要 localStorage 持久化——它始终从 Pi 的历史消息中恢复：

1. App 启动 → 连接 Pi → `loadHistory()` → `get_messages` RPC 返回历史
2. 从历史中**最后一条 assistant 消息**的 `usage` 字段恢复 tokenUsage
3. `setTokenUsage()` 必须在 `clearMessages()` **之后**调用，否则会被清零覆盖

切换 session 时流程相同：`switchSession` → `clearMessages()` → `loadHistory()` → `setTokenUsage(恢复值)`。

如果历史中无 assistant 消息或 usage 字段缺失，圆环显示 0%。

### 3. 在 `App.tsx` 中接入

从 `usePiRpc` 获取 `tokenUsage`，传递给 `TokenUsageRing` 组件，放置在 App Bar 中。

### 4. 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/renderer/src/components/TokenUsageRing.tsx` | 新增 |
| `src/renderer/src/hooks/usePiRpc.ts` | 新增 `tokenUsage` state，在事件中提取 usage |
| `src/renderer/src/App.tsx` | 接入 `tokenUsage`，在 App Bar 中渲染 `TokenUsageRing` |

## Future Enhancements

- **Compaction 感知**：监听 `compaction_start` / `compaction_end` 事件，compaction 后 token 用量会下降，圆环应反映这一点
- **Token 预算线**：在圆环上画一条虚线标记"建议不超过此比例"的阈值
- **动画**：token 变化时圆环填充的过渡动画 (`transition: stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)`)
- **深色模式适配**：当支持深色模式时，调整背景环和文字颜色

# 修复：对话内容多时 LLM 流式输出闪烁问题

> 日期：2026-05-30
> 涉及文件：`usePiRpc.ts`、`ChatView.tsx`、`App.tsx`

## 问题描述

对话内容较多时，LLM 流式生成内容期间页面闪烁严重，影响阅读体验。

## 根本原因

闪烁由三个层面的问题叠加导致：

### 1. 每个 `text_delta` 都触发 React 状态更新

`syncContentBlocksToMessage()` 在每次 delta 事件时都调用 `setMessages(prev => prev.map(...))`，LLM 输出 token 速率远高于屏幕刷新率，高频触发完整消息列表的重新渲染。

```
text_delta (每秒数十次)
  → syncContentBlocksToMessage()
  → setMessages(prev => prev.map(...))  // 每次都重建整个消息数组
  → React 协调所有消息组件
  → DOM 大量更新 → 闪烁
```

### 2. ReactMarkdown 解析开销

每次重渲染都重新解析所有 Markdown（包括已完成的历史消息），这是 CPU 密集操作。对话越长，需要重新解析的 Markdown 越多，闪烁越严重。

### 3. scrollIntoView 在每次更新时触发

`useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])` 在每次 messages 变化时都触发平滑滚动动画，与高频状态更新叠加造成滚动抖动，加剧视觉闪烁。

## 修复措施

### 修复 1：RAF 节流状态同步

**文件**：`src/renderer/src/hooks/usePiRpc.ts`

将 `syncContentBlocksToMessage` 改为 `requestAnimationFrame` 节流：一帧内多个 delta 只触发一次 React 更新（最多 60fps）。

```ts
const rafIdRef = useRef<number | null>(null)

const syncContentBlocksToMessage = useCallback(() => {
  if (!currentAssistantId.current) return
  // 一帧内只调度一次 RAF
  if (rafIdRef.current !== null) return
  rafIdRef.current = requestAnimationFrame(() => {
    rafIdRef.current = null
    if (!currentAssistantId.current) return
    const blocks = Array.from(currentContentBlocks.current.values())
    const assistantId = currentAssistantId.current
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantId) return msg
        return { ...msg, blocks: [...blocks] }
      }),
    )
  })
}, [])
```

新增 `flushSync()` 方法，在关键节点（`toolcall_end`、`agent_end`）强制刷出，保证结构变化的及时性：

```ts
const flushSync = useCallback(() => {
  if (rafIdRef.current !== null) {
    cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = null
  }
  // 立即同步到 state
  if (!currentAssistantId.current) return
  const blocks = Array.from(currentContentBlocks.current.values())
  const assistantId = currentAssistantId.current
  setMessages((prev) =>
    prev.map((msg) => {
      if (msg.id !== assistantId) return msg
      return { ...msg, blocks: [...blocks] }
    }),
  )
}, [])
```

### 修复 2：流式文本轻量渲染

**文件**：`src/renderer/src/components/ChatView.tsx`

`TextBlockRenderer` 新增 `isStreaming` 属性：

- **Streaming 时**：跳过 ReactMarkdown 解析，直接用纯文本渲染 + 光标动画，极大减少 CPU 开销
- **完成后**：切换回完整 Markdown 渲染，保证最终显示效果

```tsx
function TextBlockRenderer({ block, isStreaming }: { block: TextBlock; isStreaming?: boolean }) {
  if (isStreaming) {
    return (
      <div className="prose prose-sm max-w-none whitespace-pre-wrap break-words text-sm leading-relaxed">
        {block.content}
        <span className="inline-block w-1.5 h-4 ml-0.5 bg-gray-400 animate-pulse align-text-bottom" />
      </div>
    )
  }
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
    </div>
  )
}
```

新增 `streamingMessageId` 精确标识哪条消息正在流式输出，只有该消息的文本块才用轻量渲染：

```tsx
<ContentBlockRenderer
  isStreamingBlock={isStreaming && streamingMessageId === msg.id && block.type === 'text'}
  ...
/>
```

`streamingMessageId` 从 `usePiRpc` 中派生：

```ts
const streamingMessageId = isStreaming ? currentAssistantId.current : null
```

### 修复 3：React.memo 包裹组件

**文件**：`src/renderer/src/components/ChatView.tsx`

`ContentBlockRenderer` 和 `ToolCallRenderer` 用 `memo()` 包裹，避免已完成消息的不必要重渲染：

```tsx
const ContentBlockRenderer = memo(function ContentBlockRenderer({ ... }) { ... })
const ToolCallRenderer = memo(function ToolCallRenderer({ ... }) { ... })
```

当 `isStreamingBlock` 为 `false` 且其他 props 不变时，`memo` 会跳过重渲染，有效隔离 streaming 状态更新对已完成消息的影响。

### 修复 4：优化滚动行为

**文件**：`src/renderer/src/components/ChatView.tsx`

滚动也用 `requestAnimationFrame` 节流，避免高频 scrollIntoView：

```ts
const scrollRafRef = useRef<number | null>(null)

useEffect(() => {
  if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
  scrollRafRef.current = requestAnimationFrame(() => {
    scrollRafRef.current = null
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' })
  })
  return () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
  }
}, [messages, isStreaming])
```

关键细节：Streaming 时用 `behavior: 'auto'`（无动画即时跳转），非 streaming 时才用 `smooth`（平滑滚动）。这避免了平滑滚动动画与高频更新冲突造成的抖动。

## 修复后数据流

```
text_delta (高频，每秒数十次)
  → updateContentBlock (更新 ref，无渲染开销)
  → syncContentBlocksToMessage (RAF 节流，~60fps 合并为一次)
  → setMessages → React 重渲染
  → memo 跳过已完成消息的重渲染
  → 只有 streamingMessageId 匹配的文本块用轻量渲染（纯文本 + 光标）
  → 完成后切换回完整 Markdown 渲染
```

## 性能对比

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 每秒 React 状态更新次数 | 与 delta 事件 1:1（数十次） | ≤ 60fps（RAF 节流） |
| 每次更新 Markdown 解析量 | 全部消息所有文本块 | 仅 streaming 中的文本块（轻量渲染） |
| 每次更新 DOM 协调范围 | 全部消息 | memo 跳过已完成消息 |
| scrollIntoView 频率 | 与 delta 1:1 + smooth 动画冲突 | ≤ 60fps + streaming 时 auto 跳转 |

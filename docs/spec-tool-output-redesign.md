# Tool Output & Thinking Content Redesign Spec

## 改动总结

### 数据层

- `TextBlock` 新增 `subtype?: 'thinking'`
- `tool_execution_end`：输出包装为 `tool_result` block，**插入到对应 `tool_call` 后面**（而非 append 到末尾）
- `message_end`：不再处理 toolResult（避免重复）
- thinking 事件生成 `subtype: 'thinking'` 的 TextBlock
- `loadHistory`：toolResult 包装为 `tool_result`；thinking 使用 `subtype: 'thinking'`

### 渲染层

**连续 assistant messages 合并**：
- normal 视图中，连续的 assistant messages 合并成一个 "Pi" 卡片
- 用 `MergedBlocksRenderer` 扁平化所有 blocks，保持原序渲染

**ToolCallRenderer**（合并了 tool_result）：
- 亮色，无边框/背景，一行摘要（图标+工具名+路径+状态）
- 条目间用 `border-t border-gray-200/50` 分隔
- 默认折叠，点击展开
- 展开后：左侧竖线缩进，显示 args + output（>15行折叠）

**ThinkingBlockRenderer**：
- 紫色左边线，无边框/背景
- 默认折叠，streaming 时显示 spinner

**tool_call + tool_result 配对**：
- `tool_result` 紧跟 `tool_call` 后面插入，渲染时嵌在 `ToolCallRenderer` 内
- 每个 tool_call 在原位渲染，不改变顺序

### 修改的文件

1. `src/renderer/src/types/message.ts` — TextBlock.subtype
2. `src/renderer/src/hooks/usePiRpc.ts` — 数据流改造
3. `src/renderer/src/components/ChatView.tsx` — 渲染层改造
4. `src/renderer/src/utils/compact-view.ts` — 跳过 thinking 摘要

### 视觉效果

```
┌─ Pi ────────────────────────────────────────┐
│                                              │
│  ▸ Thinking (8 lines)                       │  ← 紫色左边线，折叠
│                                              │
│  📄 read  src/App.tsx                    ✓   │  ← 一行摘要
│  ─────────────────────────────────────────── │
│  ✏️ edit  src/App.tsx                    ✓   │
│  ─────────────────────────────────────────── │
│  ▶ bash  npm run build                   ✓   │
│                                              │
│  我看了这个文件，做了以下修改...              │  ← 正常 prose
│  构建通过了。                                │
│                                              │
└──────────────────────────────────────────────┘
```

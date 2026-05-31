# Tool Output & Thinking Content Redesign Spec

## 问题

1. **Tool Result 裸渲染**：工具输出直接用 `<pre>` 显示，大段内容无折叠、无标题
2. **Tool Call 信息不足**：header 只显示工具名，read/edit/write 无摘要
3. **Thinking 内容无法区分**：推理过程和正式回复混在一起
4. **Tool Call + Result 分离**：命令和输出是两个独立卡片，不自然

## 方案

### 核心思路：Tool Call 就是"一步操作"，输出是它的附属

`tool_call` + `tool_result` 合并成一个视觉单元：
- **默认**：一行摘要（图标 + 工具名 + 命令/路径 + 状态）
- **展开**：显示 args + 输出（超 15 行自动折叠）

### 数据层

- `TextBlock` 新增 `subtype?: 'thinking'`
- `tool_execution_end` 输出包装为 `tool_result` block（紧跟 `tool_call`）
- `message_end` 不再处理 toolResult（避免重复）
- thinking 事件生成 `subtype: 'thinking'` 的 TextBlock

### 渲染层

**ToolCallRenderer**（合并了 tool_result）：
- 亮色主题（`bg-gray-50` header）
- 工具图标：bash→▶, read→📄, edit→✏️, write→📝
- 一行摘要：工具名 + 命令/路径截断 + 状态(✓/✗/spinner)
- 默认折叠，点击展开
- 展开后：args JSON + Output（带折叠）

**MessageBlocksRenderer**：
- 检测 `tool_call` + `tool_result` 连续 blocks
- 合并渲染为一个 `ToolCallRenderer`，把 result 传进去
- 孤立 `tool_result` 用 `OrphanToolResultRenderer` 兜底

**ThinkingBlockRenderer**：
- 紫色左边线 + 浅紫背景
- 默认折叠，streaming 时显示 spinner

### 修改的文件

1. `src/renderer/src/types/message.ts` — TextBlock.subtype
2. `src/renderer/src/hooks/usePiRpc.ts` — 数据流改造
3. `src/renderer/src/components/ChatView.tsx` — 渲染层改造
4. `src/renderer/src/utils/compact-view.ts` — 跳过 thinking 摘要

### 视觉效果

```
📄 read  src/App.tsx                           ✓   ← 默认一行
▶ bash  npm run build                          ✓   ← 默认一行
✏️ edit  src/App.tsx                           ✓   ← 默认一行

点击展开后：
┌─ ▶ bash  npm run build                      ✓  ▸ ────────────┐
│  {                                                              │
│    "command": "npm run build"                                   │  args
│  }                                                              │
│  Output (42 lines)                              Show all        │
│  > build                                                        │
│  > tsc                                                          │  输出
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘

│ ▸ Thinking (8 lines)                                            ← 折叠
│   Let me analyze the file structure...                          
```

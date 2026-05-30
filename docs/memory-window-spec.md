# Memory Window Spec

## Overview

每个 session 伴随一个**动态记忆缓存区**（memory），随对话演进自动更新。它不是对话日志，不是摘要，而是 Pi 维护的**工作记忆**——只保留"值得记住"的信息。

## Core Principles

1. **Pi 自动写入为主**：Pi 在对话中判断哪些信息值得持久记忆，主动调用 `memory_update` 工具写入
2. **用户可修改**：用户可在 UI 中查看、编辑、删除记忆内容
3. **自由文本格式**：不强制结构（无分区、无 bullet），Pi 自行组织文本
4. **增量更新**：Pi 写入时应尽量追加或替换相关段落，而非每次全量覆盖
5. **随对话增长**：记忆随对话推进自然增长，但 Pi 应自行判断什么值得记、什么是闲聊

## Storage

- 每个 session 一个 `memory.md` 文件，与 JSONL 同目录
- 格式：Markdown 自由文本
- 新建 session 时 `memory.md` 为空文件

```
~/.pi/agent/sessions/--path--/<timestamp>_<uuid>.jsonl
~/.pi/agent/sessions/--path--/<timestamp>_<uuid>.memory.md
```

### 为什么独立文件

- 不污染对话流（记忆 ≠ 消息）
- 用户可直接编辑
- 可读性好，`cat` 即可查看
- Fork 时自然继承（copy 文件）

## Lifecycle

| 场景 | 行为 |
|---|---|
| 新建 session | 创建空 memory.md |
| Fork | 复制父 session 的 memory.md 到新 session |
| 删除 session | 连带删除 memory.md |
| 切换 session | UI 切换到对应 session 的记忆内容 |

## Pi 侧：memory_update Tool Call

注册 `memory_update` 扩展（类似现有 `gui-control`），作为 Pi 的 tool call hook。

### 请求格式

```json
{
  "type": "tool_call",
  "tool": "memory_update",
  "input": {
    "action": "append | replace | clear",
    "content": "自由文本内容"
  }
}
```

### Action 语义

| Action | 说明 |
|---|---|
| `append` | 追加内容到 memory 末尾 |
| `replace` | 用新内容替换整个 memory（慎用，建议 Pi 仅在整理/压缩时使用） |
| `clear` | 清空 memory |

### 响应格式

```json
{
  "type": "tool_result",
  "tool": "memory_update",
  "output": "Memory updated. Current length: 342 chars"
}
```

## UI

侧边栏底部 "Memory" 折叠面板：
- 默认折叠，点击展开
- 显示当前 session 的 memory.md 内容
- 可直接编辑（textarea）
- 编辑后自动保存（debounce）

## Open Questions

以下问题尚未完全确定，待后续讨论：

1. **增长控制**：是否需要上限？Pi 自行控制 vs 硬限制？
2. **压缩策略**：当记忆过长时，是否让 Pi 自动压缩/整理？触发条件？
3. **跨 session 共享**：是否需要项目级共享记忆（而非 session 级）？
4. **memory 作为上下文**：Pi 在每次对话开始时是否自动读取 memory 作为额外上下文？还是需要显式注入？
5. **写入时机**：Pi 在什么时机触发 memory_update？每轮对话？检测到关键信息时？用户请求时？
6. **与 system prompt 的关系**：memory 是作为 system prompt 的一部分注入，还是独立的上下文窗口？

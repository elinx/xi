# Spec: Session 搜索 (Session Search)

## 背景

Xi 的 session 是树形结构的对话历史。随着项目发展，用户会产生大量 session，每个 session 都包含有价值的讨论和决策。当前 Pi agent 的搜索能力仅限于文件系统（`read`, `grep`, `find`, `bash`），无法搜索其他 session 的对话内容。

用户在 ideas.md 中提到：
> 给 agent 提供搜索其他 session 的能力，memory 存在 session 的树形结构中，而不是线性的 session 中

核心洞察：**所有 session 的对话历史构成了 agent 的全局长期记忆**。让 agent 能搜索这些记忆，等于从「单 session 有限上下文」升级到「跨 session 全局记忆」。

## 现状

| 搜索场景 | 能力 | 实现 |
|----------|------|------|
| 搜索项目代码/文件 | ✅ | `fs:search` IPC → ripgrep |
| 搜索当前 session 历史 | ✅ 有限 | Pi SDK `get_messages` RPC |
| 搜索其他 session 历史 | ❌ | 无实现 |
| Pi agent 搜索 session | ❌ | 无对应 tool |

已有基础设施：
- `session-service.ts` 的 `parseSessionMessages(filePath)` 可以从 JSONL 文件直接读取任意 session 的消息，不走 Pi RPC
- Pi SDK 的 Extension 系统支持 `pi.registerTool()` 注册自定义工具
- 项目已有 `.pi/extensions/gui-control.ts` 扩展

## 目标

1. Pi agent 可以通过 `search_sessions` 工具搜索项目中所有 session 的对话内容
2. 搜索结果返回匹配的对话片段及其所属 session 信息
3. agent 可以基于搜索结果主动获取更完整的上下文
4. 用户端 SearchPanel 可选增加 session 搜索 tab（路线 A，低优先级）

## 设计

### 核心机制：Pi Extension + Custom Tool

使用 Pi SDK 的 Extension 系统注册 `search_sessions` 工具。Extension 运行在 Pi worker 内部，可以访问当前 session 的 `ctx.sessionManager`，但搜索其他 session 需要从文件系统读取 JSONL。

```
用户提问 "之前 CORS 问题怎么解决的？"
  │
  ▼
Pi agent 判断需要搜索历史
  │
  ▼
调用 search_sessions(query="CORS", limit=5)
  │
  ▼
Extension 读取项目下所有 session JSONL
  │  → session-service.parseSessionMessages() (在 worker 进程中)
  │  → 文本匹配，提取上下文片段
  │
  ▼
返回匹配结果：[{ sessionName, sessionPath, role, content, timestamp }]
  │
  ▼
Agent 看到结果，可能追问或直接引用
```

### Extension 位置

放在项目本地 `.pi/extensions/session-search.ts`，随项目版本控制。

也可以放在全局 `~/.pi/agent/extensions/` 下，但项目本地更合理——不同项目的 session 存储位置不同。

### 工具定义

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

export default function sessionSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "search_sessions",
    label: "Search Sessions",
    description: "Search all sessions in the current project for relevant conversations. Use this when the user asks about previous discussions, past decisions, or work done in other sessions.",
    promptSnippet: "Search past session conversations for context",
    promptGuidelines: [
      "Use search_sessions when the user refers to past work, previous decisions, or discussions that may be in other sessions.",
      "search_sessions returns conversation excerpts from other sessions — use them as context, not as truth.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query - keywords or phrases to find in session conversations" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 10, max: 30)", default: 10 })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // 实现见下文
    },
  })
}
```

### 搜索实现

Extension 运行在 Pi worker（Node.js 子线程）中，可以直接用 `fs` 读取 session JSONL 文件。

```typescript
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, basename } from "node:path"

interface SessionSearchResult {
  sessionName: string
  sessionPath: string
  role: "user" | "assistant"
  content: string
  timestamp: number
}

function searchSessions(query: string, limit: number): SessionSearchResult[] {
  const sessionDir = getSessionDir()
  if (!sessionDir || !existsSync(sessionDir)) return []

  const q = query.toLowerCase()
  const results: SessionSearchResult[] = []

  const files = readdirSync(sessionDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => join(sessionDir, f))

  for (const filePath of files) {
    if (results.length >= limit) break

    const { entries, name: sessionName } = parseSessionFile(filePath)

    for (const entry of entries) {
      if (results.length >= limit) break
      if (entry.type !== "message" || !entry.message) continue

      const msg = entry.message
      if (msg.role !== "user" && msg.role !== "assistant") continue

      const text = extractText(msg.content)
      if (!text.toLowerCase().includes(q)) continue

      results.push({
        sessionName,
        sessionPath: filePath,
        role: msg.role,
        content: text.slice(0, 500),
        timestamp: msg.timestamp ?? 0,
      })
    }
  }

  return results.sort((a, b) => b.timestamp - a.timestamp)
}
```

### Session 目录发现

Xi 的 session 存储在 `<project-root>/.xi/sessions/--<encoded-cwd>--/` 下。Xi 启动 Pi worker 时设置了 `PI_CODING_AGENT_DIR = <project-root>/.xi`，所以 Pi 的 session 目录实际是 `$PI_CODING_AGENT_DIR/sessions/--<encoded-cwd>--/`。

Extension 中获取 session 目录的方式：

1. **从当前 session 文件路径推算**（最可靠）：`ctx.sessionManager.getSessionFile()` 返回当前 session 的绝对路径，`dirname()` 即为 session 目录
2. **从环境变量获取**：`process.env.PI_CODING_AGENT_DIR` + `sessions/` + encoded path

```typescript
function getSessionDir(): string | null {
  // Xi 的 session 目录结构：<project-root>/.xi/sessions/--<encoded-cwd>--/
  // 当前 session 文件路径可从 ctx.sessionManager 获取
  // dirname() 即为包含所有 session .jsonl 文件的目录
  const sessionFile = ctx.sessionManager.getSessionFile()
  if (!sessionFile) return null
  return dirname(sessionFile)
}
```

**Session 名称获取**：不能从文件名推算。需要读 JSONL 中的 `session_info` entry 获取 `name` 字段。如果没有 `session_info`，回退到文件名。

### 返回格式

工具返回纯文本，方便 LLM 理解：

```
Found 3 matching conversations:

--- Session: "feat/cors-fix" (experiment-3.jsonl) ---
[User, 2h ago]: CORS 问题怎么解决？
[Assistant, 2h ago]: 我在 server.ts 里加了 Access-Control-Allow-Origin 头...

--- Session: "main" (main.jsonl) ---
[User, 1d ago]: 那个 API 的跨域配置改了吗？
[Assistant, 1d ago]: 改了，在 nginx 配置里加了...

--- Session: "refactor/auth" (experiment-5.jsonl) ---
[Assistant, 3d ago]: CORS 中间件已经更新，支持 credentials 了
```

### 性能考虑

- Session 文件可能很大（compaction 前可达数 MB）
- 搜索应限制读取量和结果数量
- 大文件只读取最近 N 条 entry（如最近 500 条）
- 搜索结果按时间倒序排列，优先返回最近的
- 设置超时（如 10s），避免阻塞 agent 循环

### 与 Xi 主进程的协作

**Option A（推荐）：Extension 独立实现**

Extension 运行在 Pi worker 中，直接用 `node:fs` 读取 JSONL。不依赖 Xi 主进程的 IPC。

优点：
- 零 IPC 开销，搜索在 worker 线程完成
- 不需要修改 Xi 主进程代码
- Extension 逻辑自包含，可独立测试

缺点：
- JSONL 解析逻辑与 `session-service.ts` 的 `parseSessionMessages` 重复
- 但 Extension 内的解析可以更轻量（只提取文本，不需要转换为 ChatMessage 格式）

**Option B：通过 Xi 主进程 IPC**

Extension 发现需要搜索 session → 通过某种机制请求 Xi 主进程 → Xi 主进程调用 `session-service` → 返回结果。

缺点：
- Pi Extension 没有直接与 Xi 主进程通信的通道
- 需要额外建立通信机制，复杂度高
- 不推荐

**结论：选 Option A**。Extension 内独立实现轻量 JSONL 解析，复用文件路径发现逻辑但不复用解析代码。

## 用户端搜索（路线 A，低优先级）

在 SearchPanel 中增加 session 搜索能力，复用同一个搜索函数。

实现方式：
1. 新增 IPC `session:searchAll(query, options)` 在 Xi 主进程
2. SearchPanel 增加 tab 切换：Files / Sessions
3. Session 搜索结果点击可跳转到对应 session

这是路线 B 的副产物，优先级低。

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `.pi/extensions/session-search.ts` | 新增 | Pi Extension，注册 `search_sessions` 工具 |

**不需要改动的文件：**
- ❌ `src/main/` — 不新增 IPC
- ❌ `src/renderer/` — 不改 UI
- ❌ `session-service.ts` — Extension 内独立实现

## 边界情况

| 场景 | 处理 |
|------|------|
| 当前 session 也在搜索范围内 | 包含在结果中，但标注「当前 session」 |
| Session 文件很大 | 只读取最近 500 条 entry |
| Session 正在被 Pi 写入（streaming） | 跳过当前活跃 session 的最新 streaming entry |
| 项目没有其他 session | 返回空结果，提示无历史记录 |
| 搜索关键词太短（< 2 字符） | 要求至少 2 字符 |
| 搜索无结果 | 返回「未找到匹配的对话」 |
| 并发搜索请求 | Extension 的 execute 是 async，自然串行 |

## 与旧方案的对比

| | 旧状态 | 新方案 |
|---|---|---|
| Agent 搜索 session | ❌ 不可能 | ✅ `search_sessions` 工具 |
| Agent 全局记忆 | ❌ 只有当前 session 上下文 | ✅ 可跨 session 检索 |
| 用户搜索 session | ❌ 只能手动切换查看 | ✅ 未来可在 SearchPanel 搜索 |
| 新增 IPC/Main 代码 | — | ❌ 不需要 |
| 新增 Extension 代码 | — | ✅ 一个 .ts 文件 |

## 未来扩展

1. **语义搜索**：用 embedding 替代关键词匹配，更精准
2. **自动注入上下文**：`before_agent_start` 事件中自动注入相关 session 摘要
3. **Session 摘要索引**：每次 session 结束时生成摘要并缓存，加速搜索
4. **跨项目搜索**：搜索 `~/.pi/agent/sessions/` 下的所有项目
5. **搜索结果跳转**：点击搜索结果跳转到对应 session 的对应消息

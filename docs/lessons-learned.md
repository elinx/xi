## 变量遮蔽（Variable Shadowing）

在 `pi-worker.ts` 中遇到了一个经典的变量遮蔽 bug：

- 模块级声明 `let sessionManager = null`（第 25 行）
- `init()` 函数内又声明了 `let sessionManager`（第 72 行），遮蔽了模块级变量
- `createRuntime` 回调在 `init()` 作用域内，赋值 `sessionManager = sm` 写的是局部变量
- `get_messages` 读的是模块级变量，永远是 `null`
- 结果：重启后历史消息无法加载（`session.messages` 为空，fallback 也不会触发）

**教训**：同一个作用域链中不要重名变量，TypeScript 的 `noShadow` 规则可以帮助检测这类问题。

## Pi SDK 会话历史 API 选择

- `session.messages` — 仅包含当前运行时的消息，重启后为空
- `SessionManager.getBranch()` — 返回 `model_change`、`thinking_level_change` 等元数据条目，不含实际对话消息
- `SessionManager.getEntries()` — 返回所有条目，包括 `type: 'message'` 的条目，其 `entry.message` 包含 `role`/`content`/`timestamp`
- 正确做法：用 `getEntries()` 过滤 `type === 'message'`，提取 `entry.message`

## utilityProcess vs Worker Thread

Electron 中 Worker Threads 不暴露 `node:internal/webidl`（Node 内部模块），导致 `undici@8.3.0` 的 `markAsUncloneable` 崩溃。`utilityProcess.fork()` 以独立 OS 进程运行，拥有完整 Node.js 环境，是 Electron 推荐方式（VS Code、Insomnia 等均采用）。IPC 用 `process.parentPort` 而非 `parentPort`。

**不要用 `child_process.fork()` + 外部 Node 二进制**：依赖外部 Node 路径，打包后会断裂。`utilityProcess` 使用 Electron 内置 Node。

## Multi-Worker Session 切换 Bug（2026-06-09）

完整复盘见 [multi-worker-session-switching-bug-fix.md](./multi-worker-session-switching-bug-fix.md)

核心教训：
- Worker 的 `sessionPath` 是身份标识，不能 mutate（否则 Map key-value 失配）
- 操作结果从操作本身返回，不要用副作用查询
- `connected` 回调不能覆盖已设置的 `sessionPath`

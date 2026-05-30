## compact view mode
激活这个模式之后，用户看到的是

1. 模式 1：一行问题接着一行问题，没有agent的回答
2. 模式 2：一行问题后面紧接着agent回答

这样就不用担心找不到问题了

## 变量遮蔽（Variable Shadowing）教训

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
# Spec: New Session Without Abort

## Problem

当用户在一个正在 streaming 的 session 上点击 `+` 创建子 session 时，当前代码会先 `abort()` 掉正在 streaming 的对话，然后通过 Pi runtime 创建新 session。这违背了用户"边等边干别的事"的预期——streaming 可能要很久，用户不想中断它。

## Goal

创建新（空白）session 时，**不中断任何正在 streaming 的 session**，通过纯文件操作完成 session 创建。

## Scope

- ✅ `newSession`（空白子 session）：改为纯文件操作，不经过 Pi runtime
- ❌ `forkAtEntry`：保持现状（需要 Pi runtime 理解 entry 语义），不在本次范围内
- ❌ `clearSession`：保持现状，不在本次范围内

## Current Flow

```
用户点击 + → handleNewSession(name, parentPath)
  → abort(currentPath)           // 杀掉 streaming 😱
  → newSession(currentPath, name, parentPath)
    → IPC: session:newSession
      → 找到 currentPath 对应的 worker
      → worker.sendRpcCommand({ type: 'new_session', parentSession })
      → Pi runtime 创建新 session（in-place，替换 worker 当前 session）
      → set_session_name
      → flush_session
      → get_state（拿新 session 路径）
      → switch_session（切回 worker 原来的 session）
  → workerEnsureReady(newPath)
```

核心问题：`new_session` 命令在当前 worker 的 Pi runtime 上执行，streaming 和 new_session 在同一 runtime 里会冲突，所以必须先 abort。

## New Flow

```
用户点击 + → handleNewSession(name, parentPath)
  → newSession(null, name, parentPath)   // 不再 abort，不再传 currentPath
    → IPC: session:newSession（复用现有 IPC，改实现）
      → sessionService.createSessionFile(sessionDir, cwd, name, parentSessionPath)
        → 生成 uuid + timestamp
        → 写 header 行
        → 复用 nameSession() 写 session_info 行
        → 返回新 session 文件路径
    → workerEnsureReady(newPath)   // 用户切过去时才启动 secondary worker 加载它
```

正在 streaming 的 worker **完全不被触碰**。

## Implementation Details

### 1. `session-service.ts` — 新增 `createSessionFile`

现有的 `nameSession` 只能往已有文件追加，没有"从零创建 JSONL 文件"的能力，所以需要加一个函数。但 `nameSession` 可以复用——写完 header 行后调它来写 session_info 行。

```typescript
export function createSessionFile(
  sessionDir: string,
  cwd: string,
  name: string,
  parentSessionPath?: string
): string
```

- 生成 `id = randomUUID()`
- 生成 `timestamp = new Date().toISOString()`
- 文件名：`<timestamp>_<uuid>.jsonl`（与 Pi SDK 格式一致，其中 timestamp 用 `YYYYMMDD_HHmmss` 格式）
- 写入 header 行：`{ type: 'session', version: 1, id, timestamp, cwd, parentSession }`
- 复用 `nameSession(path, name)` 写入 session_info 行
- 返回完整文件路径

注意：`parentSession` 字段只在有 parent 时写入 header，与 Pi SDK 行为一致。

### 2. `index.ts` — 改现有 `session:newSession` handler

**复用现有 IPC**，不新增。将实现从"找 worker → sendRpcCommand"改为"纯文件操作"。

`clearSession` 有自己独立的 handler（`session:clearSession`），不走 `session:newSession`，所以改动不影响 clearSession。

```typescript
ipcMain.handle('session:newSession', async (_event, _sessionPath: string | null, name: string, parentSessionPath?: string) => {
  const cwd = process.cwd()
  const sessionDir = getSessionDir(cwd)
  try {
    const sessionPath = sessionService.createSessionFile(sessionDir, cwd, name, parentSessionPath || undefined)
    return { success: true, sessionPath }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})
```

不再找 worker，不再 sendRpcCommand，纯同步文件操作。

### 3. `preload/index.ts` — 无改动

IPC channel 名 `session:newSession` 不变，preload 无需改动。

### 4. `useSessionManager.ts` — 无改动

`api.newSession(sessionPath, name, parentSessionPath)` 调用不变，只是 handler 实现变了。

### 5. `App.tsx` — 移除 `handleNewSession` 中的 abort

```diff
 const handleNewSession = useCallback(async (name: string, parentSessionPath: string) => {
-    const currentPath = displayedSessionPathRef.current
-    if (isPiStreaming()) {
-      await abort(currentPath)
-    }
-    const newPath = await newSession(currentPath, name, parentSessionPath)
+    const newPath = await newSession(null, name, parentSessionPath)
     if (newPath) {
       await refresh()
       await displaySessionRef.current(newPath)
       // ... workerEnsureReady + saveLastSession 不变
     }
-  }, [abort, newSession, refresh, isPiStreaming])
+  }, [newSession, refresh])
```

## 改动总结

| 文件 | 改动 |
|------|------|
| `session-service.ts` | 新增 `createSessionFile`（复用 `nameSession`） |
| `index.ts` | 改 `session:newSession` handler 实现 |
| `App.tsx` | 去掉 abort |
| `preload/index.ts` | 无改动 |
| `useSessionManager.ts` | 无改动 |

## Verification

### 功能验证

1. **streaming 中新建子 session**：
   - Session A 正在 streaming
   - 在 Session A 节点上点 `+`，输入名字，创建 Session B
   - Session A 的 streaming **不被中断**，继续在后台跑
   - 切到 Session B，可以正常发消息对话
   - 切回 Session A，streaming 仍在进行（或已完成，结果完整）

2. **非 streaming 中新建子 session**：
   - 行为与之前一致，新 session 正常创建、可对话

3. **新建顶层 session（无 parent）**：
   - 当前 UI 没有"新建顶层 session"的入口，但 `createSessionFile` 不传 `parentSessionPath` 时应正常工作

4. **sidebar 树结构**：
   - 新建的子 session 正确出现在 parent 下方
   - 父子关系通过 header 的 `parentSession` 字段体现

5. **secondary worker 加载**：
   - 切到新 session 时 `workerEnsureReady` 启动 secondary worker
   - `SessionManager.open(newPath)` 能正确加载我们手写的 JSONL
   - 发送第一条 prompt 正常工作

6. **clearSession 不受影响**：
   - `clearSession` 有独立的 handler，不走 `session:newSession`
   - 行为不变

### 边界情况

- **Session dir 不存在**：`getSessionDir` 会自动创建，已有处理
- **同名 session**：文件名包含 uuid，不会冲突
- **并发创建**：多个 `createSessionFile` 同时调用，每个生成独立 uuid，不会冲突
- **Pi SDK 版本变更 JSONL 格式**：风险存在，但 header 格式（`type: 'session'` + 标准字段）是 Pi SDK 的稳定契约，`clearSessionMessages` 已有同样的依赖

## Future Considerations

- **`forkAtEntry` 不 abort**：fork 需要 Pi runtime 理解 entry 语义，纯文件操作复杂度高。可考虑用临时 secondary worker 执行，或 queue 到 agent_end 后执行
- **`clearSession` 不 abort**：同理，可改为纯文件操作重建空白 JSONL + 删旧文件

# Spec: Session 拖拽 Reparent

## 背景

当前 session 树的父子关系由 `parentSession` 字段决定，在 session 创建时（fork / new child）一次性写入，之后无法修改。由于之前的版本 bug，部分 session 的 `parentSession` 未正确写入，导致本该嵌套的 session 变成了扁平的。用户需要手动修复树结构。

此外，用户创建 session 时可能忘记指定 parent，事后希望整理树形结构。当前没有提供任何修改 `parentSession` 的能力。

## 目标

1. 用户可以通过拖拽改变 session 的 parent，修复被破坏的树结构
2. 用户可以将扁平的 session 拖入正确的 parent 下
3. 拖拽操作安全：防止循环引用、防止破坏 main session
4. 改动最小：复用现有 `session_info` 追加覆盖机制，不修改 Pi SDK 行为

## 存储设计

### 追加覆盖 `parentSession`

现有 `session_info` 的追加覆盖模式已支持 `name` 和 `status` 字段。新增 `parentSession` 字段使用完全相同的机制：

```
文件内容（修改前）：
  第1行: {"type":"session","id":"abc","parentSession":"/path/to/old-parent.jsonl",...}
  第4行: {"type":"session_info","name":"my-session"}
  第6行: {"type":"session_info","status":"completed"}

文件内容（修改后，追加一行）：
  第1行: {"type":"session","id":"abc","parentSession":"/path/to/old-parent.jsonl",...}
  第4行: {"type":"session_info","name":"my-session"}
  第6行: {"type":"session_info","status":"completed"}
  第7行: {"type":"session_info","parentSession":"/path/to/new-parent.jsonl"}  ← 新增
```

**解析规则**：`parseSessionFile` 从上往下逐行读取，后出现的 `session_info` 字段覆盖先出现的。最终 `parentSessionPath` 取最后一个 `session_info` 中的 `parentSession` 值；若无，回退到 header。

**设为 null（解除 parent）**：追加 `{"type":"session_info","parentSession":null}` 即可。

**安全性**：
- Pi SDK 不回读 `session_info` 中的 `parentSession`，只看 header，因此不受影响
- Pi SDK 的 `_rewriteFile()` 会原样保留 `session_info` 行（包括我们追加的行）
- Pi SDK 的 `appendSessionInfo()` 只写 `name` 字段，不会覆盖我们的 `parentSession`
- 所有写入路径（`_appendEntry` / `_rewriteFile` / `appendCompaction`）均保留 `session_info` 行

### 解析逻辑改动

```typescript
// parseSessionFile 中，改动前：
return {
  ...
  parentSessionPath: header.parentSession ?? null,
}

// 改动后：
let parentSessionPath = header.parentSession ?? null

for (let i = 1; i < lines.length; i++) {
  ...
  } else if (entry.type === 'session_info') {
    if (typeof entry.name === 'string') name = entry.name
    if (entry.status === 'active' || entry.status === 'completed') status = entry.status
    // 新增：session_info 中的 parentSession 覆盖 header
    if ('parentSession' in entry) {
      parentSessionPath = typeof entry.parentSession === 'string' ? entry.parentSession : null
    }
  }
}

return {
  ...
  parentSessionPath,
}
```

## 后端改动

### 1. session-service.ts

#### 新增 `reparentSession()`

```typescript
export function reparentSession(sessionPath: string, newParentPath: string | null): boolean {
  if (!existsSync(sessionPath)) return false

  // 防止自引用
  if (newParentPath === sessionPath) return false

  // 如果指定了 newParent，验证目标文件存在
  if (newParentPath && !existsSync(newParentPath)) return false

  try {
    const entry = JSON.stringify({
      type: 'session_info',
      parentSession: newParentPath,
    })
    appendFileSync(sessionPath, entry + '\n')
    return true
  } catch {
    return false
  }
}
```

#### 修改 `parseSessionFile()`

如上"解析逻辑改动"所述，让 `session_info` 中的 `parentSession` 覆盖 header 的值。

### 2. 环检测

在 IPC handler 层做环检测，而非 `session-service.ts`，因为需要访问完整的 session 列表：

```typescript
function wouldCreateCycle(
  sessionPath: string,
  newParentPath: string,
  sessions: SessionInfo[]
): boolean {
  if (!newParentPath) return false // 设为 null 不可能成环

  // 从 newParent 沿 parent 链向上走，如果回到 sessionPath 则成环
  const parentMap = new Map<string, string | null>()
  for (const s of sessions) {
    parentMap.set(s.filePath, s.parentSessionPath)
  }

  let current: string | null = newParentPath
  const visited = new Set<string>()
  while (current) {
    if (current === sessionPath) return true
    if (visited.has(current)) return false // 非相关环，不是我们造成的
    visited.add(current)
    current = parentMap.get(current) ?? null
  }
  return false
}
```

### 3. IPC 通道

```typescript
// index.ts
ipcMain.handle('session:reparentSession', async (_event, sessionPath: string, newParentPath: string | null) => {
  // 1. 获取所有 session 用于环检测
  const result = sessionService.listSessions()
  const allSessions = result.projects.flatMap(p => p.allSessions)

  // 2. 不允许移动 main session
  const target = allSessions.find(s => s.filePath === sessionPath)
  if (target?.isMain) {
    return { success: false, error: 'Cannot reparent the main session' }
  }

  // 3. 环检测
  if (newParentPath && wouldCreateCycle(sessionPath, newParentPath, allSessions)) {
    return { success: false, error: 'Cannot create a cycle in the session tree' }
  }

  // 4. 执行 reparent
  const ok = sessionService.reparentSession(sessionPath, newParentPath)
  if (ok) {
    return { success: true }
  }
  return { success: false, error: 'Failed to reparent session' }
})
```

### 4. Preload

```typescript
reparentSession: (sessionPath: string, newParentPath: string | null): Promise<{ success: boolean; error?: string }> =>
  ipcRenderer.invoke('session:reparentSession', sessionPath, newParentPath),
```

### 5. 类型

```typescript
// session.ts - SessionIpcApi 新增
reparentSession: (sessionPath: string, newParentPath: string | null) => Promise<{ success: boolean; error?: string }>
```

## 前端改动

### 交互方案：拖拽 (Drag & Drop)

使用 `@dnd-kit/core` + `@dnd-kit/sortable` 实现 tree 拖拽。

#### 拖拽行为

| 拖拽目标位置 | 行为 | 视觉指示 |
|-------------|------|---------|
| 拖到某 session **上方 1/3** | 插入为该 session 的 **前兄弟**（同一 parent 下） | 蓝色横线在上方 |
| 拖到某 session **下方 1/3** | 插入为该 session 的 **后兄弟**（同一 parent 下） | 蓝色横线在下方 |
| 拖到某 session **中间 1/3** | 成为该 session 的 **子节点** | 蓝色背景高亮目标 session |

#### 约束

| 规则 | 实现 |
|------|------|
| 不能拖 main session | 拖拽开始时检测，main session 不设 draggable |
| 不能拖到自己的后代上 | `onDragOver` 时检测，显示禁止光标 |
| 不能拖到自身 | 拖拽开始时排除自身作为 drop target |
| 正在 streaming 的 session 限制拖拽 | streaming session 不设 draggable（可选，初始版本可不做） |

#### 自动展开

拖拽时 hover 在折叠的节点上 500ms，自动展开该节点。使用 `requestAnimationFrame` + 计时器实现。

#### 拖拽中的虚拟树

拖拽过程中不修改实际数据，只维护一个临时 `virtualTree` 状态用于渲染预览位置。drop 后才调用 `reparentSession` IPC。

```
onDragStart → 记录 dragSource
onDragOver  → 更新 virtualTree（预览位置）+ 环检测 + 自动展开
onDragEnd   → 如果合法 → reparentSession IPC → refresh
              如果取消 → 清除 virtualTree
```

#### 组件结构改动

1. `SessionSidebar` 外层包裹 `DndContext`
2. `SessionNode` 包裹 `useSortable`，增加 drag handle
3. 新增 `SortableTree` 组件封装 tree flatten / reconcile 逻辑

### 降级方案：右键 "Move under..."

如果拖拽实现周期过长，可以先实现右键菜单方案作为降级：

右键菜单新增 **"Move under..."** 选项 → 弹出 session 选择器（平铺列表）→ 选择目标 parent → 调用 `reparentSession`。

工时约 0.5 天，可覆盖 80% 使用场景（特别是修复扁平 session 的需求）。

## 边界情况

| 场景 | 处理 |
|------|------|
| 将 session 拖为根节点（无 parent） | Drop 到 sidebar 空白区域，或 drop 到 main session 的中间区域，`newParentPath = null` |
| 被移动的 session 有子节点 | 子节点跟随移动（`parentSession` 只改被拖的那个，子节点的 parent 指向它不变） |
| `newParentPath` 指向已删除的 session | `reparentSession` 检查文件存在性，不存在则失败 |
| Pi SDK 的 `_rewriteFile` 覆写 | 我们的 `session_info` 行在 `fileEntries` 中，`_rewriteFile` 原样写回 |
| Pi SDK 的 `appendSessionInfo` | 只写 `name` 字段，不影响 `parentSession` |
| header 中的 `parentSession` | 保留原值不变，解析时被 `session_info` 中的值覆盖 |
| 多次 reparent | 每次 append 一行 `session_info`，最后一次 wins |
| reparent 后切换到该 session | Pi 不关心 `parentSession`，切换不受影响 |
| reparent 与并发操作冲突 | `appendFileSync` 是原子操作，安全 |

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/main/session-service.ts` | 修改 + 新增 | `parseSessionFile` 加 `parentSession` 覆盖；新增 `reparentSession()` |
| `src/main/index.ts` | 新增 | `session:reparentSession` IPC handler + `wouldCreateCycle()` |
| `src/preload/index.ts` | 新增 | `reparentSession` 桥接 |
| `src/renderer/src/types/session.ts` | 修改 | `SessionIpcApi` 新增 `reparentSession` |
| `src/renderer/src/hooks/useSessionManager.ts` | 新增 | `reparentSession` hook |
| `src/renderer/src/components/SessionSidebar.tsx` | 修改 | DnD 逻辑 + drag handle + drop indicator |
| `package.json` | 修改 | 新增 `@dnd-kit/core` + `@dnd-kit/sortable` 依赖 |
| `test/session-service.test.ts` | 新增 | `reparentSession` + `parseSessionFile` parentSession 覆盖测试 |

## 实现顺序

1. **后端**（~2h）：`parseSessionFile` 改动 + `reparentSession()` + IPC + 环检测
2. **测试**（~1h）：后端单元测试
3. **降级方案**（~3h）：右键 "Move under..." — 可独立交付
4. **拖拽**（~1-2 天）：`@dnd-kit` 集成 + tree flatten + drop indicator + 自动展开 + 虚拟树预览

建议先完成 1-3，确认后端和交互模式无误后再做 4。

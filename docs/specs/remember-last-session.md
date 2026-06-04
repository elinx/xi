# Spec: 记住最后操作的 Session

## 背景

当前每次打开 App，Pi 总是连接到 `findMainSession()` 返回的 session（名为 `main` 或最早创建的 session）。用户上次操作的 session 信息没有被持久化，导致每次都要手动切换。

## 目标

1. App 启动时能够恢复到用户上次操作的 session
2. 用户可以在 Settings 中选择启动时的 session 行为

## 功能设计

### 1. Settings 新增 "Startup Session" 选项

在 `GeneralSettings` 组件的 **AI** 分组中新增一个选项：

| 选项值 | 标签 | 说明 |
|--------|------|------|
| `last` | Last Session | 打开上次操作的 session（默认） |
| `main` | Main Session | 打开项目的主 session |

- **存储位置**：`localStorage` key `xi-settings-startup-session`，值为 `'last'` 或 `'main'`
- **默认值**：`'last'`（新用户体验更友好，老用户不丢失上下文）

#### UI 设计

在 GeneralSettings 的 AI 分组中，紧跟 "Default Model" 之后新增一行：

```
AI
───────────────────────────────
Default Model       [input    ]

Startup Session     [Last Session ▾]
                    选项: Last Session / Main Session
```

使用 `<select>` 下拉框，与 Theme 选项风格一致。

### 2. 后端：last-session 持久化

#### 存储位置

每个项目的 session 目录下新增 `last-session.json`：

```
.xi/sessions/--<encoded-cwd>--/last-session.json
```

```json
{
  "sessionPath": "/abs/path/to/session.jsonl",
  "updatedAt": "2026-06-05T10:30:00.000Z"
}
```

选择文件而非 localStorage 的原因：
- 跨窗口一致性：localStorage 是 per-window 的
- 项目关联：不同项目目录独立记录
- 与 session 数据同目录，方便管理

#### session-service.ts 新增

```typescript
export function getLastSession(cwd: string): string | null
export function saveLastSession(cwd: string, sessionPath: string): void
```

- `getLastSession`：读取 `last-session.json`，验证文件存在性后返回路径，否则返回 `null`
- `saveLastSession`：写入 `last-session.json`

#### index.ts 新增 IPC

```typescript
ipcMain.handle('session:getLastSession', () => {
  return sessionService.getLastSession(process.cwd())
})

ipcMain.handle('session:saveLastSession', (_event, sessionPath: string) => {
  sessionService.saveLastSession(process.cwd(), sessionPath)
  return { ok: true }
})
```

### 3. 前端：启动恢复 + 切换时保存

#### preload/index.ts 新增

```typescript
getLastSession: (): Promise<string | null> =>
  ipcRenderer.invoke('session:getLastSession'),

saveLastSession: (sessionPath: string): Promise<{ ok: boolean }> =>
  ipcRenderer.invoke('session:saveLastSession', sessionPath),
```

#### App.tsx 改动

**(a) 启动时根据 Settings 恢复 session：**

当 Pi 连接成功后，读取 `xi-settings-startup-session` 设置：
- 若为 `'last'`：读取 `getLastSession()`，有值且与当前不同则 switch
- 若为 `'main'`：沿用现有逻辑（不额外操作）

```typescript
useEffect(() => {
  if (!isConnected || !currentSession) return

  const startupPref = localStorage.getItem('xi-settings-startup-session') || 'last'
  if (startupPref !== 'last') return

  window.api.getLastSession().then(async (lastPath) => {
    if (!lastPath || currentSession.filePath === lastPath) return
    const result = await switchSession(lastPath)
    if (result.success) {
      setPiConnectedPath(lastPath)
      clearMessages()
      await loadHistory()
      await loadForkPoints(lastPath)
      await refresh()
    }
  })
}, [isConnected, currentSession?.filePath])
```

**(b) 每次 session 切换成功后保存 last session：**

在以下 handler 成功后调用 `window.api.saveLastSession(sessionPath)`：
- `handleSwitchSession`
- `handleNewSession`
- `handleForkAtEntry`
- `handleForkFromEnd`
- `handleClearSession`

**(c) App 退出前保存（增强可靠性）：**

在 main process `before-quit` 中保存当前 Pi session：

```typescript
app.on('before-quit', () => {
  if (piBridge?.isConnected) {
    piBridge.sendRpcCommand({ type: 'get_state' }).then((data) => {
      const sessionPath = (data as any).sessionFile
      if (typeof sessionPath === 'string') {
        sessionService.saveLastSession(process.cwd(), sessionPath)
      }
    }).catch(() => {})
  }
  piBridge?.stop().catch(() => {})
})
```

### 4. 边界情况

| 场景 | 处理 |
|------|------|
| last-session.json 记录的文件已被删除 | `getLastSession` 验证存在性，不存在返回 null，fallback 到 main |
| 项目首次使用 | 无 last-session.json，返回 null，沿现有逻辑 |
| Settings 设为 `main` | 不读取 last-session.json，不恢复 |
| 用户从 `main` 改为 `last` | 下次启动时生效 |
| switchSession 失败 | UI 保持当前 session 不变，不保存 last |
| 多窗口同一项目 | 后写覆盖，可接受 |

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/main/session-service.ts` | 新增函数 | `getLastSession()`、`saveLastSession()` |
| `src/main/index.ts` | 新增 IPC + before-quit | 2 个 handler + 退出保存 |
| `src/preload/index.ts` | 新增桥接 | `getLastSession`、`saveLastSession` |
| `src/renderer/src/components/GeneralSettings.tsx` | 新增 UI | Startup Session 下拉选项 |
| `src/renderer/src/App.tsx` | 改动逻辑 | 启动恢复 + 切换时保存 |

## 交互流程

```
App 启动
  │
  ▼
pi:start → Pi 连接成功 → currentSession 已加载
  │
  ▼
读取 localStorage('xi-settings-startup-session')
  │
  ├─ 'main' → 不做额外操作（沿用 findMainSession 逻辑）
  │
  └─ 'last' (默认)
      │
      ▼
    读取 getLastSession()
      │
      ├─ 有记录 & 文件存在 & ≠ currentSession
      │   → switchSession(lastPath) → 恢复上次 session
      │
      └─ 无记录 / 文件已删 / = currentSession
          → 不操作
  │
  ▼
用户操作 (switch / new / fork / clear)
  │
  ▼
切换成功 → saveLastSession(currentPath)
  │
  ▼
App 退出 → before-quit → saveLastSession(currentPath)
```

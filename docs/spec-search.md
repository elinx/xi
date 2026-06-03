# Global Search Spec

## 1. Overview

实现全局搜索功能，`Cmd/Ctrl+Shift+F` 打开搜索面板，支持跨文件内容搜索和跨会话消息搜索。

参考：VS Code `Ctrl+Shift+F`，结合 Xi 的会话特性。

## 2. 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl+Shift+F` | 打开/关闭搜索面板 |
| `Enter` | 跳转到下一个匹配 |
| `Shift+Enter` | 跳转到上一个匹配 |
| `Cmd+Enter` | 在新 Tab 中打开匹配文件 |

## 3. UI 设计

### 3.1 布局

搜索面板作为 Right Panel 的新 view 添加，与 `files` / `git` 并列：

```
Right Panel 顶栏：
[📁 Files] [🔍 Search] [🔀 Git]
              ↑ 新增
```

```
┌─────────────────────────────┐
│ 🔍 Search                    │
├─────────────────────────────┤
│ [搜索输入框______________]   │
│ ☐ Include: [__________]     │
│ ☐ Exclude: [__________]     │
├─────────────────────────────┤
│ 3 files, 7 matches          │
├─────────────────────────────┤
│ ▼ src/App.tsx (3)           │  ← 文件 group，可折叠
│   48: const handleDiffSelect│     匹配行高亮
│   92: setRightPanelView     │
│ 120: const rightPanelView   │
│ ▼ src/hooks/usePiRpc.ts (2) │
│   45: sendPrompt            │
│   88: isStreaming           │
│ ▶ src/components/ChatView (2)│  ← 折叠状态
└─────────────────────────────┘
```

### 3.2 尺寸

- 搜索框：`px-3 py-2 text-sm`，圆角 `rounded-md`
- Include/Exclude：默认折叠，点击展开
- 文件 Group header：`py-1.5 px-3 text-xs font-medium text-gray-700 bg-gray-50`
- 匹配行：`py-1 px-3 text-xs font-mono`
- 匹配文字高亮：`bg-yellow-200 text-yellow-900 rounded px-0.5`

### 3.3 搜索范围切换

搜索框下方有两个 tab：

| Tab | 范围 | 数据源 |
|-----|------|--------|
| Files | 项目文件内容 | 新 `fs:search` IPC |
| Sessions | 会话消息 | `getMessagesForSession()` |

## 4. 数据源

### 4.1 文件内容搜索

新增 IPC handler：`fs:search`

```typescript
// main/index.ts
ipcMain.handle('fs:search', async (_event, query: string, options?: {
  includePattern?: string
  excludePattern?: string
  maxResults?: number
}) => {
  // 使用 child_process 执行 ripgrep
  // 或者使用 Node.js 实现 glob + read + search
  // 返回: { ok: boolean, results?: SearchResult[], error?: string }
})

interface SearchResult {
  filePath: string
  relativePath: string
  matches: Array<{
    lineNumber: number
    lineContent: string
    matchStart: number
    matchEnd: number
  }>
}
```

**实现方案**：优先使用系统 `rg` (ripgrep)，fallback 到 Node.js 逐文件搜索。

```typescript
// 优先 ripgrep
async function searchWithRipgrep(query: string, cwd: string, options?: SearchOptions): Promise<SearchResult[]> {
  const args = ['--json', '--max-count', '50', '--ignore-case']
  if (options?.includePattern) args.push('--glob', options.includePattern)
  if (options?.excludePattern) args.push('--glob', `!${options.excludePattern}`)
  args.push(query, cwd)

  const { stdout } = await execFile('rg', args, { timeout: 10000 })
  return parseRipgrepJson(stdout)
}

// Fallback: Node.js search
async function searchWithNode(query: string, cwd: string, options?: SearchOptions): Promise<SearchResult[]> {
  const files = await walkDirectory(cwd)
  const results: SearchResult[] = []
  const q = query.toLowerCase()
  for (const file of files) {
    if (results.length >= (options?.maxResults ?? 200)) break
    const content = readFileSync(file.path, 'utf-8')
    const lines = content.split('\n')
    const matches = []
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].toLowerCase().indexOf(q)
      if (idx !== -1) {
        matches.push({ lineNumber: i + 1, lineContent: lines[i], matchStart: idx, matchEnd: idx + query.length })
      }
    }
    if (matches.length > 0) results.push({ filePath: file.path, relativePath: file.path.replace(cwd + '/', ''), matches })
  }
  return results
}
```

### 4.2 会话消息搜索

使用现有 API：

```typescript
async function searchSessions(query: string, sessions: SessionInfo[]): Promise<SessionSearchResult[]> {
  const results = []
  const q = query.toLowerCase()
  for (const session of sessions) {
    const messages = await window.api.getMessagesForSession(session.filePath)
    const matches = []
    for (const msg of messages) {
      const text = extractTextFromMessage(msg)
      if (text.toLowerCase().includes(q)) {
        matches.push({ messageId: msg.id, text: truncate(text, 200) })
      }
    }
    if (matches.length > 0) {
      results.push({ session, matches })
    }
  }
  return results
}
```

### 4.3 Preload 桥接

```typescript
// preload/index.ts 新增
searchFiles: (query: string, options?: { includePattern?: string; excludePattern?: string; maxResults?: number }): Promise<{
  ok: boolean
  results?: SearchResult[]
  error?: string
}> => ipcRenderer.invoke('fs:search', query, options)
```

## 5. 交互行为

### 5.1 搜索触发

- 输入后 debounce 300ms 自动搜索
- 最小 2 个字符才开始搜索
- 搜索中显示 spinner

### 5.2 结果浏览

- 文件 group 默认展开前 3 个，其余折叠
- 点击文件 group header → 展开/折叠
- 点击匹配行 → 打开文件 tab 并滚动到该行
- 会话模式下点击匹配 → switchSession + scrollToMessage

### 5.3 匹配导航

搜索结果底部状态栏显示：

```
3 files · 7 matches · ⌘↵ to open in new tab
```

## 6. 技术方案

### 6.1 新文件

| 文件 | 职责 |
|------|------|
| `src/renderer/src/components/SearchPanel.tsx` | 搜索面板组件（搜索框 + 结果列表 + Files/Sessions 切换） |
| `src/renderer/src/hooks/useSearch.ts` | 搜索逻辑 hook：debounce + 调用 search API + 状态管理 |
| `src/main/search.ts` | 搜索实现：ripgrep 优先 + Node fallback |

### 6.2 修改文件

| 文件 | 改动 |
|------|------|
| `useLayoutStore.ts` | `RightPanelView` 添加 `'search'` |
| `RightPanel.tsx` | 添加 Search tab + 渲染 `<SearchPanel>` |
| `App.tsx` | 添加 `Cmd+Shift+F` 全局快捷键 |
| `preload/index.ts` | 添加 `searchFiles` API |
| `main/index.ts` | 添加 `fs:search` IPC handler |

### 6.3 RightPanel 扩展

```typescript
// useLayoutStore.ts
export type RightPanelView = 'files' | 'git' | 'search'
```

RightPanel 顶部 tab 栏添加搜索图标：

```
[📁] [🔍] [🔀]
```

选中搜索 tab 时渲染 `<SearchPanel />`。

## 7. 分阶段实现

### Phase 1: 文件搜索

- `fs:search` IPC（ripgrep + Node fallback）
- `SearchPanel.tsx`：搜索框 + 结果列表（Files 模式）
- Right Panel 添加 search tab
- `Cmd+Shift+F` 快捷键
- 点击结果 → 打开文件 tab

### Phase 2: 会话搜索

- Files / Sessions tab 切换
- Sessions 搜索：遍历所有会话消息
- 点击结果 → switchSession + scrollToMessage

### Phase 3: 高级搜索

- Include / Exclude pattern 过滤
- 正则表达式模式
- 搜索结果折叠/展开持久化
- 搜索历史（最近搜索词）
- 替换功能

## 8. 边界情况

| 场景 | 处理 |
|------|------|
| 空查询 | 不搜索，显示空状态 |
| 查询太短（1 字符） | 不搜索，显示 "Type 2+ characters" |
| 搜索耗时 > 5s | 超时，显示 "Search timed out" |
| 结果 > 200 条 | 截断，显示 "Showing first 200 results" |
| 二进制文件 | ripgrep 自动跳过，Node fallback 检查 file extension |
| 大文件 | ripgrep 有 max-filesize 参数，Node fallback 跳过 >2MB |
| 项目不是 git repo | ripgrep 不依赖 git，正常工作 |
| ripgrep 未安装 | Fallback 到 Node.js 搜索 |
| 会话数量很多 | 并发限制：同时搜索最多 5 个会话 |
| 搜索中切换 session | 取消搜索（AbortController） |

## 9. 与 Command Palette 的关系

Command Palette (`Cmd+P`) 侧重**导航**：快速跳转到文件/会话/命令。
Search (`Cmd+Shift+F`) 侧重**内容搜索**：在文件/会话中查找文本。

两者互补，不重叠：
- 想打开 `login.ts` → `Cmd+P` + 输入 `login`
- 想找所有包含 `handleAuth` 的文件 → `Cmd+Shift+F` + 输入 `handleAuth`

## 10. 与 File Mention 的关系

File Mention 是输入框内的**上下文注入**，Search 是全局的**内容查找**。

搜索结果可以快速转为 mention：
- 在搜索结果中右键 → "Copy as @mention"
- 或者未来：拖拽搜索结果到输入框自动转为 mention

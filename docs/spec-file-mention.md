# File & Session Mention Spec

## 1. Overview

在 InputBar 的聊天输入框中，支持两种 mention：

- **文件 mention**：输入 `@` 触发文件选择弹窗，选中文件后将文件路径作为结构化数据嵌入消息，Pi agent 收到后可以读取该文件内容作为上下文。
- **Session mention**：输入 `$` 触发 session 选择弹窗，选中 session 后将该 session 的最近消息作为上下文注入。

两种 mention 在 **ChatView 消息渲染** 中均显示为可点击的 pill，点击可跳转查看对应文件或切换到对应 session。

参考：Cursor `@Files`，VS Code Copilot Chat `#file`，Windsurf `@files`。

## 2. 触发与交互

### 2.1 触发方式

| 触发 | 说明 |
|------|------|
| 输入 `@` | 弹出文件选择下拉框 |
| `@` + 继续输入 | fuzzy 过滤文件列表 |
| `@` + 空格 | 关闭下拉框，`@` 视为普通文字 |
| 删除 `@` | 关闭下拉框 |

### 2.2 交互流程

```
用户输入: "fix the bug in @"
                    ↓
┌─────────────────────────────────────────┐
│ 📄 src/auth/login.ts                    │
│ 📄 src/auth/middleware.ts               │
│ 📄 src/components/LoginForm.tsx          │
│ 📁 src/auth/                            │
│ ...                                     │
└─────────────────────────────────────────┘
                    ↓ 用户继续输入 "log"
┌─────────────────────────────────────────┐
│ 📄 src/auth/login.ts              ← match│
│ 📄 src/utils/logger.ts            ← match│
└─────────────────────────────────────────┘
                    ↓ 选中
输入框变为: "fix the bug in @login.ts█"
                         ↑ chip（不可编辑的原子节点）
```

### 2.3 键盘交互

| 键 | 动作 |
|----|------|
| `↑` / `↓` | 上下移动选中项 |
| `Enter` | 选中当前项 |
| `Tab` | 选中当前项（同 Enter） |
| `Escape` | 关闭下拉框，`@` 保留为普通文字 |
| `Backspace` | 删除 `@` → 关闭下拉框 |

### 2.4 多 mention 支持

一条消息可以包含多个 `@mention`：

```
"compare @App.tsx with @main.ts and tell me the differences"
        ↑ chip       ↑ chip
```

每个 chip 独立可删除（光标在 chip 后按 Backspace 整个删除）。

## 3. 消息格式

### 3.1 发送给 Pi 的格式

Mention 在发送前被解析为结构化数据。`onSend` 扩展为：

```typescript
interface MentionItem {
  type: 'file'
  path: string       // 绝对路径
  name: string       // 文件名
}

interface InputBarProps {
  // ...existing
  onSend: (text: string, images?: ImageData[], mentions?: MentionItem[]) => void
}
```

### 3.1 发送给 Pi 的格式（2024-06 更新：对齐主流做法）

**主流做法（Cursor / VS Code Copilot / Windsurf）**：@mention 的文件内容**绝不出现在用户消息文本中**。文件内容作为结构化上下文与用户文本**分开发送**。

| 工具 | Chat UI 显示 | AI 收到的格式 |
|------|-------------|--------------|
| Cursor | pill/chip（文件名） | 文件内容注入结构化 context，与用户文本分离 |
| VS Code Copilot | attachment pill | `<attachments>` XML tag，用户文本在 `<prompt>` tag |
| Windsurf | context item | 优先级 pipeline 组装，与用户文本分离 |

**Xi 的策略**：

1. **Chat UI**：用户消息只显示 `@filename`，不显示文件内容
2. **发送给 Pi**：`mentions` 字段传给 Pi SDK，由 SDK 读取文件内容注入 context
3. **Fallback**：如果 Pi SDK 不支持 `mentions` 字段，在 `message` 之外用结构化标记追加（而非直接拼入用户消息文本）

发送格式：
```
{ 
  type: 'prompt', 
  message: 'fix the bug in @login.ts',    ← 用户文本不变
  mentions: [{ type: 'file', path: '/path/src/auth/login.ts', name: 'login.ts' }]
}
```

Pi SDK 处理 `mentions` 字段读取文件内容。如果 SDK 不支持，fallback 为追加到 message 末尾，但使用 XML 标记分隔：

```
fix the bug in @login.ts

<attachment id="login.ts">
<file content>
</attachment>
```
```

### 3.2 选择 fallback 策略

优先检查 Pi SDK 是否支持 `mentions` 字段。如果支持 → 结构化发送；如果不支持 → XML attachment fallback。

**重要**：无论哪种 fallback，文件内容都**不混入用户消息文本**。用户在 Chat UI 中只看到 `@filename`，不看到文件原文。这与 Cursor / VS Code Copilot / Windsurf 的做法一致。

## 4. UI 设计

### 4.1 下拉框

```
┌──────────────────────────────────────┐
│ 🔍 Search files...                   │  ← 筛选提示（无单独搜索框）
├──────────────────────────────────────┤
│ 📄 src/auth/login.ts                 │  ← 文件图标 + 相对路径
│ 📄 src/auth/middleware.ts            │
│ 📄 src/components/LoginForm.tsx       │
│ 📁 src/auth/                         │  ← 文件夹有 → 箭头
└──────────────────────────────────────┘
```

- 定位：`absolute bottom-full left-0 mb-1`（与 ModelSelector 一致）
- 宽度：与 textarea 同宽
- 最大高度：`240px`
- 最多显示 20 个结果
- 选中项：`bg-blue-50 text-blue-900`

### 4.2 Chip 样式

Mention 插入后在 textarea 中显示为纯文本 `@filename`。

**Phase 1**：使用原生 `<textarea>`，mention 作为纯文本 `@filename` 插入。这是最简单的实现，不需要 contentEditable 或 Tiptap。

**Phase 2**（可选升级）：切换到 Tiptap/ProseMirror，mention 渲染为原子 chip：
```
┌──────────┐
│ 📄 login.ts │  ← chip，背景 bg-blue-50 border border-blue-200 rounded px-1
└──────────┘
```

### 4.3 文件夹导航

Phase 1：文件夹不可进入，只显示文件。

Phase 2：选中文件夹 → `Tab` 进入 → 显示子目录内容。`Backspace`（搜索框为空时）返回上级。

## 5. 数据源

### 5.1 文件索引

复用 Command Palette 的 `useFileIndex` hook。同一个缓存，避免重复遍历。

```typescript
const { files } = useFileIndex()
```

### 5.2 搜索过滤

使用 cmdk 同款的 fuzzy match 逻辑，或简单 `includes` 前缀匹配（Phase 1）：

```typescript
function filterFiles(files: FileEntry[], query: string): FileEntry[] {
  if (!query) return files.slice(0, 20)
  const q = query.toLowerCase()
  return files
    .filter(f => !f.isDirectory)
    .filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.path.toLowerCase().includes(q)
    )
    .slice(0, 20)
}
```

### 5.3 项目根路径

使用 `window.api.getProjectPath()` 获取项目根，计算相对路径显示。

## 6. 技术方案

### 6.1 依赖

Phase 1：无新依赖（原生 textarea + 手动下拉框）。
Phase 2（可选）：`@tiptap/react` + `@tiptap/extension-mention` + `@tiptap/suggestion` + `tippy.js`。

### 6.2 新文件

| 文件 | 职责 |
|------|------|
| `src/renderer/src/components/FileMentionDropdown.tsx` | 下拉框组件：文件列表 + 键盘导航 + 选中回调 |
| `src/renderer/src/hooks/useFileMention.ts` | Mention 逻辑：检测 `@` 触发、提取 query、管理下拉框状态 |

### 6.3 修改文件

| 文件 | 改动 |
|------|------|
| `InputBar.tsx` | 集成 `useFileMention`，渲染 `FileMentionDropdown`，扩展 `onSend` 签名 |
| `App.tsx` | 传递 `onSend` 时处理 mentions 字段（文本 fallback 或结构化发送） |
| `usePiRpc.ts` | `sendPrompt` 可选接收 `mentions` 参数 |

### 6.4 `useFileMention` Hook 设计

```typescript
interface FileMentionState {
  open: boolean
  query: string
  triggerStart: number  // @ 字符在 textarea 中的位置
  filteredFiles: FileEntry[]
  selectedIndex: number
}

interface FileMentionActions {
  onTextInput: (value: string, selectionStart: number) => void
  onKeyDown: (e: React.KeyboardEvent) => boolean  // return true = consumed
  selectItem: (file: FileEntry) => void
  close: () => void
}

export function useFileMention(files: FileEntry[]): FileMentionState & FileMentionActions
```

**触发检测逻辑**：

```typescript
function onTextInput(value: string, cursorPos: number) {
  // 从 cursor 往前找最近的 @
  const textBeforeCursor = value.substring(0, cursorPos)
  const atPos = textBeforeCursor.lastIndexOf('@')
  if (atPos === -1) { close(); return }

  // @ 后面的文字作为 query
  const query = textBeforeCursor.substring(atPos + 1)

  // 如果 query 包含空格 → 不是 mention，关闭
  if (query.includes(' ')) { close(); return }

  // 如果 @ 前面是字母/数字 → 不是 mention trigger（如 email）
  if (atPos > 0 && /\w/.test(value[atPos - 1])) { close(); return }

  setTriggerStart(atPos)
  setQuery(query)
  setFilteredFiles(filterFiles(files, query))
  setOpen(true)
}
```

**选中插入逻辑**：

```typescript
function selectItem(file: FileEntry) {
  const before = text.substring(0, triggerStart)
  const after = text.substring(cursorPos)
  const mention = `@${file.name}`
  setText(before + mention + ' ' + after)
  setOpen(false)
  // 同时记录 mention 到 mentions 数组
  addMention({ type: 'file', path: file.path, name: file.name })
}
```

**键盘拦截**：

```typescript
function onKeyDown(e: React.KeyboardEvent): boolean {
  if (!open) return false

  switch (e.key) {
    case 'ArrowUp': e.preventDefault(); selectPrev(); return true
    case 'ArrowDown': e.preventDefault(); selectNext(); return true
    case 'Enter':
    case 'Tab':
      e.preventDefault()
      selectItem(filteredFiles[selectedIndex])
      return true
    case 'Escape':
      e.preventDefault()
      close()
      return true
  }
  return false
}
```

## 7. 分阶段实现

### Phase 1: 基础 Mention

- `useFileMention` hook：`@` 触发、query 提取、文件过滤
- `FileMentionDropdown` 组件：文件列表 + 键盘导航
- InputBar 集成：下拉框渲染 + mention 插入
- 消息发送：文本 fallback（文件内容追加到 message 末尾）
- 仅支持文件 mention（不支持文件夹导航）

### Phase 2: 增强

- 文件夹导航（Tab 进入 / Backspace 返回）
- 多 mention 支持（mentions 数组）
- Pi SDK 结构化 mention（如果 SDK 支持）
- Mention chip 视觉高亮（textarea overlay 或切换 Tiptap）

### Phase 3: 高级

- `@` 后选择 mention 类型：Files / Folders / Symbols / Git Diff
- 大文件处理：小文件全量注入，大文件只注入 outline
- `/` slash commands（`/fix` `/explain` `/test`）

## 8. 边界情况

| 场景 | 处理 |
|------|------|
| `@` 在行首 | ✅ 正常触发 |
| `@` 前面是空格或行首 | ✅ 正常触发 |
| `@` 前面是字母（email） | ❌ 不触发（`/\w/.test(charBefore)`） |
| `@` 后输入空格 | 关闭下拉框，`@` 作为普通文字 |
| 输入 `@@` | 第二个 `@` 从第二个 `@` 开始新 query |
| 多个 `@mention` | 各自独立，mentions 数组累积 |
| 删除 `@` | 关闭下拉框 |
| 文件名有空格 | Phase 1：不支持（空格关闭下拉）。Phase 2：chip 是原子节点 |
| 非常大的项目（10000+ 文件） | 索引缓存 + 最多 20 结果 + debounce 200ms |
| 文件索引还没建完 | 下拉框显示 "Loading..." |
| `@` 后无匹配 | 下拉框显示 "No files found" |

## 9. 与现有代码的交互

### 9.1 InputBar 改动

当前 `handleKeyDown` 只处理 `Enter`：

```typescript
function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}
```

修改后：

```typescript
function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
  // Mention 下拉框优先拦截
  if (mention.onKeyDown(e)) return

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}
```

### 9.2 `onSend` 签名扩展

```typescript
// Before
onSend: (text: string, images?: ImageData[]) => void

// After
onSend: (text: string, images?: ImageData[], mentions?: MentionItem[]) => void
```

向后兼容：`mentions` 是可选参数，现有调用方无需修改。

### 9.3 Textarea 不变

Phase 1 继续使用原生 `<textarea>`，不需要 contentEditable。Mention 以纯文本 `@filename` 形式插入，简单可靠。

### 9.4 文件索引共享

`useFileIndex` 在 Command Palette 和 File Mention 之间共享同一份缓存。首次触发任一功能时构建索引，之后复用。

---

# Part 2: Session Mention

## 10. Session Mention 概述

输入 `$` 触发 session 选择下拉框，选中后以 pill 形式插入输入框，发送时将对应 session 的最近消息作为上下文注入。ChatView 渲染时，`$sessionName` 显示为可点击的紫色 pill，点击后切换到对应 session。

### 10.1 现有实现状态

| 层面 | 状态 | 文件 |
|------|------|------|
| 输入侧（`$` 触发下拉） | ✅ 已实现 | `useSessionMention.ts` + `SessionMentionDropdown.tsx` |
| 数据传递（MentionItem type=session） | ✅ 已实现 | `useFileMention.ts` (`SessionMentionData`) |
| 发送时上下文注入 | ✅ 已实现 | `App.tsx` 提取最近10条消息注入 |
| ChatView 可点击 pill 渲染 | ❌ 缺失 | `ChatView.tsx` 只识别 `@` 不识别 `$` |

### 10.2 本次改动范围

补全 ChatView 渲染侧，使 `$sessionName` 在 **user 和 assistant 消息** 中均显示为可点击的紫色 pill。

## 11. Session Mention 输入侧

### 11.1 触发方式

| 触发 | 说明 |
|------|------|
| 输入 `$` | 弹出 session 选择下拉框 |
| `$` + 继续输入 | fuzzy 过滤 session 列表（按 name 匹配） |
| `$` + 空格 | 关闭下拉框，`$` 视为普通文字 |
| 删除 `$` | 关闭下拉框 |

### 11.2 触发检测逻辑

与 `@` 文件 mention 对称，从 cursor 往前找最近的 `$`：

```typescript
function onTextInput(value: string, cursorPos: number) {
  const textBeforeCursor = value.substring(0, cursorPos)
  const dollarPos = textBeforeCursor.lastIndexOf('$')
  if (dollarPos === -1) { close(); return }
  if (dollarPos > 0 && /\w/.test(value[dollarPos - 1])) { close(); return } // 不是独立 $
  const query = textBeforeCursor.substring(dollarPos + 1)
  if (query.includes(' ')) { close(); return }
  const filtered = filterSessions(sessions, query)
  setState({ open: true, query, filteredSessions: filtered, ... })
}
```

### 11.3 键盘交互

与文件 mention 一致：`↑/↓` 移动选中，`Enter/Tab` 选中，`Escape` 关闭。

### 11.4 下拉框样式

与 `FileMentionDropdown` 对称，紫色主题：

```
┌──────────────────────────────────────┐
│ 🔄 session管理                       │  ← session 图标 + 名称 + 消息数
│ 🔄 feat: mentions                    │
│ 🔄 feat: lazy-session-switch         │  3 msgs
│ 🔄 bugfix: input-lost                │
└──────────────────────────────────────┘
```

- 选中项：`bg-purple-50 text-purple-900`
- 最多显示 15 个结果
- 只显示有 name 的 session

### 11.5 数据结构

```typescript
interface SessionMentionData {
  type: 'session'
  sessionId: string
  name: string
  filePath: string  // session JSONL 文件路径
}
```

### 11.6 发送时上下文注入

发送消息时，`App.tsx` 提取 type=session 的 mentions，从缓存读取对应 session 最近 10 条消息，格式化为 XML 注入 prompt：

```
[Referenced session context]
<session name="session管理">
User: ...
Assistant: ...
</session>

用户原始消息
```

## 12. Session Mention 渲染侧（本次新增）

### 12.1 正则匹配

在 ChatView 的 `TextBlockRenderer` 中，新增 session mention 的正则：

```typescript
const FILE_MENTION_RE = /@([\w][\w-]*(?:[\/.][\w./-]+)+)/g
const SESSION_MENTION_RE = /\$([\w\u4e00-\u9fff][\w\u4e00-\u9fff-]*)/g
```

**Session mention 正则说明**：
- 以 `$` 开头
- 第一个字符：`\w`（字母数字下划线）或中文（`\u4e00-\u9fff`）
- 后续字符：`\w`、中文、或连字符 `-`
- 支持中文是因为 session 名称经常包含中文
- 不含 `/` 和 `.`，与文件 mention 区分（文件路径必然含这些字符）

### 12.2 Segment 类型扩展

```typescript
interface TextSegment { type: 'text'; value: string }
interface FileMentionSegment { type: 'mention'; value: string }
interface SessionMentionSegment { type: 'session-mention'; value: string }
type Segment = TextSegment | FileMentionSegment | SessionMentionSegment
```

### 12.3 `splitByMentions` 改造

同时匹配 `@` 和 `$`，按位置顺序分段：

```typescript
function splitByMentions(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0

  // 收集所有匹配
  const matches: { index: number; endIndex: number; type: 'mention' | 'session-mention'; value: string }[] = []

  const fileRe = new RegExp(FILE_MENTION_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = fileRe.exec(text)) !== null) {
    matches.push({ index: m.index, endIndex: fileRe.lastIndex, type: 'mention', value: m[1] })
  }

  const sessionRe = new RegExp(SESSION_MENTION_RE.source, 'g')
  while ((m = sessionRe.exec(text)) !== null) {
    matches.push({ index: m.index, endIndex: sessionRe.lastIndex, type: 'session-mention', value: m[1] })
  }

  // 按位置排序
  matches.sort((a, b) => a.index - b.index)

  for (const match of matches) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: match.type, value: match.value } as Segment)
    lastIndex = match.endIndex
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }]
}
```

### 12.4 `SessionMentionPill` 组件

```tsx
function SessionMentionPill({ sessionName, onClick }: { sessionName: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-0.5 px-1.5 py-px mx-0.5 rounded-md bg-purple-100 text-purple-700 text-[13px] leading-5 align-baseline hover:bg-purple-200 transition-colors cursor-pointer border-0"
    >
      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      {sessionName}
    </button>
  )
}
```

- 紫色主题（`bg-purple-100 text-purple-700 hover:bg-purple-200`），与输入侧下拉框的紫色一致
- 图标使用 session 图标（圆形窗口），与 `SessionMentionDropdown` 一致
- 点击行为：切换到对应 session

### 12.5 渲染逻辑

`TextBlockRenderer` 扩展：

```tsx
if (onFileSelect) {
  const segments = splitByMentions(block.content)
  if (segments.length === 1 && segments[0].type === 'text') {
    // 无 mention，走普通 Markdown 渲染
    return <ReactMarkdown ...>{block.content}</ReactMarkdown>
  }
  return (
    <div className="prose prose-sm max-w-none">
      <p>
        {segments.map((seg, i) => {
          if (seg.type === 'mention')
            return <MentionPill key={i} filePath={seg.value} onClick={() => onFileSelect(seg.value)} />
          if (seg.type === 'session-mention')
            return <SessionMentionPill key={i} sessionName={seg.value} onClick={() => onSessionSelect(seg.value)} />
          return <ReactMarkdown key={i} ...>{seg.value}</ReactMarkdown>
        })}
      </p>
    </div>
  )
}
```

### 12.6 `onSessionSelect` 回调

`TextBlockRenderer` 新增 `onSessionSelect` prop，点击 session pill 时：

1. 在 session 列表中按 name 查找匹配的 session
2. 调用 session 切换逻辑（与侧边栏点击 session 效果一致）

```typescript
interface TextBlockRendererProps {
  // ...existing
  onFileSelect?: (filePath: string) => void
  onSessionSelect?: (sessionName: string) => void  // 新增
}
```

### 12.7 User 和 Assistant 消息均支持

**两种消息均渲染 session mention pill**：

- **User 消息**：用户输入 `$session管理` → 可点击跳转到该 session
- **Assistant 消息**：assistant 回复中提到 `$feat/lazy-session-switch` → 可点击跳转

无需区分消息角色，`splitByMentions` 对所有文本统一处理。

## 13. 边界情况

| 场景 | 处理 |
|------|------|
| `$` 前面是字母（如 `var$foo`） | 不匹配（正则要求 `$` 前不是 `\w`） |
| `$` 后输入空格 | 渲染时 `$` 视为普通文字 |
| Session name 包含中文 | ✅ 正则包含 `\u4e00-\u9fff` |
| Session name 包含连字符 | ✅ 如 `feat/lazy-switch` |
| `$USD` / `$100` | 看正则：`U` 和 `1` 都是 `\w`，但后面不含空格前的完整词，只有连续 `\w-` 字符才匹配。如果 `USD` 后面是空格或结尾则匹配。注意：纯数字开头的 `$100` 不匹配（正则要求首字符为 `\w` 但不含纯数字，或用 `\D` 排除） |
| 同一文本中同时出现 `@file` 和 `$session` | ✅ 按位置排序分段，互不干扰 |
| Session 被删除后点击 pill | 提示 "Session not found" 或忽略 |
| `$$` 两个 `$` | 第二个 `$` 前面是 `$`（非 `\w`），会触发匹配。可能需要排除连续 `$` 的情况 |

### 13.1 `$100` / `$var` 误匹配问题

Session mention 的 `$` 前缀与 Shell 变量、价格等有歧义。解决方案：

- **方案 A**（推荐）：渲染侧的正则与输入侧一致，只匹配有 name 的 session 列表中的名称。不在 session 列表中的 `$xxx` 不渲染为 pill
- **方案 B**：正则限制首字符必须为中文或大写字母，排除 `$100` 等数字开头的场景

选择方案 A：**渲染时做 session name 校验**，只有 `$xxx` 中的 `xxx` 确实存在于 session 列表中才渲染为 pill，否则当普通文本。这样最安全，不会误匹配。

## 14. 改动清单

### 14.1 修改文件

| 文件 | 改动 |
|------|------|
| `ChatView.tsx` | 新增 `SESSION_MENTION_RE`、`SessionMentionSegment`、`SessionMentionPill`；改造 `splitByMentions` 支持双正则；`TextBlockRenderer` 增加 `onSessionSelect` |
| `App.tsx` | 向 `ChatView` 传递 `onSessionSelect` 回调和 session 列表 |

### 14.2 不需要改动的文件

| 文件 | 原因 |
|------|------|
| `useSessionMention.ts` | 输入侧已实现 |
| `SessionMentionDropdown.tsx` | 输入侧已实现 |
| `useFileMention.ts` | 数据结构已支持 `SessionMentionData` |
| `InputBar.tsx` | 已集成 `$` 触发逻辑 |

预计改动量：**~50 行代码**，仅涉及 ChatView.tsx 和 App.tsx。

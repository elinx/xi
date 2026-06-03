# File Mention in Input Spec

## 1. Overview

在 InputBar 的聊天输入框中，输入 `@` 触发文件选择弹窗，选中文件后将文件路径作为结构化数据嵌入消息，Pi agent 收到后可以读取该文件内容作为上下文。

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

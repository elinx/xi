# Input History Navigation Spec

## 1. Overview

在 InputBar 的聊天输入框中，按 `↑` / `↓` 键浏览当前 session 已发送的用户消息历史，自动回填到输入框中。行为类似 shell（bash/zsh）的命令历史导航。

参考：ChatGPT、Claude、iTerm2 的 `↑` / `↓` 历史回溯。

## 2. 交互行为

### 2.1 基本导航

| 操作 | 行为 |
|------|------|
| 按 `↑` | 用上一条已发送的用户消息替换输入框内容 |
| 连续按 `↑` | 继续往更早的消息遍历 |
| 按 `↓` | 往更近的消息遍历 |
| 遍历到最新后再按 `↓` | 恢复到浏览前的草稿内容 |
| 发送消息 | 重置历史指针到最新位置 |
| 按非 `↑` / `↓` 的其他键 | 重置历史指针到最新位置，用户继续编辑 |

### 2.2 草稿保存

当用户正在输入但还没发送时，按 `↑` 浏览历史：

1. **保存当前输入框的文本作为"草稿"**（包括空字符串）
2. 遍历历史消息替换输入框内容
3. 按 `↓` 遍历回最新位置后，恢复草稿
4. 按其他键或发送消息时，草稿被丢弃

```
输入框: "fix the bu|"
按 ↑ → 草稿保存 "fix the bu"，输入框显示上一条消息
按 ↓ → 回到最新位置，恢复草稿 "fix the bu|"
继续输入 → 历史指针重置
```

### 2.3 空输入框时的行为

| 状态 | 按 `↑` |
|------|--------|
| 输入框为空 | 草稿为空字符串，直接显示最后一条用户消息 |
| 输入框有内容 | 先保存草稿，再显示最后一条用户消息 |

### 2.4 历史顺序

- 历史列表按**发送时间从新到旧**排列（index 0 = 最新）
- 按 `↑` 往更早方向移动（index 增大）
- 按 `↓` 往更新方向移动（index 减小）
- 这与 shell `↑` = 上一条命令的直觉一致

## 3. 冲突处理

### 3.1 与 @ Mention Dropdown 的冲突

当前 `↑` / `↓` 在 `mention.open` 时已被用于文件下拉列表导航。优先级：

| 状态 | `↑` / `↓` 归属 |
|------|----------------|
| Mention dropdown 打开 | 归 mention 下拉导航（现有行为不变） |
| Mention dropdown 关闭 | 归历史导航 |

现有代码已有 `if (mention.open)` 优先处理逻辑，无需额外改动：

```typescript
function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
  if (mention.open) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      mention.onKeyDown(e)
      return  // ← mention 优先，历史导航不会触发
    }
    // ...
  }
  // ↓ 历史导航逻辑放在此处 ↓
}
```

### 3.2 与多行输入（Shift+Enter）的冲突

`↑` / `↓` 在多行文本中本应用于光标上下移动。但考虑到：

- 输入框最大高度仅 `96px`（约 4-5 行），多行编辑场景极少
- shell / ChatGPT / Claude 均采用 `↑` / `↓` = 历史导航，覆盖多行光标移动
- 用户可通过鼠标点击定位光标

**决策**：`↑` / `↓` 在输入框中始终为历史导航，不支持多行光标移动。这与 ChatGPT 的行为一致。

## 4. 历史消息来源

### 4.1 方案选择

**采用方案：从当前 session 的 user messages 中提取**

- 从 `messages` 中过滤 `role === 'user'` 的消息
- 提取纯文本内容（不含 mention pill 标记）
- 天然跟随 session 切换

**不采用方案**：

| 方案 | 不采用原因 |
|------|-----------|
| 全局跨 session 持久化历史 | 需要持久化存储，实现复杂；跨 session 消息可能不相关 |
| localStorage 存储 | 过度工程，当前 session 级别已满足核心需求 |

### 4.2 消息提取

```typescript
// 从 ChatMessage[] 中提取用户发送的纯文本
function extractUserMessages(messages: ChatMessage[]): string[] {
  return messages
    .filter(msg => msg.role === 'user')
    .map(msg => {
      // 提取 text block 的内容，拼接为纯文本
      return msg.blocks
        .filter(b => b.type === 'text' && !b.subtype)
        .map(b => (b as TextBlock).content)
        .join('\n')
    })
    .filter(text => text.trim().length > 0)
}
```

### 4.3 去重策略

**不去重**，保持原始发送顺序。如果用户连续发送相同消息，历史中会出现重复，与 shell 行为一致。

### 4.4 历史上限

**不限制**。当前 session 的 user messages 数量通常在合理范围内（几十到几百条），无需截断。

### 4.5 Session 切换

切换 session 后，`messages` 自动更新，历史列表随之变化，无需额外处理。

## 5. 技术方案

### 5.1 新增状态

在 `InputBar` 组件内部新增：

```typescript
const [historyIndex, setHistoryIndex] = useState(-1)  // -1 = 当前草稿
const draftRef = useRef('')  // 保存用户输入草稿
```

- `historyIndex === -1`：不在浏览历史，用户在编辑当前输入
- `historyIndex >= 0`：正在浏览历史，对应 `sentMessages[historyIndex]`

### 5.2 新增 Props

```typescript
interface InputBarProps {
  // ...existing
  sentMessages: string[]  // 当前 session 已发送的用户消息（新到旧）
}
```

`App.tsx` 从 `displayedMessages` 中提取 user messages 并传入。

### 5.3 键盘事件处理

修改 `handleKeyDown`：

```typescript
function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
  // 1. Mention dropdown 优先（现有逻辑不变）
  if (mention.open) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      mention.onKeyDown(e)
      return
    }
    // ... existing mention handling
  }

  // 2. 历史导航（新增）
  if (sentMessages.length > 0) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      navigateHistory('up')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      navigateHistory('down')
      return
    }
  }

  // 3. Escape while browsing history: restore draft
  if (e.key === 'Escape' && historyIndex !== -1) {
    e.preventDefault()
    const draft = draftRef.current
    setHistoryIndex(-1)
    draftRef.current = ''
    setEditorText(draft)
    return
  }

  // 4. 其他键 → 重置历史指针（Enter 除外，由 handleSubmit 独立处理）
  if (historyIndex !== -1 && !['Shift', 'Meta', 'Control', 'Alt', 'Enter'].includes(e.key)) {
    resetHistory()
  }

  // 5. 现有 Enter 逻辑
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}
```

### 5.4 历史导航逻辑

```typescript
function navigateHistory(direction: 'up' | 'down'): void {
  if (sentMessages.length === 0) return

  // 首次按 ↑：保存草稿
  if (historyIndex === -1 && direction === 'up') {
    draftRef.current = getPlainText()
  }

  let newIndex: number
  if (direction === 'up') {
    newIndex = historyIndex === -1 ? 0 : Math.min(historyIndex + 1, sentMessages.length - 1)
  } else {
    // direction === 'down'
    if (historyIndex === -1) return  // 已经在最新位置，不做任何事
    newIndex = historyIndex - 1
  }

  setHistoryIndex(newIndex)

  // 回填到输入框
  const text = newIndex === -1 ? draftRef.current : sentMessages[newIndex]
  setEditorText(text)
}

function resetHistory(): void {
  if (historyIndex === -1) return
  // 当前输入框内容就是用户编辑后的内容，直接重置指针
  setHistoryIndex(-1)
  draftRef.current = ''
}

function setEditorText(text: string): void {
  if (!editorRef.current) return
  // Suppress mention detection during programmatic text replacement
  suppressMentionRef.current = true
  editorRef.current.innerHTML = ''
  if (text) {
    // Convert newlines to <br> elements for proper rendering in contentEditable
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) editorRef.current.appendChild(document.createElement('br'))
      editorRef.current.appendChild(document.createTextNode(lines[i]))
    }
  }
  // Move cursor to end
  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(editorRef.current)
    range.collapse(false)  // collapse to end
    sel.removeAllRanges()
    sel.addRange(range)
  }
  // Close any open mention dropdown
  mention.close()
  setTimeout(() => { suppressMentionRef.current = false }, 100)
}
```

### 5.5 发送消息时重置

```typescript
const handleSubmit = useCallback((): void => {
  // ...existing submit logic
  // 重置历史指针
  setHistoryIndex(-1)
  draftRef.current = ''
}, [/* ...existing deps */])
```

### 5.6 App.tsx 传递 sentMessages

```typescript
// App.tsx 中提取 user messages
const sentMessages = useMemo(() => {
  return displayedMessages
    .filter(msg => msg.role === 'user')
    .map(msg => {
      return msg.blocks
        .filter((b): b is TextBlock => b.type === 'text' && !('subtype' in b && b.subtype))
        .map(b => b.content)
        .join('\n')
    })
    .filter(text => text.trim().length > 0)
    .reverse()  // 新到旧，index 0 = 最新
}, [displayedMessages])
```

## 6. 回填格式

### 6.1 纯文本回填

历史消息以纯文本回填到 contentEditable div 中，不保留 mention pill 结构。

理由：
- 历史浏览是快速回溯功能，用户期望看到原始文本
- mention pill 的结构化数据需要复杂的 DOM 操作重建
- 用户如需重新发送带 mention 的消息，可以手动重新 @

### 6.2 多行文本

保留原始换行符，contentEditable div 自然支持多行显示。

## 7. 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/renderer/src/components/InputBar.tsx` | 新增 `historyIndex`、`draftRef` 状态；新增 `navigateHistory`、`resetHistory`、`setEditorText` 逻辑；修改 `handleKeyDown` 增加 `↑` / `↓` 处理；修改 `handleSubmit` 重置历史指针；新增 `sentMessages` prop |
| `src/renderer/src/App.tsx` | 从 `displayedMessages` 提取 `sentMessages`，传入 `InputBar` |

## 8. 边界情况

| 场景 | 处理 |
|------|------|
| 新 session 无历史 | `sentMessages` 为空，`↑` / `↓` 无效果 |
| 只有一条历史 | 按 `↑` 回填该条，再按 `↑` 不变（已达最老），按 `↓` 恢复草稿 |
| 草稿为空 | 保存空字符串作为草稿，`↓` 遍历回最新时清空输入框 |
| 历史消息包含 mention pill 文本 | 回填为 `@path/to/file` 纯文本，不重建 pill |
| 历史消息包含图片 | 只回填文本部分，图片不回填（图片数据不在历史中） |
| 发送消息后立即按 `↑` | `handleSubmit` 已重置指针，按 `↑` 回填刚发送的消息 |
| Mention dropdown 打开时按 `↑` / `↓` | 归 mention 导航，历史不触发 |
| 浏览历史时发送消息 | `handleSubmit` 重置指针，发送当前输入框内容 |
| 浏览历史时按修饰键（Shift/Ctrl/Meta/Alt） | 不重置指针，允许用户组合按键 |
| 浏览历史时按 Escape | 恢复草稿内容，重置历史指针 |
| 浏览历史时按其他可输入键 | 重置历史指针，用户在历史文本基础上继续编辑 |
| 浏览历史时按 Enter | 不走 resetHistory，由 handleSubmit 独立重置，避免丢失草稿 |
| 输入框 disabled（未连接 Pi） | `↑` / `↓` 仍可浏览历史，但无法发送 |
| Session 切换 | `sentMessages` 随 messages 更新，`historyIndex` 自动重置为 -1 |
| 历史消息包含换行 | `setEditorText` 将 `\n` 转为 `<br>` 元素，正确渲染多行 |
| 历史回填后 mention 误触发 | `suppressMentionRef` 保护，100ms 内禁止 mention 检测 |
| 历史回填时 mention dropdown 仍打开 | `setEditorText` 调用 `mention.close()` 关闭下拉框 |

## 9. Session 切换时历史重置

当 session 切换导致 `sentMessages` 引用变化时，需要重置历史指针：

```typescript
useEffect(() => {
  setHistoryIndex(-1)
  draftRef.current = ''
}, [sentMessages])  // sentMessages 变化时重置
```

注意：`sentMessages` 是 `useMemo` 计算的，session 切换时会产生新引用，effect 会正确触发。

## 10. 未来扩展

| 扩展 | 说明 |
|------|------|
| 全局跨 session 历史 | 在 localStorage 中维护一个全局发送历史，新 session 也能回溯 |
| 历史搜索 | `Ctrl+R` 触发增量搜索历史（类似 shell 的 reverse-i-search） |
| mention pill 回填 | 回填时重建 mention chip 结构（需要更复杂的 DOM 操作） |
| 图片历史回填 | 历史中记录图片数据，回填时恢复图片预览 |

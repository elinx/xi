# Chat 右键菜单 Spec

## 目标

在 Chat 消息上支持右键菜单，将现有 hover 按钮的操作（Copy / Quote / Forward / Fork）通过右键方式触达，降低发现成本。

## 菜单项

仅在**消息气泡**上右键时弹出，菜单项固定，不区分 user/assistant：

| # | 菜单项 | 说明 |
|---|---|---|
| 1 | Copy Text | 复制消息纯文本（同 CopyButton 逻辑，跳过 thinking） |
| 2 | Quote | 引用该消息到输入框（同 onQuoteMessage） |
| 3 | Forward... | 转发到其他 Session（同 onForwardMessage） |
| 4 | Fork from Here | 从该消息 Fork（同 onForkAtEntry） |

> Copy Text 始终可用。Quote / Forward / Fork 在流式输出中（`isStreaming`）时灰显禁用。

## 触发条件

- 右键点击消息气泡区域（`data-msg-id` 所在元素）时弹出菜单
- 右键点击空白区域不弹出菜单（保持浏览器默认行为）
- 流式输出中仍可弹出，仅部分项灰显

## 技术方案

### 1. 新建 `ChatContextMenu.tsx`

```tsx
interface ChatContextMenuProps {
  x: number
  y: number
  messageId: string
  messageRole: 'user' | 'assistant'
  messageBlocks: ContentBlock[]
  isStreaming: boolean
  onCopy: (blocks: ContentBlock[]) => void
  onQuote: (messageId: string, role: 'user' | 'assistant', content: string, timestamp: number) => void
  onForward: (messageId: string, role: 'user' | 'assistant', content: string) => void
  onFork: (messageId: string) => void
  onClose: () => void
}
```

- 渲染方式：沿用项目已有 pattern（`createPortal` to `document.body`，fixed 定位）
- 视口边界：菜单高度/宽度超出时自动调整坐标

### 2. `ChatView.tsx` 改动

**a) 消息气泡加 `data-msg-id`**

在 normal 视图和 turn/outline 展开视图的消息 `<div>` 上添加：
```tsx
data-msg-id={msg.id}
data-msg-role={msg.role}
```

**b) 滚动容器加 `onContextMenu` 事件委托**

```tsx
const handleContextMenu = useCallback((e: React.MouseEvent) => {
  const msgEl = (e.target as HTMLElement).closest('[data-msg-id]') as HTMLElement | null
  if (!msgEl) return  // 空白区域，不拦截
  e.preventDefault()
  setContextMenu({
    x: e.clientX,
    y: e.clientY,
    messageId: msgEl.dataset.msgId!,
    messageRole: msgEl.dataset.msgRole as 'user' | 'assistant',
  })
}, [])
```

**c) 状态管理**

```tsx
const [contextMenu, setContextMenu] = useState<{
  x: number
  y: number
  messageId: string
  messageRole: 'user' | 'assistant'
} | null>(null)
```

**d) 菜单关闭**

- 点击菜单外任意位置
- 右键其他位置
- ESC 键
- 执行任意菜单项后

### 3. 菜单项动作

| 菜单项 | 实现方式 |
|---|---|
| Copy Text | 从 props 传入的 `messageBlocks` 提取 text block，`navigator.clipboard.writeText()`，同 `CopyButton` |
| Quote | 调用 `onQuoteMessage(messageId, role, content, timestamp)` |
| Forward | 设置 `forwardingMessage` state（复用已有 `SessionPickerModal`） |
| Fork | 调用 `handleForkClick(messageId, piEntryId)`（复用已有 `ForkNameInput`） |

### 4. 视口边界检测

```tsx
const menuRef = useRef<HTMLDivElement>(null)
useEffect(() => {
  if (!menuRef.current) return
  const rect = menuRef.current.getBoundingClientRect()
  const adjustedX = Math.min(x, window.innerWidth - rect.width - 8)
  const adjustedY = Math.min(y, window.innerHeight - rect.height - 8)
  if (adjustedX !== x || adjustedY !== y) {
    menuRef.current.style.left = `${adjustedX}px`
    menuRef.current.style.top = `${adjustedY}px`
  }
}, [x, y])
```

## 不做的事

- ❌ 选中文本的差异化菜单（Copy Selection / Quote Selection）
- ❌ 图片 / 代码块 / Thinking 的差异化菜单
- ❌ 空白区域右键菜单
- ❌ 快捷键提示
- ❌ 插件扩展点

## 涉及文件

| 文件 | 改动类型 |
|---|---|
| `src/renderer/src/components/ChatContextMenu.tsx` | 新建 |
| `src/renderer/src/components/ChatView.tsx` | 修改：加 data 属性、事件委托、state、Portal |

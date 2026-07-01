# In-Tab Search Spec

## 1. Overview

实现每个 tab 内部的局部搜索（Ctrl+F 风格）。

与全局搜索（`Cmd+Shift+F`，跨文件）互补：全局搜索找项目里的所有匹配，in-tab 搜索只在当前 tab 已渲染的内容里找。

参考：VS Code `Ctrl+F`、Chrome 页面内搜索、GitHub code view 的搜索栏。

## 2. 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl+F` | 打开/关闭 in-tab 搜索栏 |
| `Esc` | 关闭搜索栏，清除高亮 |
| `Enter` | 跳到下一个匹配 |
| `Shift+Enter` | 跳到上一个匹配 |

`Cmd/Ctrl+F` 只在当前 tab 类型支持搜索时生效（见 §4），否则不拦截。

## 3. UI 设计

### 3.1 布局

搜索栏浮在内容区右上角，半透明背景，不遮挡内容流：

```
┌──────────────────────────────────────────┐
│  Content area (ChatView / FileViewer)    │
│                          ┌──────────────┐│
│                          │ 🔍 foo  ↑↓ 3/12 │
│                          └──────────────┘│
│  ...content...                            │
│  ...content with yellow highlights...     │
└──────────────────────────────────────────┘
```

### 3.2 搜索栏样式

```
┌─────────────────────────┐
│ 🔍 [foo_________] Aa ↑ ↓ 3/12 × │
└─────────────────────────┘
```

- 容器：`absolute top-2 right-2 z-50`，glass 背景（`xi-glass`），圆角 `rounded-lg`，阴影
- 输入框：`text-xs`，宽度 144px（`w-36`），autofocus
- Aa 按钮：大小写敏感切换（默认不敏感），激活时蓝底白字
- 导航按钮：`↑` `↓` 两个小按钮，点击切换匹配
- 计数：`3/12` 格式（当前/总数），无匹配时显示 `0/0`，截断时显示 `3/500+`
- 关闭按钮：`×`，点击关闭搜索栏

### 3.3 匹配高亮

匹配文本用黄色背景高亮，当前选中项用橙色：

| 状态 | 样式 |
|------|------|
| 普通匹配 | `background: rgba(250, 204, 21, 0.35)` (yellow-400/35%) |
| 当前匹配 | `background: rgba(249, 115, 22, 0.5)` (orange-500/50%) |

## 4. 各 Tab 类型的搜索

### 4.1 适用范围

| Tab 类型 | 是否支持 | 搜索方式 |
|----------|---------|---------|
| session (chat) | ✅ | DOM TreeWalker 文本搜索 |
| file | ✅ | DOM TreeWalker 文本搜索 |
| skill | ✅ | DOM TreeWalker 文本搜索 |
| terminal | ❌ | 暂不支持（Phase 2） |
| diff | ❌ | 不支持 |
| settings | ❌ | 不支持 |

### 4.2 DOM 文本搜索（session / file / skill）

适用于所有以 DOM 渲染内容的 tab。

**搜索容器**：统一的 `contentAreaRef`，即 App.tsx 中包裹所有 tab 内容的 `<div ref={contentAreaRef}>`。不需要为每个组件单独传 ref。

**算法**：

1. 用 `TreeWalker` 遍历 `contentAreaRef` 内所有 `TEXT_NODE`
2. 对每个文本节点，用 `indexOf` 找到所有匹配位置
3. 为每个匹配创建 `Range` 对象
4. 维护 `matches: { range: Range, text: string }[]`
5. 滚动当前匹配到可视区域（见 §4.3）

**隐藏内容过滤**：

用 `offsetParent` 检测隐藏子树。`offsetParent` 对 `display: none` 子树内的元素返回 `null`，无论嵌套多深。比 `getComputedStyle().display` 更可靠——后者只检查元素自身的 display，不检查祖先。

实际场景：当 file tab 激活时，session div 有 `class="hidden"`（Tailwind = `display: none`），但其内部 `<p>`、`<span>` 等元素的 `getComputedStyle().display` 仍是 `block`/`inline`，不会被过滤。`offsetParent` 则正确返回 `null`。

**高亮实现**：CSS Custom Highlight API（Chromium 105+）

```typescript
const allRanges = matches.map((m) => m.range.cloneRange())
const highlightAll = new Highlight(...allRanges)
CSS.highlights.set('search-match', highlightAll)

const currentRange = matches[currentIndex].range.cloneRange()
const highlightCurrent = new Highlight(currentRange)
CSS.highlights.set('search-current', highlightCurrent)
```

```css
::highlight(search-match) {
  background-color: rgba(250, 204, 21, 0.35);
}
::highlight(search-current) {
  background-color: rgba(249, 115, 22, 0.5);
}
```

不修改原始 DOM 结构，不注入 `<mark>` 元素。

**TypeScript 类型处理**：`CSS.highlights` 的 `HighlightRegistry` 类型定义在 TypeScript DOM lib 中不完整，缺少 `set`/`delete` 方法。需要类型断言：

```typescript
const highlights = CSS.highlights as unknown as {
  delete: (key: string) => void
  set: (key: string, value: unknown) => void
}
```

### 4.3 滚动到当前匹配

不能直接用 `scrollIntoView`，因为 Shiki 高亮的代码 DOM 结构（`display: grid` > `display: flex` > inline `<span>`）下 `scrollIntoView` 行为不可靠。

**实现**：

1. 从匹配的 `Range.startContainer.parentElement` 向上遍历 DOM
2. 找到第一个可滚动祖先（`overflowY: auto/scroll` 且 `scrollHeight > clientHeight`）
3. 检查匹配的 `getBoundingClientRect()` 是否在可视区域内
4. 如果不在，手动计算偏移量并用 `scrollTo` 居中：

```typescript
const offset = rect.top - scRect.top + scrollContainer.scrollTop
  - (scrollContainer.clientHeight - rect.height) / 2
scrollContainer.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
```

5. 零矩形保护：如果 `rect.height === 0`（隐藏子树残留），跳过滚动

### 4.4 当前匹配导航

- `Enter` / `↓`：`currentIndex = (currentIndex + 1) % matches.length`
- `Shift+Enter` / `↑`：`currentIndex = (currentIndex - 1 + matches.length) % matches.length`
- 切换时自动滚动到当前匹配（见 §4.3）
- 更新高亮样式（普通 → 当前）

## 5. 状态管理

### 5.1 Per-Tab 状态隔离

搜索栏的 `visible` 和 `query` 状态是 **per-tab** 的——切换 tab 时，每个 tab 保持各自的搜索状态。

实现方式：组件内用 `useRef<Map<tabId, boolean>>` 和 `useRef<Map<tabId, string>>` 保存每个 tab 的可见性和查询词。切换 tab 时从 Map 恢复状态。

```typescript
const visibilityByTab = useRef<Map<string, boolean>>(new Map())
const queryByTab = useRef<Map<string, string>>(new Map())
```

**行为示例**：
- Tab A Ctrl+F 开搜索，输入 "foo" → 切到 Tab B → 搜索栏不显示
- 切回 Tab A → 搜索栏自动出现，输入框恢复 "foo"，高亮恢复
- Tab B Ctrl+F 开搜索，输入 "bar" → 切回 Tab A → 看到 Tab A 的 "foo" 搜索

### 5.2 组件状态

```typescript
// React state（当前 tab 的）
visible: boolean        // 搜索栏是否显示
query: string           // 当前搜索词
caseSensitive: boolean  // 大小写敏感
matches: DomMatch[]     // 匹配列表
currentIndex: number    // 当前选中匹配

// Ref（per-tab 持久化）
visibilityByTab: Map<string, boolean>
queryByTab: Map<string, string>
```

### 5.3 生命周期

- 打开：`Ctrl+F` → `visible = true`，保存到 `visibilityByTab`，autofocus 输入框
- 输入：query 变化 → 保存到 `queryByTab` → debounce 150ms → 重新搜索 → `currentIndex = 0` → 滚动到第一个
- 导航：`Enter` / `Shift+Enter` → 切换 `currentIndex` → 滚动
- 关闭：`Esc` / `×` → `visible = false` → 保存到 `visibilityByTab` → 清除高亮 → 清空 query
- 切 tab：从 Map 恢复 `visible` 和 `query`，重新搜索

### 5.4 搜索防抖

输入时 debounce 150ms 后执行搜索，避免每次按键都遍历 DOM。

## 6. 组件结构

### 6.1 文件

| 文件 | 职责 |
|------|------|
| `src/renderer/src/components/InTabSearch.tsx` | 搜索栏 UI（输入框 + 导航 + 计数 + per-tab 状态管理） |
| `src/renderer/src/hooks/useDomSearch.ts` | DOM 文本搜索逻辑（TreeWalker + 高亮 + 滚动） |

### 6.2 组件接口

```typescript
interface InTabSearchProps {
  containerRef: React.RefObject<HTMLElement | null>
  mode: InTabSearchMode  // 'dom' | 'terminal'
  active: boolean        // 当前 tab 是否支持搜索
  tabId?: string         // 当前 tab ID，用于 per-tab 状态隔离
  onClose: () => void
}
```

`InTabSearch` 组件自己管理 `visible` 状态，通过监听 `Ctrl+F` keydown 事件控制显隐。组件挂载在 tab 内容容器的 `relative` 父级内，用 `absolute` 定位浮在右上角。

### 6.3 App.tsx 集成

```tsx
<div ref={contentAreaRef} className="flex-1 overflow-hidden relative">
  {/* tab content */}
  <div className={activeTab?.type === 'session' ? 'h-full' : 'hidden'}>
    <ChatView ... />
  </div>
  {activeTab?.type === 'file' && <FileViewer ... />}
  {/* ... */}

  {/* in-tab search overlay */}
  <InTabSearch
    containerRef={contentAreaRef}
    mode={searchConfig.mode}
    active={searchConfig.active}
    tabId={activeTab?.id}
    onClose={() => {}}
  />
</div>
```

`searchConfig` 根据当前 tab 类型决定是否启用搜索：

```typescript
const searchConfig = useMemo<{ mode: InTabSearchMode; active: boolean }>(() => {
  if (!activeTab) return { mode: 'dom', active: false }
  switch (activeTab.type) {
    case 'session':
    case 'file':
    case 'skill':
      return { mode: 'dom', active: true }
    default:
      return { mode: 'dom', active: false }
  }
}, [activeTab?.type])
```

### 6.4 修改文件

| 文件 | 改动 |
|------|------|
| `App.tsx` | `contentAreaRef`、`searchConfig` memo、`<InTabSearch>` 渲染 |
| `main.css` | `::highlight(search-match)` 和 `::highlight(search-current)` 样式 |
| `ChatView.tsx` | 无改动 |
| `FileViewer.tsx` | 无改动 |

## 7. useDomSearch Hook

```typescript
interface UseDomSearchOptions {
  containerRef: React.RefObject<HTMLElement | null>
  query: string
  caseSensitive: boolean
  enabled: boolean
}

interface DomMatch {
  range: Range
  text: string
}

interface UseDomSearchReturn {
  matches: DomMatch[]
  currentIndex: number
  setCurrentIndex: (i: number) => void
  next: () => void
  prev: () => void
  clear: () => void
  truncated: boolean
}
```

**核心流程**：

1. `useEffect` 监听 `query` 变化 → debounce 150ms → 执行搜索
2. 搜索：`TreeWalker` 遍历 `containerRef` 内所有 `TEXT_NODE`
3. 隐藏内容过滤：`parent.offsetParent === null` → 跳过（检测任意深度的 `display: none` 祖先）
4. 跳过 `<script>`、`<style>` 标签
5. 对每个文本节点做 `indexOf`，收集所有匹配为 `Range`
6. 用 CSS Custom Highlight API 设置高亮
7. `currentIndex` 变化时，找到可滚动祖先，手动 `scrollTo` 居中
8. 零矩形保护：`rect.height === 0` 时跳过滚动
9. 组件卸载时清除高亮

**常量**：`MAX_MATCHES = 500`，超过后截断，`truncated` 返回 `true`。

## 8. 边界情况

| 场景 | 处理 |
|------|------|
| 空查询 | 清除所有高亮，显示空搜索栏 |
| 无匹配 | 显示 `0/0`，清除高亮 |
| 内容更新（streaming） | 搜索栏打开时，新内容追加后自动重新搜索（query 不变触发 debounce） |
| 切换 tab | per-tab 恢复 visible 和 query 状态 |
| 搜索栏打开时按 Ctrl+F | 切换关闭 |
| 大量匹配（>500） | 截断到 500，显示 `12/500+` |
| 折叠的代码块/tool call | `offsetParent` 为 null，不搜索 |
| 隐藏的 session 内容（file tab 激活时） | `offsetParent` 为 null，不搜索 |
| FileViewer Shiki 高亮代码 | 滚动用手动 `scrollTo`，不用 `scrollIntoView` |
| 零矩形匹配（隐藏子树残留） | 跳过滚动 |

## 9. 与全局搜索的关系

| 特性 | In-Tab Search (`Ctrl+F`) | Global Search (`Ctrl+Shift+F`) |
|------|--------------------------|-------------------------------|
| 范围 | 当前 tab 已渲染的内容 | 全项目文件 + 所有会话 |
| 速度 | 即时（DOM 遍历） | 异步（ripgrep / IPC） |
| 高亮 | 页面内高亮 + 导航 | 结果列表 + 跳转 |
| 适用场景 | 在当前对话里找关键词 | 找哪个文件里有某段代码 |

两者独立，不共享状态。`Ctrl+F` 打开 in-tab search，`Ctrl+Shift+F` 打开 right panel 全局搜索。

## 10. 分阶段实现

### Phase 1: DOM 搜索 + 基础 UI（已完成）

- ✅ `useDomSearch` hook：TreeWalker + CSS Custom Highlight API
- ✅ `InTabSearch` 组件：搜索栏 UI + 导航 + 计数 + 大小写切换
- ✅ App.tsx 集成：session/file/skill tab 支持
- ✅ `Ctrl+F` 快捷键
- ✅ Per-tab 状态隔离（visible + query）
- ✅ 隐藏内容过滤（`offsetParent`）
- ✅ Shiki 代码滚动修复（手动 `scrollTo`）

### Phase 2: Terminal 搜索（暂缓）

- TerminalPane 加载 `@xterm/addon-search`
- InTabSearch 支持 `mode: 'terminal'`
- 匹配计数追踪

### Phase 3: 体验优化

- 搜索栏拖拽移动位置
- streaming 时自动刷新搜索结果
- 搜索历史（最近 5 个搜索词，↑ 键回溯）

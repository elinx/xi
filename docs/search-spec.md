# Search Spec

## 1. Overview

搜索功能允许用户在当前 session 的对话历史中快速查找内容。支持搜索用户消息、助手回复、工具调用等所有文本内容，并定位到对应消息位置。

## 2. Design Principles

1. **Client-side only**：Pi RPC 没有提供 search 命令，所有搜索在本地完成
2. **当前 session 优先**：搜索范围为当前活跃 session 的已加载消息
3. **即时响应**：输入即搜索，无需按 Enter
4. **最小侵入**：搜索 UI 为浮层，不改变现有布局
5. **可定位**：搜索结果可点击跳转到对应消息

## 3. Searchable Content

### 3.1 可搜索字段

| ContentBlock 类型 | 搜索字段 | 说明 |
|---|---|---|
| `text` | `content` | 用户消息、助手回复、thinking 内容 |
| `tool_call` | `toolName` + `args` 的 JSON 字符串 | 工具名称和参数 |
| `tool_result` | 内部 `content` 中的 text block | 工具返回的文本结果 |
| `html` | `title` | HTML 块的标题（文件名） |
| `image` | `alt` | 图片的 alt 文本（有限价值） |
| `action` | `label` + `options[].label` + `options[].description` | 交互操作的文本 |

### 3.2 不可搜索

- Image 的 base64 数据
- HTML 的 `content`（可能非常大，且渲染内容不适合文本搜索）
- 注解的坐标数据

### 3.3 搜索范围选项

| 范围 | 说明 | 默认 |
|---|---|---|
| **当前 session** | 只搜索当前已加载的 `messages[]` | 是 |
| **所有 session** | 搜索当前项目的所有 session（需读取 JSONL 文件） | 否 |

> 注：跨 session 搜索为 Phase 2 功能，Phase 1 只实现当前 session 搜索。

## 4. Search Behavior

### 4.1 搜索算法

- **大小写不敏感**（case-insensitive）
- **子串匹配**（substring match），非整词匹配
- **高亮匹配**：在搜索结果和原文中高亮匹配文本
- **排序**：按消息时间正序（旧 → 新）

### 4.2 交互流程

```
1. 用户按 Cmd/Ctrl + K → 打开搜索浮层
2. 输入关键词 → 实时过滤匹配消息
3. 上下箭头导航搜索结果
4. Enter → 跳转到对应消息并高亮
5. Esc → 关闭搜索浮层，回到之前状态
```

### 4.3 搜索结果格式

每条结果显示：
- 消息角色图标（👤/🤖 → 用文字标签 user/assistant）
- 匹配文本片段（前后各 40 字符，匹配部分高亮）
- 相对时间（如 "2h ago"）

```
┌─────────────────────────────────────┐
│ 🔍  [搜索关键词____________]  Esc   │
│─────────────────────────────────────│
│ user · ...implement the session manager... │
│ assistant · ...I'll create a session... │
│ user · ...画一个sin波形... │
└─────────────────────────────────────┘
```

## 5. UI Design

### 5.1 SearchOverlay 组件

搜索浮层，覆盖在 ChatView 上方：

- **位置**：页面顶部居中，宽 560px，类似 VS Code 的 Cmd+K 搜索栏
- **触发**：`Cmd/Ctrl + K` 全局快捷键
- **关闭**：`Esc` 或点击浮层外部
- **输入框**：自动聚焦，输入即搜索
- **结果列表**：最多显示 50 条，可滚动
- **空状态**：无匹配时显示 "No results"
- **加载状态**：跨 session 搜索时显示 loading（Phase 2）

### 5.2 消息高亮

当搜索命中某条消息并跳转后：
- 被命中的消息短暂高亮（黄色渐隐动画，1.5s）
- ChatView 自动滚动到该消息
- 如果同一条消息有多个匹配，用下划线标记所有匹配位置

### 5.3 SearchOverlay 状态

```typescript
interface SearchState {
  query: string
  results: SearchResult[]
  selectedIndex: number
  isOpen: boolean
}

interface SearchResult {
  messageId: string
  role: 'user' | 'assistant' | 'system'
  blockIndex: number        // 哪个 ContentBlock 匹配
  matchStart: number        // 匹配在文本中的起始位置
  matchEnd: number          // 匹配在文本中的结束位置
  snippet: string           // 前后截断的文本片段
  timestamp: number
}
```

## 6. Implementation

### 6.1 搜索逻辑（纯函数，可测试）

```typescript
function searchMessages(
  messages: ChatMessage[],
  query: string
): SearchResult[]
```

- 遍历所有 `messages`，对每个 `ContentBlock` 提取可搜索文本
- 对提取的文本做 case-insensitive substring match
- 返回 `SearchResult[]`，按 `timestamp` 升序

```typescript
function getSearchableText(block: ContentBlock): string
```

- 根据block类型提取可搜索的文本内容
- `text` → `content`
- `tool_call` → `toolName + ' ' + JSON.stringify(args)`
- `html` → `title ?? ''`
- `image` → `alt ?? ''`
- `action` → `label + options.map(o => o.label + o.description).join(' ')`
- `tool_result` → 递归提取内部 content blocks 的文本

### 6.2 新增文件

| 文件 | 说明 |
|---|---|
| `src/renderer/src/components/SearchOverlay.tsx` | 搜索浮层组件 |
| `src/renderer/src/hooks/useSearch.ts` | 搜索状态管理 hook |
| `src/renderer/src/utils/search.ts` | 搜索纯函数（searchMessages, getSearchableText） |
| `test/search.test.ts` | 搜索逻辑测试 |

### 6.3 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/renderer/src/App.tsx` | 添加 `Cmd/Ctrl+K` 快捷键，渲染 SearchOverlay，接收 jumpToMessage 回调 |
| `src/renderer/src/components/ChatView.tsx` | 添加 `scrollToMessage(messageId)` 方法，消息高亮动画 |

### 6.4 Hook 接口

```typescript
interface UseSearchReturn {
  isOpen: boolean
  query: string
  results: SearchResult[]
  selectedIndex: number
  openSearch: () => void
  closeSearch: () => void
  setQuery: (query: string) => void
  selectNext: () => void
  selectPrev: () => void
  confirmSelection: () => void    // 返回选中的 SearchResult
  selectedResult: SearchResult | null
}

function useSearch(messages: ChatMessage[]): UseSearchReturn
```

### 6.5 ChatView 扩展

ChatView 需要暴露滚动到指定消息的能力：

```typescript
// ChatView ref 方法
interface ChatViewHandle {
  scrollToMessage: (messageId: string) => void
}

// 使用 forwardRef + useImperativeHandle
```

消息高亮：匹配消息添加 CSS class `search-highlight`，配合动画：

```css
@keyframes search-highlight-fade {
  0% { background-color: rgba(234, 179, 8, 0.3); }
  100% { background-color: transparent; }
}
.search-highlight {
  animation: search-highlight-fade 1.5s ease-out;
}
```

### 6.6 IPC 与 Preload

Phase 1（当前 session 搜索）：不需要新增 IPC 通道。搜索在 renderer 进程内完成，数据来源为已加载的 `messages` 状态。

Phase 2（跨 session 搜索）：需要新增 IPC 通道：

| 通道 | 说明 |
|---|---|
| `session:searchSessions` | 在指定项目的所有 session JSONL 文件中搜索文本 |

## 7. Keyboard Shortcuts

| 快捷键 | 作用 |
|---|---|
| `Cmd/Ctrl + K` | 打开搜索 |
| `Esc` | 关闭搜索 |
| `↑` / `↓` | 导航搜索结果 |
| `Enter` | 跳转到选中结果 |
| `Shift + Enter` | 跳转到上一个匹配（同消息内多匹配时） |

## 8. Edge Cases

| 场景 | 处理 |
|---|---|
| 空搜索词 | 不显示结果，显示 "Type to search..." |
| 消息正在流式传输 | 搜索结果实时更新（每次 streaming 更新后重新搜索） |
| HTML block 内容搜索 | 只搜索 `title`，不搜索 `content`（内容太大） |
| 搜索词在多条 block 中匹配 | 每条 block 生成独立的 SearchResult |
| 超长消息 | snippet 截断前后各 40 字符 |
| 无匹配 | 显示 "No results found" |
| 搜索结果为当前可见消息 | 仍滚动到消息并高亮 |

## 9. Test Coverage

| 测试文件 | 覆盖内容 |
|---|---|
| `test/search.test.ts` | `getSearchableText` 各 block 类型、`searchMessages` 基本搜索、大小写不敏感、多 block 匹配、snippet 生成、空结果、特殊字符 |
| `test/search-overlay.test.ts` | 组件渲染、键盘导航、选择确认、关闭行为 |

## 10. Phase 2 (Future)

以下功能不在 Phase 1 范围内，记录以备后续：

1. **跨 session 搜索**：搜索当前项目所有 session 的 JSONL 文件
2. **正则搜索**：支持正则表达式匹配
3. **搜索过滤器**：按 role（user/assistant）、按 tool name 过滤
4. **搜索历史**：记住最近搜索关键词
5. **替换功能**：搜索并替换（在对话编辑场景下）
6. **全文索引**：对大 session 建立 inverted index 加速搜索
7. **代码搜索**：搜索工具调用中的代码片段（read/write/edit 的 file content）

# Command Palette Spec

## 1. Overview

实现 Command Palette，通过 `Cmd+P` / `Cmd+Shift+P` 快速访问文件、命令、会话等。

参考：VS Code `Ctrl+P`/`Ctrl+Shift+P`，Raycast，使用 `cmdk` 库实现。

## 2. 快捷键分配

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| `Cmd/Ctrl+P` | Quick Open | 文件搜索 + 会话切换 + 最近项目 |
| `Cmd/Ctrl+Shift+P` | Command Palette | 命令/动作搜索 |

两个快捷键打开同一个 UI，通过前缀区分模式：
- 无前缀 → 文件/会话搜索（Quick Open）
- `>` 前缀 → 命令搜索（Command Palette）

这与 VS Code 行为一致：`Cmd+P` 打开后输入 `>` 自动切换为命令模式。

## 3. UI 设计

### 3.1 布局

```
┌─────────────────────────────────────────────────────┐
│ 🔍 Type a command or search...              [Esc ✕] │  ← 搜索框
├─────────────────────────────────────────────────────┤
│ Recent Files                                        │  ← Group heading
│   📄 src/App.tsx                                    │
│   📄 src/components/InputBar.tsx                     │
│ Sessions                                            │
│   💬 main                                            │
│   💬 fix-auth-bug                                    │
│ Project Files                                       │
│   📄 package.json                                    │
│   📄 README.md                                       │
│   📁 src/                                            │
│   ...                                               │
└─────────────────────────────────────────────────────┘
```

居中弹出，`fixed top-[15%] left-1/2 -translate-x-1/2 w-[560px]`。
背景半透明遮罩 `bg-black/40 backdrop-blur-sm`，点击遮罩或 `Esc` 关闭。

### 3.2 尺寸

- 宽度：`560px`
- 最大高度：`min(480px, 60vh)`
- 搜索框高度：`44px`，`px-4 text-sm`
- 列表项高度：`36px`，`px-4 text-sm`
- Group heading：`24px`，`px-4 text-xs font-semibold uppercase text-gray-400`
- 圆角：`rounded-xl`
- 阴影：`shadow-2xl`

### 3.3 列表项样式

```
┌─────────────────────────────────────────┐
│ 📄  src/components/InputBar.tsx  ⌘P    │  ← icon + label + 右侧快捷键
│ 📄  src/App.tsx                          │
│ 💬  main session                    2m  │  ← icon + name + 右侧时间
│ 📁  src/components/                      │  ← folder 有 > 箭头
└─────────────────────────────────────────┘
```

选中项：`bg-blue-50 text-blue-900`，未选中：`text-gray-700`

## 4. 数据源

### 4.1 Quick Open 模式（`Cmd+P`，无前缀）

三个 Group，按优先级排序：

| Group | 数据源 | API | 排序 |
|-------|--------|-----|------|
| Recent Files | 最近打开的文件 tab | `useTabStore.tabs.filter(t => t.type === 'file')` | 最近使用优先 |
| Sessions | 所有会话 | `window.api.listSessions()` → `allSessions` | 当前会话最前 |
| Project Files | 项目文件树 | `window.api.readDirectory()` 递归 | 路径字母序 |

**Recent Files**：从已打开的 file tab 中取，最多显示 5 个。
**Sessions**：显示会话名称 + 相对时间，选中则 switchSession。
**Project Files**：懒加载，首次打开 palette 时触发一次，之后缓存。最多显示 50 个结果。

### 4.2 Command Palette 模式（`>` 前缀）

命令分组：

| Group | 命令 | 快捷键提示 |
|-------|------|-----------|
| File | New File, Save File, Close Tab | ⌘N, ⌘S, ⌘W |
| Session | New Session, Switch Session, Fork Session |  |
| View | Toggle Left Panel, Toggle Right Panel, Toggle Terminal, Open Settings | ⌘\\, ⌘⇧\\, ⌘\` |
| Git | Stage All, Commit, Discard All |  |
| Model | Switch Model |  |
| Navigation | Go to File, Go to Command | ⌘P, ⌘⇧P |

每个命令定义：

```typescript
interface CommandItem {
  id: string
  label: string
  group: string
  keywords: string[]
  shortcut?: string
  action: () => void
}
```

### 4.3 文件索引（懒加载 + 缓存）

```typescript
// 新 hook: useFileIndex.ts
interface FileIndex {
  files: Array<{ name: string; path: string; isDirectory: boolean }>
  loading: boolean
  refresh: () => void
}
```

- 首次打开 palette 时调用 `buildFileIndex()`
- 递归调用 `readDirectory()`，过滤 `.git`/`node_modules`/`.pi` 等
- 缓存结果，`onFsChanged` 事件触发时标记 stale，下次打开时重建
- 建立索引时显示 loading spinner

## 5. 交互行为

### 5.1 搜索过滤

使用 `cmdk` 内置的 `command-score` fuzzy matcher：
- `app` 匹配 `App.tsx`
- `sct` 匹配 `src/components/TabBar.tsx`
- `inp` 匹配 `InputBar.tsx`

cmdk 的 fuzzy scorer 已经对 `/` 路径分隔符做了 word-boundary 优化，适合文件路径搜索。

### 5.2 键盘导航

| 键 | 动作 |
|----|------|
| `↑` / `↓` | 上下移动选中项 |
| `Alt+↑` / `Alt+↓` | 跳转到上一个/下一个 Group |
| `Enter` | 执行选中项 + 关闭 palette |
| `Cmd+Enter` | 执行选中项 + 保持 palette 打开（仅命令模式） |
| `Tab` | 选中文件夹时进入文件夹（仅文件模式） |
| `Escape` | 关闭 palette |
| `Backspace`（搜索框为空时） | 关闭 palette |

### 5.3 前缀切换

- 在搜索框输入 `>` → 自动切换为 Command Palette 模式，清除 `>` 前缀，显示命令列表
- 在命令模式按 `Backspace` 清空搜索框 → 回到 Quick Open 模式
- `Cmd+Shift+P` 打开时自动插入 `>` 前缀

### 5.4 选中文件的行为

| 文件类型 | 行为 |
|---------|------|
| 文件 | `addTab({ type: 'file', ... })` → 打开文件 tab |
| 文件夹 | `Tab` 展开，显示文件夹内容；`Enter` 同 Tab |
| 会话 | `switchSession(path)` → 切换到该会话 |
| 命令 | 执行 `action()` |

## 6. 技术方案

### 6.1 依赖

```
npm install cmdk
```

`cmdk` v1.1+，支持 React 19，~5KB gzip，内置 fuzzy scorer。

### 6.2 新文件

| 文件 | 职责 |
|------|------|
| `src/renderer/src/components/CommandPalette.tsx` | 主组件，基于 `cmdk` 的 `Command.Dialog` |
| `src/renderer/src/hooks/useFileIndex.ts` | 文件索引：递归遍历 + 缓存 + stale 标记 |
| `src/renderer/src/hooks/useCommandRegistry.ts` | 命令注册表：静态命令定义 + 动态命令（model list 等） |

### 6.3 修改文件

| 文件 | 改动 |
|------|------|
| `App.tsx` | 添加 `Cmd+P` / `Cmd+Shift+P` 全局快捷键，渲染 `<CommandPalette>` |
| `useTabStore.ts` | 导出 tab 列表供 Recent Files 使用 |

### 6.4 命令注册表设计

```typescript
// useCommandRegistry.ts
export function useCommandRegistry(): CommandItem[] {
  const { addTab } = useTabStore()
  const { toggleLeftPanel, toggleRightPanel } = useLayoutStore()
  // ...

  return useMemo(() => [
    { id: 'file.save', label: 'Save File', group: 'File', keywords: ['save', 'write'], shortcut: '⌘S', action: handleSave },
    { id: 'file.close', label: 'Close Tab', group: 'File', keywords: ['close', 'tab'], shortcut: '⌘W', action: () => closeTab(activeTabId) },
    { id: 'session.new', label: 'New Session', group: 'Session', keywords: ['new', 'create'], action: handleNewSession },
    { id: 'view.toggleLeft', label: 'Toggle Left Panel', group: 'View', keywords: ['sidebar', 'panel'], shortcut: '⌘\\', action: toggleLeftPanel },
    // ...
  ], [deps])
}
```

### 6.5 文件索引构建

```typescript
// useFileIndex.ts
export function useFileIndex(): FileIndex {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [stale, setStale] = useState(true)

  useEffect(() => {
    return window.api.onFsChanged(() => setStale(true))
  }, [])

  const buildIndex = useCallback(async () => {
    if (!stale && files.length > 0) return
    setLoading(true)
    const root = await window.api.getProjectPath()
    const entries = await walkDirectory(root)  // 递归 readDirectory
    setFiles(entries)
    setStale(false)
    setLoading(false)
  }, [stale, files])

  return { files, loading, refresh: buildIndex }
}
```

## 7. 分阶段实现

### Phase 1: 最小可用

- `cmdk` 安装 + `CommandPalette.tsx` 基础组件
- `Cmd+P` 快捷键注册
- 文件搜索（基于 `readDirectory` 递归索引）
- 基础命令列表（Toggle Panel, Open Terminal, Open Settings）

### Phase 2: 命令丰富

- `Cmd+Shift+P` + `>` 前缀切换
- 完整命令注册表（File, Session, View, Git, Model）
- 命令快捷键提示显示
- Recent Files group（从已打开 tab 取）

### Phase 3: 体验打磨

- 文件索引缓存 + stale 重建
- 会话搜索 group
- 键盘快捷键注册（命令中的 shortcut 真正生效）
- `Cmd+Enter` 保持 palette 打开
- `Tab` 进入文件夹

## 8. 与现有代码的交互

### 8.1 快捷键冲突

当前全局快捷键：

| 快捷键 | 现有功能 | 冲突？ |
|--------|---------|--------|
| `Cmd+\` | Toggle Left Panel | ❌ 不冲突 |
| `Cmd+Shift+\` | Toggle Right Panel | ❌ 不冲突 |
| `Cmd+\`` | Open Terminal | ❌ 不冲突 |
| `Escape` | Abort streaming | ⚠️ 需优先级处理：palette 打开时 Escape → 关闭 palette，不触发 abort |

解决方案：Command Palette 内部 `onKeyDown` 中 `e.stopPropagation()`，阻止事件冒泡到 App.tsx 的全局 handler。

### 8.2 Z-index 层级

| 层级 | Z-index | 内容 |
|------|---------|------|
| 底层 | 0 | 主界面 |
| Panel overlay | 50 | ModelSelector, context menus |
| Portal overlay | 9998-9999 | FileTree/Session context menus |
| **Command Palette** | **10000** | 高于一切 |

### 8.3 点击遮罩关闭

与 WelcomeDialog 模式一致：`<div className="fixed inset-0 ...">` 作为 backdrop，点击触发 `onOpenChange(false)`。

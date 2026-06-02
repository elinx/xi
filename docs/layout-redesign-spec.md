# Layout Redesign Spec: Three-Panel + Tab Architecture

## 1. Overview

将 Xi 的布局从当前的 "左 sidebar + 单 ChatView" 两栏结构，重构为 "Activity Bar + Left Panel + Tab Area + Right Panel" 四区架构。目标是支持多 Tab、文件浏览、Git 状态查看、Terminal 等功能，同时保持 Xi 的简洁调性。

## 2. Layout Architecture

### 2.1 整体结构

```
┌────┬──────────┬──────────────────────────────┬───────────────┐
│    │          │ [Tab: Chat] [Tab: main.ts] [+]│  📁 File Tree │
│ 📊 │ Sessions │──────────────────────────────│  🔀 Git Status│
│ 🔧 │ Skills   │                              │               │
│ 🔌 │ MCP      │      (Tab Content)           │               │
│ ⚙️ │ Settings │                              │               │
│    │          │                              │               │
│Act-│  Left    │       Tab Area               │  Right Panel  │
│Bar │  Panel   │                              │               │
├────┴──────────┴──────────────────────────────┴───────────────┤
│ [Input Bar — 仅 Session Tab 时显示]                           │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 四个区域

| 区域 | 宽度 | 说明 |
|------|------|------|
| **Activity Bar** | `48px` 固定 | 最左侧 icon 列，点击切换 Left Panel 内容 |
| **Left Panel** | `180–480px`，默认 `260px`，可拖拽调整，可折叠 | 显示当前 Activity Bar 选中项的内容 |
| **Tab Area** | `flex-1` 自适应 | 中间主内容区，支持多 Tab |
| **Right Panel** | `180–400px`，默认 `220px`，可拖拽调整，可折叠 | 文件树 / Git 状态等导航内容 |

### 2.3 与当前布局的对比

| | 当前 | 重构后 |
|---|---|---|
| 左侧 | SessionSidebar（260px，可折叠） | Activity Bar（48px）+ Left Panel（260px，可折叠） |
| 中间 | ChatView（单页面，无 Tab） | Tab Area（多 Tab，含 ChatView） |
| 右侧 | 无 | Right Panel（可折叠） |
| 底部 | InputBar（始终显示） | InputBar（仅 Session Tab 时显示） |

---

## 3. Activity Bar

### 3.1 位置与尺寸

- 固定在窗口最左侧，宽度 `48px`
- 纵向排列，顶部是功能 icon，底部是设置 icon
- 不随 Left Panel 折叠而隐藏 — Activity Bar 始终可见

### 3.2 Icon 列表

| Icon | 标识 | 切换到的 Left Panel 内容 | 位置 |
|------|------|------------------------|------|
| 💬 对话气泡 | `sessions` | Session 树 | 顶部 |
| 🔧 扳手 | `skills` | Skills 列表 | 顶部 |
| 🔌 插头 | `mcp` | MCP Servers 列表 | 顶部 |
| ⚙️ 齿轮 | `settings` | Provider 设置 | 底部（push down） |

### 3.3 交互规则

- **点击 icon** → 切换 Left Panel 到对应内容；若 Left Panel 已折叠则自动展开
- **再次点击当前活跃 icon** → 折叠 Left Panel
- **活跃 icon** → 背景色 `bg-gray-200`，icon 颜色 `text-gray-900`
- **非活跃 icon** → 背景 transparent，icon 颜色 `text-gray-500`，hover `text-gray-700 bg-gray-100`
- **Tooltip** → hover 0.5s 后显示文字提示（如 "Sessions"、"Skills"）

### 3.4 折叠态

Left Panel 折叠时，Activity Bar 仍然可见。此时：
- 活跃 icon 保持高亮
- 点击任意 icon → 展开 Left Panel 并显示对应内容

---

## 4. Left Panel

### 4.1 通用结构

```
┌──────────────────────────┐
│  Panel Title    [操作按钮] │  ← 各 Panel 自定义 header
├──────────────────────────┤
│                          │
│  (Panel 内容)             │  ← 各 Panel 自定义内容
│                          │
└──────────────────────────┘
```

- 顶部有一个 Panel header，显示标题和操作按钮
- Panel header 高度固定 `36px`
- 内容区域 `overflow-y-auto`

### 4.2 Sessions Panel

与当前 `SessionSidebar` 功能一致，不再重复描述。详见 [sidebar-spec.md](./sidebar-spec.md)。

变更点：
- 从独立组件变为 Left Panel 的一种内容
- 折叠逻辑由外层 Activity Bar 控制，不再自带折叠按钮
- Header 中的项目名和展开/折叠按钮移除（由 Activity Bar 承担）
- 保留：+ 新建 Session 按钮、session 树、右键菜单

```
┌──────────────────────────┐
│  Sessions          [+]   │
├──────────────────────────┤
│  ● main          2h ago  │
│    产品建议      2h ago  │
│    绘图          2h ago  │
│  ● ideas           15m   │
└──────────────────────────┘
```

### 4.3 Skills Panel

展示当前项目可用的 Skills 列表。

```
┌──────────────────────────┐
│  Skills                  │
├──────────────────────────┤
│  🔧 git-master           │
│     Git operations       │
│  🎨 frontend-ui-ux       │
│     UI/UX design         │
│  🧪 review-work          │
│     Post-impl review     │
│  🤖 ai-slop-remover      │
│     Remove AI code smell │
└──────────────────────────┘
```

| 属性 | 规则 |
|------|------|
| 数据来源 | Pi SDK 的 skills 配置（`@earendil-works/pi-coding-agent`） |
| 显示 | icon + skill name + 一行描述 |
| 交互 | 点击 → 无直接操作（skills 是 agent 端概念，不直接由用户触发） |
| 折叠/展开 | 暂不支持分组折叠，平铺列表 |
| 状态 | 标记哪些 skill 当前已加载（`loaded` vs `available`） |

**Phase 1 最小实现**：只显示 skill 名称和描述列表，不做交互。后续可支持拖拽到 InputBar 触发、搜索等。

### 4.4 MCP Panel

展示当前已连接的 MCP Servers 及其 tools/resources。

```
┌──────────────────────────┐
│  MCP Servers             │
├──────────────────────────┤
│  ▾ playwright            │  ← 展开/折叠
│    📄 browser_navigate    │
│    📄 browser_click       │
│    📄 browser_screenshot  │
│  ▾ filesystem            │
│    📄 read_file           │
│    📄 write_file          │
│  ● context7 (connected)  │
│  ○ github (disconnected) │
└──────────────────────────┘
```

| 属性 | 规则 |
|------|------|
| 数据来源 | Pi SDK 的 MCP 配置 |
| Server 节点 | 显示 server name + 连接状态指示（🟢 connected / 🔴 disconnected） |
| 展开后 | 列出该 server 提供的 tools，每项显示 tool name |
| 交互 | 点击 tool → 展示 tool 的参数 schema（只读） |
| 折叠/展开 | 点击 server name 展开/折叠其 tools 列表，默认折叠 |

**Phase 1 最小实现**：只显示 server 列表 + 连接状态 + tools 名称，不做 tool 调用。

### 4.5 Settings Panel

将当前的 `ProviderSetup` 组件内嵌到 Left Panel，替代弹出 Modal。

```
┌──────────────────────────┐
│  Settings                │
├──────────────────────────┤
│  [Open config dir]       │
│                          │
│  Provider: OpenAI        │
│  ●●●●●●●●● key input    │
│  [Save]                  │
│                          │
│  Provider: Anthropic     │
│  ●●●●●●●●● key input    │
│  [Save]                  │
└──────────────────────────┘
```

- 复用现有 `ProviderSetup` 组件，去掉 Modal 外壳
- 不再需要从 header 的齿轮按钮打开 Modal — 点击 Activity Bar 的 ⚙️ 直接显示
- `WelcomeDialog` 仍然保留为 Modal（首次使用引导）

### 4.6 宽度与折叠

| 属性 | 规则 |
|------|------|
| 默认宽度 | `260px` |
| 最小宽度 | `180px` |
| 最大宽度 | `480px` |
| 折叠宽度 | `0px`（完全隐藏，只剩 Activity Bar） |
| 拖拽调整 | 右侧边缘拖拽，逻辑复用当前 sidebar 的 resize 机制 |
| 持久化 | localStorage key: `xi-left-panel-width` |
| 折叠状态持久化 | localStorage key: `xi-left-panel-collapsed` |

---

## 5. Tab Area

### 5.1 Tab 类型

Tab Area 支持以下 Tab 类型：

| Tab 类型 | 标识 | 内容 | 关闭 | 图标 |
|---------|------|------|------|------|
| **Session** | `session` | ChatView + InputBar | ❌ 不可关闭 | 💬 |
| **File** | `file` | 文件内容（语法高亮） | ✅ 可关闭 | 📄 |
| **Diff** | `diff` | Git diff 视图 | ✅ 可关闭 | 🔀 |
| **Terminal** | `terminal` | 终端模拟器 | ✅ 可关闭 | ⬛ |

### 5.2 Tab Bar

```
┌─────────────────────────────────────────────────────────────────┐
│ [💬 main.ts *] [📄 App.tsx] [📄 sidebar.ts] [🔀 diff] [+]      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  (Active Tab Content)                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Tab Bar 规则

| 属性 | 规则 |
|------|------|
| 位置 | Tab Area 顶部 |
| 高度 | `36px` |
| 背景 | `bg-gray-100` |
| 滚动 | Tab 过多时水平滚动（scrollbar 隐藏，支持鼠标滚轮） |
| 活跃 Tab | `bg-white`，底部 `border-b-2 border-blue-500` |
| 非活跃 Tab | `bg-gray-50`，hover `bg-gray-100` |
| 关闭按钮 | hover 时在 Tab 右侧显示 `×`，点击关闭 |
| 拖拽排序 | Phase 2 — 暂不支持 |
| 右键菜单 | Phase 2 — 暂支持 "Close" / "Close Others" / "Close All" |

#### Session Tab

- **始终存在**，不可关闭，不可移除
- 初始状态只有一个 Session Tab，显示当前活跃 session 的对话
- Tab 标题 = session 的 `getDisplayName()`
- Session Tab 始终是第一个 Tab
- 切换 session 时，Session Tab 的标题和内容更新（**不开新 Tab**）

> **设计决策：为什么不每个 Session 一个 Tab？**
>
> Xi 的 session 切换通过左侧 Session 树完成，已有专门的导航方式。Session Tab 代表 "当前活跃对话"，是动态更新的，不是静态标签页。如果每个 session 都开 Tab，Tab 数量会爆炸且与左侧 Session 树功能重复。

#### File Tab

- 点击右侧栏文件树中的文件 → 打开 File Tab
- 同一文件只开一个 Tab（重复点击 → 切换到已有 Tab）
- Tab 标题 = 文件名（如 `App.tsx`），tooltip 显示完整路径
- 文件修改后 Tab 标题加 `*` 后缀（依赖文件系统 watcher）
- 关闭 Tab → 直接关闭，不保存（文件由外部编辑器或 git 管理）

#### Diff Tab

- 点击右侧栏 Git 状态中的 changed file → 打开 Diff Tab
- 显示 `git diff` 的输出，语法高亮
- Tab 标题 = `diff: filename`
- 关闭 Tab → 直接关闭

#### Terminal Tab

- 点击 Tab Bar 右侧的 `+` 下拉菜单 → 选择 "Terminal" → 打开 Terminal Tab
- 或快捷键 `` Ctrl+` `` 打开 Terminal Tab
- 使用 `xterm.js` 渲染，通过 node-pty 在主进程创建 PTY
- Tab 标题 = `Terminal`
- 支持多个 Terminal Tab（每个独立 PTY 实例）

#### `+` 按钮

Tab Bar 右侧的 `+` 按钮，点击后显示下拉菜单：

```
┌──────────────┐
│ Terminal     │
│──────────────│
│ (更多类型后续) │
└──────────────┘
```

Phase 1 只提供 Terminal 选项。

### 5.3 Tab 内容区域

- 切换 Tab → 内容区域切换到对应组件
- **Session Tab** → ChatView + InputBar（与当前完全一致）
- **File Tab** → 代码查看器（只读，语法高亮，行号）
- **Diff Tab** → diff 查看器（红绿配色，统一/分割视图）
- **Terminal Tab** → xterm.js 终端
- 非 Session Tab 时，InputBar 隐藏

### 5.4 Tab 与 Left Panel 的联动

| Tab 类型 | 联动行为 |
|---------|---------|
| Session | Activity Bar 自动切换到 `sessions`，高亮当前 session |
| File | 无特殊联动 |
| Diff | Right Panel 自动切换到 `git`（如已展开） |
| Terminal | 无特殊联动 |

### 5.5 Tab 状态管理

```typescript
interface TabInfo {
  id: string              // 唯一标识
  type: 'session' | 'file' | 'diff' | 'terminal'
  title: string           // Tab 标题
  icon?: string           // Tab icon
  closable: boolean       // 是否可关闭
  meta: Record<string, unknown>  // 类型特定数据
}

interface TabState {
  tabs: TabInfo[]
  activeTabId: string
}
```

- Session Tab 的 `meta` = `{ sessionPath: string }`
- File Tab 的 `meta` = `{ filePath: string, modified: boolean }`
- Diff Tab 的 `meta` = `{ filePath: string, ref: string }`  // git ref
- Terminal Tab 的 `meta` = `{ ptyId: string, cwd: string }`

---

## 6. Right Panel

### 6.1 通用结构

与 Left Panel 对称，但切换方式不同：通过 Panel 内的 icon 按钮行切换内容。

```
┌───────────────────────┐
│  [📁] [🔀]            │  ← 切换按钮行（icon，非 Activity Bar）
├───────────────────────┤
│                       │
│  (Panel 内容)          │
│                       │
└───────────────────────┘
```

### 6.2 切换按钮

| Icon | 标识 | 内容 | 默认 |
|------|------|------|------|
| 📁 文件夹 | `files` | 文件目录树 | ✅ 默认 |
| 🔀 分支 | `git` | Git 状态 / Source Control | |

按钮行高度 `32px`，水平排列在 Panel header 区域。

- **活跃按钮** → `bg-gray-200 text-gray-900`
- **非活跃按钮** → `text-gray-500 hover:text-gray-700`
- 右侧有折叠按钮 `≫`

### 6.3 Files Panel

```
┌───────────────────────┐
│  [📁] [🔀]        [≫] │
├───────────────────────┤
│  ▾ src/               │
│    ▾ renderer/        │
│      ▾ src/           │
│        App.tsx         │
│        main.tsx        │
│    ▾ main/            │
│      index.ts          │
│  ▾ docs/              │
│    sidebar-spec.md     │
│  package.json          │
│  tsconfig.json         │
└───────────────────────┘
```

| 属性 | 规则 |
|------|------|
| 数据来源 | 主进程通过 `fs` 读取项目目录结构，IPC 传输 |
| 更新时机 | 文件变更时通过 `chokidar` watcher 推送增量更新 |
| 折叠/展开 | 点击文件夹 → 展开/折叠，默认展开第一层 |
| 排序 | 文件夹优先，然后字母序；`node_modules` / `.git` / `out` / `dist` 默认隐藏 |
| 交互 | 单击文件 → 在 Tab Area 打开 File Tab |
| 右键 | Phase 2 — "Copy Path" / "Copy Relative Path" / "Reveal in Finder" |

**过滤与隐藏规则**：
- 始终隐藏：`node_modules`, `.git`, `out`, `dist`, `.pi`
- 遵循 `.gitignore`（Phase 2）

### 6.4 Git Panel

```
┌───────────────────────┐
│  [📁] [🔀]        [≫] │
├───────────────────────┤
│  Staged Changes (2)   │
│    M  src/App.tsx      │
│    A  src/components/  │
│       TabBar.tsx       │
│  Changes (3)           │
│    M  package.json     │
│    M  tsconfig.json    │
│    ?? docs/new-spec.md │
│                       │
│  [Commit]             │  ← Phase 2
└───────────────────────┘
```

| 属性 | 规则 |
|------|------|
| 数据来源 | 主进程通过 `simple-git` 库读取 `git status` + `git diff --name-status` |
| 更新时机 | 文件变更时 watcher 触发 `git status` 刷新 |
| 分组 | Staged Changes / Changes / Untracked |
| 状态标识 | `M` modified, `A` added, `D` deleted, `??` untracked |
| 交互 | 点击文件 → 在 Tab Area 打开 Diff Tab |
| Commit | Phase 2 — 底部 commit 输入框 + 按钮 |

**Phase 1 最小实现**：只显示 `git status` 列表和文件状态标识，点击打开 Diff Tab。不做 commit/stage/unstage 操作。

### 6.5 宽度与折叠

| 属性 | 规则 |
|------|------|
| 默认宽度 | `220px` |
| 最小宽度 | `180px` |
| 最大宽度 | `400px` |
| 折叠宽度 | `0px`（完全隐藏） |
| 拖拽调整 | 左侧边缘拖拽 |
| 持久化 | localStorage key: `xi-right-panel-width` |
| 折叠状态持久化 | localStorage key: `xi-right-panel-collapsed` |
| 默认显示 | `true`（首次启动显示右侧栏） |

---

## 7. Header Bar 重构

### 7.1 当前 Header 的问题

当前 Header 是一整行，按 sidebar 宽度分割为左右两个 zone。加入 Activity Bar 和 Right Panel 后，需要调整为四段式。

### 7.2 新 Header 结构

```
┌────┬──────────────────────────────┬───────────────┐
│    │ [●] session-name  [⚙️][👁][💰]│               │
│Act-│         Main Header          │  Right Header  │
│Bar │                              │               │
└────┴──────────────────────────────┴───────────────┘
```

| 区域 | 内容 | 宽度 |
|------|------|------|
| Activity Bar 上方 | 无内容（与 Activity Bar 对齐） | `48px` |
| Main Header | Session name / 状态指示 / view mode / token ring / provider 设置 | `flex-1` |
| Right Header | Right Panel 切换按钮（当 Right Panel 折叠时显示） | `auto` |

**macOS 交通灯按钮**：仍然在 Main Header 左上角，padding-top 避让。

**Right Panel 折叠时的切换按钮**：当 Right Panel 折叠时，在 Right Header 区域显示一个 📁 icon，点击展开 Right Panel 到 Files 视图。

---

## 8. InputBar 变更

### 8.1 显示条件

| 条件 | 显示 |
|------|------|
| Session Tab 活跃 | ✅ 显示 |
| 其他 Tab 活跃 | ❌ 隐藏 |

### 8.2 功能不变

InputBar 的所有功能（textarea、图片粘贴、model selector、send/stop）保持不变。

---

## 9. 状态管理

### 9.1 当前问题

`App.tsx` 已 650 行，session 状态管理复杂（`piConnectedPath` vs `displayedSessionPath`、lazy switch 等）。新增 Tab 和 Right Panel 状态后，继续在 App 中管理会导致不可维护。

### 9.2 新增状态

```typescript
// Activity Bar
leftPanelView: 'sessions' | 'skills' | 'mcp' | 'settings'
leftPanelCollapsed: boolean
leftPanelWidth: number

// Tab Area
tabs: TabInfo[]
activeTabId: string

// Right Panel
rightPanelView: 'files' | 'git'
rightPanelCollapsed: boolean
rightPanelWidth: number
```

### 9.3 建议方案

引入 zustand 管理布局状态，App.tsx 只做组合渲染。improvement-roadmap.md #5 也提到了这个需求。

**Phase 1 最小方案**：

- 新建 `useLayoutStore` (zustand) 管理所有布局状态
- `useSessionStore` (zustand) 管理现有 session 状态（从 App.tsx 中抽出）
- App.tsx 变为纯布局组合，不持有业务状态

**状态持久化**：zustand 的 `persist` middleware，直接持久化到 localStorage，替代当前手动的 `localStorage.setItem` 调用。

---

## 10. 状态序列化与恢复

App 重启时，UI 状态必须从 localStorage 正确恢复。

| 状态项 | localStorage key | 默认值 |
|-------|-----------------|-------|
| 左侧 Panel 视图 | `xi-left-panel-view` | `'sessions'` |
| 左侧 Panel 折叠 | `xi-left-panel-collapsed` | `false` |
| 左侧 Panel 宽度 | `xi-left-panel-width` | `260` |
| 活跃 Tab ID | `xi-active-tab-id` | session tab id |
| 右侧 Panel 视图 | `xi-right-panel-view` | `'files'` |
| 右侧 Panel 折叠 | `xi-right-panel-collapsed` | `false` |
| 右侧 Panel 宽度 | `xi-right-panel-width` | `220` |
| 视图模式 | `xi-view-mode` | `'normal'` |

**恢复规则**：
1. Tab 列表不持久化 — 重启后只有 Session Tab
2. 左/右 Panel 宽度 clamp 到各自 min-max 范围
3. 视图模式：仅接受 `'normal' | 'turn' | 'outline'`，非法值回退 `'normal'`
4. 状态变更时实时写入 localStorage

**废弃的 key**（迁移时删除）：
- `xi-sidebar-collapsed` → `xi-left-panel-collapsed`
- `xi-sidebar-width` → `xi-left-panel-width`

---

## 11. 新增依赖

| 包 | 用途 | 版本 | 备注 |
|---|------|------|------|
| `zustand` | 布局 + session 状态管理 | ^5.0 | 替代 App.tsx 中的 useState |
| `xterm` | Terminal 渲染 | ^5.0 | Terminal Tab |
| `xterm-addon-fit` | Terminal 自适应尺寸 | ^0.8 | 配合 xterm |
| `node-pty` | PTY 进程管理 | ^1.0 | 主进程，Electron native 模块 |
| `@xterm/xterm` | xterm v5 新包名 | ^5.5 | 如用 v5 |
| `chokidar` | 文件系统 watcher | ^4.0 | Right Panel 文件树 + Git 状态刷新 |
| `simple-git` | Git 操作 | ^3.0 | Git Panel 数据源 |
| `highlight.js` 或 `shiki` | 代码语法高亮 | latest | File Tab + Diff Tab |

---

## 12. 新增 IPC Channels

### 12.1 文件树

| Channel | 方向 | Payload | 说明 |
|---------|------|---------|------|
| `fs:readDirectory` | renderer → main | `dirPath: string` | 读取目录内容，返回文件/子目录列表 |
| `fs:readFile` | renderer → main | `filePath: string` | 读取文件内容（文本） |
| `fs:watchDirectory` | main → renderer | `{ type: 'create' \| 'delete' \| 'rename', path: string }` | 文件变更事件推送 |

### 12.2 Git

| Channel | 方向 | Payload | 说明 |
|---------|------|---------|------|
| `git:status` | renderer → main | (none) | 返回 `git status --porcelain` |
| `git:diff` | renderer → main | `filePath: string, staged?: boolean` | 返回 `git diff` 输出 |
| `git:watchStatus` | main → renderer | `StatusResult` | 文件变更时推送 |

### 12.3 Terminal

| Channel | 方向 | Payload | 说明 |
|---------|------|---------|------|
| `terminal:create` | renderer → main | `cwd?: string` | 创建 PTY，返回 `ptyId` |
| `terminal:write` | renderer → main | `ptyId: string, data: string` | 向 PTY 写入 |
| `terminal:resize` | renderer → main | `ptyId: string, cols: number, rows: number` | PTY 尺寸变更 |
| `terminal:kill` | renderer → main | `ptyId: string` | 关闭 PTY |
| `terminal:data` | main → renderer | `ptyId: string, data: string` | PTY 输出推送 |

---

## 13. 组件拆分

### 13.1 新增组件

| 组件 | 路径 | 说明 |
|------|------|------|
| `ActivityBar` | `components/ActivityBar.tsx` | 左侧 icon 导航栏 |
| `LeftPanel` | `components/LeftPanel.tsx` | 左侧面板容器（含 header） |
| `SkillsPanel` | `components/SkillsPanel.tsx` | Skills 列表 |
| `McpPanel` | `components/McpPanel.tsx` | MCP Servers 列表 |
| `SettingsPanel` | `components/SettingsPanel.tsx` | 设置面板（复用 ProviderSetup） |
| `TabBar` | `components/TabBar.tsx` | Tab 栏 |
| `FileViewer` | `components/FileViewer.tsx` | 文件查看器（语法高亮） |
| `DiffViewer` | `components/DiffViewer.tsx` | Diff 查看器 |
| `TerminalPane` | `components/TerminalPane.tsx` | 终端组件（xterm 封装） |
| `RightPanel` | `components/RightPanel.tsx` | 右侧面板容器 |
| `FileTree` | `components/FileTree.tsx` | 文件目录树 |
| `GitPanel` | `components/GitPanel.tsx` | Git 状态面板 |

### 13.2 修改组件

| 组件 | 变更 |
|------|------|
| `App.tsx` | 重构为纯布局组合，移除业务状态到 zustand stores |
| `SessionSidebar.tsx` | 移除自带折叠逻辑，作为 Left Panel 的子内容 |
| `InputBar.tsx` | 添加显示条件判断（仅 Session Tab 时显示） |
| `ProviderSetup.tsx` | 去掉 Modal 外壳，适配嵌入 Left Panel |

### 13.3 新增 Hooks

| Hook | 说明 |
|------|------|
| `useFileTree.ts` | 文件目录数据 + 展开/折叠状态 |
| `useGitStatus.ts` | Git 状态轮询 / watcher |
| `useTerminal.ts` | PTY 管理 + xterm 生命周期 |
| `useTabStore.ts` | Tab 状态管理 (zustand) |
| `useLayoutStore.ts` | 布局状态管理 (zustand) |

---

## 14. 实施阶段

### Phase 1: Layout Skeleton（最小可用）

**目标**：搭建四区布局框架，Tab 系统，不新增功能。

- [ ] Activity Bar 组件（4 个 icon，切换逻辑）
- [ ] Left Panel 容器 + Session 内容迁移
- [ ] Tab Bar 组件 + Session Tab
- [ ] Right Panel 容器 + FileTree 最小实现
- [ ] zustand `useLayoutStore`
- [ ] App.tsx 重构为布局组合
- [ ] localStorage 状态迁移
- [ ] Header Bar 四段式重构

**验收标准**：启动后看到四区布局，Session Tab 功能与当前完全一致，FileTree 可浏览目录。

### Phase 2: File & Git

**目标**：文件浏览和 Git 状态可用。

- [ ] FileTree 完整实现（watcher、折叠、隐藏规则）
- [ ] File Tab + FileViewer（语法高亮）
- [ ] Git Panel（`git status` + 点击打开 Diff）
- [ ] Diff Tab + DiffViewer
- [ ] 右侧栏折叠/展开

**验收标准**：可以在右侧栏浏览文件、查看 git status、点击文件打开 Tab。

### Phase 3: Terminal & Skills & MCP

**目标**：Terminal 和辅助面板可用。

- [ ] Terminal Tab（xterm + node-pty）
- [ ] Skills Panel
- [ ] MCP Panel
- [ ] Settings Panel（ProviderSetup 嵌入）
- [ ] `+` 按钮下拉菜单

**验收标准**：可以在 Tab 中使用终端，查看 skills 和 MCP 列表。

### Phase 4: Polish

**目标**：体验优化。

- [ ] Tab 右键菜单（Close / Close Others / Close All）
- [ ] Tab 拖拽排序
- [ ] 文件树右键菜单
- [ ] Git commit/stage/unstage
- [ ] Keyboard shortcuts（`Cmd+\` 切换侧栏，`Cmd+B` 切换 Activity Bar）
- [ ] 性能优化（FileTree 虚拟化、大文件懒加载）

---

## 15. 风险与约束

### 15.1 `node-pty` native 模块

`node-pty` 是 native 模块，需要针对 Electron 版本重新编译。可能导致：
- 安装失败
- Electron 升级后需要重新 rebuild
- 跨平台构建复杂度增加

**缓解**：Phase 3 才引入 Terminal，给足够时间处理 native 模块问题。如果 `node-pty` 问题持续，可降级为简单的命令输出面板（非交互式）。

### 15.2 文件系统 watcher 性能

`chokidar` 监听大项目（如 `node_modules` 未排除）可能 CPU 占用高。

**缓解**：
- 严格排除 `node_modules`、`.git`、`out`、`dist`
- 使用 `chokidar` 的 `ignored` 选项 + `.gitignore` 感知
- 防抖刷新（300ms debounce）

### 15.3 zustand 迁移风险

将 App.tsx 的状态迁移到 zustand 是大规模重构，可能引入回归。

**缓解**：
- 先创建 zustand store，App.tsx 通过 store hook 消费
- 逐步迁移，每次只移一个状态域
- 保持现有测试全部通过

### 15.4 Tab 状态与 Pi 连接的耦合

当前 ChatView 与 Pi 连接状态深度耦合。Tab 系统需要确保切换 Tab 不会中断 Pi 连接。

**缓解**：
- Pi 连接状态全局管理，不属于任何 Tab
- Session Tab 只是 ChatView 的容器，ChatView 的逻辑不变
- 切换到非 Session Tab 时，Pi 连接保持，streaming 继续后台运行

---

## 16. 与现有 Spec 的关系

| 现有 Spec | 影响程度 | 说明 |
|-----------|---------|------|
| [sidebar-spec.md](./sidebar-spec.md) | 🟡 修改 | Session 内容不变，折叠逻辑由 Activity Bar 承担 |
| [session-management-spec.md](./session-management-spec.md) | 🟢 无影响 | Session 数据模型和 RPC 不变 |
| [compact-view-spec.md](./compact-view-spec.md) | 🟢 无影响 | View mode 切换仍在 header，与 Tab 无关 |
| [token-usage-spec.md](./token-usage-spec.md) | 🟢 无影响 | Token ring 仍在 header |
| [search-spec.md](./search-spec.md) | 🟢 无影响 | 搜索功能独立于布局 |
| [improvement-roadmap.md](./improvement-roadmap.md) | 🟡 修改 | #5 State Management 与本 spec 的 zustand 迁移重叠 |

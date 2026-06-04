# Git Log & Git Graph Spec

## 1. Overview

右侧栏 Git 面板当前仅展示工作区变更（Staged / Changes / Untracked），无文件修改时几乎为空白。本功能为 Git 面板增加 **Commit 历史（Log）** 和 **分支图形（Graph）**，使用户无论工作区是否有变更都能看到有意义的 Git 信息，类似 VSCode 的 Git Graph 插件。

核心思路：
- Git 面板拆分为 **Changes / Log** 两个子 Tab
- Log 视图展示 commit 列表 + 分支图形（复用公共 TreeGraph 组件）
- 点击 commit 可展开详情，点击详情中的文件可查看 diff

## 2. Design Principles

1. **不破坏现有功能**：Changes 视图逻辑完全保留，只是包了一层 Tab
2. **始终有内容**：即使无文件修改，Log 视图也能展示 commit 历史
3. **复用 TreeGraph 组件**：将 SessionSidebar 的引导线/圆点/分支图形抽象为公共组件，Session 树和 Git Graph 共用
4. **按需加载**：commit detail 只在点击展开时请求，log 列表支持分页
5. **内联展开**：commit 详情在 Log 列表内 inline 展开，不跳转到主区域（体验更连贯）

## 3. UI Layout

### 3.1 GitPanel 整体结构

```
┌──────────────────────────────────┐
│  Branch: main ↑2 ↓0        [↻]  │  ← 顶栏：分支名 + ahead/behind + 刷新
├──────────────────────────────────┤
│  [Changes]  [Log]               │  ← 子 Tab 切换
├──────────────────────────────────┤
│                                  │
│  Changes 视图（现有逻辑）         │  ← 无变更时显示 "No changes"
│  或                              │
│  Log 视图（新增）                │  ← 始终有内容
│                                  │
├──────────────────────────────────┤
│  Commit 输入区（仅 Changes Tab） │  ← 仅在 Changes + 有 staged 时显示
└──────────────────────────────────┘
```

### 3.2 Log 视图

```
┌──────────────────────────────┐
│  ● │ a1b2c3d │ main          │  ← 当前分支最新 commit（蓝色圆点）
│  │ │ Fix login bug           │
│  │ │ John · 2h ago           │
│  ├───────────────────────────┤
│  │ │ c3d4e5f │               │
│  │ │ Add user model          │
│  │ │ John · 1d ago           │
│  ├───────────────────────────┤
│  ○ │ f6g7h8i │ feature-x     │  ← 其他分支（绿色圆点）
│  │ │ WIP: new feature        │
│  │ │ Jane · 3d ago           │
│  ├───────────────────────────┤
│  ...                          │
│  [Load more]                  │  ← 分页加载
└──────────────────────────────┘
```

### 3.3 Commit Detail（inline 展开）

```
┌──────────────────────────────────┐
│  ● │ a1b2c3d │ main        [✕]  │  ← 点击后展开，右上角收起
│  ┌──────────────────────────────┐│
│  │ Fix login bug                ││  ← 完整 message
│  │ The session token was not    ││  ← body（如有）
│  │ being refreshed properly     ││
│  │                              ││
│  │ Author: John <j@x.com>      ││
│  │ Date:   2024-06-04 14:30    ││
│  │                              ││
│  │ Changed files:               ││
│  │  M  src/auth.ts         [→]  ││  ← 点击查看该文件此 commit 的 diff
│  │  A  src/models/user.ts  [→]  ││
│  │  D  src/old_auth.ts     [→]  ││
│  └──────────────────────────────┘│
│  │ │ c3d4e5f │                   │
│  ...                             │
└──────────────────────────────────┘
```

点击变更文件时，在主区域打开 diff tab（复用现有 DiffViewer，传入 commit hash + file path）。

## 4. TreeGraph 公共组件

### 4.1 抽象动机

SessionSidebar 和 Git Graph 都需要渲染"树形结构 + 连接线 + 节点圆点"的图形：

| 特性 | Session 树 | Git Graph |
|---|---|---|
| 数据结构 | 树（parent-child） | DAG（merge 有两个 parent） |
| 节点 | Session | Commit |
| 连接线 | 竖线 + 分叉 + 拐角 | 竖线 + 分叉 + 合并 |
| 圆点 | 活跃/完成/普通 | 当前分支/其他分支/普通 |
| 缩进层级 | 树深度 | 分支 lane |
| 交互 | 切换/重命名/删除 | 展开详情/查看 diff |

两者共享的视觉元素：
1. **GuideLine** — 垂直引导线
2. **GuideBranch** — 分叉线（从主线向右展开）
3. **GuideElbow** — 拐角线（子线到节点）
4. **DotSlot** — 节点圆点（实心/空心/不同颜色）
5. **GuideSlot** — 空位占位

### 4.2 组件 API

```tsx
// src/renderer/src/components/TreeGraph.tsx

/** 一条引导线的配置 */
interface GuideEntry {
  type: 'line' | 'branch' | 'elbow' | 'slot' | 'dot'
  /** 该引导线/圆点的颜色主题 */
  color: string          // e.g. '#3b82f6' (blue-500)
  /** 仅 dot 类型：是否有子节点且已展开（决定是否在圆点下方画线） */
  hasExpandedChildren?: boolean
  /** 仅 dot 类型：圆点样式 */
  dotStyle?: 'filled' | 'outlined' | 'hollow'
  /** 仅 branch 类型：主线上方是否需要高亮（merge 回主线时） */
  highlightAbove?: boolean
}

interface TreeGraphProps {
  /** 每个 slot 的引导线配置，从左到右排列 */
  guides: GuideEntry[]
  /** slot 宽度，默认 16px */
  slotWidth?: number
  /** 引导线距离 slot 左边的偏移，默认 8px */
  lineLeft?: number
  /** 圆点半径，默认 3px */
  dotRadius?: number
  /** 整行高度自适应（flex-stretch） */
  children: React.ReactNode
}

/** 渲染一行树形图形 */
function TreeGraphRow({ guides, slotWidth, lineLeft, dotRadius, children }: TreeGraphProps)

/** 便捷 hooks：将 git log 数据转换为 TreeGraphRow 所需的 guides[] */
function useGitGraphGuides(commits: CommitEntry[]): Map<string, GuideEntry[]>

/** 便捷 hooks：将 session tree node 转换为 TreeGraphRow 所需的 guides[] */
function useSessionTreeGuides(
  node: SessionTreeNode,
  ancestorLines: { hasLine: boolean; highlight: boolean; branchActive: boolean }[]
): GuideEntry[]
```

### 4.3 重构计划

1. **新建 `TreeGraph.tsx`**：从 SessionSidebar 中提取 `GuideLine`、`GuideBranch`、`GuideElbow`、`DotSlot`、`GuideSlot` 为通用组件，接受 `GuideEntry[]` 配置驱动渲染
2. **重构 `SessionSidebar.tsx`**：将 `SessionNode` 中的 guide 渲染逻辑替换为 `TreeGraphRow`，逻辑不变
3. **新建 `GitLogList.tsx`**：使用 `TreeGraphRow` 渲染 git commit 的分支图形

### 4.4 Git Graph 的 guide 映射

Git 的分支结构是 DAG（有向无环图），比 session 树多了"合并"（一个 commit 有两个 parent）。映射规则：

| Git 拓扑 | GuideEntry 序列 | 说明 |
|---|---|---|
| 主线连续 commit | `[dot(color=main)]` | 单列，竖线由上一行的 dot hasExpandedChildren 控制 |
| 分支起点（fork） | 上一行: `[dot, branch(color=branch)]`，分支行: `[line, dot(color=branch)]` | 新增 lane |
| 合并点（merge） | `[dot(color=main), elbow(color=branch)]` | 分支 lane 消失 |
| 多分支并行 | `[dot, line, line, ...]` | 多列 |

**简化首版**：只做单 lane + 分支颜色标识圆点，不画多 lane 并行线。即：
- 主线 commit：蓝色圆点 + 竖线
- 其他分支最新 commit：绿色/紫色圆点（无竖线连接到主线）
- 合并 commit：蓝色圆点 + 特殊标记

后续迭代可增加多 lane 完整 graph。

## 5. 后端 IPC 接口

### 5.1 新增 IPC Handler

| IPC Channel | 参数 | 返回 | 说明 |
|---|---|---|---|
| `git:log` | `{ maxCount?: number, skip?: number }` | `{ ok, data?: CommitEntry[], error? }` | 获取 commit 列表，支持分页 |
| `git:commitDetail` | `hash: string` | `{ ok, data?: CommitDetail, error? }` | 获取单个 commit 详情（含文件变更） |
| `git:commitFileDiff` | `hash: string, filePath: string` | `{ ok, data?: string, error? }` | 获取某 commit 中某文件的 diff |

### 5.2 数据类型

```typescript
/** Commit 列表条目（git:log 返回） */
interface CommitEntry {
  hash: string           // 完整 hash
  shortHash: string      // 前 7 位
  message: string        // commit message（首行）
  body: string           // commit body（换行后的部分）
  author_name: string
  author_email: string
  date: string           // ISO 8601
  refs: string           // HEAD -> main, origin/main 等
}

/** Commit 详情（git:commitDetail 返回） */
interface CommitDetail extends CommitEntry {
  files: FileChange[]
}

/** 文件变更条目 */
interface FileChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | 'C'
  additions: number
  deletions: number
}
```

### 5.3 simple-git 调用

```typescript
// git:log — 使用 simple-git 的 log API
const result = await git.log({ maxCount: 50, skip: 0 })
// result.all: DefaultLogFields[] — 包含 hash, date, message, refs, body, author_name, author_email

// git:commitDetail — 使用 git show --stat
const show = await git.show(['--stat=4096', '--format=%H%n%h%n%s%n%b%n%an%n%ae%n%aI%n%D', hash])
// 需要解析输出提取 files 列表

// git:commitFileDiff — 使用 git show 获取单个文件 diff
const diff = await git.show([hash, '--', filePath])
```

### 5.4 Preload API

在 `src/preload/index.ts` 新增：

```typescript
gitLog: (options?: { maxCount?: number; skip?: number }): Promise<{
  ok: boolean
  data?: CommitEntry[]
  error?: string
}>

gitCommitDetail: (hash: string): Promise<{
  ok: boolean
  data?: CommitDetail
  error?: string
}>

gitCommitFileDiff: (hash: string, filePath: string): Promise<{
  ok: boolean
  data?: string
  error?: string
}>
```

## 6. 前端组件结构

```
GitPanel.tsx (重构)
├── 顶栏 (branch + ahead/behind)       ← 保持不变
├── SubTab: [Changes] [Log]            ← 新增
├── Changes 视图                        ← 现有逻辑不变
│   ├── Staged / Changes / Untracked
│   └── Commit 输入区
└── Log 视图                            ← 新增
    ├── GitLogList                      ← commit 列表 + 分支图形
    │   └── GitLogItem                  ← 单条 commit（TreeGraphRow + hash + msg + author + date）
    │       └── CommitDetailInline      ← 展开的 commit 详情
    │           ├── 完整 message/body/author/date
    │           └── FileChangeList      ← 变更文件列表，点击打开 diff tab
    └── LoadMore 按钮

TreeGraph.tsx (新建公共组件)
├── TreeGraphRow                        ← 通用树形行组件（guide 线 + dot + children）
├── GuideLine / GuideBranch / ...       ← 内部渲染子组件
├── useGitGraphGuides()                 ← Git 专用 guide 计算 hook
└── useSessionTreeGuides()              ← Session 专用 guide 计算 hook
```

## 7. 数据流

```
用户点击 Log Tab
  → GitPanel 调用 window.api.gitLog({ maxCount: 50 })
  → IPC → main/git:log → simple-git.log()
  → 返回 CommitEntry[]
  → GitLogList 渲染列表（使用 TreeGraphRow 画分支线）

用户点击某个 commit
  → 调用 window.api.gitCommitDetail(hash)
  → IPC → main/git:commitDetail → git.show(['--stat', hash])
  → 返回 CommitDetail（含 files 列表）
  → CommitDetailInline 渲染详情

用户点击 commit 中的某个文件
  → 调用 onCommitFileSelect(hash, filePath)
  → 主区域打开 commitDiff tab
  → DiffViewer 调用 window.api.gitCommitFileDiff(hash, filePath) 显示 diff
```

## 8. DiffViewer 扩展

现有 DiffViewer 仅支持工作区 diff（`git diff`），需扩展支持 commit diff：

```tsx
// 扩展 DiffViewer props
interface DiffViewerProps {
  filePath: string
  commitHash?: string  // 新增：传入时显示该 commit 的文件 diff
}
```

现有 `onDiffSelect` 回调签名从 `(filePath: string) => void` 扩展为 `(filePath: string, commitHash?: string) => void`。在 App.tsx 中：

```tsx
const handleDiffSelect = useCallback((filePath: string, commitHash?: string) => {
  const name = filePath.split(/[/\\]/).pop() ?? filePath
  addTab({
    type: 'diff',
    title: commitHash ? `${shortHash}: ${name}` : `diff: ${name}`,
    closable: true,
    meta: { filePath, commitHash }  // 新增 commitHash meta
  })
  setRightPanelView('git')
}, [addTab, setRightPanelView])
```

DiffViewer 内部根据 `commitHash` 有无决定调用 `gitCommitFileDiff` 还是 `gitDiff`。

## 9. 实施步骤

| 阶段 | 内容 | 涉及文件 |
|---|---|---|
| **Step 1** | 新建 `TreeGraph.tsx` 公共组件 | `src/renderer/src/components/TreeGraph.tsx` |
| **Step 2** | 重构 `SessionSidebar.tsx` 使用 TreeGraphRow | `src/renderer/src/components/SessionSidebar.tsx` |
| **Step 3** | 后端新增 `git:log`、`git:commitDetail`、`git:commitFileDiff` IPC handler | `src/main/index.ts` |
| **Step 4** | Preload 暴露新 API + 类型声明 | `src/preload/index.ts` |
| **Step 5** | GitPanel 重构：加入 Changes/Log 子 Tab | `src/renderer/src/components/GitPanel.tsx` |
| **Step 6** | 新建 `GitLogList.tsx`：commit 列表展示 | `src/renderer/src/components/GitLogList.tsx` |
| **Step 7** | 新建 `CommitDetailInline.tsx`：inline 展开详情 | `src/renderer/src/components/CommitDetailInline.tsx` |
| **Step 8** | 扩展 DiffViewer 支持 commit diff | `src/renderer/src/components/DiffViewer.tsx` |
| **Step 9** | 扩展 App.tsx 的 tab/diff 机制支持 commitHash | `src/renderer/src/App.tsx` |
| **Step 10** (可选) | Git Graph 多 lane 完整分支图形 | 需额外 lane 分配算法 |

## 10. 性能考虑

1. **分页加载**：首次加载 50 条，滚动到底部时 load more（skip 递增）
2. **按需请求**：commit detail 只在点击展开时请求，不在 log 列表时预加载
3. **前端缓存**：用 `Map<string, CommitDetail>` 缓存已请求过的 commit detail
4. **防抖刷新**：fs:changed 事件同时刷新 git:status 和 git:log（log 请求可加 debounce 1s）
5. **log 不频繁刷新**：commit history 变化频率远低于 status，只在 commit/push/pull 后刷新

## 11. Git Graph 多 Lane 算法（Phase 2）

首版只做单 lane + 颜色区分。Phase 2 实现完整的多 lane 分支图：

1. 遍历 log 结果，解析每个 commit 的 parent hash 列表
2. 维护一个 `lanes: Lane[]` 数组，每个 lane 有颜色和当前 commit hash
3. 遍历每个 commit：
   - 如果 hash 在某个 lane 的 head 位置，该 commit 占据此 lane
   - 如果有多个 parent（merge），保留一个 parent 在当前 lane，另一个 parent 分配新 lane 或复用已结束的 lane
   - 如果 commit 只有一个 parent 且该 parent 也在某 lane 上，保持连续
4. 渲染时每条 commit 的 guides[] 长度 = lanes.length

此算法复杂度中等，单独一个迭代周期实现。

## 12. 待讨论

### 12.1 Log 视图默认选中

是否默认选中 Log Tab（当没有 changes 时）？还是始终默认 Changes？

**建议**：始终默认 Changes，无 changes 时显示 "No changes — switch to Log to see history" 提示。

### 12.2 Log 视图搜索

是否需要在 Log 视图顶部加搜索框过滤 commit？

**建议**：Phase 2。首版 50 条足够浏览，搜索需求不强。

### 12.3 Branch 标签渲染

commit 的 `refs` 字段包含 `HEAD -> main, origin/main, tag: v1.0` 等信息。如何在 UI 中优雅展示？

**建议**：在 commit 行右侧以小标签（badge）形式展示 branch name 和 tag，不同类型用不同颜色：
- 当前分支：蓝色 badge
- 远程分支：灰色 badge
- tag：琥珀色 badge

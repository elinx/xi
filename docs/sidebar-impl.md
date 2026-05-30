# Sidebar — Implementation Record

对应 spec: `sidebar-spec.md`

## 已实现

### Header

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| 显示项目目录名 | 从 `projects[0].projectPath.split('/').pop()` 取最后一节 | 无 |
| 取代 "SESSIONS" 文字 | 相同，`text-xs font-semibold uppercase tracking-wider text-gray-500` | 无 |
| 新建 + 折叠按钮 | SVG 图标按钮，`title` 属性标注 | 无 |

### Session 节点

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| 名称：有 name 显示 name，无 name 显示时间 | `getDisplayName()` — 有 name 返回 name，无 name 返回 `May 30 16:24` 格式 | 无 |
| 缩进 `depth * 16 + 8px` | 每个 depth level 是一个 16px `GuideSlot`，无需 `paddingLeft` | 见偏差 #1 |
| 活跃高亮 `bg-gray-100 text-gray-900` | 相同 | 无 |
| isMain 蓝色小圆点 | isMain/isActive/isOnActivePath 均为实心蓝点 `bg-blue-500 border-blue-500`，其余空心 `bg-white border-gray-300` | 见偏差 #2 |
| hover 显示相对时间 | `opacity-0 group-hover:opacity-100 transition-opacity`，`formatRelativeTime()` | 无 |
| 双击重命名 | 相同，Enter 提交，Escape 取消，失焦提交 | 无 |
| 跳转父 session 向上箭头 | 仅 `parentSessionPath` 非空时显示，hover 显现 | 无 |
| 删除：x → Del 两步确认 | 相同，仅非活跃+非 main 可删除，onBlur 重置确认状态 | 无 |

### 创建新 Session

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| header + 按钮出现输入框 | 输入框 + Create 按钮，border-b 分隔 | 无 |
| 必须输入名称 | `disabled={!newSessionName.trim()}` | 无 |
| Enter 提交，Escape 取消 | 相同 | 无 |

### 折叠态

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| 只保留展开按钮 | 双箭头图标 `M13 5l7 7-7 7M5 5l7 7-7 7`，`w-12` 居中 | 无 |

### Git Graph 线条（GuideSlot 模式）

采用 VS Code 同款 GuideSlot 模式（参考 `microsoft/prompty/tracetree.tsx`），每个 indent level 是独立 16px slot。

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| 竖线 + 圆点节点 | `DotSlot` 组件：圆点 + gutter 竖线（仅 `hasChildren && isExpanded`） | 无 |
| 线条与缩进共存 | 每个 depth 是独立 `GuideSlot`/`GuideLine`/`GuideBranch`/`GuideElbow`，不使用 paddingLeft | 见偏差 #1 |
| 空心/实心圆点 | 空心：`bg-white border-gray-300`，hover `border-blue-500`；实心：`bg-blue-500 border-blue-500` | 无 |
| 竖线 `bg-gray-200` | 使用 `#e5e7eb`（gray-200 的 hex 值） | 无 |
| 示意图用直角连接 | **实现用圆角 elbow（`border-bottom-left-radius: 4px`）** | 见偏差 #3 |
| 选中节点到根路径高亮 | `ancestorLines: { hasLine: boolean; color: string }[]` 传递路径颜色 | spec 无此设计 |

四种 Guide 组件：

```
GuideLine   — 纯竖线（祖先 level 有后续兄弟时）
GuideBranch — 竖线 + 横线（connector level，有后续兄弟时）
GuideElbow  — L 形圆角弯头（connector level，最后子节点时）
GuideSlot   — 空 slot（祖先 level 无后续兄弟时）
```

`ancestorLines` 传递规则：
- `hasLine`：该 level 的祖先是否有后续兄弟（决定竖线是否延伸）
- `color`：`#3b82f6`（active path 上）或 `#e5e7eb`（不在 path 上）
- 颜色根据 `childIsActivePath || laterSiblingOnActivePath` 决定

### 拖拽调整宽度

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| 最小 180px，最大 480px，默认 260px | `Math.min(480, Math.max(180, ...))` | 无 |
| 拖拽时实时调整 | `mousemove` 事件实时更新 `sidebarWidth` state | 无 |
| 松开后持久化 localStorage | `localStorage.setItem('xi-sidebar-width', ...)`，初始化时读取 | 无 |
| 右边缘 resize handle | `w-1` 竖条，hover `w-1.5 bg-blue-500/30`，cursor `col-resize` | 无 |
| 拖拽时禁用文本选择 | `document.body.style.userSelect = 'none'`，mouseup 恢复 | 无 |

### 右键菜单

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| Rename | 点击后设 `triggerRenamePath`，触发对应节点的 `isRenaming` 状态 | 无 |
| Go to parent | 仅 `parentSessionPath` 非空时显示，点击后 `onSwitchSession(parentPath)` | 无 |
| Delete | 仅非活跃+非 main 时显示，点击后 `onDeleteSession(path)` | 无 |
| 点击其他区域关闭 | document click listener + Escape key listener | 无 |
| 补充而非替代现有交互 | 现有双击重命名、hover 删除/跳转均保留 | 无 |

---

## 偏差

### #1 GuideSlot 取代 paddingLeft 缩进

**spec 设计**：缩进用 `paddingLeft: depth * 16px`，线条用绝对定位
**实际实现**：每个 depth level 是独立 16px `GuideSlot`，行内容不再使用 paddingLeft

**理由**：GuideSlot 模式下缩进和线条是同一个 slot 系统的不同渲染，自然共存，无需两层定位。线条位置固定在 slot 内 `left: 7px`，不受行宽或滚动影响。这是 VS Code 文件树的同款方案。

### #2 isMain 与 isActive/isOnActivePath 合并处理

**spec 设计**：isMain 用蓝色小圆点（`h-1.5 w-1.5 bg-blue-500`），与 active 高亮区分
**实际实现**：isMain、isActive、isOnActivePath 均为同尺寸实心蓝点

**理由**：main session 几乎总是 active session，区分两种蓝色意义不大。`isOnActivePath` 的高亮表示"该节点在选中节点到根的路径上"，包括祖先节点，比单纯的 isMain 更有用。

### #3 圆角 Elbow 取代直角连接

**spec 设计**：示意图用直角 `├─●` 连接
**实际实现**：L 形 elbow 带 `border-bottom-left-radius: 4px`，视觉上类似 `╰─●`

**理由**：圆角连接更流畅，与 sidebar 的整体圆角风格一致。直角连接在浅色背景上显得生硬。

### #4 Active Path 高亮（spec 无此设计）

**实际实现**：选中节点到根路径上的所有线条和圆点高亮为蓝色

**理由**：用户明确要求"选中某一个的时候能不能让对应的到根目录的线都高亮"。实现通过 `ancestorLines` 的 `color` 字段传递，每个子节点计算 `childIsActivePath || laterSiblingOnActivePath` 决定颜色。

---

## 未实现

### 折叠态额外信息

spec 讨论中提出折叠态是否显示 session 数量或当前 session 名，决定保持极简。

### 搜索/过滤

标记为待定，session 数量少时无需求。

---

## 代码结构

```
src/renderer/src/components/SessionSidebar.tsx
├── formatRelativeTime()        # ISO 时间 → 相对时间（2h ago）
├── getDisplayName()            # 有 name 显示 name，无 name 显示时间
├── isDescendantOf()            # 递归判断节点是否在 active path 上
├── GuideLine                   # 纯竖线 slot（祖先 level）
├── GuideBranch                 # 竖线 + 横线 slot（connector level，有后续兄弟）
├── GuideElbow                  # L 形圆角弯头 slot（connector level，最后子节点）
├── GuideSlot                   # 空 slot（祖先 level 无后续兄弟）
├── DotSlot                     # 圆点 + gutter 竖线
├── SessionNode                 # 递归树节点组件
│   ├── renderGuides()          # 根据 ancestorLines 渲染 Guide 组件序列
│   ├── expand/collapse 按钮     # 有子节点时显示，hover 显现
│   ├── 重命名编辑               # 双击或右键触发
│   ├── 跳转父 session           # hover 显示
│   └── 删除确认                 # x → Del 两步
└── SessionSidebar              # 侧边栏容器
    ├── header                   # 项目名 + 新建/折叠按钮
    ├── 创建区                   # 输入框 + Create 按钮
    ├── session 树               # SessionNode 递归渲染
    ├── resize handle            # 右边缘拖拽
    └── 右键菜单                 # Rename / Go to parent / Delete
```

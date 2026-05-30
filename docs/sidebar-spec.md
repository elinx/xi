# Sidebar Spec

## Overview

左侧栏展示当前项目的 session 树形结构，支持创建、切换、重命名、删除、导航到父 session。

## 当前实现

### 布局

- 展开宽度：`w-[260px]`
- 折叠宽度：`w-12`（只保留展开按钮）
- 背景：`bg-gray-50`，右边框 `border-gray-200`
- 顶部留 `pt-10` 避让 macOS 交通灯按钮

### 三段结构

```
┌──────────────────────────┐
│  agent-gui   [+] [<<]   │  ← header（项目名 + 操作按钮）
├──────────────────────────┤
│  [Session name] [Create] │  ← 创建区（点击 + 后出现，创建后消失）
├──────────────────────────┤
│  ● main          2h ago  │  ← session 节点（直接展示，无项目折叠层）
│    产品建议      2h ago  │    └ parent ↑ | x
│    绘图          2h ago  │    └ x
│    ideas           15m   │
└──────────────────────────┘
```

### Header

- 显示当前项目目录最后一节名称（取代原先的 "SESSIONS" 文字）
- Xi 是单项目应用，sidebar 只展示当前项目的 session 树，不支持多项目切换

### Session 节点

| 属性 | 规则 |
|---|---|
| 名称 | 有 name 显示 name，无 name 显示 `May 30 16:24` 格式 |
| 缩进 | `depth * 16 + 8 px` |
| 活跃高亮 | `bg-gray-100 text-gray-900` |
| isMain 标记 | 左侧蓝色小圆点（`h-1.5 w-1.5 bg-blue-500`） |
| 时间 | hover 显示相对时间（`2h ago`） |
| 重命名 | 双击进入编辑，Enter 提交，Escape 取消，失焦提交 |
| 跳转父 session | 向上箭头按钮，仅 parentSessionPath 非空时显示 |
| 删除 | x 按钮（hover 显示），再点确认（变为红色 `Del`），仅非活跃+非 main 可删除 |

### 创建新 Session

- 点击 header 的 + 按钮，出现输入框 + Create 按钮
- 必须输入名称才能创建
- Enter 提交，Escape 取消
- 创建后作为当前 session 的子 session

### 折叠态

- 只显示展开按钮（双箭头图标）
- 宽度 `w-12`，居中排列

---

## 已决定

### 项目节点去除

- Header 从 "SESSIONS" 改为显示项目名（如 `agent-gui`）
- 去掉项目折叠节点，session 树直接展示在 header 下方
- Xi 是单项目应用，不考虑多项目场景

---

## 状态序列化与恢复

App 重启时，UI 状态必须从 localStorage 正确恢复，确保用户看到与关闭前一致的界面。

| 状态项 | localStorage key | 默认值 | 恢复时机 |
|-------|-----------------|-------|--------|
| 侧栏折叠 | `xi-sidebar-collapsed` | `false` | App mount |
| 侧栏宽度 | `xi-sidebar-width` | `260` | App mount |
| 视图模式 | `xi-view-mode` | `'normal'` | App mount |

恢复规则：
1. 读取 localStorage 对应 key，解析失败则使用默认值
2. 侧栏折叠：`'true'` → 折叠，其他 → 展开
3. 侧栏宽度：数值 clamp 到 `[180, 480]`，超出范围取默认 260
4. 视图模式：仅接受 `'normal' | 'turn' | 'outline'`，非法值回退 `'normal'`
5. 状态变更时实时写入 localStorage（如拖拽松开时写宽度，点击折叠时写折叠状态）

Session 树节点展开/折叠状态暂不持久化（重启后默认全展开），后续按需增加。

---

## 待讨论

### 1. Session 节点样式

保持现状：单行紧凑文字，hover 显示时间。无需增加视觉层次。

### 2. 拖拽调整宽度

支持拖拽右侧边缘调整 sidebar 宽度。

- 最小宽度：180px
- 最大宽度：480px
- 默认宽度：260px
- 拖拽时实时调整，松开后宽度持久化到 localStorage（key: `xi-sidebar-width`）
- 折叠态宽度不受影响（固定 w-12）

### 3. 折叠态实用性

保持极简，只保留展开按钮。不额外显示信息——折叠的目的就是节省空间，塞信息会失去折叠的意义。

折叠后只剩一个展开按钮，无法快速操作。是否需要在折叠态显示 session 数量或当前 session 名？

### 4. 搜索/过滤

暂不实现，标记为待定。Session 数量少时无需求，多了再考虑。

session 多了之后是否需要搜索？是否需要按名称/时间/消息数排序？

### 5. Git Graph 线条一致性

Chat 区域已用 git graph 线条连接 turn，sidebar 的 session 树也采用同样风格：

- 左侧 gutter 区域画竖线 + 圆点节点，与 compact view 一致
- 线条与缩进共存（不取代缩进）：缩进表示深度，线条表示父子连接
- 折叠状态：空心圆点（`bg-white border-gray-300`），hover 变蓝
- 展开状态 / 有子节点：实心圆点（`bg-blue-500`）
- 活跃 session：圆点高亮
- 竖线用 `bg-gray-200`，与 compact view 一致

示意：
```
│
●  main              2h ago
│
├─●  产品建议         2h ago
│
├─●  绘图            2h ago
│
●  ideas             15m ago
```

### 6. 右键菜单

保留现有交互方式（单击切换、双击重命名、hover 显示删除/跳转），同时增加右键菜单作为统一入口。

右键菜单项：
- Rename — 进入重命名编辑
- Go to parent — 跳转父 session（仅 parentSessionPath 非空时显示）
- Delete — 删除 session（仅非活跃 + 非 main 时显示）

优先级：现有直接交互不变，右键菜单是补充而非替代。

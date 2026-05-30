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

## 待讨论

### 1. Session 节点样式

当前每个 session 节点是一行紧凑文字，信息密度高但区分度低。是否需要增加视觉层次？

**选项**：
- A) 保持现状（单行，纯文字）
- B) 双行：第一行 session 名称，第二行元数据（消息数、时间）
- C) 单行但增加 icon 区分（main 用特殊 icon，forked session 用分支 icon）

### 2. 拖拽调整宽度

sidebar 当前固定 260px。是否需要支持拖拽调整？

### 3. Git Graph 线条一致性

折叠后只剩一个展开按钮，无法快速操作。是否需要在折叠态显示 session 数量或当前 session 名？

### 4. 搜索/过滤

session 多了之后是否需要搜索？是否需要按名称/时间/消息数排序？

### 5. Git Graph 线条一致性

compact view 中的 chat 区域已用 git graph 线条表示 turn 序列。sidebar 的 session 树是否也用类似的线条连接父子关系（取代当前的缩进）？

### 6. 右键菜单

当前操作散落在各个按钮上（双击重命名、hover 显示删除/跳转）。是否改为右键菜单统一入口？

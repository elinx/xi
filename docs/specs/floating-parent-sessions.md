# Floating Parent Sessions

## 1. 问题

当 active session 嵌套较深时，用户在左侧 Session Sidebar 中看不到自己的层级上下文。祖先节点随滚动滚出视口后，用户需要手动向上滚动才能找到 parent 并导航回去。

```
main
  ├── Refactor auth
  │   ├── Fix JWT
  │   │   ├── Update token expiry    ← active, 深度 3
  │   │   └── Add refresh logic
  │   └── Clean up middleware
  ├── Feature: dashboard
  │   └── ...
```

问题：
- 祖先滚出视口后，上下文丢失
- 逐层回退需要滚动 + 点击，操作成本高
- 深层嵌套时，大量展开的祖先占据可视区域

## 2. 方案概述

在 Session Sidebar 的可滚动区域顶部，以 **sticky 堆叠** 的方式浮动显示当前 active session 的祖先链。每层祖先独占一行，层级越深缩进越大，整体风格类似 VS Code 编辑器顶部的函数层级导航（breadcrumb stack）。

```
┌──────────────────────────────────┐
│ ● main                           │  ← sticky, 缩进 0
│   ● Refactor auth                │  ← sticky, 缩进 1
│     ● Fix JWT                    │  ← sticky, 缩进 2, direct parent
├──────────────────────────────────┤
│ (树内容，正常滚动)                 │
│ main                              │
│   ├── Refactor auth               │
│   │   ├── Fix JWT                 │
│   │   │   ├── Update token expiry │  ← active
│   │   │   └── Add refresh logic   │
│   │   └── Clean up middleware     │
│   ├── Feature: dashboard          │
│   ...                             │
└──────────────────────────────────┘
```

## 3. 显示/隐藏规则

### 3.1 何时显示

只要 active session 有至少 1 个祖先就显示，即 `ancestors.length >= 1`。无任何额外阈值限制。

| active 位置 | 祖先链 (ancestors) | 是否显示 |
|---|---|---|
| main | `[]` | ❌ 不显示（无祖先） |
| main 的直接子节点 | `[main]` | ✅ 显示 1 行 |
| 深度 2 的节点 | `[main, childA]` | ✅ 显示 2 行 |
| 深度 3 的节点 | `[main, childA, grandchildB]` | ✅ 显示 3 行 |

### 3.2 何时不显示

- active session 无祖先（即 active 就是 main/root）
- Move-under 模式激活时（避免交互冲突）
- Sidebar 处于 collapsed 状态时

### 3.3 动态更新

- active session 切换时，浮动区立即更新
- session 树结构变化（rename、reparent、delete）时，浮动区同步更新
- 如果 active session 被删除，浮动区自然消失

## 4. 布局与样式

### 4.1 容器结构

```
SessionSidebar
└── Scroll Container (flex-1, overflow-y-auto)
    ├── FloatingParentStack (sticky top-0 z-10, flex-col)
    │   ├── Row 0: root/main     (sticky, top: 0px × 0)
    │   ├── Row 1: parent level 1 (sticky, top: rowHeight × 1)
    │   └── Row 2: parent level 2 (sticky, top: rowHeight × 2)
    └── SessionNode tree content (正常文档流)
```

每行使用 `sticky` 定位，`top` 值按行序递增，使得多行可以依次"粘"在顶部堆叠显示。

### 4.2 单行样式

| 属性 | 值 | 说明 |
|---|---|---|
| 高度 | `py-1.5` ≈ 24px | 与树节点行高接近 |
| 缩进 | 每层 `pl-4`（16px） | 与树中 SLOT_W=16 一致，视觉对齐 |
| 背景 | `bg-white/95 backdrop-blur-sm` | 半透明，滚动时隐约可见下方内容 |
| 字体 | `text-[11px]` | 比树节点 (text-xs=12px) 略小，不喧宾夺主 |
| 分隔 | `border-b border-gray-100` | 行间细线分隔 |
| 圆点 | 左侧 1.5×1.5 圆点 | 与树中 status dot 风格一致 |

### 4.3 缩进计算

```
row i 的 padding-left = basePadding + i × indentStep

basePadding = 8px   (px-2, 与树内容左侧对齐)
indentStep  = 16px  (与树中每个 SLOT_W=16px 一致)
```

示例：

| 层级 | padding-left | 视觉 |
|---|---|---|
| 0 (root) | 8px | `● main` |
| 1 | 24px | `  ● Refactor auth` |
| 2 | 40px | `    ● Fix JWT` |

### 4.4 行样式区分

| 行角色 | 背景 | 文字 | 圆点 | 额外 |
|---|---|---|---|---|
| 非 direct parent (中间层) | `bg-white/90` | `text-gray-500` | `bg-gray-300` | — |
| Direct parent (最后一行) | `bg-white` | `text-blue-600 font-medium` | `bg-blue-500` | `border-b border-gray-200/80`（与树区域分隔更明显） |

### 4.5 底部分隔

Direct parent 行下方有一条略深的分隔线 (`border-gray-200/80`)，将浮动区与下方树内容视觉分隔开。中间层之间用更淡的线 (`border-gray-100`)。

## 5. 交互

### 5.1 点击跳转

- 点击任意祖先行 → 调用 `onSwitchSession(ancestor.filePath)` 跳转到该 session
- 跳转后 active session 变更，浮动区自动更新为新 active 的祖先链
- 整行可点击（cursor-pointer），点击区域大

### 5.2 Hover 效果

- 非直接 parent 行：hover 时 `bg-gray-50 text-gray-700`
- 直接 parent 行：hover 时 `bg-blue-50`
- 过渡：`transition-colors duration-100`

### 5.3 溢出处理

当 sidebar 宽度不足以完整显示名称时：
- 每行文字 `truncate`（overflow: hidden, text-overflow: ellipsis）
- tooltip 显示完整名称（`title` 属性）

### 5.4 与现有功能的协同

| 现有功能 | 协同方式 |
|---|---|
| Auto-scroll to active | 不受影响，浮动区是 sticky 的，不影响 scroll 逻辑 |
| Collapse/Expand | 不受影响，浮动区不参与折叠逻辑 |
| Go to parent ↑ 按钮 | 保留，树行内快捷操作，浮动区是补充而非替代 |
| 右键菜单 | V1 不支持在浮动行右键，V2 可增强 |
| Move-under 模式 | 浮动区隐藏，避免交互冲突 |
| Drag & Drop | 浮动行不可拖拽，不影响拖拽逻辑 |

## 6. 数据层

### 6.1 计算祖先链

```typescript
/** 获取从 root 到 target 的祖先链（含 root，不含 target 本身），顺序为 root → direct parent */
function getAncestorChain(
  root: SessionTreeNode | null,
  targetPath: string
): SessionInfo[] {
  if (!root) return []
  const result: SessionInfo[] = []

  function walk(node: SessionTreeNode): boolean {
    if (node.session.filePath === targetPath) return true
    for (const child of node.children) {
      if (walk(child)) {
        result.push(node.session)
        return true
      }
    }
    return false
  }

  walk(root)
  return result.reverse()
}
```

### 6.2 性能

- `getAncestorChain` 在 session 树上做 DFS，O(n) 最坏情况，n = 总 session 数
- 用 `useMemo` 缓存，依赖 `[activePath, root]`
- session 数量通常 < 100，性能无问题

## 7. 实现变更

### 7.1 文件变更

仅修改 `src/renderer/src/components/SessionSidebar.tsx`：

1. 新增 `getAncestorChain()` 函数
2. 新增 `FloatingParentStack` 组件
3. 在 `SessionSidebar` 中计算 `ancestorChain` 并渲染 `FloatingParentStack`
4. Import 新增 `useMemo`, `Fragment`

### 7.2 不需要变更

- 类型定义 (`session.ts`)
- 数据层 (`useSessionManager.ts`)
- 布局状态 (`useLayoutStore.ts`)
- TreeGraph 组件
- 主进程 (`session-service.ts`)
- IPC 接口

## 8. 示例场景

### 场景 A：深层嵌套

```
active = "Update token expiry"，深度 3

浮动区显示：
┌──────────────────────────────────┐
│ ● main                           │  ← 点击 → 跳转 main
│   ● Refactor auth                │  ← 点击 → 跳转 Refactor auth
│     ● Fix JWT                    │  ← direct parent, 蓝色高亮
├──────────────────────────────────┤
│ (树内容)                          │
```

### 场景 B：浅层，不显示

```
active = "Feature: dashboard"，深度 1，parent 只有 main

浮动区不显示，树内容正常展示。
```

### 场景 C：滚动后

```
用户向下滚动，树中 main、Refactor auth 等滚出视口

浮动区仍然粘在顶部：
┌──────────────────────────────────┐
│ ● main                           │  ← 始终可见
│   ● Refactor auth                │  ← 始终可见
│     ● Fix JWT                    │  ← 始终可见
├──────────────────────────────────┤
│   ... (树中更深的节点)             │
│   Add refresh logic              │
│   Clean up middleware            │
│   Feature: dashboard             │
└──────────────────────────────────┘
```

## 9. V2 增强方向

| 增强 | 说明 |
|---|---|
| 右键菜单 | 浮动行支持右键（rename、detach、move under） |
| Worker 状态 | 圆点颜色随连接状态变化（green/amber/red） |
| 展开/折叠联动 | 点击浮动行跳转后，自动 expand 该节点 |
| 出现/消失动画 | 浮动行增减时加 slide-down/slide-up 过渡 |
| 最大行数限制 | 祖先超过 N 层时，只显示最近 N 层 + "... " 折叠入口 |

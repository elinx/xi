# 树形视图竖线高亮算法

通用算法，用于在树形侧边栏中绘制从激活节点到根的蓝色高亮路径。不依赖具体框架。

---

## 1. 视觉模型

树形视图的每一行由若干 **slot 列** 组成，每列宽度固定（如 16px）。行从左到右依次为：

```
| 祖先列0 | 祖先列1 | ... | 连接器列 | 节点列(Dot) | 内容区 |
```

- **祖先列**（0 到 N-2）：表示更上层祖先的延续竖线
- **连接器列**（最后一列）：从父级竖线拐弯连到当前节点的水平分支
- **节点列**：圆点 + 向下延伸到子节点的竖线
- **内容区**：节点名称等

### 四种 Slot 组件

| 组件 | 视觉 | 使用场景 |
|------|------|---------|
| `GuideSlot` | 空白 | 祖先层无后续兄弟，无竖线 |
| `GuideLine` | 竖线 │ | 祖先层有后续兄弟，竖线穿过 |
| `GuideBranch` | 竖线 + 拐角 + 横线 ├─ | 连接器层，当前节点有后续兄弟 |
| `GuideElbow` | 竖线上半 + 拐角 + 横线 ╰─ | 连接器层，当前节点是最后兄弟 |

`GuideBranch` 的结构（重点，因为高亮覆盖层依赖它）：

```
     │           上半段竖线 (top → 50%)
     ╰─┐        圆角拐角 (50% 附近)
       ├─────●  横线连向圆点 (50% → 右侧)
     │           下半段竖线 (50% → bottom)，始终灰色
  ███████████    highlight 覆盖层 (top → bottom 全高)，蓝色叠加
```

覆盖层的存在是为了让蓝色竖线能穿过**非激活兄弟节点**的行（如 A1），连续延伸到后面的激活兄弟（如 A2）。

### 节点列（DotSlot）

- 圆点：激活=实心蓝，完成=实心灰，其他=空心灰
- 下方竖线（仅当有展开的子节点时）：从圆点底部延伸到行底部，颜色由 `hasChildOnActivePath` 决定

---

## 2. 数据模型

### 树节点

```
TreeNode {
  id: string
  children: TreeNode[]
}
```

### Slot 状态

渲染每一行时，需要知道每个 slot 列的状态。这些状态通过 **`ancestorLines`** 数组从父节点传播给子节点：

```typescript
type SlotState = {
  hasLine: boolean       // 该列是否有竖线（祖先有后续兄弟）
  highlight: boolean     // 该列竖线是否在激活路径上（需要蓝色覆盖）
  branchActive: boolean  // 激活路径是否在该层拐弯进入当前子树
}

// 每行的祖先列状态，由父节点计算后传入
ancestorLines: SlotState[]
```

三个字段的含义：

| 字段 | 含义 | 举例 |
|------|------|------|
| `hasLine` | 该祖先层是否有后续兄弟节点 | A 是 Root 的非末子 → hasLine=true |
| `highlight` | 激活路径经过该列竖线 | B 激活，A 在 B 上方 → A 行的根列 highlight=true |
| `branchActive` | 路径在此层拐弯进入当前子树 | A 包含激活后代 → A 行的连接器 branchActive=true |

### 关键不变量

1. **`branchActive` 一旦为 true，传播到其后代时保持 true**（直到叶子节点）
2. **`highlight && !branchActive` 表示路径"直通"该层**，竖线应为蓝色
3. **`highlight && branchActive` 表示路径在该层"拐弯"**，竖线不在路径上，应为灰色
4. **蓝线从激活节点到根必须连续不断** — 通过 GuideBranch 的 highlight 覆盖层和 DotSlot 的下方竖线实现

---

## 3. 算法

### 3.1 辅助函数

```
// 判断节点或其后代是否为激活节点
function isActiveDescendant(node, activeId):
  if node.id == activeId: return true
  return any child: isActiveDescendant(child, activeId)

// 判断子节点列表中，索引 i 之后是否有兄弟在激活路径上
function hasLaterSiblingOnPath(children, i, activeId):
  return any children[j] for j > i: isActiveDescendant(children[j], activeId)
```

### 3.2 传播算法（核心）

当父节点渲染子节点时，为每个子节点计算 `ancestorLines`：

```
for each child at index i in node.children:
  childIsActive = isActiveDescendant(child, activeId)
  laterOnPath   = hasLaterSiblingOnPath(node.children, i, activeId)
  onPath        = childIsActive || laterOnPath

  newAncestorLines = [
    // 继承父级的 ancestorLines，更新 highlight 和 branchActive
    ...parentAncestorLines.map(entry => {
      hasLine:      entry.hasLine                           // 结构不变
      highlight:    entry.branchActive
                     ? (entry.highlight && childIsActive)   // 拐弯层：仅路径内子树保留
                     : entry.highlight                      // 直通层：无条件保留
      branchActive: entry.branchActive && childIsActive     // 只在路径内子树保持
    }),

    // 新增一列：当前父节点的连接器列
    {
      hasLine:      i < node.children.length - 1            // 是否有后续兄弟
      highlight:    onPath                                  // 路径经过该列
      branchActive: childIsActive                           // 路径在此拐弯
    }
  ]

  render(child, newAncestorLines)
```

**传播逻辑的核心洞察**：

- `branchActive=true` 意味着路径在该层拐弯。此时 highlight 必须 `&& childIsActive` 过滤，
  因为只有路径内的子树才需要保留蓝色，路径外的兄弟子树不应该继承高亮。
- `branchActive=false` 意味着路径直通该层（竖线在路径上）。此时 highlight 无条件保留，
  因为无论进入哪个子树，该列的竖线都是蓝色路径的一部分。

### 3.3 渲染算法

给定一行的 `ancestorLines`，渲染各列：

```
for i, entry in ancestorLines:
  isConnector = (i == ancestorLines.length - 1)

  if isConnector:
    if entry.hasLine:
      render GuideBranch(
        active    = entry.branchActive
        highlight = entry.highlight && !entry.branchActive
      )
    else:
      render GuideElbow(
        active = entry.branchActive
      )
  else:
    if entry.hasLine:
      render GuideLine(
        highlight = entry.highlight && !entry.branchActive
      )
    else:
      render GuideSlot()
```

### 3.4 节点列渲染

```
// 圆点颜色
dotActive = isOnActivePath || isCurrentNode || isMainNode

// 下方竖线（仅当有展开的子节点时）
if hasChildren && isExpanded:
  hasChildOnActivePath = any child: isActiveDescendant(child, activeId)
  lineColor = hasChildOnActivePath ? BLUE : GRAY
```

### 3.5 根节点

根节点 `ancestorLines = []`，不渲染任何祖先列。根节点的 `isOnActivePath = true`（根始终在路径上）。

---

## 4. 渲染规则总结

| 组件 | 参数 | 蓝色条件 | 灰色条件 |
|------|------|---------|---------|
| `GuideSlot` | 无 | — | 始终灰色（空白） |
| `GuideLine` | `highlight` | `highlight && !branchActive` | 其他 |
| `GuideBranch` | `active`, `highlight` | `active=true`：上半+拐角+横线蓝；`highlight=true`：全高覆盖蓝 | `active=false`：上半+拐角+横线灰 |
| `GuideElbow` | `active` | `active=true` | `active=false` |
| `DotSlot` dot | `active` | `active=true` | 其他 |
| `DotSlot` line | `hasChildOnActivePath` | `hasChildOnActivePath=true` | 其他 |

**`highlight && !branchActive` 是所有竖线变蓝的统一条件**：
- 直通（branchActive=false）+ 路径经过（highlight=true）→ 蓝
- 拐弯（branchActive=true）→ 灰（路径在此拐向了子树，竖线不在路径上）

---

## 5. 完整场景推导

### 场景 A：深层节点激活，多分支

```
Main
├── A
│   ├── A1
│   └── A2 ← active
└── B
```

逐步推导各行的 `ancestorLines`：

**Root 渲染子节点 A**（i=0, childIsActive=true, laterOnPath=false, onPath=true）：
```
newAncestorLines = [
  { hasLine: true, highlight: true, branchActive: true }   // 连接器列
]
```

**A 渲染子节点 A1**（i=0, childIsActive=false, laterOnPath=true, onPath=true）：
```
newAncestorLines = [
  { hasLine: true, highlight: true && false = false, branchActive: true && false = false },  // 根层
  { hasLine: true, highlight: true, branchActive: false }   // A层连接器
]
```

**A 渲染子节点 A2**（i=1, childIsActive=true, laterOnPath=false, onPath=true）：
```
newAncestorLines = [
  { hasLine: true, highlight: true && true = true, branchActive: true && true = true },  // 根层
  { hasLine: false, highlight: true, branchActive: true }   // A层连接器
]
```

渲染结果：

| 行 | 列0 (根层) | 列1 (A层连接器) | Dot |
|----|-----------|----------------|------|
| A1 | GuideLine h=F,b=F → **灰** | GuideBranch h=T,b=F → **蓝色覆盖** | 蓝 |
| A2 | GuideLine h=T,b=T → **灰** | GuideElbow active=T → **蓝** | 蓝 |

- 根层竖线灰 ✓（A1 行：不在路径；A2 行：路径拐弯，!branchActive=false）
- A 层蓝线连续 ✓（A1 的 GuideBranch 覆盖层 + A2 的 GuideElbow）
- 蓝线路径：A2→A1覆盖层→A的DotSlot线→A→Main的DotSlot线→Main ✓

### 场景 B：根层直接子节点激活

```
Main
├── A
│   ├── A1
│   └── A2
└── B ← active
```

**Root 渲染子节点 A**（i=0, childIsActive=false, laterOnPath=true, onPath=true）：
```
newAncestorLines = [
  { hasLine: true, highlight: true, branchActive: false }   // 连接器列
]
```

**A 渲染子节点 A1**（i=0, childIsActive=false, laterOnPath=false, onPath=false）：
```
// 关键：根层 branchActive=false，highlight 无条件保留
newAncestorLines = [
  { hasLine: true, highlight: true && false = false, branchActive: false && false = false },
  { hasLine: true, highlight: false, branchActive: false }
]
```

**A 渲染子节点 A2**（i=1, childIsActive=false, laterOnPath=false, onPath=false）：
```
newAncestorLines = [
  { hasLine: true, highlight: true, branchActive: false },  // 直通，保留
  { hasLine: false, highlight: false, branchActive: false }
]
```

**Root 渲染子节点 B**（i=1, childIsActive=true, laterOnPath=false, onPath=true）：
```
newAncestorLines = [
  { hasLine: false, highlight: true, branchActive: true }
]
```

渲染结果：

| 行 | 列0 (根层) | Dot |
|----|-----------|------|
| A | GuideBranch active=F, h=T&&!F=T → **蓝色覆盖** | 蓝 |
| A1 | GuideLine h=F → **灰** | 灰 |
| A2 | GuideLine h=T&&!F=T → **蓝** | 蓝 |
| B | GuideElbow active=T → **蓝** | 蓝 |

- 根层蓝线从 A 到 B 连续 ✓
- A1 灰（不在路径上）✓
- A2 蓝（路径直通）✓

### 场景 C：3 层深度激活

```
Main
├── A
│   ├── A1
│   │   └── A1a ← active
│   └── A2
└── B
```

**A1a 的 ancestorLines**：
```
[
  { hasLine: true, highlight: true,  branchActive: true },   // 根层：路径拐弯进 A
  { hasLine: true, highlight: true,  branchActive: true },   // A层：路径拐弯进 A1
  { hasLine: false, highlight: true, branchActive: true }    // A1层连接器
]
```

渲染：

| 列 | 类型 | h && !b | 颜色 |
|----|------|---------|------|
| 0 | GuideLine | T && !T = F | **灰** |
| 1 | GuideLine | T && !T = F | **灰** |
| 2 | GuideElbow | active=T | **蓝** |

- 根层和 A 层灰 ✓（路径在这两层都拐弯）
- A1 层 connector 蓝 ✓
- 蓝线：A1a→A1→A→Main ✓

---

## 6. 常量

| 常量 | 值 | 含义 |
|------|----|------|
| `SLOT_W` | 16 | 每列宽度（px） |
| `LINE_LEFT` | 8 | 竖线在列内的左偏移（px） |
| `R` | 3 | 拐角圆角半径（px） |
| `GRAY` | #e5e7eb | 非激活线颜色 |
| `BLUE` | #3b82f6 | 激活线颜色 |

竖线宽度：1.5px。竖线居中在 `LINE_LEFT` 位置（左边缘 8px，中心 8.75px）。

---

## 7. 实现清单

从零实现此算法需要：

1. 定义 `TreeNode` 数据结构和 `isActiveDescendant` 辅助函数
2. 实现四种 Guide 组件（GuideSlot / GuideLine / GuideBranch / GuideElbow）
3. 实现 DotSlot 组件（圆点 + 条件下方竖线）
4. 实现递归渲染函数，在渲染子节点时按 **3.2 传播算法** 计算 `ancestorLines`
5. 在每行中按 **3.3 渲染算法** 将 `ancestorLines` 映射为 Guide 组件
6. 确保 `GuideBranch` 的 highlight 覆盖层为全高（top:0, bottom:0），保证蓝线穿过非激活兄弟行时连续
7. 确保 `DotSlot` 的下方竖线使用绝对定位 `left: LINE_LEFT`，与 Guide 组件的竖线对齐

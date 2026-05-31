# 侧边栏树形线条高亮逻辑修复

## 背景

`SessionSidebar.tsx` 使用一组 Guide 组件（`GuideLine`、`GuideBranch`、`GuideElbow`、`GuideSlot`、`DotSlot`）在侧边栏中绘制 session 树的连接线。当某个 session 激活时，从该节点到根的路径应高亮为蓝色。

## 问题描述

激活路径高亮存在两个 bug：

### Bug 1：最外层（根层）竖线不该亮却亮了

当深层 session 激活时，最左侧的竖线（根层 GuideLine）也变成蓝色，但它只是树的结构线，不在活跃路径上。

```
Main
├── A
│   ├── A1
│   └── A2 ← active
└── B

❌ 错误：A1/A2 行左侧的根层竖线也变蓝
✅ 期望：根层竖线始终灰色，只有路径上的 connector 和中间层竖线变蓝
```

### Bug 2：中间层竖线该亮却不亮

当根层竖线不亮的修复过于粗暴时（直接抑制所有非 connector 列的 highlight），导致从激活节点到根之间的中间层竖线也变灰，蓝线断断续续。

```
Main
├── A
│   ├── A1
│   └── A2 ← active
└── B

❌ 错误：A 层的竖线灰色，蓝线从 A2 到 Main 断开
✅ 期望：A 层竖线蓝色，蓝线从 A2 经 A 到 Main 连续不断
```

## 根因分析

高亮信息通过 `ancestorLines` 数组从父节点传播给子节点，每个条目包含三个字段：

```typescript
ancestorLines: { hasLine: boolean; highlight: boolean; branchActive: boolean }[]
```

| 字段 | 含义 |
|------|------|
| `hasLine` | 该层祖先是否有后续兄弟（决定是否画竖线） |
| `highlight` | 该层竖线是否需要蓝色覆盖（路径经过） |
| `branchActive` | 路径是否在该层拐弯进入当前子树 |

### 传播逻辑（构建 `newAncestorLines`）

```typescript
const childIsActivePath = /* 当前子节点或其后代是否激活 */
const laterSiblingOnActivePath = /* 当前子节点之后是否有兄弟在路径上 */
const onPath = childIsActivePath || laterSiblingOnActivePath

const newAncestorLines = [
  ...ancestorLines.map((entry) => ({
    hasLine: entry.hasLine,
    highlight: entry.branchActive
      ? (entry.highlight && childIsActivePath)   // 路径拐弯：仅当前 child 在路径上时保留
      : entry.highlight,                          // 路径直通：无条件保留
    branchActive: entry.branchActive && childIsActivePath,
  })),
  {
    hasLine: i < node.children.length - 1,
    highlight: onPath,
    branchActive: childIsActivePath,
  },
]
```

关键：**`highlight` 的传播需要区分路径是否在该层拐弯**：

- `branchActive=true`（路径在此层拐弯进入某子树）：只有进入路径内的子树时才保留 highlight，路径外的子树不保留
- `branchActive=false`（路径直通该层）：highlight 无条件保留，因为竖线是路径的一部分

### 渲染逻辑（`renderGuides`）

```typescript
ancestorLines.map((entry, i) => {
  const isConnector = i === ancestorLines.length - 1

  if (isConnector) {
    // 连接器：GuideBranch 或 GuideElbow
    if (entry.hasLine) {
      return <GuideBranch active={entry.branchActive}
                          highlight={entry.highlight && !entry.branchActive} />
    }
    return <GuideElbow active={entry.branchActive} />
  }

  // 非连接器：GuideLine、GuideSlot
  if (entry.hasLine) {
    return <GuideLine highlight={entry.highlight && !entry.branchActive} />
  }
  return <GuideSlot />
})
```

关键渲染规则：

| 组件 | highlight 条件 | 说明 |
|------|---------------|------|
| GuideLine | `highlight && !branchActive` | 路径拐弯处的竖线灰，直通处蓝 |
| GuideBranch | `highlight && !branchActive` | 同上（active 参数已处理 branchActive 情况） |
| GuideElbow | `active` | 最后子节点，路径拐弯处蓝 |
| DotSlot | `hasChildOnActivePath` | 有激活子节点时下方竖线蓝 |

## 场景验证

### 场景 1：深度 2 节点激活，多分支

```
Main
├── A
│   ├── A1
│   └── A2 ← active
└── B
```

| 行 | 列 0 (根层) | 列 1 (A层) | Dot |
|----|------------|------------|-----|
| A1 | GuideLine, h=F,b=F → 灰 | GuideBranch, h=T,b=F → 蓝色覆盖 | 蓝 |
| A2 | GuideLine, h=F,b=F → 灰 | GuideElbow, active=T → 蓝 | 蓝 |

- 根层竖线永远灰 ✓（路径在 A 处拐弯，branchActive=true，非 connector 列不亮）
- A 层蓝线连续 ✓（A1 的 GuideBranch 覆盖层提供蓝色竖线穿过）

### 场景 2：根层直接子节点激活

```
Main
├── A
│   ├── A1
│   └── A2
└── B ← active
```

| 行 | 列 0 (根层) | Dot |
|----|------------|-----|
| A | GuideBranch, h=T,b=F → 蓝色覆盖 | 蓝 |
| A1 | GuideLine, h=T,b=F → 蓝 | 蓝 |
| A2 | GuideLine, h=T,b=F → 蓝 | 蓝 |
| B | GuideElbow, active=T → 蓝 | 蓝 |

- 根层竖线蓝 ✓（路径直通，branchActive=false）
- A/A1/A2 行根层蓝线连续 ✓

### 场景 3：深度 3 节点激活

```
Main
├── A
│   ├── A1
│   │   └── A1a ← active
│   └── A2
└── B
```

| 行 | 列 0 (根层) | 列 1 (A层) | 列 2 (A1层) | Dot |
|----|------------|------------|-------------|-----|
| A1a | h=T,b=T → 灰 | h=T,b=T → 灰 | GuideElbow active=T → 蓝 | 蓝 |

- 根层和 A 层竖线灰 ✓（路径在这两层都拐弯）
- A1 层 connector 蓝 ✓
- 蓝线路径：A1a dot → A1 Elbow → A DotSlot线 → A dot → A Branch → Main DotSlot线 → Main dot ✓

## GuideBranch 的 highlight 覆盖层

`GuideBranch` 渲染为：
- 上半段竖线（top → 50%）：颜色由 `active` 决定
- 圆角拐角（50% 附近）：颜色由 `active` 决定
- 水平分支（50% → 右侧）：颜色由 `active` 决定
- 下半段竖线（50% → bottom）：始终灰色
- **highlight 覆盖层**（top → bottom 全高蓝色）：当 `highlight=true` 时叠加

覆盖层的作用：当非激活兄弟节点（如 A1）前方有激活兄弟（如 A2）时，竖线需要继续往下延伸蓝色路径。覆盖层全高覆盖，保证蓝线连续不断穿过该行。

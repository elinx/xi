# 侧边栏树形细线对齐与颜色修复方案

## 背景

`SessionSidebar.tsx` 使用一组 Guide 组件（`GuideLine`、`GuideBranch`、`GuideElbow`、`GuideSlot`、`DotSlot`）在侧边栏中绘制 session 树的连接线。当前存在两个视觉问题。

---

## 问题 1：Main 蓝球下方的竖线与子节点上来的细线不对齐

### 现象

Main 节点（蓝球）下方延伸出的竖线，在行与行之间与 Guide 组件绘制的竖线存在 0.5\~1px 的水平偏移，导致树线在视觉上断裂或呈锯齿状。

### 根因

关键常量：

| 常量 | 值 | 含义 |
|------|-----|------|
| `SLOT_W` | 16 | 每个 slot 列的宽度（px） |
| `LINE_LEFT` | 7 | Guide 组件中竖线的 `left` 值（px） |

**Guide 组件**（`GuideLine`/`GuideBranch`/`GuideElbow`）使用 CSS 绝对定位绘制竖线：

```jsx
style={{ left: LINE_LEFT, top: 0, bottom: 0, width: 1, backgroundColor: color }}
```

- 竖线左边缘：7px
- 竖线中心：7.5px

**DotSlot** 使用 flexbox 居中绘制竖线：

```jsx
<div className="flex-shrink-0 flex flex-col items-center relative" style={{ width: SLOT_W }}>
  <div className="flex items-center justify-center h-6"> {/* 圆点 */} </div>
  {hasChildren && isExpanded && (
    <div className="w-px flex-1" style={{ backgroundColor: ... }} /> {/* 竖线 */}
  )}
</div>
```

- 容器宽度：16px，`items-center` 居中
- `w-px` = 1px 宽的线，flexbox 居中 → left = (16 - 1) / 2 = **7.5px**
- 竖线中心：**8px**

两者中心相差 0.5px。在浏览器亚像素渲染中：

| 场景 | Guide（left:7） | DotSlot（居中 7.5） | 偏移 |
|------|-----------------|---------------------|------|
| 1x 屏幕 | snap 到 7px | snap 到 7px 或 8px | 0\~1 CSS px |
| 2x Retina | device px 14 | device px 15 | 0.5 CSS px = 1 device px |

无论哪种情况，行与行之间都会出现可感知的偏移。

此外，圆点本身（`w-2.5` = 10px）在 16px 容器中居中，中心在 8px，与 Guide 线中心 7.5px 也有 0.5px 偏移，但因为圆点较大，视觉影响不明显。

### 修复方案

将 `DotSlot` 中的竖线从 flexbox 居中改为绝对定位，使用 `left: LINE_LEFT` 与 Guide 组件完全对齐。

#### 修改前

```jsx
function DotSlot({ active, hasChildren, isExpanded, gutterActive }) {
  return (
    <div
      className="flex-shrink-0 flex flex-col items-center relative"
      style={{ width: SLOT_W, alignSelf: 'stretch' }}
    >
      <div className="flex items-center justify-center h-6">
        <div className={active
          ? 'w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-blue-500 flex-shrink-0'
          : 'w-2.5 h-2.5 rounded-full bg-white border-2 border-gray-300 group-hover:border-blue-500 flex-shrink-0'
        } />
      </div>
      {hasChildren && isExpanded && (
        <div
          className="w-px flex-1"
          style={{ backgroundColor: gutterActive ? '#3b82f6' : '#e5e7eb' }}
        />
      )}
    </div>
  )
}
```

#### 修改后

```jsx
function DotSlot({ active, hasChildren, isExpanded, gutterActive }) {
  return (
    <div
      className="flex-shrink-0 flex flex-col items-center relative"
      style={{ width: SLOT_W, alignSelf: 'stretch' }}
    >
      <div className="flex items-center justify-center h-6">
        <div className={active
          ? 'w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-blue-500 flex-shrink-0'
          : 'w-2.5 h-2.5 rounded-full bg-white border-2 border-gray-300 group-hover:border-blue-500 flex-shrink-0'
        } />
      </div>
      {hasChildren && isExpanded && (
        <div
          className="absolute"
          style={{
            left: LINE_LEFT,
            top: 24,   // h-6 = 24px, 圆点区域结束后
            bottom: 0,
            width: 1,
            backgroundColor: gutterActive ? '#3b82f6' : '#e5e7eb',
          }}
        />
      )}
    </div>
  )
}
```

**要点：**
- 竖线改用绝对定位 `left: LINE_LEFT`（7px），与 Guide 组件对齐
- `top: 24` 对应 `h-6`（圆点容器高度），确保竖线从圆点正下方开始
- `bottom: 0` 确保竖线延伸到行底部
- 圆点仍用 flexbox 居中（10px 圆点的 0.5px 偏移不可见）

---

## 问题 2：中间 session 激活时，左边线有一条多余的垂直向下蓝线

### 现象

当中间的子节点（非最后一个）被激活时，该节点所在行的 connector 会画一条从上到下的蓝色竖线。其中下半段（从当前节点延伸到下一个兄弟节点）不应该着蓝色，因为下一个兄弟节点不在 active path 上。

### 示意图

```
Root (main)
├── A
├── B (active)   ← 中间节点激活
│   └── B1
└── C
```

当前渲染效果（❌ 错误）：

```
│
├── A
├── B (蓝色)     ← 上半段蓝线正确，下半段蓝线多余
│   └── B1       ← 蓝线正确
├── C            ← 这条蓝线应该为灰色
│
```

期望渲染效果（✅ 正确）：

```
│  (灰)
├── A  (灰)
├── B  (上半段蓝，下半段灰)
│   └── B1 (蓝)
├── C  (灰)
│  (灰)
```

### 根因

**`GuideBranch` 用单一颜色渲染整条竖线**，没有区分上半段和下半段。

当前代码中，connector 颜色的计算逻辑如下：

```javascript
const hasChildOnActivePath = node.children.some(
  (child) =>
    currentSessionPath === child.session.filePath ||
    isDescendantOf(child, currentSessionPath)
)

const onPath = childIsActivePath || laterSiblingOnActivePath
const connectorColor = onPath ? '#3b82f6' : '#e5e7eb'
```

在 B 节点（中间，激活）的情况下：
- `childIsActivePath = true`（B 自己在 active path）
- `laterSiblingOnActivePath = false`（C 不在 active path）
- `onPath = true` → `connectorColor = '#3b82f6'`（蓝色）

B 不是最后一个子节点，所以使用 `GuideBranch`，它用 `connectorColor`（蓝色）渲染整条竖线 + 水平分支。但竖线的下半段（连向 C）应该是灰色的。

### 修复方案

将 `GuideBranch` 的竖线拆分为上半段和下半段，支持两种不同颜色。

#### 2.1 修改 `GuideBranch` 组件

**修改前：**

```jsx
function GuideBranch({ color }: { color: string }) {
  return (
    <div
      className="flex-shrink-0 relative pointer-events-none"
      style={{ width: SLOT_W, alignSelf: 'stretch' }}
    >
      {/* 整条竖线：单一颜色 */}
      <div
        className="absolute"
        style={{
          left: LINE_LEFT,
          top: 0,
          bottom: 0,
          width: 1,
          backgroundColor: color,
        }}
      />
      {/* 水平分支 */}
      <div
        className="absolute"
        style={{
          left: LINE_LEFT,
          top: '50%',
          width: SLOT_W - LINE_LEFT - 1,
          height: 1,
          backgroundColor: color,
        }}
      />
    </div>
  )
}
```

**修改后：**

```jsx
function GuideBranch({ color, bottomColor }: { color: string; bottomColor?: string }) {
  const bc = bottomColor ?? color
  return (
    <div
      className="flex-shrink-0 relative pointer-events-none"
      style={{ width: SLOT_W, alignSelf: 'stretch' }}
    >
      {/* 上半段竖线：从顶部到 50%，当前节点的 active path 颜色 */}
      <div
        className="absolute"
        style={{
          left: LINE_LEFT,
          top: 0,
          height: '50%',
          width: 1,
          backgroundColor: color,
        }}
      />
      {/* 下半段竖线：从 50% 到底部，延续到兄弟节点的颜色 */}
      <div
        className="absolute"
        style={{
          left: LINE_LEFT,
          top: '50%',
          bottom: 0,
          width: 1,
          backgroundColor: bc,
        }}
      />
      {/* 水平分支：从竖线连到当前节点的圆点 */}
      <div
        className="absolute"
        style={{
          left: LINE_LEFT,
          top: '50%',
          width: SLOT_W - LINE_LEFT - 1,
          height: 1,
          backgroundColor: color,
        }}
      />
    </div>
  )
}
```

**参数说明：**
- `color`：上半段竖线 + 水平分支的颜色（当前节点是否在 active path 上）
- `bottomColor`：下半段竖线的颜色（后续兄弟节点是否有在 active path 上的），默认等于 `color`

#### 2.2 修改 `SessionNode` 中的颜色计算

在 `renderGuides()` 调用处，需要区分两种颜色：

```javascript
// 在 SessionNode 的 children 渲染中，当前代码：
const onPath = childIsActivePath || laterSiblingOnActivePath
const connectorColor = onPath ? '#3b82f6' : '#e5e7eb'

// 修改为：
const branchColor = childIsActivePath ? '#3b82f6' : '#e5e7eb'         // 上半段 + 水平分支
const continuationColor = laterSiblingOnActivePath ? '#3b82f6' : '#e5e7eb'  // 下半段延续线
```

然后将两个颜色都传递下去。有两种实现方式：

##### 方案 A：在 ancestorLines 中携带两种颜色

修改 `ancestorLines` 的数据结构：

```typescript
// 之前
ancestorLines: { hasLine: boolean; color: string }[]

// 之后
ancestorLines: { hasLine: boolean; color: string; bottomColor?: string }[]
```

在构建 `newAncestorLines` 时：

```javascript
const newAncestorLines = [
  ...ancestorLines.map((entry) => ({
    hasLine: entry.hasLine,
    color: onPath ? '#3b82f6' : entry.color,
    bottomColor: entry.bottomColor,
  })),
  {
    hasLine: i < node.children.length - 1,
    color: branchColor,
    bottomColor: i < node.children.length - 1 ? continuationColor : undefined,
  },
]
```

在 `renderGuides()` 中：

```jsx
if (isOnActivePath) {
  if (entry.hasLine) {
    return <GuideBranch key={i} color={entry.color} bottomColor={entry.bottomColor} />
  }
  return <GuideElbow key={i} color={entry.color} />
}
```

##### 方案 B：直接在渲染子节点时计算并传递（推荐）

由于 `bottomColor` 只在 `GuideBranch` 中使用，且 `GuideBranch` 仅在当前行的 connector 位置出现（`i === ancestorLines.length - 1`），可以在 `renderGuides` 中直接根据当前行所在的 `ancestorLines` 最后一个条目的 `hasLine` 来决定。

但最清晰的做法还是 **方案 A**，因为它在数据层就完整描述了每条线的上下两段颜色，渲染层只需读取即可。

#### 2.3 颜色语义对照表

以如下树为例：

```
Root (main)
├── A
├── B (active)
│   └── B1
└── C
```

各行的 connector 颜色：

| 行 | connector 类型 | 上半段 (color) | 下半段 (bottomColor) | 说明 |
|----|---------------|---------------|---------------------|------|
| Root | DotSlot (root 无 connector) | — | — | 蓝球下方竖线由 gutterActive 控制 |
| A | GuideBranch | 灰 | 灰 | A 不在 active path，下方有 B |
| B | GuideBranch | 蓝 | 灰 | B 在 active path，但 C 不在 |
| B1 | GuideElbow | 蓝 | — | B1 在 active path，最后一个子节点 |
| C | GuideBranch | 灰 | 灰 | C 不在 active path |

---

## 问题 3：非 active path 的末尾子节点缺少连接线（断线）

### 现象

当某个子节点不在 active path 上，且它是父节点的最后一个子节点时（`hasLine = false`），该节点前方的 connector 区域为空白（`GuideSlot`），没有任何连接线从父级竖线延伸到该节点的圆点。视觉上该节点像是悬浮在空白处，与树结构完全断开。

以如下树为例（A 为激活节点）：

```
Root (main)
├── A (active)
└── B              ← 最后一个子节点，不在 active path
```

当前渲染效果（❌ 错误）：

```
│
├── A  (蓝)        ← GuideBranch，正确
│                   ← B 前方是 GuideSlot（空白），没有任何线连到 B
  B                ← 看起来像浮在空中，与 Root 没有视觉连接
```

期望渲染效果（✅ 正确）：

```
│
├── A  (蓝)
└── B  (灰)        ← GuideElbow，灰色肘形线从竖线连到 B 的圆点
```

### 根因

`renderGuides()` 中，connector 的选择逻辑如下：

```javascript
const renderGuides = () => {
  if (ancestorLines.length === 0) return null
  return ancestorLines.map((entry, i) => {
    const isConnector = i === ancestorLines.length - 1
    if (isConnector) {
      if (isOnActivePath) {            // ← 分支 1：active path
        if (entry.hasLine) {
          return <GuideBranch key={i} color={entry.color} />
        }
        return <GuideElbow key={i} color={entry.color} />
      }
      if (entry.hasLine) {             // ← 分支 2：非 active path，有后续兄弟
        return <GuideLine key={i} color={entry.color} />
      }
      return <GuideSlot key={i} />     // ← 分支 3：非 active path，无后续兄弟 → 空白！
    }
    if (entry.hasLine) {
      return <GuideLine key={i} color={entry.color} />
    }
    return <GuideSlot key={i} />
  })
}
```

三个分支的含义：

| 分支 | 条件 | 使用的组件 | 效果 |
|------|------|-----------|------|
| 1 | `isOnActivePath` | `GuideBranch` 或 `GuideElbow` | 画竖线+水平分支 或 肘形线（蓝色） |
| 2 | 非 active path + `hasLine` | `GuideLine` | 仅画竖线，无水平分支 |
| 3 | 非 active path + `!hasLine` | `GuideSlot` | 空白 |

**问题出在分支 2 和分支 3。**

- **分支 2**：`GuideLine` 只画一条从上到下的竖线，没有水平分支连到当前节点的圆点。这条竖线只是"路过"当前行，为下方的兄弟节点提供垂直连接，但当前节点本身没有得到从竖线到圆点的水平连接。
- **分支 3**：`GuideSlot` 完全空白，既没有竖线也没有水平连接。最后一个子节点完全没有从父级竖线连过来的线。

对比分支 1（active path）中，`GuideBranch` 同时画了竖线和水平分支，`GuideElbow` 画了肘形线（上半段竖线+水平段），都能把竖线和圆点连接起来。但非 active path 的节点缺少这个水平连接。

### 修复方案

所有节点（无论是否在 active path 上）都应该有树形连接线。区别仅在于颜色：蓝色 = active path，灰色 = 非 active path。

#### 修改前

```javascript
if (isConnector) {
  if (isOnActivePath) {
    if (entry.hasLine) return <GuideBranch key={i} color={entry.color} />
    return <GuideElbow key={i} color={entry.color} />
  }
  if (entry.hasLine) return <GuideLine key={i} color={entry.color} />
  return <GuideSlot key={i} />
}
```

#### 修改后

```javascript
if (isConnector) {
  // 所有节点统一使用 GuideBranch / GuideElbow，颜色不同而已
  if (entry.hasLine) {
    return <GuideBranch key={i} color={entry.color} bottomColor={entry.bottomColor} />
  }
  return <GuideElbow key={i} color={entry.color} />
}
```

逻辑简化为：
- `hasLine = true`（有后续兄弟）→ `GuideBranch`：竖线 + 水平分支
- `hasLine = false`（最后一个子节点）→ `GuideElbow`：肘形线

颜色由 `entry.color` 控制，在构建 `ancestorLines` 时已经根据是否在 active path 上设置了蓝色或灰色。

#### 颜色语义对照表（含问题 3 修复）

以如下树为例：

```
Root (main)
├── A (active)
│   └── A1
└── B
```

各行的 connector 颜色：

| 行 | isOnActivePath | hasLine | 修复前组件 | 修复后组件 | color | bottomColor | 说明 |
|----|---------------|---------|-----------|-----------|-------|-------------|------|
| Root | true | — | DotSlot | DotSlot | — | — | 蓝球，下方竖线由 gutterActive 控制 |
| A | true | true | GuideBranch(蓝) | GuideBranch(蓝, 灰) | 蓝 | 灰 | A 在 active path，下方 B 不在 |
| A1 | true | false | GuideElbow(蓝) | GuideElbow(蓝) | 蓝 | — | A1 在 active path，末尾节点 |
| B | false | false | **GuideSlot** | **GuideElbow(灰)** | 灰 | — | B 不在 active path，末尾节点，修复前断线 |

修复前 B 行是 `GuideSlot`（空白），视觉断开；修复后是 `GuideElbow(灰)`，灰色肘形线连接到 B 的圆点。

#### 另一个场景：非 active path 的中间子节点

```
Root (main)
├── A (active)
├── B              ← 非 active path，有后续兄弟 C
└── C
```

| 行 | isOnActivePath | hasLine | 修复前组件 | 修复后组件 | color | bottomColor |
|----|---------------|---------|-----------|-----------|-------|-------------|
| B | false | true | **GuideLine(灰)** | **GuideBranch(灰, 灰)** | 灰 | 灰 |

修复前 B 行是 `GuideLine`（仅有竖线，无水平分支连到圆点）；修复后是 `GuideBranch(灰, 灰)`，既有竖线也有灰色水平分支连到 B 的圆点。

### 与问题 2 修复的关系

问题 3 的修复与问题 2 的修复是互补的：
- 问题 2 让 `GuideBranch` 支持 `bottomColor`，区分上下两段颜色
- 问题 3 让所有节点都使用 `GuideBranch`/`GuideElbow`，不再使用 `GuideLine`/`GuideSlot` 作为 connector

两者共同作用后，`renderGuides()` 的 connector 逻辑变得完全统一：

```javascript
if (isConnector) {
  if (entry.hasLine) return <GuideBranch key={i} color={entry.color} bottomColor={entry.bottomColor} />
  return <GuideElbow key={i} color={entry.color} />
}
```

不再有 `isOnActivePath` 的分支判断，代码更简洁，逻辑更一致。

---

## 实施清单

- [ ] **修复 1**：将 `DotSlot` 竖线从 flexbox 居中改为绝对定位 `left: LINE_LEFT`
- [ ] **修复 2a**：修改 `GuideBranch` 支持 `bottomColor` 参数，拆分上下两段竖线
- [ ] **修复 2b**：修改 `ancestorLines` 数据结构，携带 `bottomColor`
- [ ] **修复 2c**：修改 `SessionNode` 中构建 `newAncestorLines` 的颜色计算逻辑
- [ ] **修复 2d**：修改 `renderGuides()` 传递 `bottomColor` 给 `GuideBranch`
- [ ] **修复 3**：统一 `renderGuides()` 的 connector 逻辑，所有节点都使用 `GuideBranch`/`GuideElbow`，仅通过颜色区分 active/non-active path
- [ ] **测试**：在不同树形结构（单节点、深链、多分支、中间节点激活、末尾节点激活、非 active path 节点）下验证视觉效果

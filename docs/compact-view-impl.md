# Compact View — Implementation Record

对应 spec: `compact-view-spec.md`
实现 commits: `5244925` (初始实现), `d2517fe` (左对齐 + git graph)

## 已实现

### 类型与工具函数 (`src/renderer/src/utils/compact-view.ts`)

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| `ViewMode = 'normal' \| 'turn' \| 'outline'` | 相同 | 无 |
| `ConversationTurn` interface | 相同，含 `id`, `index`, `userMessage`, `assistantMessages` | 无 |
| `groupByTurns()` | 跳过 system 消息，user 起始新 turn，后续 assistant 归入当前 turn | 无 |
| `getUserSummary()` — emoji 摘要 | 纯文字：text 取首行，image 显示 `[image]`，HTML 显示 `[HTML: title]`，`·` 连接，截断 80 字符 | spec 用 emoji（👤🖼️🌐），项目约束禁止 emoji |
| `getAgentSummary()` — emoji 摘要 | 纯文字：tool call 统计 `bash x3, read x2`，text 首行，`[2 images]`/`[1 HTML]`，`·` 连接 | spec 用 emoji（🤖🔧🖼️🌐），项目约束禁止 emoji |
| `truncate()` | 截断 + `…` | 无 |

### 顶栏切换按钮

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| 单按钮循环切换 Normal→Turn→Outline→Normal | **Segmented control**（三按钮并排，一次点击到位） | 见下方争议 #1 |
| 按钮文字 + emoji 图标 | SVG 图标按钮，title 属性标注 "Full view"/"Turn view"/"Outline view" | 项目约束禁止 emoji |
| 当前模式高亮 | active: `bg-gray-200 text-gray-900 shadow-sm`，inactive: `text-gray-500` | 无 |
| 放在顶栏右侧 | 放在顶栏中间区域，左右信息栏之间 | 微调位置，避免与右侧 Stop 按钮挤在一起 |

### 状态持久化

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| `localStorage` 存 `pi-view-mode` | key 改为 `xi-view-mode` | 项目名是 Xi 不是 Pi |

### Turn 模式

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| 两行卡片：user 行 + agent 摘要行 | 相同，agent 行前缀 `→` 字符 | 无 |
| 点击任意一轮展开 | 点击卡片展开 | 无 |
| "再次单击" 或 "收起按钮" 折叠 | **仅收起按钮**折叠，点击卡片内容区不折叠 | 见下方争议 #2 |
| 展开样式：左侧蓝色竖线 + 浅蓝背景 | `border-l-[3px] border-blue-500 bg-blue-50/30 rounded-r-lg` | 无 |
| 展开后复用 Normal 模式渲染 | 复用 `ContentBlockRenderer`、`ForkNameInput`、fork 逻辑 | 无 |
| 无 gutter 装饰 | **左侧 git graph gutter**：圆点节点 + 竖线连接 | 见下方争议 #7 |
| user 消息偏右 (`ml-8`) | **全部左对齐**，user/assistant 无 margin 偏移 | 见下方争议 #8 |

### Outline 模式

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| 每轮一行，只显示 user 提问 | 相同 | 无 |
| 序号标记为"可选增强" | **默认开启**，`#N` 序号 + user 摘要 | 见下方争议 #3 |
| 点击展开 | 相同，展开后与 Turn 模式一致（显示完整 user + assistant） | 无 |
| 无 gutter 装饰 | **左侧 git graph gutter**：与 Turn 模式相同 | 见下方争议 #7 |

### Normal 模式

| spec 设计 | 实现 | 偏差 |
|---|---|---|
| user 消息偏右（聊天气泡风格） | **全部左对齐** | 见下方争议 #8 |

### Edge Cases

| spec 场景 | 实现 |
|---|---|
| system 消息 | `groupByTurns` 中跳过 |
| 连续多条 assistant | 全部归入当前 turn |
| 只有 user 没回复 | `assistantMessages` 为空，agent 摘要显示 `...` |
| 空消息 | `getUserSummary` 返回空字符串，`getAgentSummary` 返回空字符串 |
| 单轮展开后新消息到达 | 展开状态保持，因为 `expandedTurns` 是 `Set<string>` 按 turn id 追踪 |

---

## 争议与未实现

### #1 循环按钮 vs Segmented Control

**spec 设计**：单按钮循环点击 Normal→Turn→Outline→Normal
**实际实现**：三按钮 segmented control

**理由**：循环按钮从 Outline 回 Normal 需要点两次，用户无法一眼看出当前模式和全部选项。Segmented control 一次点击到位，当前模式一目了然。

**待定**：如果用户偏好极简顶栏，可改为循环按钮 + tooltip。

### #2 点击卡片折叠 vs 仅按钮折叠

**spec 设计**：单击卡片任意位置可展开，"再次单击"或"收起按钮"可折叠
**实际实现**：单击卡片 header 区域展开，只有右上角 "Collapse" 按钮折叠

**理由**：展开后卡片内是完整的交互内容（markdown、tool call details、图片标注），点击内容区域不应折叠——用户可能在选中文字、点击链接、滚动查看时误触折叠。只有明确的 "Collapse" 按钮提供可预测的行为。

### #3 Outline 序号：可选 vs 默认

**spec 设计**：Outline 模式序号标记为"可选增强"
**实际实现**：默认开启

**理由**：序号是 Outline 模式的核心价值——快速定位和引用第 N 轮对话。没有序号的 Outline 只是更窄的 Turn，缺乏独立存在的意义。

### #4 流式传输自动展开（未实现）

**spec 设计**：Turn/Outline 模式下自动展开当前最后一轮（正在写入的轮次）
**实际实现**：未实现

**理由**：用户选择精简视图就是想少看，强制展开违背用户意图。流式传输时最后一轮卡片已显示摘要，用户可按需点击展开。如需提示，可用 pulse 动画标记"正在写入"的轮次，而非强制展开。

### #5 滚动位置保持（未实现）

切换模式时当前视口位置未保持，可能跳到顶部。

**待定**：需要在切换时记录当前可见的 turn/message id，切换后 scrollIntoView 到对应位置。

### #6 虚拟滚动（未实现）

长对话（200+ 条消息）在 Normal 模式下 DOM 节点过多，Compact View 只缓解了一半。

**待定**：需要引入虚拟滚动（如 `@tanstack/react-virtual`），配合 Compact View 使用。

### #7 Git Graph 线条（spec 无此设计）

**spec 设计**：无 gutter 装饰，纯卡片列表
**实际实现**：左侧 git graph gutter

样式：
- 每个 turn 前有圆点节点，非最后一个 turn 后有竖线连接
- 折叠状态：空心圆点（白底灰边 `border-gray-300`），hover 时边框变蓝
- 展开状态：实心蓝点（`bg-blue-500 border-blue-500`）
- 竖线：`w-px bg-gray-200`
- 展开内容的蓝色左边框（`border-l-[3px] border-blue-500`）与圆点视觉对齐

结构：每个 turn 是 flex 行，左侧 gutter（`w-6`）+ 右侧内容区。

**理由**：纯卡片列表视觉单调，缺乏上下文关联感。Git graph 线条赋予 turn 序列一种"时间线"的视觉节奏，让用户直觉感受到对话的推进脉络。圆点 → 竖线 → 圆点的模式与 git log --graph 同构，对开发者而言心智模型零成本。

**待定**：Fork 分支的视觉表达——从圆点处分叉出第二条线通向子 session。目前 fork 只在卡片底部显示文字标签，未用线条表达。

### #8 消息全部左对齐（spec 设计 user 偏右）

**spec 设计**：Normal 模式 user 消息 `ml-8`（偏右），assistant 消息 `mr-4`（偏左），类似聊天气泡
**实际实现**：所有模式下 user/assistant 消息均无水平 margin，统一左对齐

**理由**：user 消息一会在左一会在右，在对话流中不协调。Agent 对话不是即时聊天——user 输入和 agent 回复是同一个工作流的上下游，视觉上应该是同方向流动，而非交替摇摆。左对齐让视线始终从左扫到右，阅读效率更高。

---

## Open Questions（来自 spec，均未决定）

1. **快捷键** — `Cmd+Shift+V` 循环切换？或 `Cmd+1/2/3` 直接切换？
2. **按类型过滤** — Turn 模式下 "只折叠 tool result" 或 "只折叠 bash 输出"？
3. **自动切换提示** — 对话超过 50 条消息时提示切换到 Turn 模式？
4. **展开动画** — 过渡动画还是直接切换？
5. **搜索联动** — 搜索结果自动展开匹配的轮次？

---

## 代码结构

```
src/renderer/src/
├── utils/
│   └── compact-view.ts        # ViewMode 类型、groupByTurns、摘要生成
├── components/
│   └── ChatView.tsx           # TurnCard、OutlineRow 组件 + 三模式渲染分支
└── App.tsx                    # viewMode 状态、segmented control、localStorage 持久化
```

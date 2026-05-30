# 验证：流式输出闪烁修复

> 是否需要写 UT？**不需要。**
> 这是渲染性能问题，不是逻辑正确性问题。RAF 节流、memo、轻量渲染都是优化策略，UT 无法测"闪不闪烁"，Mock rAF 写出的测试脆弱且收益低。

## 验证方式

### 方式 1：肉眼对比（最直接）

**前置条件**：准备一个能触发长输出的场景（如"写一个完整的 React Todo 应用"）

| 对比项 | 修复前 | 修复后（预期） |
|--------|--------|----------------|
| 历史消息是否闪烁 | 全部消息随 delta 闪烁 | 已完成消息不闪烁 |
| 正在生成的文本 | 每帧重解析 Markdown，卡顿 | 纯文本流式输出，流畅 |
| 滚动行为 | 抖动、跳跃 | 平滑跟随 |
| 10+ 轮对话后 | 明显卡顿 | 与首轮无感知差异 |

### 方式 2：DevTools Performance 面板（量化）

1. 打开 Electron DevTools → Performance 面板
2. 点击 Record → 触发一次流式输出 → 停止 Record
3. 关注以下指标：

**修复前典型特征：**
- Scripting 占比高（ReactMarkdown 反复解析）
- Layout/Paint 频率高且密集（每帧多次）
- `scrollIntoView` 调用次数与 delta 事件 1:1

**修复后预期：**
- Scripting 占比下降（跳过 Markdown 解析）
- Layout/Paint 频率 ≤ 60fps（RAF 节流）
- `scrollIntoView` 调用频率 ≤ 60fps

#### 具体操作步骤

```bash
# 启动开发模式
cd /Users/xilinxing/workspace/agent-gui
npm run dev
```

1. 打开应用，连接 Pi
2. DevTools → Performance → ⏺ Record
3. 输入 "用 Python 写一个完整的 HTTP 服务器，包含路由、中间件、错误处理"（触发长输出）
4. 等输出完成 → 停止 Record
5. 对比修复前后的火焰图

#### 火焰图对比要点

| 观察点 | 修复前 | 修复后 |
|--------|--------|--------|
| React reconcile 频率 | 每个 delta 一次 | 每帧最多一次 |
| `ReactMarkdown` 出现范围 | 所有文本块 | 仅非 streaming 的文本块 |
| `scrollIntoView` 动画 | smooth 动画排队 | streaming 时 auto 无动画 |

### 方式 3：Console 计数（最简量化）

在 `syncContentBlocksToMessage` 中临时加计数器，对比修复前后同一场景下的实际调用次数：

```ts
// 临时调试代码，验证后删除
const syncCountRef = useRef(0)

const syncContentBlocksToMessage = useCallback(() => {
  if (!currentAssistantId.current) return
  if (rafIdRef.current !== null) return
  syncCountRef.current++
  rafIdRef.current = requestAnimationFrame(() => {
    rafIdRef.current = null
    // ... 原有逻辑
  })
}, [])
```

修复前：`syncCountRef` ≈ delta 事件数（数十到数百）
修复后：`syncCountRef` ≈ 实际渲染帧数（大幅减少）

### 方式 4：回归测试（防止回退）

如果后续重构导致问题复现，可通过以下信号快速识别：

- 流式输出时 CPU 占用飙升 → 可能是 Markdown 解析未跳过
- 历史消息文本闪烁 → 可能是 memo 失效或 isStreamingBlock 未传递
- 滚动抖动 → 可能是 scrollIntoView 节流失效

## 结论

| 验证方式 | 耗时 | 可靠度 | 推荐度 |
|----------|------|--------|--------|
| 肉眼对比 | 5 min | 中 | ⭐⭐⭐ |
| DevTools Performance | 15 min | 高 | ⭐⭐⭐⭐ |
| Console 计数 | 10 min | 中 | ⭐⭐ |
| 写 UT | 2+ h | 低（测不了闪烁） | ❌ |

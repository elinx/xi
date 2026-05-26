# Agent GUI POC Plan

## Goal

验证核心假设：**在 agent 对话流中内嵌交互式图片（缩放、标注、选择）比纯 CLI 文本输出更有价值。**

## Core Loop to Verify

```
用户提问 → agent 调用 screenshot 工具 → GUI 内嵌渲染截图
→ 用户在截图上画圈标注 + 文字反馈 → 回传 agent
→ agent 理解标注 → 修改 → 新截图 → GUI 渲染 + diff 对比
```

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Desktop shell | Electron 33+ | node-pty, better-sqlite3, 生态成熟 |
| Frontend | React 18 + TypeScript | 富交互组件生态 |
| Styling | Tailwind CSS 4 | 快速布局 |
| Markdown rendering | react-markdown + remark-gfm | 对话流中的文本渲染 |
| Image annotation | Fabric.js | Canvas 交互层：画框、画圈、文字标注 |
| Diff view | react-diff-viewer-continued | 代码/截图变更对比 |
| Agent backend | Pi (`pi --mode rpc`) | 已有 RPC 协议，无需自建 agent |
| Screenshot | Playwright | 无头浏览器截图，灵活 |
| IPC | Electron contextBridge | Main ↔ Renderer 通信 |
| Build | electron-vite | Electron + Vite 集成，HMR 快 |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process                                  │
│                                                         │
│  PiBridge                                               │
│  ├─ spawn("pi", ["--mode", "rpc"])                              │
│  ├─ stdin: JSON commands → Pi                           │
│  ├─ stdout: JSON lines → parse → IPC → Renderer        │
│  └─ lifecycle: restart, error, shutdown                 │
│                                                         │
│  ScreenshotServer (Playwright)                          │
│  ├─ HTTP localhost:3456/screenshot?url=...              │
│  ├─ HTTP localhost:3456/screenshot?selector=...         │
│  └─ Returns: { image: "data:image/png;base64,..." }    │
│                                                         │
│  IPC Handlers                                           │
│  ├─ pi:sendCommand → PiBridge.stdin                     │
│  ├─ pi:onEvent ← PiBridge.stdout → Renderer            │
│  ├─ screenshot:capture → ScreenshotServer               │
│  └─ file:readImage → 读取本地图片文件                    │
└──────────────┬──────────────────────────────────────────┘
               │ Electron IPC (contextBridge)
┌──────────────▼──────────────────────────────────────────┐
│  Electron Renderer (React)                              │
│                                                         │
│  App                                                    │
│  ├─ ChatView                                            │
│  │  ├─ MessageList (虚拟滚动)                            │
│  │  │  ├─ TextMessage (markdown 渲染)                    │
│  │  │  ├─ ImageMessage (内嵌图片 + Fabric.js 标注层)    │
│  │  │  ├─ ToolCallMessage (工具调用可视化)               │
│  │  │  └─ ActionMessage (选择卡片 / 确认按钮)            │
│  │  └─ InputBar (文字 + 粘贴图片)                        │
│  ├─ Sidebar (session 列表, 未来扩展)                     │
│  └─ StatusBar (Pi 状态: streaming/idle/model)            │
│                                                         │
│  Hooks                                                  │
│  ├─ usePiRpc() → 事件流 → React state                   │
│  ├─ useImageAnnotation() → Fabric.js 画布管理            │
│  └─ useScreenshot() → 截图请求                          │
└─────────────────────────────────────────────────────────┘
```

## Message Protocol

Agent 对话中的每条消息由 typed blocks 组成：

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  blocks: ContentBlock[];
  timestamp: number;
}

type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolCallBlock
  | ToolResultBlock
  | ActionBlock;

interface TextBlock {
  type: 'text';
  content: string; // markdown
}

interface ImageBlock {
  type: 'image';
  src: string;              // data:image/png;base64,... or file:// URL
  alt?: string;
  width?: number;
  height?: number;
  annotations?: Annotation[]; // 用户标注
}

interface ToolCallBlock {
  type: 'tool_call';
  toolName: string;         // e.g. "screenshot", "bash", "edit"
  args: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'error';
}

interface ToolResultBlock {
  type: 'tool_result';
  toolCallId: string;
  content: ContentBlock[];  // 结果可能是文本、图片等
}

interface ActionBlock {
  type: 'action';
  actionType: 'select' | 'confirm' | 'input';
  label: string;
  options?: { id: string; label: string; description?: string }[];
}

interface Annotation {
  id: string;
  type: 'rect' | 'circle' | 'arrow' | 'text';
  coords: number[];         // 归一化坐标 [0-1]
  label?: string;
  color?: string;
}
```

## Phases

### Phase 0: Project Scaffolding (Day 1-2)

**Deliverable**: 能启动的 Electron + React 空壳

- [ ] 0.1 初始化项目：electron-vite + React + TypeScript + Tailwind
- [ ] 0.2 Electron main process 骨架：window 创建、IPC bridge
- [ ] 0.3 Renderer 骨架：App.tsx + 基础布局（ChatView + InputBar）
- [ ] 0.4 开发环境：HMR、调试配置
- [ ] 0.5 确认 Pi 可用：`pi --mode rpc` 手动测试 stdin/stdout 通信

**文件结构**:
```
agent-gui/
├── electron/
│   ├── main/
│   │   ├── index.ts          # Electron 启动
│   │   ├── pi-bridge.ts      # Pi RPC 进程管理
│   │   └── ipc-handlers.ts   # IPC 注册
│   ├── preload/
│   │   └── index.ts          # contextBridge
│   └── renderer/
│       ├── src/
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   ├── components/
│       │   │   ├── ChatView.tsx
│       │   │   └── InputBar.tsx
│       │   └── types/
│       │       └── message.ts  # ContentBlock 类型定义
│       ├── index.html
│       └── tailwind.css
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
└── tailwind.config.ts
```

**验证**: `npm run dev` → Electron 窗口启动 → React 渲染空聊天界面

---

### Phase 1: Pi RPC Bridge (Day 3-5)

**Deliverable**: GUI 能发 prompt 给 Pi，能收到并渲染文本回复

- [ ] 1.1 PiBridge 类：spawn Pi --rpc，管理 stdin/stdout 生命周期
  - JSON-line 解析（逐行读 stdout）
  - 错误处理（Pi crash → 重启）
  - 优雅关闭（SIGTERM → Pi shutdown）
- [ ] 1.2 IPC 桥接：Renderer ↔ Main ↔ Pi
  - `pi:sendCommand` → 写 Pi stdin
  - `pi:onEvent` → Pi stdout 事件 → Renderer callback
  - `pi:onResponse` → Pi 命令回复 → Renderer callback
- [ ] 1.3 usePiRpc hook：事件流 → React state
  - 维护 `messages: ChatMessage[]`
  - 处理 AgentSessionEvent → 转换为 ContentBlock
  - 处理流式文本：token-by-token 追加到当前 TextBlock
- [ ] 1.4 ChatView 渲染：文本消息流
  - react-markdown 渲染 assistant 回复
  - 工具调用显示（折叠面板：工具名 + 参数 + 状态）
  - 自动滚动到底部
- [ ] 1.5 InputBar：文字输入 → `prompt` 命令
  - Enter 发送
  - 支持粘贴图片（clipboard → base64 → `images` 字段）

**关键代码路径**:
```
用户输入 "hello" 
→ InputBar onSubmit 
→ IPC: pi:sendCommand({ type: "prompt", message: "hello" })
→ PiBridge: write stdin
→ Pi: 处理 → 输出 events
→ PiBridge: read stdout → parse JSON
→ IPC: pi:onEvent(event)
→ usePiRpc: append to messages state
→ ChatView: re-render
```

**AgentSessionEvent → ContentBlock 映射**:
需要研究 Pi agent core 的事件类型。核心事件大概包括：
- `text_delta` → 追加到 TextBlock
- `tool_call_start` → 新建 ToolCallBlock (status: running)
- `tool_call_end` → 更新 ToolCallBlock (status: completed)
- `tool_result` → 新建 ToolResultBlock（检查 content 是否包含 image）
- `message_complete` → 标记消息结束

**验证**: 在 GUI 中输入 "列出当前目录文件" → Pi 执行 bash → 结果渲染在聊天流中

---

### Phase 2: Screenshot Tool (Day 6-8)

**Deliverable**: agent 能调用 screenshot 工具，GUI 能在对话流中内嵌渲染截图

- [ ] 2.1 Playwright Screenshot Server
  - Main process 中启动 Playwright
  - 暴露 capture 方法：URL 截图 / 本地 HTML 截图 / 指定 selector
  - 返回 `{ image: "data:image/png;base64,..." }`
- [ ] 2.2 Pi screenshot extension
  - Pi 的 extension 机制注册 `screenshot` 工具
  - 工具参数：`{ url: string, selector?: string, fullPage?: boolean }`
  - 工具实现：调用 ScreenshotServer → 返回 base64 image
  - 需要研究 Pi extension API（`.pi/extensions/` 目录）
- [ ] 2.3 ImageBlock 渲染组件
  - 内嵌在对话流中（非侧栏）
  - 基础功能：缩放、全屏查看
  - 自适应宽度：max 100%，保持比例
  - 点击展开 / 收起
- [ ] 2.4 ToolResultBlock 中检测 image
  - Pi tool_result 事件中，检查返回内容是否包含图片 payload
  - 如果是 → 创建 ImageBlock（而非 TextBlock）
  - 图片可能是 base64 data URL 或文件路径

**关键问题需验证**:
- Pi extension 如何注册自定义工具？需要读 `.pi/extensions/` 示例
- Pi tool_result 事件中图片 payload 的实际格式是什么？可能需要先手动测试
- Playwright 首次启动慢（~2s），需要预热或持久化 browser instance

**验证**: 在 GUI 中输入 "帮我截图 https://example.com" → Pi 调用 screenshot 工具 → 截图内嵌显示在对话流中

---

### Phase 3: Image Annotation (Day 9-12)

**Deliverable**: 用户能在截图上画圈/标注，标注结果回传 agent 形成闭环

- [ ] 3.1 Fabric.js 标注层
  - 叠加在 ImageBlock 上的 Canvas
  - 绘图工具：矩形框、圆形、箭头、文字标注
  - 工具栏：选择标注类型、颜色、撤销/重做
  - 标注数据存储：归一化坐标 [0-1]，不依赖像素尺寸
- [ ] 3.2 标注 → 注入 prompt
  - 用户完成标注后，点击 "发送反馈" 按钮
  - 前端生成：
    1. 带标注的截图（Fabric.js canvas.toDataURL()）
    2. 标注的文本描述（"用户在 [x,y,w,h] 区域标注：'这里改下'"）
  - 调用 `pi:sendCommand({ type: "prompt", message: desc, images: [annotatedImg] })`
- [ ] 3.3 Annotation 序列化
  - Annotation[] 存储在 ImageBlock 中
  - 支持重新编辑已有标注
  - 导出为自然语言描述供 agent 理解
- [ ] 3.4 标注 UX
  - 默认只读模式（不干扰阅读）
  - 点击图片进入标注模式
  - 右键或 ESC 退出标注模式
  - 标注提示文案："在图片上画圈标注你想修改的部分"

**标注 → Agent 的关键转换**:
```typescript
function annotationToPrompt(annotations: Annotation[], imageContext: string): string {
  const parts = annotations.map(a => {
    const pos = `位置 [${a.coords.map(c => Math.round(c * 100))}%]`;
    switch (a.type) {
      case 'rect': return `${pos} 画了方框${a.label ? `，标注："${a.label}"` : ''}`;
      case 'circle': return `${pos} 画了圈${a.label ? `，标注："${a.label}"` : ''}`;
      case 'arrow': return `${pos} 画了箭头${a.label ? `，标注："${a.label}"` : ''}`;
      case 'text': return `${pos} 写了："${a.label}"`;
    }
  });
  return `用户对"${imageContext}"做了标注：\n${parts.join('\n')}`;
}
```

**验证**: agent 截图 → 用户在图上画圈写 "这里改下" → 发送 → agent 回复 "我看到了你标注的区域，我来修改..."

---

### Phase 4: Interactive Action Blocks (Day 13-15)

**Deliverable**: agent 能在对话中展示交互式选择卡片，用户点击反馈

- [ ] 4.1 ActionBlock 组件
  - `select` 类型：多选卡片，点击选择
  - `confirm` 类型：确认/取消按钮
  - `input` 类型：文本输入框
- [ ] 4.2 Pi extension_ui_request 桥接
  - Pi RPC 已经有 `extension_ui_request` 事件（select/confirm/input）
  - 这些事件 → 渲染为 ActionBlock
  - 用户操作 → 发送 `extension_ui_response` 回 Pi
- [ ] 4.3 ActionBlock 视觉设计
  - 卡片式布局，hover 高亮
  - 选中状态反馈
  - 与 ImageBlock 联动：方案 A/B 截图 + 选择卡片

**验证**: agent 提示 "选择一个方案" → 显示两个截图卡片 → 用户点击 A → agent 收到选择继续工作

---

### Phase 5: Polish & Integration Test (Day 16-18)

**Deliverable**: 完整 POC 可演示

- [ ] 5.1 虚拟滚动
  - 长对话性能：react-virtuoso 或自定义虚拟化
  - 图片懒加载
- [ ] 5.2 错误处理
  - Pi crash → 自动重启 + 保留对话
  - 网络错误 → 重试提示
  - 图片加载失败 → placeholder
- [ ] 5.3 快捷键
  - Enter 发送 / Shift+Enter 换行
  - ESC 退出标注模式
  - Ctrl+C 中断 agent
- [ ] 5.4 状态栏
  - 当前模型、streaming 状态、token 计数
- [ ] 5.5 E2E 测试场景
  - 场景 1：截图 → 查看内嵌图片 → 缩放/全屏
  - 场景 2：截图 → 标注 → 反馈 → agent 修改
  - 场景 3：方案选择 → 卡片交互
  - 场景 4：粘贴本地图片 → agent 识别

---

## Timeline

| Phase | Days | Depends On |
|-------|------|-----------|
| Phase 0: Scaffolding | Day 1-2 | - |
| Phase 1: Pi RPC Bridge | Day 3-5 | Phase 0 |
| Phase 2: Screenshot Tool | Day 6-8 | Phase 1 |
| Phase 3: Image Annotation | Day 9-12 | Phase 2 |
| Phase 4: Action Blocks | Day 13-15 | Phase 1 (indep of 2/3) |
| Phase 5: Polish | Day 16-18 | Phase 3 + 4 |

**Total: ~18 working days (3.5 weeks), 1 person**

Phase 2 和 Phase 4 可以并行（不同的人/时间切片），但 1 人串行做的话按上面的顺序。

每个 Phase 完成后更新本文件的进度看板，并按 Quality Gates 检查清单验收。

## Key Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Pi extension API 文档不足 | 可能无法正确注册 screenshot 工具 | 先手动测试 Pi extension 机制；fallback：用 Pi bash 工具调外部脚本截图 |
| AgentSessionEvent 格式不明确 | 无法正确解析 agent 输出 | Phase 1 开始时先花半天读 agent core 事件类型 + 手动 dump 事件流 |
| Playwright 启动慢 | 截图工具延迟高 | 预热 browser instance；截完不关浏览器 |
| Fabric.js + React 集成问题 | 标注层渲染/状态管理复杂 | 用 fabric.js 的 React wrapper 或直接 ref 管理 |
| Pi tool_result 中图片格式不确定 | 无法自动识别图片 | Phase 2 开始时先手动触发一次截图，dump 完整事件 JSON |

## Project Management

### Git Workflow

**分支策略**：短生命周期功能分支 + main

```
main ──────────────────────────────────────
  │
  ├─ phase-0/scaffolding ──→ merge → delete
  ├─ phase-1/pi-rpc-bridge ──→ merge → delete
  ├─ phase-2/screenshot-tool ──→ merge → delete
  ├─ phase-3/image-annotation ──→ merge → delete
  ├─ phase-4/action-blocks ──→ merge → delete
  └─ phase-5/polish ──→ merge → delete
```

- 每个 Phase 一个分支，前缀 `phase-N/`
- Phase 内的子任务直接 commit 到 Phase 分支，不再拆子分支
- Phase 完成后 PR 合入 main，删除分支
- 紧急修复直接在 Phase 分支上 commit

**Commit 规范**：

```
<type>(<scope>): <description>

type:
  feat     - 新功能
  fix      - 修复 bug
  refactor - 重构（不改行为）
  chore    - 构建/配置/依赖
  docs     - 文档
  test     - 测试

scope:
  main     - Electron main process
  renderer - React 前端
  bridge   - Pi RPC 通信
  tool     - Screenshot/Extension 工具
  proto    - 消息协议/类型

示例:
  feat(renderer): add ImageBlock component with zoom support
  fix(bridge): handle Pi process crash and auto-restart
  chore: initial project scaffolding with electron-vite
```

**PR 规则**：
- 每个 Phase 结束开 PR，标题 `Phase N: <名称>`
- PR 描述包含：做了什么、验证了什么、已知问题
- POC 阶段不需要 code review，自己 merge
- 合入前必须跑通该 Phase 的验证场景

---

### 任务追踪

**追踪方式**：本计划文件 + Git commit

每个 Phase 的 checklist 就是任务列表。完成时：
1. 在本文件中勾选 `[x]`
2. Commit 时引用子任务编号（如 `feat(renderer): add ImageBlock #2.3`）
3. Phase 全部勾选 → 开 PR → 合入 main

**进度看板**（本文件维护）：

| Phase | Status | Start | End | PR |
|-------|--------|-------|-----|-----|
| Phase 0 | ✅ Done | Day 1 | Day 1 | - |
| Phase 1 | ✅ Done | Day 2 | Day 3 | - |
| Phase 2 | ✅ Done | Day 4 | Day 5 | - |
| Phase 3 | ✅ Done | Day 6 | Day 7 | - |
| Phase 4 | ✅ Done | Day 6 | Day 7 | - |
| Phase 5 | ✅ Done | Day 8 | Day 8 | - |

状态值：⬜ Not Started → 🔄 In Progress → ✅ Done → ⚠️ Blocked

---

### 测试策略

POC 阶段以**手动集成测试**为主，不追求测试覆盖率。核心逻辑写单元测试。

| 测试级别 | 什么 | 什么时候写 | 工具 |
|---------|------|-----------|------|
| **单元测试** | 消息协议转换、Annotation 序列化、prompt 生成 | 对应 Phase 完成后补 | Vitest |
| **集成测试** | Pi RPC 通信闭环、Screenshot 工具端到端 | Phase 1/2 完成后 | 手动 + Vitest |
| **E2E 验证** | 每个 Phase 的验证场景 | 每个 Phase 结束 | 手动 |

**必须写单元测试的模块**：
- `message.ts` — ContentBlock 类型解析、AgentSessionEvent → ContentBlock 转换
- `annotationToPrompt()` — 标注 → 自然语言转换
- `PiBridge` — 命令发送/事件解析（mock stdin/stdout）

**不写测试的模块**：
- React 组件渲染（POC 阶段不值得）
- Electron IPC（集成性质，手动验证）
- Fabric.js 交互（视觉性质，手动验证）

**测试命令**：
```bash
npm run test          # Vitest 单元测试
npm run test:watch    # 监听模式
npm run test:e2e      # Phase 5 的端到端手动验证脚本
```

---

### 质量门槛 (Quality Gates)

每个 Phase 合入 main 前必须通过以下门槛：

**Gate 1：功能验证**
- 该 Phase 所有 checklist 项已完成 `[x]`
- 该 Phase 的验证场景手动通过
- 无阻塞性 bug（允许已知小问题记录到 TODO）

**Gate 2：代码质量**
- TypeScript 编译无错误（`tsc --noEmit`）
- ESLint 无 error（warning 允许）
- 无 `as any`、`@ts-ignore`、空 catch block
- 新增模块有对应的类型定义

**Gate 3：非功能性**
- Electron 启动时间 < 5s（冷启动）
- 对话流渲染无卡顿（50 条消息内滚动流畅）
- 图片加载不阻塞 UI
- Pi 进程 crash 后可恢复

**Gate 4：文档**
- 新增 IPC method 有注释说明
- 消息协议变更已更新 `message.ts` 注释
- Phase PR 描述记录了关键设计决策

**Phase-specific 门槛**：

| Phase | 额外验证 |
|-------|---------|
| Phase 0 | `npm run dev` 一键启动，HMR 生效 |
| Phase 1 | 发 prompt → 收到 Pi 回复 → 渲染到 GUI，延迟 < 3s |
| Phase 2 | 截图工具调用到图片显示 < 5s；图片内嵌不破坏布局 |
| Phase 3 | 标注 → agent 理解，闭环验证通过；标注坐标归一化正确 |
| Phase 4 | extension_ui_request 三种类型都能渲染和回传 |
| Phase 5 | 3 个核心场景全部跑通，无 crash |

**阻塞处理**：
- 任何 Gate 不通过 → 不合入 main，在 Phase 分支上修复
- 连续 2 次修复失败 → 记录问题，降级为 known issue，继续下一 Phase
- 外部依赖问题（Pi bug、Playwright 兼容性）→ 记录 workaround，不阻塞进度

---

## Out of Scope (POC 不做)

- 多 session 管理 / session 历史
- Diff 滑块对比（Phase 3 做标注即可，diff 是下一步）
- 模型切换 UI
- 主题系统
- 打包分发（开发模式跑就行）
- 多 agent 并行
- 语音/音频支持
- VS Code 集成

## Success Criteria

POC 成功 = 以下 3 个场景能跑通：

1. **内嵌图片渲染**：agent 截图后，图片内嵌在对话流中，可缩放/全屏查看
2. **标注闭环**：用户在图片上画圈 + 写字 → agent 理解标注并响应
3. **交互选择**：agent 展示选项卡片 → 用户点击 → agent 收到反馈继续工作

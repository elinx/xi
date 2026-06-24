# Conductor（Melty Labs）完整复刻级界面&产品描述
## 一、产品基础定位
Conductor 是**macOS 专属原生桌面AI编程工具**，核心能力是并行调度多组Claude Code / OpenAI Codex编码Agent，每个Agent拥有完全隔离的独立Git工作树（worktree），互不污染主代码仓库，支持同时跑多个代码实验、并行开发需求，内置完整代码评审、终端、实时预览、差异对比流程，替代传统IDE单线程AI辅助模式。
整体UI为**深色暗黑主题（炭黑底色+低饱和灰阶分区）**，macOS标准原生窗口布局，三栏固定分割面板，极简工程向设计，无多余装饰，功能模块分区清晰。

## 二、全局窗口基础（复刻必备顶层元素）
1. **macOS标准标题栏（最顶部）**
    - 左上角：Mac traffic light 三色圆点（红关闭/黄最小化/绿全屏），右侧跟随窗口图标（极简矩形代码图标）
    - 中间窗口标题：`Quickstart › 1. Start here`，左右配前进/后退箭头导航按钮
    - 右上角：小正方形窗口分屏按钮
2. **全局主题色规范**
    - 背景：#16181d 纯炭黑
    - 侧边栏底色：#1e2026
    - 高亮主色：薄荷绿 #36d399（PR、运行状态、变更行数标记）
    - 文字主色：#e5e7eb，次要文字 #9ca3af
    - 气泡对话框：#272a32 深灰圆角弹窗
    - 标签/按钮：#2a2d33 悬浮提亮 #343840
    - 分割线：#2c2f36 细灰线

## 三、三栏面板完整拆解（从左→右，逐像素复刻结构）
### 左栏：Workspaces 工作区侧边栏（固定窄竖栏）
顶部固定模块：
- 顶部标签：`History` 文字标题
- 分区标题：`Workspaces`，右侧配套4个图标按钮：筛选、预览、新建工作区、折叠面板
工作区列表（纵向条目，每条包含）：
1. 分组标题：`Quickstart 3`
2. 工作区条目1：
   - 序号标识：`.:: 1. Start here`
   - 状态标签：绿色小叶子图标 + `preview` 预览就绪标记
3. 工作区条目2：
   - 序号标识：`.:: 2. Run a parall...`
   - 状态标签：绿色叶子 + `night...`
4. 工作区条目3：
   - 序号标识：`℘ 3. Next steps`
   - 云图标标记
底部无额外元素，列表可垂直滚动。

### 中间主面板：Agent Chat + 文档标签页（窗口核心区域）
#### 1. 顶部文档Tab栏（横向标签）
- 标签1：`Start here`（当前激活，底部白色下划线高亮）
- 标签2：`App.tsx`
- 标签3：`Terminal`
每个Tab左侧配对应小图标，Tab右侧有折叠/关闭控件。

#### 2. 主体聊天对话流（上下两条AI对话气泡，气泡为圆角深色悬浮框）
##### 第一条用户指令气泡（上方）
气泡内文字：`Show me how Conductor handles this project.`
下方AI回复文本块：
```
Conductor is a Mac app for running coding agents in parallel. I'll use one isolated workspace for this task: its own branch, files, chat, terminal, preview, and reviewable diff.

1. Send the drafted task.
2. Run the app with ⌘R.
3. Review the diff before you keep it.
```
附带文件操作列表（带文件图标）：
- Read README.md
- Read .conductor/settings.toml
- Read src/App.tsx

##### 第二条用户指令气泡（中间）
气泡内文字：`Add a 10-train milestone animation.`
下方AI完成回复文本块：
```
Done. I changed the train app in this workspace, kept the preview running, and ran lint. The code is isolated from main until you review it in the diff viewer.
```
附带文件修改列表（更新图标）：
- Update src/App.tsx
- Update src/App.css

#### 3. 底部输入Composer区域（对话输入框）
1. 大输入框：灰色占位文字 `Add a follow-up, attach files, or start another agent...`
2. 左下角模型选择栏：
   - `GPT-5.5` 下拉选择器
   - `Fast` / `High` 速度档位切换按钮
   - 文档附件图标
3. 右下角：发送向上箭头按钮 + 加号附件按钮

### 右栏：PR/变更 + 终端分栏（垂直二分右侧面板，顶部PR区、底部终端区）
#### 右上分区：Pull Request & 代码变更面板（顶部绿色标题栏）
1. 顶部绿色标题栏：
   - 左侧PR编号标签：`PR #1432`
   - 状态文字：`Ready for review`
   - 右上角按钮：`Create PR`
2. 子标签页（横向切换）：`All files` / `Changes 2` / `Checks` / `Review`
3. Changes 文件变更列表（绿色数字标记增删行数）：
   - src/App.tsx ｜ +12 绿色方块
   - src/App.css ｜ +31 绿色方块

#### 右下分区：Terminal 终端运行面板
1. 终端顶部控制栏：
   - 折叠下拉 `Setup`
   - 状态圆点：绿色 `Run`
   - 加号新建终端Tab
   - 右侧 `Stop` 停止按钮
2. 终端输出文本（命令行日志，浅绿色成功高亮）：
```
$ npm run dev
> welcome-to-conductor@0.0.0 dev
> vite

Preview ready
ready in 426ms
watching src/App.tsx and src/App.css
```
`Preview ready` 整行使用薄荷绿高亮文字，其余终端输出浅灰常规文字。

## 四、核心产品功能逻辑（复刻功能层必须实现）
1. **隔离并行工作区**
   每个左侧Workspace对应独立Git分支/工作树，AI Agent操作完全隔离主项目，不会污染本地代码，多任务并行互不干扰。
2. **AI Agent对话驱动编码**
   中间聊天面板作为操作入口，自然语言下发需求，AI自动读取/修改项目文件，自动记录文件读写操作（Read/Update 文件列表）。
3. **内置完整开发流水线**
   - 内置终端：执行npm、vite等执行npm、vite等本地dev命令，实时输出日志
   - 实时预览：启动前端开发服务，监控源文件变更
   - Diff代码评审：右侧面板实时展示所有文件改动行数、变更清单，支持PR创建、代码Review
4. **本地代码安全**
   所有代码、终端运行完全在本地Mac执行，仅将指令/代码片段上传AI模型，完整项目不对外传输。
5. **多模型调度**
   底部Composer支持切换GPT/Claude系列模型，Fast/High档位控制推理速度与精度。

## 五、交互细节（复刻UI微交互要点）
1. 对话气泡悬浮阴影、圆角8px，和主面板背景分层；
2. 文件操作条目左侧区分Read/Update图标，绿色数字代表新增代码行数；
3. 运行状态、PR就绪状态统一使用薄荷绿作为成功提示色；
4. macOS原生窗口滚动条、Tab切换下划线高亮、按钮悬浮提亮；
5. 终端输出关键词（Preview ready）文字变色高亮，区分普通日志；
6. 工作区条目带状态标签（preview运行中），直观展示Agent当前进度。

## 六、技术栈参考（复刻开发参考）
- 桌面端：macOS原生Rust/Tauri桌面应用（Conductor官方为本地原生客户端）
- 前端界面：React/TSX + CSS-in-JS 深色主题UI框架
- 内置终端：PTY虚拟终端，复刻iTerm风格命令行输出
- Git底层：自动管理git worktree，实现多分支隔离工作区
- AI对接：OpenAI / Anthropic API 多模型切换调度
- 代码Diff：内置轻量代码差异渲染器，展示文件增删变更

如果你需要，我可以进一步输出：
1. 完整UI组件拆分清单（每个按钮/卡片尺寸、圆角、色值）
2. 前端复刻代码（React+Tailwind 暗黑界面模板）
3. 产品功能流程图（从创建工作区→下发指令→运行预览→评审合并完整流程）
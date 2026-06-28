# Xi 项目目录结构

## 概览

Xi 是一个基于 Electron + React + TypeScript 的 AI 编码工具，采用 electron-vite 构建。

```
xi/
├── src/                    # 源代码
│   ├── main/               # Electron 主进程
│   ├── preload/            # Electron 预加载脚本
│   ├── renderer/           # 渲染进程（React 前端）
│   └── shared/             # 主进程与渲染进程共享的代码
├── build/                  # 构建资源（图标等）
├── docs/                   # 文档
├── scripts/                # 脚本工具
├── spec/                   # 规格说明
├── test/                   # 测试文件
├── demo/                   # 演示文件
├── package.json            # 项目配置与依赖
├── electron.vite.config.ts # electron-vite 构建配置
├── tsconfig.json           # TypeScript 基础配置
├── tsconfig.node.json      # Node 环境 TS 配置（主进程）
├── tsconfig.web.json       # Web 环境 TS 配置（渲染进程）
└── README.md               # 项目说明
```

## src/main/ — 主进程

Electron 主进程，负责窗口管理、系统集成和后台服务。

| 文件 | 职责 |
|---|---|
| `index.ts` | 应用入口，窗口创建、生命周期管理 |
| `pi-sdk-bridge.ts` | PI SDK 桥接层，主进程与 AI Agent 通信 |
| `pi-worker.ts` | PI Agent 工作线程 |
| `session-service.ts` | 会话管理服务 |
| `worker-manager.ts` | Worker 进程管理器 |

## src/preload/ — 预加载脚本

| 文件 | 职责 |
|---|---|
| `index.ts` | 在渲染进程加载前注入安全 API |

## src/renderer/ — 渲染进程

React 前端应用。

```
renderer/
├── index.html              # HTML 入口
└── src/
    ├── main.tsx            # React 应用入口
    ├── App.tsx             # 根组件
    ├── env.d.ts            # 环境类型声明
    ├── assets/             # 静态资源
    │   └── main.css        # 全局样式
    ├── components/         # UI 组件（35+ 个）
    ├── hooks/              # 自定义 React Hooks（13 个）
    ├── types/              # TypeScript 类型定义
    └── utils/              # 工具函数
```

### components/ — UI 组件

| 组件 | 职责 |
|---|---|
| `ChatView.tsx` | 聊天主视图 |
| `InputBar.tsx` | 输入栏 |
| `SessionSidebar.tsx` | 会话侧边栏 |
| `LeftPanel.tsx` / `RightPanel.tsx` | 左右面板容器 |
| `TabBar.tsx` | 标签栏 |
| `CommandPalette.tsx` | 命令面板（cmdk） |
| `DiffViewer.tsx` | 代码差异查看器 |
| `FileTree.tsx` / `FileViewer.tsx` | 文件树与文件查看 |
| `FileMentionDropdown.tsx` | 文件提及下拉 |
| `GitPanel.tsx` / `GitLogList.tsx` / `CommitDetailInline.tsx` | Git 面板 |
| `ImageAnnotator.tsx` | 图片标注器 |
| `McpPanel.tsx` | MCP 面板 |
| `ModelSelector.tsx` | 模型选择器 |
| `PromptInspector.tsx` | Prompt 检查器 |
| `QuoteCard.tsx` | 引用卡片 |
| `SearchPanel.tsx` | 搜索面板 |
| `SettingsPanel.tsx` / `GeneralSettings.tsx` / `ProviderSetup.tsx` | 设置面板 |
| `SkillsPanel.tsx` / `SkillBlockRenderer.tsx` / `SkillMentionDropdown.tsx` / `SkillViewer.tsx` | 技能相关 |
| `TerminalPane.tsx` | 终端面板（xterm） |
| `TodoPanel.tsx` | Todo 面板 |
| `TokenUsageBar.tsx` / `TokenUsageRing.tsx` | Token 用量显示 |
| `ToolsPanel.tsx` | 工具面板 |
| `TreeGraph.tsx` | 树状图 |
| `ChatContextMenu.tsx` | 聊天右键菜单 |
| `ForkAskDialog.tsx` | Fork 询问对话框 |
| `QuestionDialog.tsx` | 问题对话框 |
| `WelcomeDialog.tsx` | 欢迎对话框 |
| `ActionBlockRenderer.tsx` | 操作块渲染 |
| `SessionMentionDropdown.tsx` | 会话提及下拉 |

### hooks/ — 自定义 Hooks

| Hook | 职责 |
|---|---|
| `useCommandRegistry.ts` | 命令注册 |
| `useFileIndex.ts` | 文件索引 |
| `useFileMention.ts` | 文件提及 |
| `useInputDraft.ts` | 输入草稿 |
| `useLayoutStore.ts` | 布局状态 |
| `usePiRpc.ts` | PI RPC 调用 |
| `useSessionCache.ts` | 会话缓存 |
| `useSessionManager.ts` | 会话管理 |
| `useSessionMention.ts` | 会话提及 |
| `useSkillMention.ts` | 技能提及 |
| `useSkillStore.ts` | 技能状态 |
| `useTabStore.ts` | 标签状态 |
| `useTheme.ts` | 主题管理 |

### types/ — 类型定义

| 文件 | 职责 |
|---|---|
| `git.ts` | Git 相关类型 |
| `message.ts` | 消息类型 |
| `pi-events.ts` | PI 事件类型 |
| `session.ts` | 会话类型 |

### utils/ — 工具函数

| 文件 | 职责 |
|---|---|
| `compact-view.ts` | 紧凑视图处理 |
| `convert-messages.ts` | 消息格式转换 |
| `session-utils.ts` | 会话工具函数 |

## src/shared/ — 共享代码

| 文件 | 职责 |
|---|---|
| `summary-prompt.ts` | 会话摘要 Prompt |

## 技术栈

- **框架**: Electron 35 + React 19 + TypeScript 5
- **构建**: electron-vite 3 + Vite
- **样式**: Tailwind CSS 4
- **状态管理**: Zustand 5
- **终端**: xterm.js 6
- **代码高亮**: Shiki 4
- **Markdown**: react-markdown 10 + remark-gfm 4 + rehype-raw 7
- **Git**: simple-git 3
- **测试**: Vitest 4 + Playwright 1

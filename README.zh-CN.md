# Xi /ξ/ 溪

<p align="center">
  <img src="build/icon/512.png" width="128" height="128" alt="Xi Logo">
</p>

<p align="center">
  <strong>Session as Branch — 面向未来的 AI 编码工具</strong>
</p>

<p align="center">
  中文 | <a href="./README.md">English</a>
</p>

---

## 为什么是 Xi？

当前的 AI 编码工具都共享一个假设：**单一 session + 不断压缩上下文**。你对话，上下文满了，摘要压缩，然后继续——一条直线，永远如此。

我们认为这种模式终将过时。当上下文窗口趋近无限，正确的模型不是"压缩再继续"——而是**分支与切换**。

**Session 才是第一公民。**

Xi 管理 session 的方式，就像 git 管理 branch：

| Git | Xi |
|-----|-----|
| `git branch` | 创建新 session |
| `git checkout` | 切换到另一个 session |
| `git merge` | 合并另一个 session 的上下文 |
| `git log` | 浏览 session 历史 |
| `git rebase` | 从对话任意点 fork |

当上下文无限时，你不需要压缩——你需要**分叉**。每次分叉就是一个 session，每个 session 就是一条思维的分支。Xi 让这一切变得自然。

## 名字的由来

**Xi**（ξ）——希腊字母表第 14 个字母，发音 /shee/。

中文**溪**（xī）意为**溪流**——水流在地形中自然分岔。这不是巧合：

```
源头 ●
       \
        ●── ξ ──●  主 session
       /          \
      ●            ●  分支 session
```

- **溪**（stream）——水流前行，自然分岔
- **分支**（branch）——每个分岔是一个 session，每个 session 是一条思维的支流
- **ξ**——这个字母本身的三横两竖结构，天然就是"分叉"的视觉符号

Xi = 溪 = 分支 = session。

## 功能特性

- **Session 分支** — 在对话任意位置 fork，如同 `git checkout -b`
- **Session 侧边栏** — 可视化 session 树形结构，即时切换
- **Token 用量环** — 实时上下文窗口消耗一目了然
- **多种视图模式** — 完整 / Turn / Outline 视图，适应不同阅读方式
- **基于 [Pi](https://github.com/earendil-works/pi-coding-agent)** — 由 Pi 编码代理 SDK 驱动

## 技术栈

- **Electron** + **React 19** + **TypeScript**
- **Tailwind CSS v4** 样式
- **Pi SDK**（`@earendil-works/pi-coding-agent`）AI 运行时
- **electron-vite** 构建工具

## 项目结构

```
xi/
├── src/
│   ├── main/               # Electron 主进程
│   │   ├── index.ts        # 应用入口，窗口与 IPC
│   │   ├── pi-sdk-bridge.ts # Pi SDK 通信层
│   │   ├── pi-worker.ts    # Pi 工作线程
│   │   └── session-service.ts # Session 文件管理
│   ├── preload/            # Electron preload 脚本
│   │   └── index.ts
│   └── renderer/           # React 前端
│       ├── index.html
│       └── src/
│           ├── App.tsx     # 主应用组件
│           ├── components/ # UI 组件
│           ├── hooks/      # React hooks
│           ├── types/      # TypeScript 类型
│           └── utils/      # 工具函数
├── build/
│   └── icon/               # 应用图标源文件与生成产物
│       ├── icon.svg        # 矢量源
│       └── generate-icons.mjs # 图标生成脚本
├── docs/                   # 设计规格与文档
└── test/                   # 测试文件
```

## 快速开始

### 环境要求

- Node.js ≥ 18
- npm

### 安装与运行

```bash
npm install
npm run dev
```

### 构建

```bash
npm run build
```

### 图标生成

修改 `build/icon/icon.svg` 后执行：

```bash
node build/icon/generate-icons.mjs
```

## 文档

| 文档 | 说明 |
|------|------|
| [图标设计规范](docs/icon-design-spec.md) | 图标设计理念与视觉规范 |
| [Session 管理规范](docs/session-management-spec.md) | Session 分支架构 |
| [侧边栏规范](docs/sidebar-spec.md) | Session 侧边栏设计 |
| [Token 用量规范](docs/token-usage-spec.md) | 上下文窗口可视化 |
| [紧凑视图规范](docs/compact-view-spec.md) | 消息视图模式 |
| [搜索规范](docs/search-spec.md) | 搜索功能设计 |

## 理念

> 上下文稀缺时，你压缩。上下文无限时，你分支。
>
> Xi 相信 AI 编码的未来不是一条长长的线——而是一棵对话树，每一条分支都活着、都可回溯，都是你可以重返的思维支流。
>
> 如同溪水在地形中分出细流，每一条都找到自己的路径。

## 许可

私有项目 — 保留所有权利。

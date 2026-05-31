# Xi /ξ/ 溪

<p align="center">
  <img src="build/icon/512.png" width="128" height="128" alt="Xi Logo">
</p>

<p align="center">
  <strong>Session as Branch — 面向未来的 AI 编码工具</strong>
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a> | English
</p>

---

## Why Xi?

The current generation of AI coding tools all share one assumption: **a single session with a compacting context**. You chat, the context fills up, it gets summarized, and you keep going — one linear thread, forever.

We believe this will become obsolete. As context windows approach infinity, the right model is not "compress and continue" — it's **branch and switch**.

**Session is the first-class citizen.**

Xi manages sessions the way git manages branches:

| Git | Xi |
|-----|-----|
| `git branch` | Create a new session |
| `git checkout` | Switch to another session |
| `git merge` | Merge context from another session |
| `git log` | Browse session history |
| `git rebase` | Fork from any point in conversation |

When context is infinite, you don't compact — you **fork**. Each fork is a session. Each session is a branch of thought. Xi makes this natural.

## The Name

**Xi** (ξ) — the 14th letter of the Greek alphabet, pronounced /shee/.

The Chinese character **溪** (xī) means **stream** — a body of water that naturally forks into branches as it flows through terrain. This is no coincidence:

```
Source ●
        \
         ●── ξ ──●  Main session
        /          \
       ●            ●  Branched session
```

- **Stream** (溪) — water flowing, naturally forking
- **Branch** (分支) — every fork is a session, every session is a branch of thought
- **ξ** — the letter itself has a three-bar, two-stem structure that visually embodies forking

Xi = stream = branch = session.

## Features

- **Session branching** — Fork any conversation at any point, like `git checkout -b`
- **Session sidebar** — Visual tree of all sessions, switch instantly
- **Token usage ring** — Real-time context window consumption at a glance
- **Multiple view modes** — Full / Turn / Outline views for different reading styles
- **Built on [Pi](https://github.com/earendil-works/pi-coding-agent)** — Powered by the Pi coding agent SDK

## Tech Stack

- **Electron** + **React 19** + **TypeScript**
- **Tailwind CSS v4** for styling
- **Pi SDK** (`@earendil-works/pi-coding-agent`) as the AI runtime
- **electron-vite** for build tooling

## Project Structure

```
xi/
├── src/
│   ├── main/               # Electron main process
│   │   ├── index.ts        # App entry, window & IPC setup
│   │   ├── pi-sdk-bridge.ts # Pi SDK communication layer
│   │   ├── pi-worker.ts    # Worker thread for Pi
│   │   └── session-service.ts # Session file management
│   ├── preload/            # Electron preload script
│   │   └── index.ts
│   └── renderer/           # React frontend
│       ├── index.html
│       └── src/
│           ├── App.tsx     # Main application component
│           ├── components/ # UI components
│           ├── hooks/      # React hooks
│           ├── types/      # TypeScript types
│           └── utils/      # Utilities
├── build/
│   └── icon/               # App icon source & generated assets
│       ├── icon.svg        # Vector source
│       └── generate-icons.mjs # Icon generation script
├── docs/                   # Design specs & documentation
└── test/                   # Test files
```

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm

### Install & Run

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

### Icon Generation

After modifying `build/icon/icon.svg`:

```bash
node build/icon/generate-icons.mjs
```

## Documentation

| Document | Description |
|----------|-------------|
| [Icon Design Spec](docs/icon-design-spec.md) | Icon design philosophy & visual specifications |
| [Session Management Spec](docs/session-management-spec.md) | Session branching architecture |
| [Sidebar Spec](docs/sidebar-spec.md) | Session sidebar design |
| [Token Usage Spec](docs/token-usage-spec.md) | Context window visualization |
| [Compact View Spec](docs/compact-view-spec.md) | Message view modes |
| [Search Spec](docs/search-spec.md) | Search functionality design |

## Philosophy

> When context is scarce, you compress. When context is infinite, you branch.
>
> Xi believes the future of AI coding is not one long thread — it's a tree of conversations, each alive and resumable, each a branch of thought you can return to.
>
> Like a stream that forks into rivulets, each finding its own path through the terrain.

## License

Private — All rights reserved.

# Split Config Storage Spec

## 1. Overview

将 Xi 的配置存储分为两层：用户级（全局）和项目级（本地），解决切换项目时 provider/model 配置丢失的问题。

**核心问题**：当前 `PI_CODING_AGENT_DIR` 指向 `{project}/.xi/`，导致 Pi SDK 的 auth/models/settings 等配置文件从项目目录读取。用户切换到新项目后，所有 provider 配置（API Key、自定义模型等）消失，需重新配置。

**目标**：
- Provider 配置（API Key、模型列表、settings）→ 用户全局目录 `~/.xi/`，配置一次全局生效
- Session 数据（会话记录、对话历史）→ 项目目录 `{project}/.xi/sessions/`，随项目自然分离

## 2. 现状分析

### 2.1 当前存储架构

| 数据 | 存放位置 | 读取方式 |
|------|---------|---------|
| `auth.json`, `models.json`, `settings.json` | `~/.xi/` → symlink 到 `{project}/.xi/` | Pi SDK 通过 `getAgentDir()` → 读 `PI_CODING_AGENT_DIR` |
| Session JSONL 文件 | `{project}/.xi/sessions/` | Xi 通过 `session-service.ts` 独立管理 |
| `last-session.json` | `{project}/.xi/sessions/` | `session-service.ts` |
| `tools/`, `prompts/`, `themes/`, `extensions/` | `~/.xi/` → symlink 到 `{project}/.xi/` | Pi SDK 通过 `getAgentDir()` |

### 2.2 问题根源

`pi-sdk-bridge.ts` 第 69-73 行：

```ts
const localAgentDir = join(resolvedCwd, '.xi')
process.env.PI_CODING_AGENT_DIR = localAgentDir
this.linkGlobalAgentConfig(localAgentDir)  // symlink 补丁
```

- `PI_CODING_AGENT_DIR` 指向项目目录 → Pi SDK 从项目目录读配置
- `linkGlobalAgentConfig()` 用 symlink 把 `~/.xi/` 的文件链到项目目录来弥补
- Symlink 只在目标文件不存在时创建 → 项目目录已有旧文件时不覆盖，全局配置失效
- `registerCustomProvider` 写入 `{project}/.xi/models.json` → 其他项目看不到
- 切换项目后 `PI_CODING_AGENT_DIR` 变了 → 配置丢失

### 2.3 Pi SDK 的两层分离机制

Pi SDK 已经设计了两层分离：

| 数据 | Pi SDK 读取路径 | 环境变量 |
|------|----------------|---------|
| 配置 (auth/models/settings) | `getAgentDir()` | `PI_CODING_AGENT_DIR` |
| Session 文件 | `SessionManager` 构造时的 `sessionDir` 参数 | `PI_CODING_AGENT_SESSION_DIR` |

关键代码（Pi SDK `session-manager.js`）：

```js
static create(cwd, sessionDir, options) {
    const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
    // 如果显式传了 sessionDir，就用传入的；否则用 agentDir 下的默认路径
}

static continueRecent(cwd, sessionDir) {
    const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
    // ...
}
```

当不传 `sessionDir` 时，Pi SDK 用 `getDefaultSessionDir(cwd)` → `{agentDir}/sessions/{encoded-cwd}/`。

## 3. 改动方案

### 3.1 `pi-sdk-bridge.ts` — 全局 agentDir + 项目级 sessionDir

```diff
 async start(cwd: string, sessionPath?: string): Promise<void> {
   // ...
   const resolvedCwd = resolve(cwd)
-  const localAgentDir = join(resolvedCwd, '.xi')
-  if (!existsSync(localAgentDir)) {
-    mkdirSync(localAgentDir, { recursive: true })
-  }
-  process.env.PI_CODING_AGENT_DIR = localAgentDir
-  this.linkGlobalAgentConfig(localAgentDir)
+  const globalAgentDir = join(
+    process.env.HOME ?? process.env.USERPROFILE ?? '~',
+    '.xi'
+  )
+  if (!existsSync(globalAgentDir)) {
+    mkdirSync(globalAgentDir, { recursive: true })
+  }
+  process.env.PI_CODING_AGENT_DIR = globalAgentDir
+
+  const sessionDir = join(resolvedCwd, '.xi', 'sessions')
+  if (!existsSync(sessionDir)) {
+    mkdirSync(sessionDir, { recursive: true })
+  }
+  process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir

   const child = utilityProcess.fork(workerPath, [], {
     // ...
   })

-  child.postMessage({ type: 'init', data: { cwd, sessionPath } })
+  child.postMessage({ type: 'init', data: { cwd, sessionPath, sessionDir } })
 }
```

同时**删除** `linkGlobalAgentConfig()` 方法、`LINKED_FILES` 常量、`LINKED_DIRS` 常量。不再需要 symlink。

### 3.2 `pi-worker.ts` — 显式传入 sessionDir

```diff
 interface WorkerInit {
   cwd: string
   sessionPath?: string
+  sessionDir?: string
 }
```

```diff
 let sm: pi.SessionManager
 if (data.sessionPath) {
-  sm = pi.SessionManager.open(data.sessionPath)
+  sm = pi.SessionManager.open(data.sessionPath, data.sessionDir)
 } else {
-  sm = pi.SessionManager.continueRecent(data.cwd)
+  sm = pi.SessionManager.continueRecent(data.cwd, data.sessionDir)
 }
```

确保 Pi SDK 的 SessionManager 使用项目目录下的 session 路径，而非 agentDir 下的默认路径。

### 3.3 `session-service.ts` — getSessionDir 不再依赖 PI_CODING_AGENT_DIR

```diff
 export function getSessionDir(cwd?: string): string {
   const projectRoot = cwd ?? process.cwd()
   const resolvedCwd = resolve(projectRoot)
-  const agentDir = cwd ? join(resolvedCwd, '.xi') : (process.env.PI_CODING_AGENT_DIR || join(resolvedCwd, '.xi'))
-  const safePath = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
-  const sessionDir = join(agentDir, 'sessions', safePath)
+  const sessionDir = join(resolvedCwd, '.xi', 'sessions')
   if (!existsSync(sessionDir)) {
     mkdirSync(sessionDir, { recursive: true })
   }
   return sessionDir
 }
```

当前 `safePath` 编码是因为 session 目录在全局 `.xi/` 下需要区分不同项目。session 目录已在项目内，不需要路径编码。

### 3.4 `index.ts` — fallback 路径统一使用 `~/.xi/`

`registerCustomProvider`、`provider:listCustomProviders`、`provider:getConfig` 等 IPC handler 中的 fallback 路径：

```diff
 // registerCustomProvider
- const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.cwd(), '.xi')
+ const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
```

```diff
 // provider:listCustomProviders
- const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.cwd(), '.xi')
+ const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
```

`app:openConfigDir` 更新：

```diff
 ipcMain.on('app:openConfigDir', () => {
-  const configDir = join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.pi', 'agent')
+  const configDir = join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xi')
   // ...
 })
```

## 4. 改动后存储架构

```
~/.xi/                                    ← 用户级全局配置 (PI_CODING_AGENT_DIR)
  auth.json                                 Provider API Keys
  models.json                               模型列表、自定义 Provider
  settings.json                             全局设置
  tools/                                    自定义工具
  prompts/                                  Prompt 模板
  themes/                                   主题
  extensions/                               扩展
  bin/                                      托管二进制 (fd, rg)

{project}/.xi/                             ← 项目级数据
  sessions/                                 Session 文件 (PI_CODING_AGENT_SESSION_DIR)
    2026-06-09_xxx.jsonl
    last-session.json
```

## 5. 迁移兼容

### 5.1 旧项目已有 `{project}/.xi/auth.json` 等文件

新方案不再读项目目录的这些文件。需提供一次性迁移：

在 `pi-sdk-bridge.ts` 的 `start()` 方法中，迁移逻辑在设置 `PI_CODING_AGENT_DIR` 之后、fork worker 之前执行：

```
对每个配置文件 (auth.json, models.json, settings.json):
  如果 {project}/.xi/{file} 存在 且是真实文件（非 symlink） 且 ~/.xi/{file} 不存在:
    复制 {project}/.xi/{file} → ~/.xi/{file}
    记录日志: "Migrated {file} from project to global config"
```

注意：不删除项目目录下的原文件，避免用户降级后丢失数据。

### 5.2 旧项目已有 symlink

`linkGlobalAgentConfig()` 创建的 symlink 在新方案下不再需要，但不会造成问题——Pi SDK 现在直接读 `~/.xi/`，不再经过项目目录的 symlink。这些 symlink 可以在后续版本清理。

### 5.3 旧 session 路径格式

旧路径：`{project}/.xi/sessions/--Users-foo-project--/xxx.jsonl`
新路径：`{project}/.xi/sessions/xxx.jsonl`

`getSessionDir()` 改动后，`listSessions()` 等函数会在新路径下查找。需要处理旧 session 文件的迁移：

在 `getSessionDir()` 中：
- 新路径 `{project}/.xi/sessions/` 不存在，但旧路径 `{project}/.xi/sessions/--encoded-cwd--/` 存在时
- 将旧目录下的 `.jsonl` 文件移动到新路径
- 删除空的旧编码目录

## 6. 多项目并发

`PI_CODING_AGENT_DIR` 始终指向 `~/.xi/`，多个项目的 worker 读同一份全局配置——这是预期行为。

每个项目的 session 路径通过 `PI_CODING_AGENT_SESSION_DIR` 独立指向各自的项目目录，互不干扰。

## 7. 影响范围

| 文件 | 改动 |
|------|------|
| `src/main/pi-sdk-bridge.ts` | 修改 `start()`，删除 `linkGlobalAgentConfig()` 及相关常量，添加迁移逻辑 |
| `src/main/pi-worker.ts` | `WorkerInit` 增加 `sessionDir`，`SessionManager.open/continueRecent` 传入 `sessionDir` |
| `src/main/session-service.ts` | `getSessionDir()` 简化路径，添加旧路径迁移逻辑 |
| `src/main/index.ts` | fallback 路径统一，`app:openConfigDir` 更新 |

不涉及 renderer 侧改动。

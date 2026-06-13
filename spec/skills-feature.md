# Spec: Skills 功能完善

## Problem

Skills 功能目前只有最基础的"展示"能力——左侧面板可以列出扫描到的 skill 名称和描述。但存在以下核心缺陷：

1. **数据源不一致**：SkillsPanel 通过 main 进程独立扫描目录获取 skills 列表，与 pi-worker 中 `DefaultResourceLoader` 实际加载到 session 的 skills 是两套独立逻辑。用户通过 settings/packages 配置的 skills、`skillsOverride` 过滤后的 skills、扩展动态注册的 skills，面板上看不到或看不准。

2. **当前扫描路径有误**：`skills:list` handler 硬编码了 `~/.pi/agent/skills/`，但实际 agentDir 是 `~/.xi/`（通过 `PI_CODING_AGENT_DIR` 环境变量），全局 skills 应该在 `~/.xi/skills/`。切换到 worker 数据源后此问题自动修复。

3. **无法触发调用**：用户只能手动在输入框打 `/skill:name`，没有自动补全，没有点击触发，发现性极差。

4. **缺少详情查看**：点击 skill 条目无任何响应，用户无法了解 skill 的具体内容和使用方式。

5. **聊天渲染缺失**：`/skill:name` 展开后产生的 `<skill>` XML 块在聊天中作为纯文本渲染，没有 TUI 中 `SkillInvocationMessageComponent` 对应的可折叠渲染。

6. **不随项目切换刷新**：用户打开新目录后，SkillsPanel 仍显示旧项目的 project skills。

7. **诊断信息丢失**：`ResourceLoader` 加载 skills 时产生的诊断（名称不合规、描述缺失、命名冲突等）未暴露给 GUI。

8. **跨工具 skills 无法标识**：从 Claude Code (`~/.claude/skills`)、Codex (`~/.codex/skills`) 等其他 agent 工具加载的 skills，在面板上与 Xi 自有 skills 无法区分。

## Skills 目录与来源

### 目录位置

Xi 的 pi-worker 在启动时设置 `PI_CODING_AGENT_DIR=~/.xi`，这决定了全局目录。

Pi SDK 的 `DefaultResourceLoader` 在 `reload()` 时通过 `PackageManager` 自动发现 skills。完整路径如下：

| 目录 | sourceInfo | 说明 |
|------|-----------|------|
| `~/.xi/skills/` | `{ source: "auto", scope: "user", origin: "top-level" }` | Xi 全局 skills（由 `getAgentDir()/skills` 决定） |
| `~/.agents/skills/` | `{ source: "auto", scope: "user", origin: "top-level" }` | Agent Skills 标准全局目录 |
| `<cwd>/.pi/skills/` | `{ source: "auto", scope: "project", origin: "top-level" }` | 项目级 skills（`CONFIG_DIR_NAME=".pi"`，由 SDK package.json 硬编码） |
| `<cwd>/.agents/skills/` | `{ source: "auto", scope: "project", origin: "top-level" }` | 项目级标准目录 |

> ⚠️ **重要**：项目级 skills 目录是 `.pi/skills/`（不是 `.xi/skills/`），因为 `CONFIG_DIR_NAME` 从 SDK 的 `package.json` 的 `piConfig.configDir` 读取，硬编码为 `".pi"`。全局目录则通过 `PI_CODING_AGENT_DIR` 环境变量正确指向了 `~/.xi/`。
>
> 如果未来需要项目级也使用 `.xi/skills/`，需要修改 SDK 的 `package.json` 中 `piConfig.configDir` 为 `".xi"`，或向 SDK 提 feature 支持 `PI_CONFIG_DIR_NAME` 环境变量。**本 spec 不处理此问题**，项目级 skills 目录保持 `.pi/skills/`。

### 发现规则

在同一目录下：

- **子目录含 `SKILL.md`** → 识别为 skill，目录名作为 name fallback
- **根级 `.md` 文件** → 仅在 `~/.xi/skills/` 和 `<cwd>/.pi/skills/` 中作为独立 skill 发现；`~/.agents/skills/` 和 `.agents/skills/` 中根级 `.md` 被忽略
- **递归子目录** → 继续寻找含 `SKILL.md` 的子目录
- 遵循 `.gitignore` / `.ignore` / `.fdignore` 规则
- 跳过 `node_modules`

### 来源（Source）全览

除了上述默认目录，skills 还可以来自：

| 来源 | 配置方式 | sourceInfo | harness |
|------|----------|-----------|---------|
| Xi 全局自动发现 | 无需配置 | `{ source: "auto", scope: "user" }` | Xi |
| Xi 项目自动发现 | 无需配置 | `{ source: "auto", scope: "project" }` | Xi |
| `.agents/` 全局 | 无需配置 | `{ source: "auto", scope: "user" }` | Agent Skills |
| `.agents/` 项目 | 无需配置 | `{ source: "auto", scope: "project" }` | Agent Skills |
| settings.json `skills` 数组 | `{"skills": ["~/.claude/skills"]}` | `{ source: "local", scope: "user"/"project" }` | **由路径决定** |
| npm/git packages | `{"packages": ["some-pkg"]}` | 由 package-manager 决定，`origin: "package"` | Package |
| CLI `--skill` 参数 | `pi --skill ./my-skill` | `{ source: "cli", scope: "temporary" }` | CLI |
| Extensions 动态注册 | `extendResources({ skillPaths })` | 由 extension 定义 | Extension |
| SDK `skillsOverride` | 代码注入 | 自定义 | SDK |

### 跨工具 Skills 标识

通过 settings.json 加载的 Claude Code / Codex / OpenCode skills 的 `sourceInfo` 为 `{ source: "local", scope: "user" }`，与 Xi 自有的 `~/.xi/skills/` 下的 skills **sourceInfo 相同，无法区分**。

**解决方案**：通过 `skill.filePath`（或 `skill.baseDir`）的路径前缀推断来源工具（harness）：

```typescript
function inferHarness(filePath: string, baseDir: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const path = filePath.replace(/\\/g, '/')

  // Known harness directories (checked against home + path prefix)
  if (path.startsWith(`${home}/.claude/`)) return 'claude'
  if (path.startsWith(`${home}/.codex/`)) return 'codex'
  if (path.startsWith(`${home}/.opencode/`)) return 'opencode'
  if (path.startsWith(`${home}/.agents/`)) return 'agents'
  if (path.startsWith(`${home}/.xi/`)) return 'xi'
  if (path.startsWith(`${home}/.pi/`)) return 'pi'
  // Generic: any ~/.<name>/skills/ pattern
  const match = path.match(new RegExp(`^${home}/\\.([^/]+)/skills/`))
  if (match) return match[1]

  // Project-level
  // .agents/skills → Agent Skills standard
  if (path.includes('/.agents/skills/')) return 'agents'
  // .pi/skills → Xi project (CONFIG_DIR_NAME)
  if (path.includes('/.pi/skills/')) return 'xi'

  return 'unknown'
}
```

此推断在 renderer 端完成，不需要修改 SDK。

### Skills 最终如何进入 agent

完整链路：

```
DefaultResourceLoader.reload()
  → package-manager.resolve()          // 解析 packages + settings → skills paths + metadata
  → addAutoDiscoveredResources()       // 自动发现 ~/.xi/skills, ~/.agents/skills, .pi/skills, .agents/skills
  → mergePaths(cli, packages, settings, auto, additional)
  → loadSkills({ cwd, agentDir, skillPaths, includeDefaults: false })
      → loadSkillsFromDir(agentDir/skills, "user")          // ~already covered by auto-discovery
      → loadSkillsFromDir(cwd/CONFIG_DIR_NAME/skills, "project")  // ~already covered by auto-discovery
      → for each skillPath: loadSkillsFromDir / loadSkillFromFile  // settings + packages
  → skillsOverride(result)             // SDK 可过滤/替换
  → 挂 sourceInfo (从 metadataByPath / extensionSkillSourceInfos / 路径推断)
  → 写入 this.skills + this.skillDiagnostics

AgentSession.prompt("/skill:foo")
  → _expandSkillCommand(text)
    → resourceLoader.getSkills().skills.find(name === "foo")
    → readFileSync(skill.filePath)
    → 生成 <skill name="..." location="...">\n...\n</skill>
    → 替换原始文本

formatSkillsForPrompt(skills)           // 写入 system prompt
  → <available_skills><skill><name>...</name>...</skill></available_skills>
  → disableModelInvocation=true 的 skill 被排除
```

## SkillsPanel 设计

### 当前实现

```
┌─────────────────────────┐
│ Skills (3)        [🔄]  │  ← 标题 + 刷新按钮
├─────────────────────────┤
│ 🔧 brave-search  Global │  ← 名称 + scope 标签
│   Web search and...     │  ← 描述（截断）
├─────────────────────────┤
│ 🔧 pdf-tools     Global │
│   Extracts text...      │
├─────────────────────────┤
│ 🔧 my-skill     Project │
│   Custom project...     │
└─────────────────────────┘
```

- 数据来源：`window.api.listSkills()` → main 进程独立扫描 4 个目录（路径有误）
- scope 标签：硬编码 `Global` / `Project`
- 无点击交互、无详情、无调用触发
- 空状态：`No skills found. Add skills to ~/.pi/agent/skills/ or .pi/skills/`

### 新设计

#### 整体布局

```
┌──────────────────────────────────────────┐
│ Skills (5)                [🔄] [⚠️ 2]   │  ← 标题 + 刷新 + 诊断入口
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ 🌐 brave-search      [Claude] [▶ Use]│ │  ← harness 标签 + Use 按钮
│ │    Global                            │ │  ← scope
│ │    Web search and content extraction │ │  ← 描述
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ 🌐 playwright-cli    [Claude] [▶ Use]│ │
│ │    Global                            │ │
│ │    Automate browser interactions...  │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ 📊 slides           [Codex]  [▶ Use]│ │
│ │    Global                            │ │
│ │    Create, edit PowerPoint decks...  │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ 🔧 pdf-tools     🔒         [▶ Use] │ │  ← 🔒 = disableModelInvocation
│ │    Global · npm · pkg                │ │  ← source + origin
│ │    Extracts text and tables from PDF │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ ▼ 🔧 my-skill                [▶ Use]│ │  ← 展开状态
│ │    Project · local                   │ │
│ │    Custom project instructions       │ │
│ │ ┌──────────────────────────────────┐│ │
│ │ │  # My Skill                     ││ │  ← SKILL.md 内容（markdown）
│ │ │  ## Setup                       ││ │
│ │ │  Run once before first use:     ││ │
│ │ │  ```bash                        ││ │
│ │ │  npm install                    ││ │
│ │ │  ```                            ││ │
│ │ └──────────────────────────────────┘│ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

#### Harness 标签

通过 `inferHarness(filePath, baseDir)` 推断来源工具，在面板中显示为**有色标签**：

| harness | 显示文本 | 样式 |
|---------|----------|------|
| `"xi"` | `Xi` | `bg-violet-50 text-violet-600` |
| `"pi"` | `Pi` | `bg-violet-50 text-violet-600` |
| `"claude"` | `Claude` | `bg-orange-50 text-orange-600` |
| `"codex"` | `Codex` | `bg-green-50 text-green-600` |
| `"opencode"` | `OpenCode` | `bg-teal-50 text-teal-600` |
| `"agents"` | `Agents` | `bg-gray-100 text-gray-500` |
| `"npm"` / `"git"` | `npm` / `git` | `bg-gray-100 text-gray-500` |
| `"cli"` | `CLI` | `bg-amber-50 text-amber-600` |
| `"unknown"` | （不显示） | — |

标签出现在 skill 名称右侧、"Use" 按钮左侧。只有 `xi` 自有的 skills 不显示 harness 标签（因为面板本身就是 Xi 的），其他 harness 的标签都显示，让用户一眼看出这个 skill 来自哪个工具。

#### Scope 标签

简化为只显示 scope 维度：

| sourceInfo.scope | 显示文本 | 样式 |
|------------------|----------|------|
| `"user"` | `Global` | `bg-gray-100 text-gray-500` |
| `"project"` | `Project` | `bg-blue-50 text-blue-600` |
| `"temporary"` | `Temp` | `bg-amber-50 text-amber-600` |

不再显示 source 和 origin 文字标签（信息太细碎，harness 标签已经覆盖了用户关心的"它从哪来"）。但数据仍然从 worker 返回完整 sourceInfo，供未来需要时使用。

#### 🔒 disableModelInvocation 标记

当 `disableModelInvocation === true` 时：
- 在名称右侧显示 🔒 图标
- hover tooltip: "Only invokable via /skill:name command"
- 仍可点击 "Use" 触发，不会被禁用

#### 展开详情

- **点击条目** → 折叠/展开 SKILL.md 内容
- 展开时调用 `window.api.readSkill(filePath)` 获取 markdown 内容
- 内容区域用 markdown 渲染（复用现有的 markdown 渲染逻辑）
- 同一时间只展开一个 skill（手风琴模式）
- 展开状态由 `useSkillStore.expandedSkill` 管理

#### "Use" 按钮

- 点击 "Use" → 调用 `onInvokeSkill(skill.name)` prop
- App.tsx 中实现 `onInvokeSkill`：将 `/skill:<name> ` 注入 InputBar
- 注入方式：设置 InputBar 的编辑器文本，聚焦输入框

#### 诊断入口

- 标题栏 `[⚠️ N]` 显示诊断数量（N > 0 时）
- 点击弹出诊断列表弹窗，显示：
  - 类型（warning / error / collision）
  - 消息
  - 关联路径
  - collision 时显示 winner/loser 路径

#### 空状态

```
┌──────────────────────────────────────┐
│                                      │
│        No skills found.              │
│                                      │
│  Add skills via:                     │
│  • ~/.xi/skills/ (global)            │
│  • .pi/skills/ (project)             │
│  • settings.json "skills" array      │
│  • packages "skills/" directory      │
│                                      │
│  Or use skills from other tools:     │
│  • ~/.claude/skills (Claude Code)    │
│  • ~/.codex/skills (Codex)           │
│                                      │
│  Learn more about skills →           │  ← 链接到 docs
│                                      │
└──────────────────────────────────────┘
```

#### 数据流

```
SkillsPanel
  → useSkillStore.skills      (列表数据)
  → useSkillStore.diagnostics (诊断数据)
  → useSkillStore.fetchSkills()  (刷新)

useSkillStore.fetchSkills()
  → window.api.listSkills()
    → main: skills:list handler
      → workerManager.getPrimary().bridge.sendRpcCommand({ type: 'get_skills' })
        → pi-worker: resourceLoader.getSkills()
```

## Goal

让 Skills 成为一等公民功能：数据准确、可发现、可交互、有反馈、可区分来源工具。

## Scope

### ✅ In Scope

- Skills 数据源改为从 worker 获取（取代 main 进程独立扫描，同时修复路径错误）
- SkillsPanel harness 标签 + scope 标签 + 展开详情 + 调用触发 + 诊断展示
- 输入框 `/skill:` 自动补全
- Skill 调用的聊天可折叠渲染
- 项目切换时自动刷新

### ❌ Out of Scope

- 项目级 `.pi/skills/` → `.xi/skills/` 的改名（需要 SDK 支持 `CONFIG_DIR_NAME` 环境变量或修改 SDK package.json，不在本 spec 范围）
- Skill 创建/管理 UI 向导（后续 spec）
- `enableSkillCommands` 设置开关（后续 spec）
- Skill 热重载 / `reload_skills`（后续 spec）
- Skill 完整元数据（`allowed-tools`、`license`、`compatibility`）展示（后续 spec）
- SkillsPanel 搜索框（后续 spec）

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Renderer                                                │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ SkillsPanel   │  │ InputBar     │  │ ChatView      │ │
│  │ (list/detail) │  │ (/skill:补全)│  │ (skill块渲染) │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘ │
│         │                 │                   │          │
│         └────────┬────────┘───────────────────┘          │
│                  │                                       │
│         ┌────────▼────────┐                              │
│         │  useSkillStore   │  (new: zustand store)       │
│         │  + inferHarness()│                              │
│         └────────┬────────┘                              │
└──────────────────┼───────────────────────────────────────┘
                   │ IPC / Worker commands
┌──────────────────┼───────────────────────────────────────┐
│  Main Process    │                                       │
│         ┌────────▼────────┐                              │
│         │ skills:list      │  ← 从 worker 转发           │
│         │ skills:read      │  ← 新增：读取 SKILL.md 内容 │
│         └────────┬────────┘                              │
└──────────────────┼───────────────────────────────────────┘
                   │ sendRpcCommand
┌──────────────────┼───────────────────────────────────────┐
│  Pi Worker       │                                       │
│         ┌────────▼────────────────────────────────────┐  │
│         │ get_skills    → resourceLoader.getSkills()   │  │
│         │ read_skill    → fs.readFileSync(filePath)    │  │
│         └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

核心改变：**数据源从 main 进程独立扫描 → pi-worker `resourceLoader`**。现有 `skills:list` handler 的扫描逻辑将被移除，改为向 worker 发送 `get_skills` RPC 命令。这同时修复了 `~/.pi/agent/skills/` 的路径错误问题。

## Implementation Details

### 1. Pi Worker — 新增两个命令

在 `pi-worker.ts` 的 `handleCommand` switch 中新增两个 case：

#### `get_skills`

```typescript
case 'get_skills': {
  const services = runtime!.services
  const { skills, diagnostics } = services.resourceLoader.getSkills()
  const data = skills.map(s => ({
    name: s.name,
    description: s.description,
    filePath: s.filePath,
    baseDir: s.baseDir,
    source: s.sourceInfo?.source ?? 'local',
    scope: s.sourceInfo?.scope ?? 'temporary',
    origin: s.sourceInfo?.origin ?? 'top-level',
    disableModelInvocation: s.disableModelInvocation,
  }))
  const diags = diagnostics.map(d => ({
    type: d.type,
    message: d.message,
    path: d.path,
    collision: d.collision ? {
      resourceType: d.collision.resourceType,
      name: d.collision.name,
      winnerPath: d.collision.winnerPath,
      loserPath: d.collision.loserPath,
    } : undefined,
  }))
  send({
    channel: 'response', id: cmd.id, command: 'get_skills', success: true,
    data: { skills: data, diagnostics: diags },
  })
  break
}
```

注意：返回完整的 `sourceInfo` 三个维度（source, scope, origin），加上 `filePath` 和 `baseDir`。Renderer 端利用这些信息推断 harness。

#### `read_skill`

```typescript
case 'read_skill': {
  const filePath = cmd.filePath as string
  const { skills } = runtime!.services.resourceLoader.getSkills()
  const skill = skills.find(s => s.filePath === filePath)
  if (!skill) {
    send({ channel: 'response', id: cmd.id, command: 'read_skill', success: false, error: 'Skill not found' })
    break
  }
  try {
    const content = fsSync.readFileSync(skill.filePath, 'utf-8')
    // Strip frontmatter for display
    const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
    send({
      channel: 'response', id: cmd.id, command: 'read_skill', success: true,
      data: {
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        baseDir: skill.baseDir,
        source: skill.sourceInfo?.source ?? 'local',
        scope: skill.sourceInfo?.scope ?? 'temporary',
        origin: skill.sourceInfo?.origin ?? 'top-level',
        disableModelInvocation: skill.disableModelInvocation,
        content: body,
      },
    })
  } catch (err: unknown) {
    send({
      channel: 'response', id: cmd.id, command: 'read_skill', success: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  break
}
```

### 2. Main Process — 重写 `skills:list`，新增 `skills:read`

**删除**现有 `skills:list` 中独立扫描目录的全部逻辑（第 1852-1894 行），改为向 primary worker 发送 `get_skills` RPC：

```typescript
ipcMain.handle('skills:list', async () => {
  try {
    const primary = workerManager?.getPrimary()
    if (!primary?.bridge.isConnected) {
      return { ok: false, error: 'Worker not connected' }
    }
    const data = await primary.bridge.sendRpcCommand({ type: 'get_skills' }) as {
      skills: Array<{
        name: string
        description: string
        filePath: string
        baseDir: string
        source: string
        scope: string
        origin: string
        disableModelInvocation: boolean
      }>
      diagnostics: Array<{
        type: string
        message: string
        path?: string
        collision?: { resourceType: string; name: string; winnerPath: string; loserPath: string }
      }>
    }
    return { ok: true, data }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
```

新增 `skills:read` handler：

```typescript
ipcMain.handle('skills:read', async (_event, filePath: string) => {
  try {
    const primary = workerManager?.getPrimary()
    if (!primary?.bridge.isConnected) {
      return { ok: false, error: 'Worker not connected' }
    }
    const data = await primary.bridge.sendRpcCommand({ type: 'read_skill', filePath })
    return { ok: true, data }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
```

### 3. Preload — 更新 API

```typescript
// 更新 listSkills 返回类型
listSkills: (): Promise<{
  ok: boolean
  data?: Array<{
    name: string
    description: string
    filePath: string
    baseDir: string
    source: string
    scope: string
    origin: string
    disableModelInvocation: boolean
  }>
  diagnostics?: Array<{
    type: string
    message: string
    path?: string
    collision?: { resourceType: string; name: string; winnerPath: string; loserPath: string }
  }>
  error?: string
}> =>
  ipcRenderer.invoke('skills:list'),

// 新增
readSkill: (filePath: string): Promise<{
  ok: boolean
  data?: {
    name: string
    description: string
    filePath: string
    baseDir: string
    source: string
    scope: string
    origin: string
    disableModelInvocation: boolean
    content: string
  }
  error?: string
}> =>
  ipcRenderer.invoke('skills:read', filePath),
```

同时更新 `main.tsx` 中的 mock（`if (prop === 'listSkills') return okData([])` 处）。

### 4. Renderer — `useSkillStore`（新建）

用 zustand 管理 skills 状态，供 SkillsPanel、InputBar、ChatView 共享：

```typescript
// src/renderer/src/hooks/useSkillStore.ts
import { create } from 'zustand'

export interface SkillInfo {
  name: string
  description: string
  filePath: string
  baseDir: string
  source: string       // 'auto' | 'local' | 'cli' | 'npm' | 'git' | 'sdk' | ...
  scope: string        // 'user' | 'project' | 'temporary'
  origin: string       // 'top-level' | 'package'
  disableModelInvocation: boolean
  harness?: string     // 推断出的来源工具，由 inferHarness() 填充
}

export interface SkillDiagnostic {
  type: string         // 'warning' | 'error' | 'collision'
  message: string
  path?: string
  collision?: {
    resourceType: string
    name: string
    winnerPath: string
    loserPath: string
  }
}

export interface SkillDetail extends SkillInfo {
  content: string
}

/** 根据 skill 的 filePath 推断来源工具 */
export function inferHarness(filePath: string, baseDir: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const path = filePath.replace(/\\/g, '/')

  if (path.startsWith(`${home}/.claude/`)) return 'claude'
  if (path.startsWith(`${home}/.codex/`)) return 'codex'
  if (path.startsWith(`${home}/.opencode/`)) return 'opencode'
  if (path.startsWith(`${home}/.agents/`)) return 'agents'
  if (path.startsWith(`${home}/.xi/`)) return 'xi'
  if (path.startsWith(`${home}/.pi/`)) return 'pi'

  // Generic: any ~/.<name>/skills/ pattern
  const match = path.match(new RegExp(`^${home}/\\.([^/]+)/skills/`))
  if (match) return match[1]

  // Project-level
  if (path.includes('/.agents/skills/')) return 'agents'
  if (path.includes('/.pi/skills/')) return 'xi'

  return 'unknown'
}

interface SkillState {
  skills: SkillInfo[]
  diagnostics: SkillDiagnostic[]
  loading: boolean
  error: string | null
  expandedSkill: string | null   // filePath of expanded skill
  skillDetail: SkillDetail | null
  detailLoading: boolean

  fetchSkills: () => Promise<void>
  expandSkill: (filePath: string) => Promise<void>
  collapseSkill: () => void
}

export const useSkillStore = create<SkillState>()((set, get) => ({
  skills: [],
  diagnostics: [],
  loading: false,
  error: null,
  expandedSkill: null,
  skillDetail: null,
  detailLoading: false,

  fetchSkills: async () => {
    set({ loading: true, error: null })
    try {
      const result = await window.api.listSkills()
      if (result.ok && result.data) {
        const skills = result.data.map(s => ({
          ...s,
          harness: inferHarness(s.filePath, s.baseDir),
        }))
        set({
          skills,
          diagnostics: result.diagnostics ?? [],
          loading: false,
        })
      } else {
        set({ error: result.error ?? 'Failed to load skills', loading: false })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  expandSkill: async (filePath: string) => {
    const { expandedSkill } = get()
    if (expandedSkill === filePath) {
      set({ expandedSkill: null, skillDetail: null })
      return
    }
    set({ expandedSkill: filePath, detailLoading: true, skillDetail: null })
    try {
      const result = await window.api.readSkill(filePath)
      if (result.ok && result.data) {
        set({ skillDetail: { ...result.data, harness: inferHarness(result.data.filePath, result.data.baseDir) }, detailLoading: false })
      } else {
        set({ skillDetail: null, detailLoading: false })
      }
    } catch {
      set({ skillDetail: null, detailLoading: false })
    }
  },

  collapseSkill: () => {
    set({ expandedSkill: null, skillDetail: null })
  },
}))
```

### 5. Renderer — SkillsPanel 改造

重写 `SkillsPanel.tsx`，数据从 `useSkillStore` 获取。

关键组件：

```tsx
export default function SkillsPanel({ onInvokeSkill }: { onInvokeSkill?: (name: string) => void }) {
  const { skills, diagnostics, loading, error, expandedSkill, skillDetail, detailLoading,
          fetchSkills, expandSkill } = useSkillStore()

  useEffect(() => { fetchSkills() }, [fetchSkills])

  // ... 渲染列表、展开详情、Use 按钮、诊断入口
}
```

**Harness 标签渲染**：

```tsx
const HARNESS_CONFIG: Record<string, { label: string; className: string }> = {
  claude:  { label: 'Claude',  className: 'bg-orange-50 text-orange-600' },
  codex:   { label: 'Codex',   className: 'bg-green-50 text-green-600' },
  opencode:{ label: 'OpenCode',className: 'bg-teal-50 text-teal-600' },
  agents:  { label: 'Agents',  className: 'bg-gray-100 text-gray-500' },
  npm:     { label: 'npm',     className: 'bg-gray-100 text-gray-500' },
  git:     { label: 'git',     className: 'bg-gray-100 text-gray-500' },
  cli:     { label: 'CLI',     className: 'bg-amber-50 text-amber-600' },
}

function HarnessLabel({ harness }: { harness: string }) {
  // Xi/pi 自有的 skills 不显示 harness 标签
  if (harness === 'xi' || harness === 'pi') return null
  const config = HARNESS_CONFIG[harness]
  if (!config) return null
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}
```

**Scope 标签渲染**：

```tsx
function ScopeLabel({ scope }: { scope: string }) {
  const config: Record<string, { label: string; className: string }> = {
    user:     { label: 'Global',  className: 'bg-gray-100 text-gray-500' },
    project:  { label: 'Project', className: 'bg-blue-50 text-blue-600' },
    temporary:{ label: 'Temp',    className: 'bg-amber-50 text-amber-600' },
  }
  const c = config[scope] ?? { label: scope, className: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c.className}`}>
      {c.label}
    </span>
  )
}
```

**"Use" 按钮**：

```tsx
<button
  onClick={(e) => { e.stopPropagation(); onInvokeSkill?.(skill.name) }}
  className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
  title="Insert /skill:name into input"
>
  ▶ Use
</button>
```

**展开详情区域**：

```tsx
{expandedSkill === skill.filePath && (
  <div className="mt-2 ml-5 p-2 bg-gray-50 rounded text-xs prose prose-xs max-w-none">
    {detailLoading ? 'Loading...' : (
      <MarkdownRenderer content={skillDetail?.content ?? ''} />
    )}
  </div>
)}
```

### 6. Renderer — 输入框 `/skill:` 自动补全

参照现有 `useFileMention`（@触发）和 `useSessionMention`（$触发）的模式，新增 `useSkillMention` hook：

```typescript
// src/renderer/src/hooks/useSkillMention.ts
import { useState, useCallback, useRef } from 'react'
import type { SkillInfo } from './useSkillStore'

interface SkillMentionItem {
  name: string
  description: string
  harness?: string
}

export function useSkillMention(skills: SkillInfo[]) {
  const [visible, setVisible] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemsRef = useRef<SkillMentionItem[]>([])

  const items = skills
    .filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    .map(s => ({ name: s.name, description: s.description, harness: s.harness }))
  itemsRef.current = items

  // 检测 /skill: 前缀 → 提取 query 部分
  const detectSkillMention = useCallback((text: string, cursorPos: number): string | null => {
    const beforeCursor = text.slice(0, cursorPos)
    const match = beforeCursor.match(/\/skill:([a-z0-9-]*)$/)
    return match ? match[1] : null
  }, [])

  const handleTextChange = useCallback((text: string, cursorPos: number) => {
    const q = detectSkillMention(text, cursorPos)
    if (q !== null) {
      setQuery(q)
      setVisible(true)
      setSelectedIndex(0)
    } else {
      setVisible(false)
    }
  }, [detectSkillMention])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!visible) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, itemsRef.current.length - 1))
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const item = itemsRef.current[selectedIndex]
      if (item) return item.name
      return true
    }
    if (e.key === 'Escape') {
      setVisible(false)
      return true
    }
    return false
  }, [visible, selectedIndex])

  return { visible, items, selectedIndex, handleTextChange, onKeyDown }
}
```

在 `InputBar` 中集成：

```tsx
const skillMention = useSkillMention(skills)

// keydown handler 中
const skillResult = skillMention.onKeyDown(e)
if (skillResult) {
  if (typeof skillResult === 'string') {
    replaceSkillMention(skillResult)
  }
  return
}

// 文本变化时检测
const plainText = getPlainText()
const cursorPos = getCursorPos()
skillMention.handleTextChange(plainText, cursorPos)
```

需要一个 `SkillMentionDropdown` 组件（类似 `FileMentionDropdown`），显示 skill 名称、描述和 harness 标签。

**App.tsx 需要传递 skills 数据**：从 `useSkillStore` 获取 skills，传给 InputBar。

### 7. Renderer — Skill 调用的聊天渲染

#### 消息转换

在 `convert-messages.ts` 的 `splitUserContentIntoBlocks` 中检测 `<skill>` XML 块。

`<skill>` 块的完整格式（来自 `_expandSkillCommand`）：

```
<skill name="brave-search" location="/path/to/SKILL.md">
References are relative to /path/to/skill-dir.

# Brave Search
## Setup
...
</skill>
```

检测正则：

```typescript
const skillBlockRe = /<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>/g
```

在 `ContentBlock` 类型中新增：

```typescript
export interface SkillBlock {
  type: 'skill'
  name: string
  location: string
  content: string
  userMessage?: string  // /skill:name 后面跟的参数
}
```

转换逻辑：在 `splitUserContentIntoBlocks` 中，先用 skillBlockRe 匹配提取 SkillBlock，剩余文本再走原有逻辑。

#### 聊天渲染

在 `ChatView` 中新增 `SkillBlockRenderer` 组件：

- **默认折叠**：显示 `📋 skill:name` 标签，可点击展开
- **展开状态**：渲染 skill content 的 markdown
- **视觉区分**：`bg-amber-50 border-l-2 border-amber-400`，区别于普通文本（无色）和 quote 块（`bg-gray-50 border-l-2 border-gray-300`）
- 如果有 `userMessage`，在 skill 内容下方显示为附加文本

### 8. 项目切换刷新

在 `App.tsx` 中，当 `projectPath` 变化时调用 `useSkillStore.getState().fetchSkills()`。

可以在 `handleOpenDirectory` 回调中显式调用，或用 `useEffect` 监听 `projectPath` 变化。

## 改动总结

| 文件 | 改动 |
|------|------|
| `main/pi-worker.ts` | 新增 `get_skills`、`read_skill` 两个命令 |
| `main/index.ts` | 重写 `skills:list` handler（→ worker RPC），新增 `skills:read` handler，删除独立扫描逻辑 |
| `preload/index.ts` | 更新 `listSkills` 返回类型，新增 `readSkill` API |
| `renderer/src/main.tsx` | 更新 mock |
| `renderer/src/hooks/useSkillStore.ts` | **新建**：zustand store + `inferHarness()` |
| `renderer/src/hooks/useSkillMention.ts` | **新建**：`/skill:` 自动补全 hook |
| `renderer/src/components/SkillsPanel.tsx` | 重写：harness 标签 + scope 标签 + 展开详情 + Use 按钮 + 诊断入口 |
| `renderer/src/components/SkillMentionDropdown.tsx` | **新建**：skill 补全下拉框 |
| `renderer/src/components/SkillBlockRenderer.tsx` | **新建**：聊天中 skill 块可折叠渲染 |
| `renderer/src/components/InputBar.tsx` | 集成 `useSkillMention`，接收 skills prop |
| `renderer/src/components/ChatView.tsx` | 集成 `SkillBlockRenderer` |
| `renderer/src/components/LeftPanel.tsx` | 传递 `onInvokeSkill` prop 到 SkillsPanel |
| `renderer/src/types/message.ts` | 新增 `SkillBlock` 类型 |
| `renderer/src/utils/convert-messages.ts` | 在 `splitUserContentIntoBlocks` 中检测 `<skill>` XML 块 |
| `renderer/src/App.tsx` | 传递 skills 到 InputBar，项目切换时刷新 skill store |

## Verification

### 功能验证

1. **数据源一致性**：
   - SkillsPanel 显示的 skills 与 `resourceLoader.getSkills()` 完全一致
   - 在 `~/.xi/settings.json` 中添加 `"skills": ["~/.claude/skills"]`，重启后 Claude Code 的 skills 出现在面板，显示 `Claude` harness 标签
   - packages 带来的 skills 显示正确

2. **路径正确性**：
   - 全局 skills 从 `~/.xi/skills/` 加载（不是 `~/.pi/agent/skills/`）
   - 项目 skills 从 `<cwd>/.pi/skills/` 加载（CONFIG_DIR_NAME 限制）

3. **Harness 标签**：
   - `~/.claude/skills/` 下的 skill → `Claude` 橙色标签
   - `~/.codex/skills/` 下的 skill → `Codex` 绿色标签
   - `~/.xi/skills/` 下的 skill → 无标签（Xi 自有）
   - `.pi/skills/` 下的 skill → 无标签（Xi 自有）
   - `~/.agents/skills/` 下的 skill → `Agents` 灰色标签

4. **Scope 标签**：
   - 全局 skills → `Global`
   - 项目 skills → `Project`
   - CLI skills → `Temp`

5. **输入框自动补全**：
   - 输入 `/skill:` 弹出下拉框，列出所有可用 skills，含 harness 标签
   - 输入 `/skill:br` 过滤出名称含 "br" 的 skills
   - 选中后替换为 `/skill:brave-search `

6. **Skill 详情查看**：
   - 点击 SkillsPanel 中的 skill 条目，展开显示 SKILL.md markdown 内容
   - 再次点击折叠
   - 同一时间只有一个 skill 展开

7. **Skill 调用触发**：
   - 点击 "Use" 按钮，`/skill:name` 出现在输入框
   - 发送后 agent 正确接收并展开 skill

8. **聊天 Skill 块渲染**：
   - 使用 `/skill:name` 发送消息后，用户消息中的 `<skill>` 块渲染为可折叠卡片
   - 默认折叠，显示 skill 名称
   - 展开后显示 markdown 内容

9. **项目切换**：
   - 打开新目录后，SkillsPanel 自动刷新
   - 旧项目的 project skills 消失，新项目的 project skills 出现

10. **诊断信息**：
    - 故意放一个名称不合规的 skill，诊断计数器显示 >0
    - 点击诊断入口显示详情
    - 命名碰撞显示 winner/loser 路径

### 边界情况

- **Worker 未连接**：`skills:list` 返回 `ok: false`，SkillsPanel 显示错误状态而不是空列表
- **无 skills**：显示引导文案，列出所有添加方式（含跨工具添加方式）
- **Skill 文件不可读**：`read_skill` 返回 error，详情面板显示错误信息
- **disableModelInvocation 的 skills**：显示 🔒 标记，仍可 "Use" 触发
- **`/skill:` 补全与其他补全冲突**：`/skill:` 只在行首匹配，`@` 和 `$` 不在行首也能匹配，不冲突
- **历史消息中的 skill 块**：加载 JSONL 历史时，`convert-messages.ts` 正确解析 `<skill>` 块
- **同目录下 SKILL.md + 子目录**：Pi SDK 先找当前目录 SKILL.md，找到了就不递归子目录
- **`.agents/skills/` 根级 `.md` 被忽略**：面板不显示这些
- **未知 harness 目录**：`inferHarness` 回退到通用 `~/.<name>/skills/` 匹配，显示目录名为标签

## Future Considerations

- **项目级 `.xi/skills/` 支持**：需要 SDK 支持 `CONFIG_DIR_NAME` 环境变量或修改 SDK `package.json` 的 `piConfig.configDir`
- **Skill 创建向导**：GUI 引导用户创建标准 skill 目录结构和 SKILL.md 模板
- **`enableSkillCommands` 设置**：在 GeneralSettings 中暴露开关
- **Skill 热重载**：用户添加新 skill 后无需重启 session，通过 `resourceLoader.reload()` 刷新
- **Skill 完整元数据展示**：`allowed-tools`、`license`、`compatibility` 等字段
- **Skill 搜索/过滤**：SkillsPanel 顶部增加搜索框
- **Skill 安装**：从 GitHub repositories 一键安装 skill（如 Anthropic Skills、Pi Skills）
- **Harness 标签可点击**：点击 Claude 标签跳转到 `~/.claude/skills/` 目录

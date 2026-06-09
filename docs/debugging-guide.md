# Xi 调试指南

基于实际踩坑经验总结。遇到类似问题时，按此流程排查。

---

## 1. Electron + Pi SDK 整体架构

```
用户操作 (Renderer)
    ↓ IPC
主进程 (Main Process) — src/main/index.ts
    ↓ postMessage / sendRpcCommand
Pi SDK Worker (UtilityProcess) — src/main/pi-worker.ts
    ↓ 内部调用
Pi SDK (node_modules/@earendil-works/pi-coding-agent/)
```

**关键路径**：
- Renderer → `window.api.xxx()` → Preload (`ipcRenderer.invoke`) → Main (`ipcMain.handle`) → Worker (`sendRpcCommand`) → Pi SDK
- Pi SDK 事件 → Worker → Main (`broadcastToRenderers`) → Renderer

---

## 2. 自定义 Provider 持久化调试

### 问题模式：重启后 custom provider 消失 / welcome 弹窗

**排查步骤**：

1. **检查 `models.json` 是否存在且内容正确**
   ```bash
   cat .xi/models.json
   ```
   - 路径：`PI_CODING_AGENT_DIR/models.json`，通常在 `<project>/.xi/models.json`
   - 必须包含 `providers.<id>.apiKey`（Pi SDK `validateConfig` 要求非内置 provider 有 apiKey）
   - 必须包含 `providers.<id>.baseUrl`（Pi SDK 要求非内置 provider 有 baseUrl）

2. **检查 `auth.json` 是否有对应的认证信息**
   ```bash
   cat .xi/auth.json
   ```
   - Pi SDK worker 的 `authStorage` 写入 `<agentDir>/auth.json`
   - 格式：`{ "provider-id": { "type": "api_key", "key": "sk-xxx" } }`

3. **检查 Pi SDK `validateConfig` 是否拒绝加载**
   - 位置：`node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js`
   - 搜索 `validateConfig` 方法
   - 非内置 provider + 自定义 models → 必须有 `apiKey` 和 `baseUrl`
   - 如果验证失败，`registry.getError()` 会返回错误，`getAll()` 只返回内置模型

4. **检查 `PI_CODING_AGENT_DIR` 环境变量**
   - 设置位置：`pi-sdk-bridge.ts` L73：`process.env.PI_CODING_AGENT_DIR = localAgentDir`
   - Worker 使用 `pi.getAgentDir()` 获取此路径
   - 主进程 IPC handler 使用 `process.env.PI_CODING_AGENT_DIR || join(process.cwd(), '.xi')`

### 典型根因

| 症状 | 根因 | 修复 |
|------|------|------|
| 重启后 welcome 弹窗 | auth.json 里没有 custom provider 的认证 | 检查 worker 是否正确调用了 `authStorage.set()` |
| 重启后模型列表为空 | models.json 缺少 apiKey | models.json 必须包含 apiKey（Pi SDK validateConfig 要求） |
| 侧边栏 custom 显示为 Other | customProviderBaseUrls 未在启动时从 models.json 加载 | 调用 `listCustomProviders` IPC |
| `provider:getConfig` 找不到配置 | 搜索路径不对 | 检查是否同时搜索了 `PI_CODING_AGENT_DIR` 和 `~/.pi/agent/` |

---

## 3. Worker 连接与 IPC 调试

### 问题模式：IPC 调用失败 / No worker

1. **确认 Worker 状态**
   ```
   IPC: worker:getStatus → 返回所有 worker 的 sessionPath, role, status
   ```

2. **Worker 不匹配问题**
   - `getAvailableModels` 应该用 `workerManager.getPrimary()`（模型注册表是全局的）
   - 其他 IPC handler 用 `(workerManager.get(sessionPath) ?? workerManager.getPrimary())` 作为 fallback
   - 原因：`activeSessionPath` 可能不等于 primary 的 `sessionPath`（两个不同的 session 文件）

3. **Worker 崩溃处理**
    - Worker 崩溃后 `bridge._isConnected = false`，所有 pending command 会 reject
    - WorkerManager 会 emit `disconnected` 事件，主进程广播到 Renderer

---

## 4. Pi SDK 内部行为排查

当需要理解 Pi SDK 内部逻辑时：

### 4.1 直接阅读 SDK 源码

SDK 源码在 `node_modules/@earendil-works/pi-coding-agent/dist/`，是编译后的 JS，可读性尚可。

**关键文件**：
| 文件 | 关注内容 |
|------|----------|
| `core/model-registry.js` | `registerProvider()`, `validateConfig()`, `loadCustomModels()`, `parseModels()` |
| `core/auth-storage.js` | `set()`, `persistProviderChange()`, `getApiKey()` |
| `core/resolve-config-value.js` | `apiKey` 字段支持环境变量引用 (`${ENV_VAR}`) |

### 4.2 不能直接 import SDK 测试

Pi SDK 是 ESM-only，且需要 Node 22+（undici 版本问题）。不能在项目 Node 20 环境下直接 import 测试。

**替代方案**：
- 阅读编译后的 JS 源码（最可靠）
- 通过 Electron IPC 间接测试（启动 app → Playwright 自动化）
- 在 Worker 进程内添加调试日志

### 4.3 `registerProvider()` 是内存操作

- `registerProvider()` 只在当前进程的生命周期内有效
- 重启后需要从 `models.json` 重新加载
- `models.json` 是 Pi SDK 的持久化机制，在 `ModelRegistry.create()` 构造时自动加载

---

## 5. Playwright CDP 调试方法

### 5.1 启动 Electron with CDP

```bash
npx electron-vite dev -- --remote-debugging-port=9222 &
sleep 25  # 等待构建和启动
curl -s http://127.0.0.1:9222/json/version  # 验证 CDP 可用
```

### 5.2 用 playwright-cli 连接

```bash
playwright-cli attach --cdp=http://localhost:9222
playwright-cli snapshot  # 获取页面快照
playwright-cli eval "JSON.stringify(Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()))"  # 列出所有按钮
```

### 5.3 测试 custom provider 流程

```bash
# 1. 找到并点击 "Get Started" 或 "Add Custom"
playwright-cli click e274  # 用 snapshot 中的 ref

# 2. 填写表单
playwright-cli fill e467 "test-provider"
playwright-cli fill e470 "Test Provider"
playwright-cli fill e473 "https://api.openai.com/v1"
playwright-cli fill e479 "sk-test-key"
playwright-cli fill e483 "gpt-4o-mini"
playwright-cli fill e486 "GPT-4o Mini"

# 3. 提交
playwright-cli click e494  # "Add Provider" 按钮

# 4. 验证结果
playwright-cli snapshot
```

### 5.4 测试重启持久化

```bash
# 关闭 Playwright
playwright-cli close

# 杀掉 Electron 进程
pkill -f electron; pkill -f electron-vite; sleep 3

# 检查持久化文件
cat .xi/models.json
cat .xi/auth.json

# 重启
npx electron-vite dev -- --remote-debugging-port=9222 &
sleep 25
playwright-cli attach --cdp=http://localhost:9222

# 验证：模型选择器是否显示 custom model，是否弹 welcome
playwright-cli eval "JSON.stringify(Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()))"
```

### 5.5 常见问题

- **CDP 连接失败**: 等 25 秒再连，electron-vite 构建需要时间
- **Snapshot 没有 ref**: 用 `playwright-cli snapshot` 重新获取
- **页面没反应**: 检查 Pi Worker 是否连接（看主进程日志有无 `[PiSDKBridge] connected`）

---

## 6. 数据流追踪模板

遇到 IPC 问题时，按以下路径追踪：

```
[Renderer] 组件调用 prop 方法
    → 哪个组件？什么 props？
    → grep: <ComponentName

[Preload] ipcRenderer.invoke('channel', args)
    → grep: ipcRenderer.invoke('channel'
    → 确认参数格式

[Main] ipcMain.handle('channel', handler)
    → grep: ipcMain.handle('channel'
    → 确认 handler 逻辑

[Main → Worker] primary.bridge.sendRpcCommand({ type: 'command_type', ... })
    → grep: type: 'command_type'
    → 确认 command type 和参数

[Worker] case 'command_type':
    → 文件: src/main/pi-worker.ts
    → 确认 SDK 调用

[Pi SDK] 内部实现
    → 文件: node_modules/@earendil-works/pi-coding-agent/dist/core/*.js
    → 阅读编译后源码
```

---

## 7. 文件路径参考

| 路径 | 用途 |
|------|------|
| `<project>/.xi/` | 项目级配置目录 (`PI_CODING_AGENT_DIR`) |
| `<project>/.xi/auth.json` | API 认证信息 (Pi SDK `authStorage`) |
| `<project>/.xi/models.json` | 模型/provider 配置 (Pi SDK `ModelRegistry`) |
| `<project>/.xi/sessions/` | 会话文件目录 |
| `~/.xi/` | 全局配置目录 |
| `~/.pi/agent/` | Pi CLI 的配置目录 |
| `~/.xi/ → ~/.pi/agent/` | symlink（`linkGlobalAgentConfig` 创建） |

**路径优先级**：
- Worker 始终使用 `pi.getAgentDir()` = `PI_CODING_AGENT_DIR`
- Main process IPC 优先用 `PI_CODING_AGENT_DIR`，fallback 到 `~/.pi/agent/`

---

## 8. 历史踩坑记录

### 8.1 models.json 缺少 apiKey 导致重启失败

**现象**：添加 custom provider 成功，重启后模型列表为空，welcome 弹窗。

**根因**：`registerCustomProvider` handler 写 models.json 时用 `const { apiKey, ...persistConfig } = config` 剥离了 apiKey。但 Pi SDK `validateConfig` 要求非内置 provider 有 apiKey，导致 `loadCustomModels()` 失败，`registry.getError()` 返回错误，`getAll()` 只返回内置模型。

**修复**：models.json 必须包含完整的 config（含 apiKey）。

**教训**：修改 Pi SDK 的配置文件格式前，必须先读 SDK 的 `validateConfig` 方法。

### 8.2 setApiKey 写入错误的 auth.json 路径

**现象**：setApiKey 后，Pi SDK 的 `getProviderAuthStatus` 仍然显示 `configured: false`。

**根因**：`setApiKey` handler 在主进程写入 `~/.xi/auth.json`，但 Pi SDK worker 的 `authStorage` 指向 `<agentDir>/auth.json`（项目 `.xi/`）。两个路径不同（除非有 symlink）。

**修复**：移除主进程的冗余写入。Pi SDK worker 的 `authStorage.set()` 已经通过 `persistProviderChange()` 写入正确的 `auth.json`。

**教训**：不要在主进程和 Worker 两侧同时持久化同一份数据，容易路径不一致。

### 8.3 Worker 不匹配导致 getAvailableModels 返回空

**现象**：`getAvailableModels` 通过 session worker 查询，但该 worker 可能还没启动或已退出。

**根因**：`getAvailableModels` 用 `workerManager.get(sessionPath)` 查找 worker，但 `activeSessionPath` 可能不等于 primary 的 `sessionPath`。

**修复**：`getAvailableModels` 始终用 `workerManager.getPrimary()`（模型注册表是全局的）。其他 IPC handler 用 `(get(sessionPath) ?? getPrimary())` 作为 fallback。

**教训**：理解数据的作用域（全局 vs session 级别），选择正确的 worker。

### 8.4 customProviderBaseUrls 不持久化

**现象**：重启后 custom provider 在侧边栏显示为 "Other" 而不是 "Custom"。

**根因**：`customProviderBaseUrls` 是 React state，只在 `handleCustomProviderSuccess` 回调中更新，重启后丢失。

**修复**：添加 `provider:listCustomProviders` IPC，在 ProviderSetup mount 时从 models.json 加载已有 custom providers。

**教训**：React state 不会自动持久化。如果 UI 分组依赖运行时数据，需要在 mount 时从持久化源恢复。

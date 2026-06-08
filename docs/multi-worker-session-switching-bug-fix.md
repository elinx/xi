# 复盘：Multi-Worker Session 切换 Bug 修复（2026-06-09）

## 一、问题现象

用户在多 session 场景下：
1. main 输入 "hi" → 正常
2. fork 创建 aaa → 正常
3. 从 aaa fork 创建 bbb → 正常
4. 切换到 aaa → 正常
5. **切回 main → "hi" 消失，输入无回显、无响应**

症状：session 切换后，Primary session 变成"僵尸"——消息丢失、输入无响应。

---

## 二、根因分析（四层 Bug）

### Bug 1：`connected` 回调覆盖 Primary `sessionPath`

**位置**: `worker-manager.ts` L218-227 `setupBridgeEvents`

```typescript
// 修复前
if (sessionFile && sessionFile !== state.sessionPath) {
  state.sessionPath = sessionFile  // 每次重连都会覆盖！
}
```

**机制**: Pi SDK 重连时发出 `connected` 事件，`sessionFile` 可能与 `initPrimary` 传入的路径格式不同（如绝对路径 vs 相对路径）。一旦 `primary.sessionPath` 被覆盖，`workerManager.get(rendererPath)` 就找不到 Primary worker，所有发往 main 的消息（prompt、abort、model 切换）都变成"黑洞"。

**修复**: 只在 `sessionPath` 为空时设置（初始化场景），之后永不覆盖：
```typescript
if (sessionFile && !state.sessionPath) {
  state.sessionPath = sessionFile
}
```

### Bug 2：Secondary `worker.sessionPath = sp` 破坏 Map 一致性

**位置**: `index.ts` forkAtEntry/newSession/clearSession

```typescript
// 修复前
if (worker.role === 'secondary') {
  worker.sessionPath = sp  // 改了 state，但 Map key 没变！
}
```

**机制**: `WorkerManager.secondaries` 是 `Map<sessionPath, WorkerState>`。当 secondary worker 从 aaa fork 到 bbb 后：
- `worker.sessionPath` 变成了 `bbbPath`
- 但 Map 的 key 仍然是 `aaaPath`
- `workerManager.get(bbbPath)` 返回 `undefined`
- `workerEnsureReady(bbbPath)` 创建了一个**新的** bbb secondary
- aaa secondary 仍在 Map 中，但 key 与 value 不匹配，永远不会被正确查找

**这是最隐蔽的 bug**——它不报错、不崩溃，只是悄悄地让 session 路由失效。

**修复**: 所有 worker（primary 和 secondary）fork/new/clear 后都 `switch_session` 回原 session，不再 mutate `worker.sessionPath`：
```typescript
// Before: different logic for primary vs secondary
if (worker.role === 'secondary') { worker.sessionPath = sp }
if (worker.role === 'primary' && ...) { switch_session(worker.sessionPath) }

// After: unified logic, no mutation
if (worker.sessionPath && forkSessionPath !== worker.sessionPath) {
  await worker.bridge.sendRpcCommand({ type: 'switch_session', sessionPath: worker.sessionPath })
}
```

### Bug 3：Renderer 用 `currentSessionRef` 而非后端返回的路径

**位置**: `App.tsx` handleForkAtEntry/handleNewSession/handleForkFromEnd/handleClearSession

```typescript
// 修复前
const path = currentSessionRef.current?.filePath  // 查的是 Primary 的当前状态
```

**机制**: `currentSession` 来自 `session:getCurrentSession`，它查询 Primary worker 的 `get_state()`。但 fork 后 Primary 已经 switch back 了，所以 `currentSession.filePath` 返回的是**原始 session**，不是新 fork 的 session。

结果：fork 后 renderer 显示的是旧 session，新 session 在侧边栏出现了但没被激活。

**修复**: 后端返回新 session 路径，renderer 直接使用：
```typescript
// 后端
return { success: true, sessionPath: forkSessionPath }

// 前端
const newPath = await forkAtEntry(currentPath, entryId, name)
if (newPath) {
  await displaySessionRef.current(newPath)
  await workerEnsureReady(newPath)
  await saveLastSession(newPath)
}
```

### Bug 4：空会话 Fork 静默失败

**位置**: `App.tsx` handleForkFromEnd

```typescript
// 修复前
if (!lastEntry?.entryId) return  // 静默退出，什么都不做
```

**机制**: 从没有用户消息的 session fork 时，`getForkMessages` 返回空数组，`lastEntry` 为 `undefined`，直接 return。用户点击 Fork 按钮后什么都没发生。

**修复**: 无消息时 fallback 到 `newSession`（创建子 session）。

---

## 三、调试过程

### 阶段一：表面修复（失败）

看到 `connected` 回调覆盖 `primary.sessionPath`，修了。用户反馈"还是不对"。

**问题**: 只修了最明显的 bug，没有端到端追踪完整数据流。头痛医头。

### 阶段二：深度追踪（成功）

换了思路：**不猜，追踪**。把用户场景拆成 6 步（main→hi, fork aaa, fork bbb, input bbb, switch aaa, switch main），逐步模拟数据在每层的流转：

1. 用户输入 → `sendPrompt(path)` → `pi:sendCommand` → `workerManager.get(path)` → 找到 worker？
2. Worker 事件 → `setupBridgeEvents` 添加 `sessionPath` → `pi:event` → renderer `resolveSessionPath` → 正确路由？
3. Fork 后 worker 内部 session 变了 → `worker.sessionPath` 变了吗？Map key 同步了吗？
4. Renderer 拿什么路径来 display？`currentSessionRef` 返回的是什么？

在追踪第 3 步时发现了 Map key 不一致（Bug 2），追踪第 4 步时发现了 `currentSessionRef` 问题（Bug 3）。

**关键方法**: 画出完整数据流路径，逐步检查每个节点：
```
Renderer (sendPrompt)
  → Preload (pi:sendCommand)
    → Main (workerManager.get → bridge.sendCommand)
      → Worker (session.prompt)
        → Event (subscribe → forwardEvent)
          → Main (setupBridgeEvents → emit with sessionPath)
            → Preload (pi:event)
              → Renderer (handleEvent → resolveSessionPath → updateCache)
```

**具体工具和步骤**：

1. **Read 读源码** — 从入口函数开始，沿调用链逐层读下去：
   - `App.tsx` handleForkAtEntry → `useSessionManager.ts` forkAtEntry → `preload/index.ts` IPC invoke → `index.ts` session:forkAtEntry handler
   - 重点：每一层传了什么参数、返回了什么、映射关系是否正确

2. **Grep 扫描 mutation 点** — 用正则找所有可能破坏不变性的代码：
   ```bash
   grep -n '\.sessionPath\s*=' src/main/*.ts
   grep -n 'worker\.sessionPath\s*=' src/main/*.ts
   grep -n 'state\.sessionPath\s*=' src/main/*.ts
   ```
   发现了 3 处 `worker.sessionPath = sp`（forkAtEntry/newSession/clearSession），这就是 Bug 2 的根源

3. **Read Map 容器的 get/set 逻辑** — 检查 Map key 和 value 的一致性：
   - `worker-manager.ts` `get(sessionPath)`: 用 `primary.sessionPath === sessionPath` 和 `secondaries.get(sessionPath)` 查找
   - `getOrCreateSecondary(sessionPath)`: 用 `sessionPath` 作为 Map key
   - 如果 state.sessionPath 被改了但 Map key 没更新 → `get()` 断裂

4. **追踪 Renderer 的数据来源** — 检查 handler 里用什么决定"显示哪个 session"：
   - `grep -n 'currentSessionRef' App.tsx` → 发现 fork/newSession/clearSession 都用 `currentSessionRef.current?.filePath`
   - 追踪 `currentSession` 来源 → `loadCurrentSession()` → `session:getCurrentSession` → 查 Primary 的 `get_state()`
   - 但 Primary 在 fork 后已经 switch back → 返回原始 session → 新 session 没被激活

5. **添加临时 console.log** — 在关键 IPC handler 入口打印参数和 worker 状态：
   ```typescript
   console.log(`[forkAtEntry] sessionPath=${sessionPath}, entryId=${entryId}`)
   console.log(`[forkAtEntry] worker: role=${worker?.role}, sessionPath=${worker?.sessionPath}`)
   console.log(`[forkAtEntry] fork done, new sessionFile=${sp}, worker.sessionPath=${worker.sessionPath}`)
   console.log(`[ensureReady] sessionPath=${sessionPath}, primary: ${primary?.sessionPath}`)
   ```
   验证修复后这些值是否符合预期，确认后删除

6. **tsc --noEmit 类型检查** — 每次修改后验证类型正确：
   ```bash
   npx tsc --noEmit
   ```

7. **LSP diagnostics** — 用 `lsp_diagnostics` 检查修改过的文件是否有错误

### 阶段三：实际测试（验证）

无法在 headless 环境正常运行 Electron（GPU 崩溃），最终通过 Playwright CDP 连接到 Electron 做端到端测试：

1. **启动 Electron 并开启 CDP**:
   ```bash
   electron-vite dev -- --no-sandbox --remote-debugging-port=9222
   ```

2. **Playwright 连接到 Electron**:
   ```javascript
   const { chromium } = require('playwright');
   const browser = await chromium.connectOverCDP('http://localhost:9222');
   const page = browser.contexts()[0].pages()[0];
   ```

3. **模拟用户操作**:
   ```javascript
   // 输入消息
   await page.locator('div[contenteditable="true"]').first().fill('hi');
   await page.locator('button:has-text("Send")').click();

   // Fork session
   await page.locator('button[title="Fork"]').first().click();
   await page.locator('input[placeholder="Fork name"]').fill('aaa');
   await page.locator('input[placeholder="Fork name"]').press('Enter');

   // 切换 session
   await page.evaluate(() => {
     document.querySelectorAll('*').forEach(el => {
       if (el.textContent?.startsWith('main') && getComputedStyle(el).cursor === 'pointer') el.click();
     });
   });
   ```

4. **验证结果**:
   ```javascript
   const body = await page.evaluate(() => document.body.innerText);
   // 检查标题是否切换、历史消息是否保留、输入是否正常
   ```

测试结果：

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | main 输入 "hi" | ✅ Pi 正常回复 |
| 2 | fork "aaa" | ✅ 自动激活 aaa |
| 3 | 从 aaa fork "bbb" | ✅ 自动激活 bbb |
| 4 | 切回 main | ✅ "hi" 消息保留 |
| 5 | main 继续输入 | ✅ 正常响应 |
| 6 | 切到 aaa 输入 | ✅ 正常响应 |

**踩坑**: Playwright 的 `attach --cdp` 命令在 Electron 上会卡住，需要用 `connectOverCDP()` API 代替。Electron 的 input 是 `div[contenteditable="true"]`，不是 `<input>` 或 `<textarea>`。

### 阶段四：调试技巧总结

1. **Grep 扫描 mutation 点** — `grep '\.sessionPath\s*=' src/main/*.ts` 快速定位所有可能破坏不变性的代码
2. **临时 console.log** — 在 IPC handler 入口打印参数和 worker 状态，追踪路由是否正确，验证后删除
3. **模拟用户操作序列** — 不是测单个函数，而是按用户的操作步骤从头到尾走一遍
4. **Playwright CDP 连接 Electron** — 用 `chromium.connectOverCDP()` 代替 `playwright-cli attach`，解决 headless Electron 交互问题
5. **Read 沿调用链逐层读** — 从 renderer handler → hook → preload IPC → main handler → worker，每一层检查参数传递和映射
6. **Read Map 容器的 get/set** — 检查 key 和 value 的一致性，特别关注 value 的标识字段是否被 mutate

---

## 四、碰到这类问题的方法论

### 1. 不要猜，追踪数据流

Session 切换涉及 renderer → main → worker 三层，事件又有反向路径。任何一层的映射错误都会导致"消息黑洞"。正确的做法是：**写出完整的数据流路径，逐步检查每个节点**。

### 2. Map/Cache 的 key-value 一致性是隐性地雷

`Map.set(oldKey, state)` + `state.path = newPath` = 灾难。Key 没更新但 value 变了，`get(newPath)` 永远找不到。

**规则**: 如果 state 有唯一标识字段，Map key 必须与之一致。要么：
- 永远不 mutate 标识字段（推荐，本次采用的方案）
- mutate 时同步更新 Map key（`delete old → set new`）

### 3. 不要用"当前状态查询"获取"操作结果"

`currentSession` 查询 Primary 的 `get_state()`，但 Primary 在 fork 后已 switch back。查询到的是"Primary 当前在哪个 session"，不是"刚创建的新 session 在哪"。

**规则**: 操作结果从操作本身返回，不要用副作用查询。

### 4. Worker 的 sessionPath 是身份标识，不是状态变量

Primary worker 的 `sessionPath` 定义了它"是谁"（映射到哪个 session），不是"现在在干什么"。fork/new/clear 操作暂时切换了 SDK 的内部 session，但 worker 的身份不应该变。

**类比**: git branch name 是身份，`git checkout` 切换的是 HEAD，不是 branch name。Worker 的 `sessionPath` = branch name，SDK 内部的 `sessionFile` = HEAD。

### 5. 端到端测试是最终验证

代码审查和逻辑推导可以发现大部分 bug，但只有实际运行才能验证：
- IPC 序列化是否正确
- 异步时序是否有竞争
- SDK 行为是否符合预期

本次用 Playwright CDP 连接 Electron 做自动化测试，覆盖了完整的用户操作流程。

---

## 五、修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `src/main/worker-manager.ts` | `connected` 回调：`sessionFile !== state.sessionPath` → `!state.sessionPath` |
| `src/main/index.ts` | forkAtEntry/newSession/clearSession：移除 `worker.sessionPath = sp`，统一 switch back 逻辑，返回 `sessionPath` |
| `src/renderer/src/types/session.ts` | 三个 IPC 返回类型加 `sessionPath?: string` |
| `src/renderer/src/hooks/useSessionManager.ts` | forkAtEntry/newSession/clearSession 返回新 session 路径 |
| `src/renderer/src/App.tsx` | 四个 handler 用后端返回路径替代 `currentSessionRef`；handleForkFromEnd 空 session fallback |

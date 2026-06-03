# Settings Panel Redesign Spec

## 1. Overview

将 Settings Panel 从"只有 Provider API Key 配置"升级为完整的设置面板，改善窄面板（260px）下的 UX。

核心问题：
- 只有 Provider 设置，没有 General 设置
- 已配置 Provider 列表与未配置 Provider 卡片重复
- Custom provider 表单太长，在 260px 面板里不好用
- 保存后无法验证 key 是否有效
- 没有 model 选择

## 2. 参考项目

| 项目 | 模式 | 值得借鉴 |
|------|------|---------|
| **Dyad** | Grid 卡片 + 路由跳转配置页 + 状态 pill | `Ready`/`Needs Setup` 徽章、`Free Tier` 标签、Custom provider 用 Dialog |
| **Goose** | Modal 弹窗 + ParameterSchema 动态表单 | 动态表单字段、OAuth 支持、SecureStorageNotice、Cannot-delete-active 提示 |
| **OpenCowork** | Config Sets + Diagnostics | 多套配置切换、连接诊断面板、协议引导文案 |
| **OpenHuman** | Error categorization | 401/403 = credentials rejected，连接失败 = unreachable，分类展示 |

## 3. 新 Settings Panel 结构

```
┌──────────────────────────┐
│  Settings         [📁]   │  ← header（config dir 按钮）
├──────────────────────────┤
│ [Providers] [General]    │  ← section tabs
├──────────────────────────┤
│                          │
│  (当前 section 内容)      │
│                          │
└──────────────────────────┘
```

两个 section：
1. **Providers** — Provider 配置（改进现有 ProviderSetup）
2. **General** — 通用设置（新增）

### 3.1 Section Tabs

- 高度 `28px`，水平排列两个 tab
- 活跃 tab → `bg-gray-200 text-gray-900 rounded-md`
- 非活跃 tab → `text-gray-500 hover:text-gray-700`
- 默认显示 Providers

---

## 4. Providers Section（改进）

### 4.1 统一 Provider 列表

**现状问题**：上面 8 个卡片 + 下面 "Configured" 列表，信息重复。

**改为**：统一一个列表，每张卡片同时展示状态和操作入口。

```
┌──────────────────────────┐
│  ┌─── Anthropic ───────┐ │
│  │ 🟠 A  Claude  ✓     │ │  ← 已配置：绿色 ✓ + 管理按钮
│  │     [Manage]         │ │
│  └─────────────────────┘ │
│  ┌─── OpenAI ──────────┐ │
│  │ 🟢 O  GPT     ○     │ │  ← 未配置：灰色空心圆
│  └─────────────────────┘ │
│  ┌─── Google ──────────┐ │
│  │ 🔵 G  Gemini  ○     │ │
│  └─────────────────────┘ │
│  ...                     │
└──────────────────────────┘
```

#### 4.1.1 Provider Card 状态

| 状态 | 左侧标记 | 右侧 | 点击行为 |
|------|----------|------|---------|
| 未配置 | 彩色首字母 | 灰色空心圆 `○` | 展开内联 key 输入 |
| 已配置 | 彩色首字母 | 绿色 `✓` | 展开管理面板（重设 key / 删除） |
| 验证中 | 彩色首字母 | Loading spinner | 无 |

#### 4.1.2 未配置时展开（内联 key 输入）

```
┌─── OpenAI ──────────────┐
│ 🟢 O  GPT          [×]  │  ← [×] 关闭展开
│                          │
│ API Key                  │
│ ┌──────────────────┬───┐ │
│ │ sk-...           │👁 │ │  ← password input + toggle visibility
│ └──────────────────┴───┘ │
│ [Get API key →]          │  ← 外链到 provider key 页面
│                          │
│ [Save]                   │
└──────────────────────────┘
```

- 展开时卡片背景 `bg-blue-50/40`，边框 `border-blue-200`
- 与现有 selectedProvider 逻辑相同，只是去掉了底部重复的 Configured 区

#### 4.1.3 已配置时展开（管理面板）

```
┌─── Anthropic ───────────┐
│ 🟠 A  Claude   ✓   [×]  │
│                          │
│ Source: environment      │  ← key 来源（env / stored）
│                          │
│ ┌──────────────────────┐ │
│ │ Test Connection      │ │  ← 测试按钮
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Replace Key          │ │  ← 展开替换 key 输入
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Remove               │ │  ← 红色，删除确认
│ └──────────────────────┘ │
└──────────────────────────┘
```

- 点击已配置卡片 → 展开管理面板
- **Test Connection**：调用一个轻量 API（如 models list）验证 key
- **Replace Key**：展开后显示 key 输入框 + Save
- **Remove**：二次确认后删除 key（复用现有 handleRemoveAuth）

### 4.2 Custom Provider（Dialog 改造）

**现状问题**：Custom provider 表单 7 个字段，在 260px 面板内展开太长。

**改为**：点击 "Add custom provider" → 弹出居中 Dialog。

```
┌──────────────────────────────────────┐
│  Add Custom Provider            [×]  │
├──────────────────────────────────────┤
│                                      │
│  Provider ID   [my-llm          ]   │
│  Display name  [My LLM Server   ]   │
│  Base URL      [https://api...  ]   │
│  API Key       [sk-...          ]   │
│                (optional)            │
│  Model ID      [my-model-v1     ]   │
│  Model name    [My Model V1     ]   │
│                                      │
│  ☑ Reasoning support                 │
│  Context window: [128000         ]   │
│                                      │
│           [Cancel]  [Add Provider]   │
└──────────────────────────────────────┘
```

- Dialog 宽度 `480px`，不受面板宽度限制
- 使用 createPortal 挂载到 document.body
- 保存成功后关闭 Dialog，刷新 provider 列表
- 已有的 Custom provider 在列表中显示，右上角有编辑（重新打开 Dialog）/ 删除按钮

### 4.3 连接测试（Test Connection）

新增 IPC：

| Channel | 方向 | Payload | 说明 |
|---------|------|---------|------|
| `provider:test` | renderer → main | `provider: string` | 用已存储的 key 调用轻量 API |

实现方式：
- OpenAI / Anthropic / Google 等：调用 `/models` endpoint，返回 200 = 成功
- Custom provider：调用 `{baseUrl}/models`
- 超时 10s
- 返回 `{ ok: boolean, error?: string, latencyMs?: number }`

UI 表现：
- 按钮：`Test Connection`
- 测试中：按钮 disabled + spinner
- 成功：绿色文字 `Connected (120ms)`
- 失败：红色文字 + 具体错误原因

错误分类（参考 OpenHuman）：

| 错误 | 展示 |
|------|------|
| 401/403 | `Invalid API key — credentials rejected` |
| 网络不可达 | `Cannot reach server — check Base URL` |
| 超时 | `Connection timed out (10s)` |
| 其他 | 原始错误信息 |

### 4.4 Provider Card 视觉规格

```
┌────────────────────────────┐
│ [■] Name    Subtitle  [●]  │  ← 一行
└────────────────────────────┘
```

| 元素 | 规格 |
|------|------|
| 彩色方块 `[■]` | `h-6 w-6 rounded-md text-white text-xs font-bold`，背景色 = provider color |
| Name | `text-xs font-medium text-gray-900` |
| Subtitle | `text-[10px] text-gray-400` |
| 状态标记 `[●]` | 已配置：`✓` green-500；未配置：空心圆 border-2 gray-300 |
| 卡片 | `rounded-lg border px-3 py-2`，hover `border-gray-300 bg-gray-50` |
| 已配置卡片 | `border-green-200 bg-green-50/40` |
| 选中/展开 | `border-blue-200 bg-blue-50/40` |

---

## 5. General Section（新增）

### 5.1 初始范围

Phase 1 只加 3 项最常用的 General 设置：

| 设置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| Font Size | number input | `14` | 编辑器/终端字号 |
| Default Model | dropdown | 当前活跃 model | 从已配置 provider 的模型列表选择 |
| Theme | dropdown | `system` | `system` / `light` / `dark`（预留，Phase 1 不实现 dark） |

### 5.2 UI 布局

```
┌──────────────────────────┐
│  Editor                  │
│  ┌────────────────────┐  │
│  │ Font Size    [14 ] │  │
│  └────────────────────┘  │
│                          │
│  AI                      │
│  ┌────────────────────┐  │
│  │ Default Model  [▾] │  │
│  │   Claude 3.5 Sonet │  │
│  └────────────────────┘  │
│                          │
│  Appearance              │
│  ┌────────────────────┐  │
│  │ Theme     [System▾]│  │
│  └────────────────────┘  │
└──────────────────────────┘
```

- 每个设置项：`label`（左）+ `control`（右），行高 `36px`
- Group header：`text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2`
- 设置变更即保存（auto-save），不需要 Save 按钮
- 持久化到 localStorage：`xi-settings-font-size`、`xi-settings-default-model`、`xi-settings-theme`

### 5.3 Default Model Dropdown

数据来源：
- 从 Pi SDK 获取已配置 provider 的可用模型列表
- 显示格式：`Provider / Model Name`
- 选择后设为全局默认 model（下次新 session 使用）
- 如果 SDK 暂不支持 enumerate models，Phase 1 可以先做成手动输入 model ID

### 5.4 Font Size

- 范围：`10` — `24`
- 步进：`1`
- 影响范围：FileViewer、Terminal、ChatView 的代码块
- 实现：CSS 变量 `--xi-font-size`，各组件读取

---

## 6. 组件变更

### 6.1 新增组件

| 组件 | 路径 | 说明 |
|------|------|------|
| `SettingsPanel` | `components/SettingsPanel.tsx` | 设置面板容器（section tabs + 内容切换） |
| `ProviderCard` | `components/ProviderCard.tsx` | 单个 provider 卡片（含展开逻辑） |
| `CustomProviderDialog` | `components/CustomProviderDialog.tsx` | Custom provider 弹窗表单 |
| `GeneralSettings` | `components/GeneralSettings.tsx` | General 设置区 |

### 6.2 修改组件

| 组件 | 变更 |
|------|------|
| `ProviderSetup.tsx` | 重构：去掉重复的 Configured 区，provider 卡片点击已配置也展开管理面板，custom provider 改为 Dialog 触发 |
| `LeftPanel.tsx` | settings view 渲染 `SettingsPanel` 替代直接渲染 `ProviderSetup` |

### 6.3 删除组件

| 组件 | 说明 |
|------|------|
| — | ProviderSetup 重构后保留，不删除 |

---

## 7. 新增 IPC

| Channel | 方向 | Payload | 说明 |
|---------|------|---------|------|
| `provider:test` | renderer → main | `{ provider: string }` | 测试 provider 连接，返回 `{ ok, error?, latencyMs? }` |
| `provider:listModels` | renderer → main | `{ provider: string }` | 列出 provider 可用模型（Phase 2，如 SDK 支持） |

---

## 8. 状态管理

### 8.1 localStorage Keys

| Key | 类型 | 默认值 |
|-----|------|--------|
| `xi-settings-section` | `'providers' \| 'general'` | `'providers'` |
| `xi-settings-font-size` | `number` | `14` |
| `xi-settings-default-model` | `string` | `''` |
| `xi-settings-theme` | `'system' \| 'light' \| 'dark'` | `'system'` |

### 8.2 Provider 测试状态

组件内部 state，不持久化：

```typescript
type TestResult = 
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; latencyMs: number }
  | { status: 'error'; message: string }
```

---

## 9. 实施阶段

### Phase 1: Provider Card 统一 + Custom Dialog

- [ ] 重构 ProviderSetup：统一 provider 列表，去掉底部 Configured 区
- [ ] 已配置卡片点击展开管理面板（Replace Key / Remove）
- [ ] Custom provider 表单 → CustomProviderDialog（createPortal）
- [ ] LeftPanel settings view 渲染新组件

**验收**：8 个 provider 卡片在一个列表，已配置/未配置点击展开不同面板，custom provider 弹窗创建。

### Phase 2: 连接测试 + General 设置

- [ ] `provider:test` IPC 实现
- [ ] 管理面板添加 Test Connection 按钮
- [ ] 错误分类展示
- [ ] SettingsPanel 容器 + section tabs
- [ ] GeneralSettings 组件（Font Size / Default Model / Theme）
- [ ] 字号 CSS 变量应用到 FileViewer / Terminal

**验收**：可以测试 provider 连接、修改字号生效、选择默认 model。

### Phase 3: Model 选择器增强

- [ ] `provider:listModels` IPC（如 SDK 支持）
- [ ] Default Model dropdown 显示实际模型列表
- [ ] Provider card 展开显示该 provider 的可用模型

**验收**：模型列表从 API 获取而非手动输入。

---

## 10. 约束

- 面板宽度 260px，所有 UI 必须在 260px 内可用
- 不引入新 icon 库，全部使用 inline SVG
- 不引入新 UI 框架（shadcn/radix 等），保持当前纯 Tailwind + 手写组件风格
- CustomProviderDialog 使用 createPortal，不依赖第三方 Dialog 库
- 连接测试不发送实际对话请求，只用 `/models` 等轻量 endpoint
- Theme 切换 Phase 1 只保存选择，不实际切换（dark mode 后续实现）

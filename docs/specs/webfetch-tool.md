# Spec: webfetch Tool

## 背景

Xi 的 agent 当前没有联网能力。`bash` + `curl` 可以获取 URL 内容，但返回原始 HTML，模型需要从标签中提取信息，token 浪费严重，大页面容易截断。

`webfetch` 做一件事：**fetch URL → 转 Markdown → 返回干净文本**。

## 实现

作为 Pi SDK 的 custom tool 注册在 `pi-worker.ts` 中，与 `search_sessions`、`subagent` 同级。不需要 Pi Extension 机制，不需要主进程或渲染层参与。

```typescript
// pi-worker.ts → createRuntime
tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'search_sessions', 'subagent', 'webfetch'],
customTools: [guardedWriteTool, guardedEditTool, createSearchSessionsTool(...), createSubagentTool(), createWebfetchTool()],
```

### 架构

```
Agent 调用 webfetch(url="https://react.dev/reference/react/useState", format="markdown")
  │
  ▼
1. URL 校验 + HTTP→HTTPS 自动升级
   │
   ▼
2. fetch(url, { signal: AbortSignal.timeout(30s) })
   ├─ 跟随重定向（最多 5 次，fetch 默认行为）
   ├─ 检查 Content-Type
   └─ 读取响应体
   │
   ▼
3. 根据 format 参数转换：
   ├─ markdown (默认): HTML → TurndownService → Markdown
   ├─ text:             HTML → 去标签 → 纯文本
   └─ html:             原样返回
   │
   ▼
4. 内容截断（超过 51200 字符截断 + "...[truncated]" 后缀）
   │
   ▼
5. 返回 { content: [{ type: 'text', text }] }
```

### 工具定义

```typescript
function createWebfetchTool() {
  return {
    name: 'webfetch',
    label: 'webfetch',
    description:
      'Fetch content from a URL and return it as clean, readable text. ' +
      'HTML pages are automatically converted to Markdown, stripping tags and scripts. ' +
      'Use this to read documentation, API references, blog posts, or any web page. ' +
      'For JSON APIs or raw text, use bash + curl instead.',
    parameters: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string' as const,
          description: 'The URL to fetch. HTTP URLs are automatically upgraded to HTTPS.',
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'text', 'html'],
          description: 'Output format: "markdown" (default, HTML→Markdown), "text" (plain text, no tags), "html" (raw HTML).',
          default: 'markdown',
        },
      },
      required: ['url'],
    },
    execute: async (_toolCallId: string, params: { url: string; format?: string }, _signal: AbortSignal | undefined) => {
      // 见下方「核心实现」
    },
  }
}
```

### 核心实现

```typescript
import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
})

// 移除 script/style/noscript 标签内容，避免噪音
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg'])

const MAX_CONTENT_LENGTH = 51_200  // 50KB
const FETCH_TIMEOUT_MS = 30_000    // 30s

function createWebfetchTool() {
  return {
    // ... name, label, description, parameters 同上 ...
    execute: async (_toolCallId: string, params: { url: string; format?: string }) => {
      let url: string
      try {
        // 校验 URL + HTTP→HTTPS 升级
        const parsed = new URL(params.url)
        if (parsed.protocol === 'http:') parsed.protocol = 'https:'
        if (parsed.protocol !== 'https:') {
          return { content: [{ type: 'text' as const, text: `Error: Only http/https URLs are supported. Got: ${parsed.protocol}` }] }
        }
        url = parsed.toString()
      } catch {
        return { content: [{ type: 'text' as const, text: `Error: Invalid URL: ${params.url}` }] }
      }

      // fetch with timeout
      let response: Response
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { 'User-Agent': 'Xi/1.0 (webfetch tool)' },
          redirect: 'follow',
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: `Error fetching ${url}: ${msg}` }] }
      }

      if (!response.ok) {
        return { content: [{ type: 'text' as const, text: `HTTP ${response.status} ${response.statusText}: ${url}` }] }
      }

      const contentType = response.headers.get('content-type') || ''
      const raw = await response.text()
      const format = params.format ?? 'markdown'

      let text: string

      if (format === 'html' || contentType.includes('json') || contentType.includes('text/plain')) {
        // JSON / 纯文本 / 显式 html 格式：原样返回
        text = raw
      } else if (format === 'text') {
        // 纯文本：去标签
        text = raw.replace(/<[^>]+>/g, '').replace(/\s{3,}/g, '\n\n').trim()
      } else {
        // markdown（默认）：HTML → Markdown
        text = turndown.turndown(raw)
      }

      // 截断
      if (text.length > MAX_CONTENT_LENGTH) {
        text = text.substring(0, MAX_CONTENT_LENGTH) + '\n\n...[truncated]'
      }

      return { content: [{ type: 'text' as const, text }] }
    },
  }
}
```

### System Prompt 更新

在 `systemPromptOverride` 的 `Available tools` 列表中添加：

```
- webfetch: Fetch a URL and return content as Markdown. Use for reading docs, API references, or web pages. For JSON APIs, use bash + curl.
```

在 `Guidelines` 中添加：

```
- Use webfetch to read web pages (documentation, API references, articles). For JSON APIs or when you need headers/status codes, use bash + curl.
```

## URL 校验规则

| 输入 | 处理 |
|------|------|
| `https://example.com` | 直接请求 |
| `http://example.com` | 升级为 `https://example.com` |
| `ftp://example.com` | 拒绝：`Only http/https URLs are supported` |
| `not a url` | 拒绝：`Invalid URL` |
| 空 URL | 拒绝：`Invalid URL` |

## Content-Type 处理

| Content-Type | 默认行为 | 说明 |
|---|---|---|
| `text/html` | HTML→Markdown | 主要场景 |
| `application/json` | 原样返回 | JSON 转 Markdown 无意义 |
| `text/plain` | 原样返回 | 已经是纯文本 |
| `application/xml` | 原样返回 | XML 转 Markdown 可能破坏结构 |
| 其他 | 尝试 HTML→Markdown | 保守策略，大部分 URL 返回 HTML |

当 `format` 参数显式指定时，覆盖 Content-Type 判断。

## 依赖

| 包 | 版本 | 大小 | 用途 |
|---|---|---|---|
| `turndown` | ^7.2.0 | ~15KB minified | HTML→Markdown 转换 |

依赖链：`turndown` → `@mixmark-io/domino`（纯 JS DOM 实现，无 native binding，无 platform 包）。

无其他依赖。`fetch()` 是 Node 18+ 内置（Xi 要求 Node ≥ 18）。`AbortSignal.timeout()` 同为 Node 18+ 内置。

## 修改的文件

| 文件 | 改动 |
|---|---|
| `src/main/pi-worker.ts` | 新增 `createWebfetchTool()` 函数；`tools` 数组添加 `'webfetch'`；`customTools` 数组添加 `createWebfetchTool()`；system prompt 添加工具说明 |
| `package.json` | 添加 `turndown` 依赖 |

不需要修改渲染层——`webfetch` 的工具调用和结果通过现有的 `tool_call` / `tool_execution_end` 事件流自然渲染，`ToolCallRenderer` 已支持任意工具的折叠展开显示。

## 渲染效果

```
┌─ Xi ────────────────────────────────────────┐
│                                              │
│  🔗 webfetch  react.dev/reference/react/..  │  ← 一行摘要，默认折叠
│  ─────────────────────────────────────────── │
│                                              │
│  我查了 React useState 的文档，要点如下：     │  ← 正常 prose
│                                              │
└──────────────────────────────────────────────┘
```

展开 webfetch 条目后显示 args（url, format）和返回的 Markdown 内容。

## 边界情况

| 场景 | 处理 |
|---|---|
| URL 不可达 / DNS 解析失败 | 返回 `Error fetching {url}: {message}` |
| 请求超时（30s） | `AbortSignal.timeout` 触发，返回超时错误 |
| HTTP 4xx/5xx | 返回 `HTTP {status} {statusText}: {url}`，不抛异常 |
| 重定向 | `redirect: 'follow'`，fetch 自动跟随（最多 5 次） |
| 响应体 > 50KB | 截断 + `...[truncated]` 后缀 |
| JSON 响应 | 原样返回（不转 Markdown） |
| 纯文本响应 | 原样返回 |
| 空响应体 | 返回空字符串 |
| gzip/br 压缩 | fetch 自动解压 |
| 非 UTF-8 编码 | 按 UTF-8 解码（`response.text()` 默认行为） |
| SSL 证书错误 | fetch 抛异常，返回错误信息 |
| script/style 标签 | Turndown 配置 `remove()` 过滤 |

## 为什么不用 bash + curl

| | bash + curl | webfetch |
|---|---|---|
| 返回内容 | 原始 HTML | Markdown（干净文本） |
| Token 消耗 | 高（`<div class="...">` 满屏） | 低（只有内容） |
| script/style 噪音 | 全部返回 | 过滤 |
| 模型理解 | 需自行解析标签 | 直接可读 |
| HTTP→HTTPS | 不处理 | 自动升级 |
| 超时控制 | 需手动 `--max-time` | 内置 30s |
| 错误处理 | 需检查 `$?` | 结构化错误消息 |

适用场景区分：**webfetch 读网页，curl 调 API**（需要 headers、POST body、自定义认证等场景仍然用 curl）。

## 未来扩展

1. **Readability 预处理**：先用 `@mozilla/readability` 提取正文，再转 Markdown。对新闻、博客文章效果好，对 API 文档可能过度提取。可选，作为 `format: "readable"` 选项。
2. **robots.txt 尊重**：当前不检查 robots.txt。如需合规可加入。
3. **缓存**：相同 URL 在短时间内重复请求时返回缓存。当前不做——agent 通常不会重复请求同一 URL。
4. **websearch**：比 webfetch 更高层，需要搜索 API provider。作为独立工具后续实现。

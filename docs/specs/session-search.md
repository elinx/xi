# Spec: Session 搜索 (search_sessions Tool)

## 背景

Xi 的 session 是树形结构的对话历史。随着项目发展，用户会产生大量 session，每个 session 都包含有价值的讨论和决策。Pi agent 的搜索能力仅限于文件系统（`read`, `grep`, `find`, `bash`），无法搜索其他 session 的对话内容。

核心洞察：**所有 session 的对话历史构成了 agent 的全局长期记忆**。让 agent 能搜索这些记忆，等于从「单 session 有限上下文」升级到「跨 session 全局记忆」。

## 实现

`search_sessions` 作为 Pi SDK 的 custom tool 注册在 `createSearchSessionsTool()` 中（`src/main/pi-worker.ts`），随 Pi worker 初始化时注入。

```typescript
// pi-worker.ts → createRuntime
customTools: [guardedWriteTool, guardedEditTool, createSearchSessionsTool(cwd, sm.getSessionFile())]
```

每次工具调用时，读取项目中所有 session JSONL 文件，构建 MiniSearch 内存索引，执行搜索后返回结果。不做持久化索引——session 数量通常 <100，实时构建足够快。

### 为什么不是 Pi Extension

旧 spec 设想用 `.pi/extensions/session-search.ts` 实现。实际改为直接在 `pi-worker.ts` 内注册 custom tool，原因：

1. Extension 的 `pi.registerTool()` 在 Pi SDK 的 extension API 中，类型和接口不如 `customTools` 稳定
2. `customTools` 在 `createAgentSessionFromServices` 时注入，与 worker 生命周期一致，更可控
3. 不需要额外的文件，所有搜索逻辑内聚在一个函数中

### 搜索管线

```
Agent 调用 search_sessions(query="CORS 跨域", limit=5)
  │
  ▼
1. tokenize(query) → ["cors", "跨域"]
   ├─ Latin: 按空格/标点拆分，lowercase
   └─ CJK: Intl.Segmenter 分词 + bigrams
  │
  ▼
2. 读取 .xi/sessions/*.jsonl → SessionDoc[]
   ├─ 提取 name, summary, parentSessionPath
   ├─ user messages → userContent 字段
   ├─ assistant messages → assistantContent 字段
   └─ compaction → compactionSummary 字段
  │
  ▼
3. MiniSearch.addAll(SessionDoc[])
   ├─ BM25+ 评分
   ├─ 字段 boost: name×10, summary×8, compactionSummary×6, userContent×3, assistantContent×1
   └─ combineWith: AND（所有词都匹配）
  │
  ▼
4. MiniSearch.search(query) → 按分数排序
  │
  ▼
5. Fork tree 去重（同 parent session 只保留最高分结果）
  │
  ▼
6. 生成 excerpt（优先 summary > compaction > userContent > firstUserMessage）
  │
  ▼
7. 格式化输出返回给 LLM
```

## CJK 分词

### 方案选择

| 方案 | CJK 质量 | 依赖 | 评分 |
|------|---------|------|------|
| `Intl.Segmenter` + bigrams | ⭐⭐⭐⭐ | 零（Node 20 内置） | ✅ 采用 |
| `@node-rs/jieba` | ⭐⭐⭐⭐⭐ | native addon (napi) | ❌ Electron 打包复杂 |
| `jieba-wasm` | ⭐⭐⭐⭐⭐ | WASM (~5MB) | ❌ 过重 |
| 精确子串匹配 (旧) | ⭐ | 零 | ❌ 中文搜不到 |

### Intl.Segmenter + Bigrams 原理

`Intl.Segmenter` 对中文做词级切分，但存在过度切分的问题：

```
"长江大桥" → ["长江", "大", "桥"]    ← 过度切分，"大桥" 丢失
"搜索引擎" → ["搜索", "引擎"]        ← 正确
"系统休眠" → ["系统", "休眠"]        ← 正确
```

对 ≥3 字符的 CJK 词额外生成 bigrams，弥补过度切分：

```
"长江大桥" → tokens: ["长江", "大桥"] + bigrams: ["长江", "江大", "大桥"]
```

查询时同一 tokenizer 作用于 query，所以 `"大桥"` 能匹配到 bigram `"大桥"`。

### 实现

```typescript
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

function tokenize(text: string): string[] {
  const tokens: string[] = []
  const segments = text.split(/[\n\r\p{Z}\p{P}]+/u)
  for (const seg of segments) {
    if (!seg) continue
    if (CJK_PATTERN.test(seg)) {
      const words = [...segmenter.segment(seg)]
        .filter(s => s.isWordLike).map(s => s.segment)
      for (const word of words) {
        tokens.push(word.toLowerCase())
        if (word.length >= 3 && CJK_PATTERN.test(word)) {
          for (let i = 0; i <= word.length - 2; i++)
            tokens.push(word.substring(i, i + 2).toLowerCase())
        }
      }
    } else {
      if (seg.length >= 1) tokens.push(seg.toLowerCase())
    }
  }
  return tokens
}
```

## 搜索算法：MiniSearch + BM25+

### 为什么用 MiniSearch

| 特性 | MiniSearch | 旧 includes() |
|------|-----------|---------------|
| 多词匹配 | AND（所有词匹配） | 精确子串（整句匹配） |
| 词频降权 | BM25+ IDF 自动降权 | 无（"session" 和 "electron" 同权） |
| 字段权重 | `boost: { name: 10, ... }` | 手动加分 `score += 5/10` |
| CJK 支持 | 通过自定义 tokenizer | 无 |
| 模糊/前缀 | prefix search | 无 |
| 大小 | ~7KB gzip | 0 |

### 字段与权重

每个 session 解析为一个文档，包含 5 个可搜索字段：

| 字段 | 内容 | Boost | 理由 |
|------|------|-------|------|
| `name` | session 名称 | ×10 | 名称是最精炼的意图描述 |
| `summary` | session_info.summary | ×8 | AI 生成的摘要，高质量上下文 |
| `compactionSummary` | compaction 条目 | ×6 | 历史上下文压缩，信息密度高 |
| `userContent` | 所有 user 消息拼接 | ×3 | 用户意图 > 代码 |
| `assistantContent` | 所有 assistant 消息拼接 | ×1 | 主要是工具输出/代码，信息密度低 |

### BM25+ 参数

MiniSearch 使用 BM25+ 变体（带 δ 下界），默认参数：

```typescript
{ k: 1.2, b: 0.7, d: 0.5 }
```

- `k`: 词频饱和参数，1.2 是标准值
- `b`: 长度归一化，0.7 略低于标准 0.75，对长消息稍有宽容
- `d`: BM25+ delta 下界，0.5 确保每篇文档至少有基础分

### IDF 降权效果

实测对比（同一数据集）：

| 查询 | 旧 includes() | 新 BM25+ |
|------|--------------|----------|
| `"electron"` (1/8 docs) | score=1 | score=57.2 |
| `"session"` (5/8 docs) | score=1 | score=28.0 |
| 差异比 | 1:1 | 2:1 |

IDF 自动让稀有词得到更高分，解决 "session 命中 84% 的 session" 问题。

## Fork Tree 去重

Xi 的 session 是树形结构，同一 parent 下可能有多个 child session 讨论同一主题的子任务。搜索时同一棵 tree 下的多个 session 会返回重复内容。

去重策略：**同一 parentSessionPath 只保留得分最高的结果**。

```typescript
const seenParents = new Map<string, number>()
for (const result of searchResults) {
  const parentKey = result.parentSessionPath || result.filePath
  if (seenParents.has(parentKey)) {
    if (result.score > deduped[seenParents.get(parentKey)!].score)
      deduped[seenParents.get(parentKey)!] = result
  } else {
    seenParents.set(parentKey, deduped.length)
    deduped.push(result)
  }
}
```

## Excerpt 生成

### 优先级

搜索结果最多展示 2 条 excerpt，按以下优先级选取：

1. **summary** — AI 生成的摘要，最精炼
2. **compactionSummary** — 历史上下文压缩
3. **userContent** — 用户消息（跳过代码片段）
4. **firstUserMessage** — 当以上都为空时，展示第一条用户消息作为上下文

### 代码片段过滤

assistant 消息中 73× 于 user 消息的命中主要是工具输出和代码，对 LLM 理解 "这个 session 做了什么" 帮助不大。`isCodeLike()` 检测 excerpt 是否主要是代码，如果是则跳过：

```typescript
function isCodeLike(text: string): boolean {
  const codeIndicators = /^(const |let |var |import |from ['"]|function |class |return |...)/
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length === 0) return false
  const codeLines = lines.filter(l => codeIndicators.test(l.trim()))
  return codeLines.length / lines.length > 0.5
}
```

### Name-only 匹配

旧实现中，session 名称匹配但消息内容不匹配时显示 `(name match only)`，LLM 完全不知道这个 session 讨论了什么。

新实现：当没有 excerpt 可用时，展示第一条 user message 作为上下文：

```
## bugfix: input lost
  1. "(first message) 系统休眠唤醒，或者从其他页面返回主界面，之前输入的内容在input box都消失了"
```

## 输出格式

```
## session-name
  1. "excerpt text..."
  2. "another excerpt..."
```

变更：
- 移除 `Path:` 行（旧: `Path: /full/path/to/file.jsonl`）——Path 对 LLM 无用，只增加 token
- session 名为空时 fallback 到文件名

## 输入参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `query` | string | 必填 | 搜索查询，多词使用 AND 逻辑，支持中英文 |
| `limit` | number | 10 | 最大返回结果数 |

## 测试覆盖

| 测试文件 | 覆盖内容 |
|---------|---------|
| `test/issue-20-search-sessions.test.ts` | 基本搜索、大小写不敏感、limit、空结果、多词 AND、CJK 搜索、混合中英文、IDF 权重、字段 boost、summary boost |

## 依赖

| 包 | 版本 | 大小 | 用途 |
|----|------|------|------|
| `minisearch` | ^7.x | ~7KB gzip | BM25+ 评分、AND 匹配、字段 boost |

无 native 依赖。CJK 分词使用 Node 内置 `Intl.Segmenter`。

## 边界情况

| 场景 | 处理 |
|------|------|
| 空 query | 返回 "Empty query." |
| 没有其他 session | 返回 "No sessions directory found." 或 "No sessions found matching ..." |
| 当前 session | 排除在搜索范围外（`filter(f => f !== currentSessionFile)`） |
| Session 正在 streaming | 文件可能不完整，JSON parse 失败的行被跳过 |
| 查询词太常见（如 "session"） | IDF 自动降权，分数低于稀有词 |
| 纯中文查询 | `Intl.Segmenter` 分词 + bigrams |
| 混合中英文查询 | tokenizer 自动识别 CJK/Latin 段落 |
| Fork tree 下多个 child 命中 | 去重，只保留最高分 |

## 演进历史

### v1 → v2：从 includes() 到 MiniSearch

v1 的问题（来自 agent 自诊断的 23 次调用分析）：

| 问题 | 影响 | v2 修复 |
|------|------|---------|
| 多词精确子串匹配 | "drag commit project path" 只命中 1 个（精确子串）vs 46 个（词 AND） | MiniSearch `combineWith: 'AND'` |
| 高频词无降权 | "session" 命中 84% 的 session | BM25+ IDF 自动降权 |
| name-only 无上下文 | 15/20 结果只有 session 名 | 展示 firstUserMessage |
| summary 权重形同虚设 | 4% 覆盖率，×10 权重无意义 | 改用 BM25+ 统一评分 |
| 同 fork tree 重复 | 同一 parent 下 5 个 child 全返回 | fork tree 去重 |
| assistant 消息 73× 于 user | 信息密度低 | userContent ×3 vs assistantContent ×1 |
| Path 冗余 | 占 7% token，LLM 只会 cat 文件 | 移除 Path |
| 代码 excerpt | 30% excerpt 是代码 | isCodeLike() 过滤 |
| 不支持中文 | "休眠 唤醒" → 0 结果 | Intl.Segmenter + bigrams |

## 未来扩展

1. **增量索引**：缓存 MiniSearch 实例，只在 session 文件变更时重建
2. **语义搜索**：用 embedding 替代关键词匹配，更精准
3. **自动注入上下文**：`before_agent_start` 事件中自动注入相关 session 摘要
4. **@node-rs/jieba 升级**：如果 Electron 打包问题解决，替换 Intl.Segmenter 获得更好的中文分词
5. **搜索结果跳转**：用户端 SearchPanel 复用搜索逻辑

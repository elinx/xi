# Pi Core Components Investigation

## 1. Overview

Pi (`@earendil-works/pi-coding-agent` v0.75.5) is a terminal-based coding agent. It consists of 3 packages:

| Package | Purpose |
|---|---|
| `pi-agent-core` | Agent loop, state management, tool execution, event system |
| `pi-ai` | LLM provider abstraction, streaming, model registry |
| `pi-tui` | Terminal UI components (only for interactive mode) |
| `pi-coding-agent` | CLI + TUI + RPC mode + session management + tools + extensions |

Pi runs in 4 modes:
- **Interactive** (default): full TUI with editor, keyboard shortcuts
- **Print / JSON**: one-shot output, no TUI
- **RPC** (`--mode rpc`): JSON-line protocol on stdin/stdout for process integration
- **SDK**: embedding in other Node.js apps

We currently use **RPC mode** exclusively.

---

## 2. Core Architecture

### 2.1 Agent Loop (`pi-agent-core`)

The agent loop is the heart of Pi. It manages the conversation with the LLM.

**Key interfaces:**

```
AgentLoopConfig {
  model: Model                    // LLM model + provider
  convertToLlm: AgentMessage[] → Message[]  // Convert internal messages to LLM format
  transformContext?: AgentMessage[] → AgentMessage[]  // Pre-LLL context manipulation
  getApiKey?: provider → string   // Dynamic API key resolution (OAuth)
  shouldStopAfterTurn?: context → boolean  // Graceful stop after turn
  getSteeringMessages?: () → AgentMessage[]  // Inject mid-run steering
  getFollowUpMessages?: () → AgentMessage[]  // Queue follow-up after agent finishes
  toolExecution: "sequential" | "parallel"  // Tool execution mode
  beforeToolCall?: (context, signal) → { block?, reason? }  // Block/allow tool calls
  afterToolCall?: (context, signal) → { content?, details?, isError?, terminate? }  // Modify tool results
}
```

**Agent State:**
```
AgentState {
  systemPrompt: string
  model: Model
  thinkingLevel: ThinkingLevel  // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
  tools: AgentTool[]
  messages: AgentMessage[]
  isStreaming: boolean
  streamingMessage?: AgentMessage
  pendingToolCalls: Set<string>
  errorMessage?: string
}
```

**Event System:**
All events flow through `Agent.subscribe(listener)`. Events:
- `agent_start` / `agent_end` — loop lifecycle
- `turn_start` / `turn_end` — per-LLM-call lifecycle
- `message_start` / `message_update` / `message_end` — streaming message events
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` — tool execution events

**Critical hooks for GUI:**
- `beforeToolCall` — can block tool execution (we use this to block `open`)
- `afterToolCall` — can modify tool results
- `transformContext` — can inject/modify messages before sending to LLM
- `shouldStopAfterTurn` — can stop the loop after any turn

---

### 2.2 Session Manager (`pi-coding-agent/core/session-manager`)

Append-only tree-structured session storage in JSONL files.

**Key design:**
- Each session is a `.jsonl` file in `~/.pi/agent/sessions/--<encoded-cwd>--/`
- Entries form a tree via `id`/`parentId` — not a flat list
- `leafId` tracks current position in tree
- Branching = moving `leafId` to an earlier entry, next append creates new branch
- Compaction = summarizing old entries to save context tokens

**Entry types:**

| Type | Purpose |
|---|---|
| `message` | User/assistant/toolResult messages |
| `compaction` | Summary of old messages (replaces them in context) |
| `branch_summary` | Summary of abandoned branch when navigating tree |
| `custom` | Extension-specific data (NOT sent to LLM) |
| `custom_message` | Extension-injected messages (IS sent to LLM) |
| `session_info` | Session metadata (display name) |
| `label` | User-defined bookmark on an entry |
| `thinking_level_change` | Thinking level change record |
| `model_change` | Model change record |

**Key methods:**
- `appendMessage(msg)` — append message, advance leaf
- `branch(branchFromId)` — move leaf to earlier entry
- `branchWithSummary(id, summary)` — branch + summarize abandoned path
- `buildSessionContext()` — get resolved message list for LLM (follows tree path)
- `navigateTree(targetId)` — move to any node in tree
- `createBranchedSession(leafId)` — extract branch to new file
- `newSession(options)` — create new session file
- `static list(cwd)` — list sessions for a project
- `static listAll()` — list all sessions across projects

**Session file header:**
```json
{ "type": "session", "version": 3, "id": "<uuid>", "timestamp": "<ISO>", "cwd": "<path>", "parentSession": "<parent-filepath>" }
```

---

### 2.3 Agent Session (`pi-coding-agent/core/agent-session`)

High-level session orchestrator that binds Agent + SessionManager + Extensions.

**Key capabilities:**
- `prompt(text, options)` — send prompt (handles extension commands, templates, queuing)
- `steer(text)` — inject steering message during streaming
- `followUp(text)` — queue message after agent finishes
- `sendCustomMessage(msg)` — inject custom typed messages
- `sendUserMessage(content)` — inject user message (always triggers turn)
- `abort()` — abort current operation
- `setModel(model)` — switch model
- `cycleModel(direction)` — cycle through available models
- `setThinkingLevel(level)` — set reasoning depth
- `compact(customInstructions?)` — manually compact context
- `setAutoCompactionEnabled(enabled)` — toggle auto-compaction
- `executeBash(command, onChunk?)` — run bash command (adds to context)
- `navigateTree(targetId, options)` — navigate session tree with optional branch summary
- `fork(entryId, options)` — fork from entry to new session
- `switchSession(sessionPath)` — switch to different session file
- `newSession(options)` — create new session (with optional setup callback)
- `setActiveToolsByName(names)` — dynamically enable/disable tools
- `exportToHtml(outputPath?)` — export session as HTML
- `exportToJsonl(outputPath?)` — export current branch as JSONL

---

### 2.4 Tools (`pi-coding-agent/core/tools`)

Pi ships with 7 built-in tools:

| Tool | Description | Details type |
|---|---|---|
| `read` | Read file contents | `ReadToolDetails` (line numbers, truncation info) |
| `write` | Write/create files | - |
| `edit` | Edit files with search/replace | `EditToolDetails` (diff info) |
| `bash` | Execute shell commands | `BashToolDetails` (exit code, timing, output) |
| `grep` | Search file contents (regex) | `GrepToolDetails` (match info) |
| `find` | Find files by pattern | `FindToolDetails` (match paths) |
| `ls` | List directory contents | `LsToolDetails` (file info) |

**Tool creation patterns:**
- `createCodingToolDefinitions(cwd)` — read + bash + edit + write
- `createReadOnlyToolDefinitions(cwd)` — read + grep + find + ls
- `createAllToolDefinitions(cwd)` — all 7 tools
- `withFileMutationQueue(tools)` — serializes file mutations (write, edit)

**Each tool is split into:**
- `createXxxToolDefinition(cwd, options)` — tool definition for LLM (schema, description)
- `createXxxTool(cwd, options)` — executable tool implementation

**Tool hooks (via extension system):**
- `tool_call` event — can block or modify arguments BEFORE execution
- `tool_result` event — can modify result AFTER execution

---

### 2.5 Extension System (`pi-coding-agent/core/extensions`)

Full plugin architecture. Extensions are TypeScript modules loaded from:
- `~/.pi/extensions/`
- `.pi/extensions/` (project-local)
- Pi packages (npm/git)

**Extension API (`pi.*`):**

| Method | Purpose |
|---|---|
| `pi.on(event, handler)` | Subscribe to 25+ event types |
| `pi.registerTool(definition)` | Register custom LLM-callable tool |
| `pi.registerCommand(name, options)` | Register slash command |
| `pi.registerShortcut(key, options)` | Register keyboard shortcut |
| `pi.registerFlag(name, options)` | Register CLI flag |
| `pi.registerProvider(name, config)` | Register custom LLM provider |
| `pi.unregisterProvider(name)` | Remove provider |
| `pi.registerMessageRenderer(type, renderer)` | Custom rendering for custom messages |
| `pi.sendMessage(msg)` | Inject custom message into session |
| `pi.sendUserMessage(content)` | Inject user message |
| `pi.appendEntry(type, data)` | Persist extension state in session |
| `pi.setSessionName(name)` | Set session display name |
| `pi.setLabel(entryId, label)` | Bookmark session entry |
| `pi.exec(command, args, options)` | Execute shell command |
| `pi.getActiveTools()` / `pi.setActiveTools(tools)` | Dynamic tool management |
| `pi.setModel(model)` | Switch model |
| `pi.setThinkingLevel(level)` | Set reasoning depth |
| `pi.getCommands()` | List available commands |

**Extension event types (25+):**

| Event | Can modify? | Purpose |
|---|---|---|
| `resources_discover` | Yes (return paths) | Provide additional skill/prompt/theme paths |
| `session_start` | No | Session initialized |
| `session_before_switch` | Yes (cancel) | Pre-switch hook |
| `session_before_fork` | Yes (cancel) | Pre-fork hook |
| `session_before_compact` | Yes (cancel/customize) | Pre-compaction hook |
| `session_compact` | No | Post-compaction |
| `session_shutdown` | No | Extension teardown |
| `session_before_tree` | Yes (cancel/customize summary) | Pre-tree-navigation hook |
| `session_tree` | No | Post-tree-navigation |
| `context` | Yes (modify messages) | **Before each LLM call** — can inject/modify messages |
| `before_provider_request` | Yes (modify payload) | **Before HTTP request** — can replace entire payload |
| `after_provider_response` | No | After HTTP response received |
| `before_agent_start` | Yes (modify prompt/system) | **Before agent loop** — can inject messages, replace system prompt |
| `agent_start` / `agent_end` | No | Agent loop lifecycle |
| `turn_start` / `turn_end` | No | Per-LLM-call lifecycle |
| `message_start` / `message_update` / `message_end` | Yes (message_end can replace) | Streaming message events |
| `tool_execution_start/update/end` | No | Tool execution events |
| `tool_call` | Yes (block) | **Before tool executes** — can block or modify args |
| `tool_result` | Yes (modify) | **After tool executes** — can modify result |
| `model_select` / `thinking_level_select` | No | Model/thinking change events |
| `user_bash` | Yes (custom ops/result) | User bash command |
| `input` | Yes (transform/handle) | **User input received** — can transform or handle entirely |

---

### 2.6 Compaction (`pi-coding-agent/core/compaction`)

Context window management via summarization.

**Triggers:**
- Manual: `compact` command or RPC
- Threshold: auto-compaction when context usage exceeds threshold
- Overflow: emergency compaction when context overflows

**Branch summarization:**
- When navigating tree, abandoned branches can be summarized
- Summary is stored as `branch_summary` entry
- Extension can provide custom summarization via `session_before_compact` and `session_before_tree` hooks

---

### 2.7 Model & Provider System

**Built-in providers:** Anthropic, OpenAI, Google, etc. (via `pi-ai`)

**Custom providers via extensions:**
```typescript
pi.registerProvider("my-proxy", {
  baseUrl: "https://proxy.example.com",
  apiKey: "MY_API_KEY",
  api: "anthropic-messages",
  models: [{
    id: "claude-sonnet-4-20250514",
    name: "Claude 4 Sonnet (proxy)",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16384
  }]
});
```

**OAuth support:** Extensions can register OAuth providers for `/login` flow.

---

## 3. RPC Protocol (Our Interface)

### 3.1 Commands (stdin → Pi)

| Command | Parameters | Response | Purpose |
|---|---|---|---|
| `prompt` | `message`, `images?`, `streamingBehavior?` | success | Send user prompt |
| `steer` | `message`, `images?` | success | Inject steering message during streaming |
| `follow_up` | `message`, `images?` | success | Queue follow-up message |
| `abort` | - | success | Abort current operation |
| `new_session` | `parentSession?` | `{ cancelled }` | Create new session |
| `switch_session` | `sessionPath` | `{ cancelled }` | Switch to existing session |
| `fork` | `entryId` | `{ text, cancelled }` | Fork from entry |
| `clone` | - | `{ cancelled }` | Clone current session |
| `get_state` | - | `RpcSessionState` | Get current session state |
| `set_model` | `provider`, `modelId` | Model | Set active model |
| `cycle_model` | - | `{ model, thinkingLevel, isScoped }` | Cycle to next model |
| `get_available_models` | - | `{ models }` | List available models |
| `set_thinking_level` | `level` | success | Set thinking level |
| `cycle_thinking_level` | - | `{ level }` | Cycle thinking level |
| `set_steering_mode` | `mode: "all" \| "one-at-a-time"` | success | Set steering mode |
| `set_follow_up_mode` | `mode: "all" \| "one-at-a-time"` | success | Set follow-up mode |
| `compact` | `customInstructions?` | CompactionResult | Manual compaction |
| `set_auto_compaction` | `enabled` | success | Toggle auto-compaction |
| `set_auto_retry` | `enabled` | success | Toggle auto-retry |
| `abort_retry` | - | success | Cancel retry |
| `bash` | `command` | BashResult | Execute bash command |
| `abort_bash` | - | success | Cancel running bash |
| `get_session_stats` | - | SessionStats | Get session statistics |
| `export_html` | `outputPath?` | `{ path }` | Export session to HTML |
| `get_fork_messages` | - | `{ messages }` | Get forkable messages |
| `get_last_assistant_text` | - | `{ text }` | Get last assistant text |
| `set_session_name` | `name` | success | Set session name |
| `get_messages` | - | `{ messages }` | Get all messages |
| `get_commands` | - | `{ commands }` | Get available slash commands |

### 3.2 Events (Pi → stdout)

All events from `AgentSessionEvent` are streamed on stdout as JSON lines.

### 3.3 Session State (from `get_state`)

```
RpcSessionState {
  model?: Model
  thinkingLevel: ThinkingLevel
  isStreaming: boolean
  isCompacting: boolean
  steeringMode: "all" | "one-at-a-time"
  followUpMode: "all" | "one-at-a-time"
  sessionFile?: string
  sessionId: string
  sessionName?: string
  autoCompactionEnabled: boolean
  messageCount: number
  pendingMessageCount: number
}
```

---

## 4. What We Currently Use vs What's Available

| Capability | We use it? | How |
|---|---|---|
| Prompt | Yes | RPC `prompt` command |
| Streaming events | Yes | PiBridge stdout parsing |
| Session management (new/switch/fork) | Yes | RPC commands + local file reads |
| Tool call blocking (`open`) | Yes | Extension `tool_call` hook |
| HTML detection | Yes | Parse `write` tool call args |
| Image handling | Yes | Parse `tool_result` content |
| **Steer** | No | Can inject mid-stream steering |
| **Follow-up** | No | Can queue follow-up messages |
| **Context injection** | No | Extension `context` / `before_agent_start` events |
| **Custom tools** | No | Can register LLM-callable tools |
| **Custom messages** | No | Can inject typed messages into session |
| **Model switching** | No | RPC `set_model` / `cycle_model` available |
| **Compaction** | No | RPC `compact` available |
| **Navigate tree** | No | RPC missing, but extension can do it |
| **Bash execution** | No | RPC `bash` available (adds to context) |
| **Provider registration** | No | Extension can register custom providers |
| **Branch summary** | No | Available via navigateTree |
| **Labels/bookmarks** | No | Available via extension API |
| **Export** | No | RPC `export_html` available |
| **Custom entries** | No | Can persist extension state in JSONL |

---

## 5. Key Insights for GUI Autonomy

### 5.1 What Pi owns (we can't replace without major effort)

- **LLM communication**: API calls, streaming, retry, error handling
- **Tool execution loop**: sequential/parallel tool calls, result processing
- **System prompt assembly**: dynamic prompt building with tools, context files, skills
- **Compaction**: context window management via summarization

### 5.2 What GUI can own (via RPC or extension system)

- **Session storage & tree**: Pi's JSONL is append-only tree. GUI can maintain its own session index/metadata
- **Message injection**: via `steer`, `followUp`, or extension `context` event
- **Tool control**: block/allow tools, inject custom tools via extensions
- **Context enrichment**: inject git status, linter errors, memory window via extension `context` or `before_agent_start` events
- **Model selection**: GUI can manage model configs and call `set_model`

### 5.3 Paths to GUI autonomy

**Path A: RPC-only (current)**
- Limited to what RPC commands expose
- Cannot inject context, register tools, or intercept events
- Simple but inflexible

**Path B: RPC + Extension**
- Write a Pi extension that acts as bridge between Pi and GUI
- Extension subscribes to `context`, `tool_call`, `tool_result`, `before_agent_start` events
- Extension receives commands from GUI (via custom entries or RPC)
- Full access to Pi's internals without forking

**Path C: SDK mode**
- Embed Pi's `AgentSession` directly in Electron main process
- Full programmatic access to all APIs
- No JSON-line protocol overhead
- Maximum flexibility, maximum coupling

**Path D: Direct LLM API (bypass Pi)**
- GUI calls model APIs directly
- Implements own tool execution loop
- Full autonomy, but must reimplement: streaming, tool calls, compaction, system prompt
- Massive effort, essentially building a new agent

---

## 6. File Structure Reference

```
~/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/
├── dist/
│   ├── cli.js                    # CLI entry point
│   ├── main.js                   # Main orchestrator
│   ├── config.js                 # Configuration
│   ├── core/
│   │   ├── agent-session.js      # Session orchestrator (prompt, steer, fork, compact...)
│   │   ├── agent-session-services.js
│   │   ├── session-manager.js    # JSONL session tree storage
│   │   ├── bash-executor.js      # Shell command execution
│   │   ├── compaction/           # Context compaction + branch summarization
│   │   ├── extensions/           # Extension loader, runner, types
│   │   ├── tools/                # Built-in tools (read, write, edit, bash, grep, find, ls)
│   │   ├── system-prompt.js      # System prompt assembly
│   │   ├── model-registry.js     # Model/provider registry
│   │   ├── model-resolver.js     # Model selection logic
│   │   ├── prompt-templates.js   # File-based prompt templates
│   │   ├── skills.js             # Skill system
│   │   ├── slash-commands.js     # Slash command registry
│   │   ├── settings-manager.js   # User settings
│   │   ├── resource-loader.js    # Load skills, prompts, themes, context files
│   │   ├── event-bus.js          # Shared event bus for extensions
│   │   ├── messages.js           # Custom message types
│   │   └── diagnostics.js        # Diagnostic utilities
│   ├── modes/
│   │   ├── rpc/                  # RPC mode (our interface)
│   │   │   ├── rpc-mode.js
│   │   │   ├── rpc-types.js
│   │   │   ├── rpc-client.js
│   │   │   └── jsonl.js
│   │   └── interactive/          # Interactive TUI mode
│   ├── export-html/              # HTML export
│   └── utils/
├── docs/
├── examples/
└── node_modules/
    └── @earendil-works/
        ├── pi-agent-core/        # Agent loop + types
        └── pi-ai/                # LLM provider abstraction
```

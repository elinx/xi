# Session Management Spec

## 1. Overview

Session management allows users to organize conversations with the Pi agent into named, resumable sessions. Each project (working directory) gets a tree of sessions rooted at a "main" session. Users can fork at any message, switch between sessions, rename, delete, and navigate back to parent sessions.

## 2. Storage Format

### 2.1 Session Directory

```
~/.pi/agent/sessions/
  --<encoded-cwd>--/
    <timestamp>_<uuid>.jsonl
    <timestamp>_<uuid>.jsonl
  --<another-project>--/
    <timestamp>_<uuid>.jsonl
```

- `encoded-cwd`: the working directory with `/` replaced by `-`, wrapped in `--`. E.g. `/Users/foo/project` → `--Users-foo-project--`
- Each project directory contains one or more `.jsonl` session files
- When the last session file in a project directory is deleted, the directory is removed

### 2.2 Session File (JSONL)

Each line is a JSON object. The first line is always the session header.

```
{"type":"session","version":3,"id":"<uuid>","timestamp":"<ISO>","cwd":"<path>","parentSession":"<parent-filepath>"}
{"type":"message","id":"<entryId>","parentId":"<parentEntryId>","timestamp":"<ISO>","message":{"role":"user","content":"Hello"}}
{"type":"message","id":"<entryId>","parentId":"<parentEntryId>","timestamp":"<ISO>","message":{"role":"assistant","content":[...]}}
{"type":"session_info","name":"my-experiment"}
{"type":"fork_point","entryId":"<entryId>","childName":"fork-name"}
```

**Header** (line 0):
| Field | Type | Description |
|-------|------|-------------|
| `type` | `"session"` | Always `"session"` |
| `version` | `3` | Session format version |
| `id` | `string` | UUID for this session |
| `timestamp` | `string` | ISO timestamp of creation |
| `cwd` | `string` | Working directory |
| `parentSession` | `string?` | File path of parent session (for forks) |

**Entry types** (lines 1+):
| `type` | Purpose | Key Fields |
|--------|---------|------------|
| `message` | A conversation entry | `id`, `parentId`, `message.role`, `message.content` |
| `session_info` | Session metadata (name) | `name` |
| `fork_point` | Records where a fork was created | `entryId`, `childName` |

**Name resolution**: If multiple `session_info` entries exist, the **last** one wins (rename overwrites).

### 2.3 Inter-Session Relationships

Sessions form a tree via the `parentSession` header field:

```
main.jsonl          (no parentSession)
  ├── fork-a.jsonl  (parentSession: "/path/to/main.jsonl")
  │   └── sub.jsonl (parentSession: "/path/to/fork-a.jsonl")
  └── fork-b.jsonl  (parentSession: "/path/to/main.jsonl")
```

## 3. Core Concepts

### 3.1 Main Session

- Each project has exactly one **main session**
- The main session is identified by:
  1. A session explicitly named `"main"`, OR
  2. The oldest session for the project (fallback)
- On app startup, the main session is automatically resumed via `--session <path>` flag to PiBridge
- If the main session has no name, it is automatically named `"main"` before PiBridge starts

### 3.2 Session Naming

- **All new sessions and forks require user-provided names** — no auto-naming
- Unnamed sessions display their creation time (e.g. "May 29 16:24") instead of "Untitled"
- Names are persisted by appending `{"type":"session_info","name":"..."}` to the JSONL file
- Names are written via both RPC (`set_session_name`) and file fallback (`nameSession()`) for resilience

### 3.3 Fork

A fork creates a new session that shares conversation history up to a specific message (entry point), then diverges.

**Fork flow**:
1. User clicks "Fork" on a user message → ForkPopover opens
2. User selects which message to fork from (entry point)
3. User enters a fork name → confirms
4. Main process:
   - Records `parentPath` from current `get_state` RPC
   - Sends `fork` RPC with `entryId` to Pi
   - Sends `set_session_name` RPC with user name
   - Writes `nameSession(childPath, name)` to disk
   - Writes `addForkPoint(parentPath, entryId, name)` to parent's JSONL
5. Frontend:
   - `clearMessages()` → `forkAtEntry(entryId, name)` → `loadHistory()` → `refresh()`

### 3.4 Fork Points

When a fork is created, a `fork_point` entry is appended to the **parent** session's JSONL file. This allows the UI to show visual markers on messages where forks originated.

```
{"type":"fork_point","entryId":"entry-42","childName":"experiment-1"}
```

- `entryId`: the `id` field from the Pi message entry where the fork occurred
- `childName`: the name the user gave to the forked session

Fork points are rendered as purple badges on the corresponding message in ChatView.

### 3.5 Delete

- Sessions can be deleted from the sidebar
- **Cannot delete the currently active session** — IPC handler checks via `get_state`
- **Cannot delete main sessions** — UI hides the delete button
- When the last session in a project directory is deleted, the project directory is removed
- Delete is a two-step confirmation: hover shows `x`, click shows red `Del`, click again executes

## 4. Data Flow

### 4.1 Backend (Main Process)

#### Session Service (`session-service.ts`)

Pure functions operating on the filesystem. All functions that access the session directory accept an optional `sessionDir` parameter for testability.

| Function | Signature | Description |
|----------|-----------|-------------|
| `getSessionDir()` | `() → string` | Returns `~/.pi/agent/sessions` |
| `decodeProjectDir()` | `(encodedDir) → string` | `--Users-foo-bar--` → `/Users/foo/bar` |
| `parseSessionFile()` | `(filePath) → SessionInfo \| null` | Parse header + entries from JSONL |
| `findMainSession()` | `(cwd, sessionDir?) → SessionInfo \| null` | Find named "main" or oldest for cwd |
| `listSessions()` | `(currentSessionPath?, sessionDir?) → SessionListResult` | List all sessions grouped by project |
| `buildSessionTree()` | `(sessions) → SessionTreeNode \| null` | Build parent-child tree from SessionInfo[] |
| `nameSession()` | `(sessionPath, name) → boolean` | Append session_info entry to JSONL |
| `deleteSession()` | `(sessionPath, sessionDir?) → boolean` | Delete file + cleanup empty directory |
| `addForkPoint()` | `(sessionPath, entryId, childName) → boolean` | Append fork_point entry to JSONL |
| `getForkPoints()` | `(sessionPath) → ForkPoint[]` | Extract all fork_point entries from JSONL |

#### IPC Handlers (`index.ts`)

| Channel | RPC Commands | Notes |
|---------|-------------|-------|
| `session:listSessions` | `get_state` → `listSessions(path)` | Passes currentSessionPath to mark active |
| `session:getForkMessages` | `get_fork_messages` | Returns forkable user messages |
| `session:forkAtEntry` | `get_state` → `fork` → `set_session_name` → `get_state` | Records fork point in parent |
| `session:switchSession` | `switch_session` | Passes sessionPath |
| `session:newSession` | `new_session` | Optionally passes parentSession |
| `session:renameSession` | `set_session_name` + `nameSession()` | RPC first, file fallback always |
| `session:getCurrentSession` | `get_state` → `listSessions()` → find | Matches by sessionPath |
| `session:deleteSession` | `get_state` (safety check) → `deleteSession()` | Blocks active session deletion |
| `session:getMessages` | `get_messages` | Returns raw Pi message array |
| `session:getForkPoints` | (no RPC) → `getForkPoints()` | Reads directly from disk |

#### RPC Correlation

All RPC commands use UUID correlation via `pendingRpcResponses` Map with 30s timeout:

```
sendRpcCommand({ type: "fork", entryId }) 
  → piBridge.sendCommand({ ...command, id: randomUUID() })
  → Promise pending in Map
  → response arrives with matching id → resolve/reject
```

### 4.2 IPC Bridge (Preload)

| Channel | Direction | Payload |
|---------|-----------|---------|
| `session:listSessions` | renderer → main | (none) |
| `session:getForkMessages` | renderer → main | (none) |
| `session:forkAtEntry` | renderer → main | `entryId: string, name?: string` |
| `session:switchSession` | renderer → main | `sessionPath: string` |
| `session:newSession` | renderer → main | `parentSessionPath?: string` |
| `session:renameSession` | renderer → main | `name: string` |
| `session:getCurrentSession` | renderer → main | (none) |
| `session:refreshSessions` | renderer → main | (none) |
| `session:getMessages` | renderer → main | (none) |
| `session:deleteSession` | renderer → main | `sessionPath: string` |
| `session:getForkPoints` | renderer → main | `sessionPath: string` |

### 4.3 Frontend

#### Hooks

**`usePiRpc`** — manages real-time Pi communication and message state:
- `messages: ChatMessage[]` — current conversation (streaming or loaded)
- `forkPoints: ForkPoint[]` — fork markers for current session
- `loadHistory()` — fetches `get_messages` RPC, converts Pi → ChatMessage format
- `loadForkPoints(sessionPath)` — fetches fork points for a session
- `clearMessages()` — resets messages and forkPoints

**`useSessionManager`** — manages session CRUD:
- `sessions: SessionListResult | null` — all projects/sessions
- `currentSession: SessionInfo | null` — active session (from RPC)
- `forkAtEntry(entryId, name)` — fork with user-provided name
- `switchSession(sessionPath)` — switch to different session
- `newSession(name, parentSessionPath?)` — create + rename
- `deleteSession(sessionPath)` — delete non-active session
- `refresh()` — reload sessions + currentSession

#### Conversion: Pi Messages → ChatMessage

`loadHistory()` converts Pi's raw message format into the UI's ChatMessage format:

| Pi Message | ChatMessage |
|------------|-------------|
| `{ role: "user", content: "text" }` | `{ role: "user", blocks: [{ type: "text", content: "text" }] }` |
| `{ role: "user", content: [{ type: "text", text: "..." }] }` | Concatenated text blocks |
| `{ role: "assistant", content: [{ type: "text" }] }` | `{ role: "assistant", blocks: [{ type: "text" }] }` |
| `{ role: "assistant", content: [{ type: "thinking" }] }` | Text block with 💭 prefix |
| `{ role: "assistant", content: [{ type: "toolCall" }] }` | ToolCallBlock with status "completed" |
| `{ role: "toolResult", content: [...] }` | **Appended** to last assistant message |

Key behaviors:
- **Tool results are NOT separate messages** — they append blocks to the current assistant message
- `piEntryId` is extracted from `msg.id` for fork point matching
- Timestamps fall back to `Date.now()` if missing

#### Active Session Name (Title Bar)

The title bar displays the current session name. Resolution order:

1. `activeSessionPath` state (set immediately on click) → lookup in `sessions` list
2. `currentSession?.name` (from `getCurrentSession` RPC)
3. Null (nothing displayed)

This ensures the name updates instantly on click without waiting for RPC round-trips.

For unnamed sessions, `getDisplayName()` shows creation time: `"May 29 16:24"`

## 5. UI Components

### 5.1 SessionSidebar (260px, collapsible)

```
┌──────────────────────┐
│ Sessions        [+] [≪] │
│ ───────────────────── │
│ [New session input]   │
│ ▾ /project            │
│   ● main         2h ago │
│     ├ experiment-1 1h ago │
│     │  ↑ parent         │
│     └ experiment-2 30m  │
│        ↑ parent         │
└──────────────────────┘
```

- **Project header**: decoded cwd basename, click to expand/collapse, shows session count
- **Session node**: click to switch, double-click to rename, hover for relative time
- **Main indicator**: blue dot (●) before name
- **Active highlight**: `bg-gray-800` on the current session
- **Delete button**: `x` on hover for non-active, non-main sessions; click once → red `Del` confirm
- **Parent link**: `↑ parent` text below forked sessions, click to switch to parent
- **New session**: `+` button opens inline name input, requires name before creating

### 5.2 ChatView Fork Markers

Messages where forks originated show a purple badge below the content:

```
┌─────────────────────────────┐
│ You                    Fork │
│ List files                  │
│ ─────────────────────────── │
│ 🔀 forked: experiment-1    │
└─────────────────────────────┘
```

- Badge appears when `message.piEntryId` matches a `ForkPoint.entryId`
- Shows `childName` from the fork_point entry
- Multiple forks from the same message show multiple badges

### 5.3 ForkPopover (2-step)

1. **Step 1**: List of forkable user messages (from `get_fork_messages` RPC), click to select
2. **Step 2**: Name input appears, user types fork name, Enter or click "Fork" to confirm
- Confirmation requires both `selectedEntryId` and non-empty trimmed `forkName`
- Click outside to dismiss

## 6. Lifecycle Events

### 6.1 App Startup

```
1. findMainSession(cwd)
2. If main exists but unnamed → nameSession(path, "main")
3. initPiBridge(mainSession?.filePath)  ← passes --session flag
4. PiBridge.start() → waits for connected event
5. If still no named "main" → set_session_name RPC + nameSession fallback
6. Frontend: loadSessions() + loadCurrentSession()
```

### 6.2 Session Switch

```
1. setActiveSessionPath(path)  ← instant title bar update
2. clearMessages()
3. switchSession(path)  ← RPC: switch_session
4. loadHistory()        ← RPC: get_messages → convert → setMessages
5. loadForkPoints(path) ← IPC: getForkPoints → setForkPoints
6. refresh()            ← reload sessions + currentSession
```

### 6.3 Fork

```
1. clearMessages()
2. forkAtEntry(entryId, name)  ← IPC: fork + rename + addForkPoint (atomic in main)
3. loadHistory()               ← RPC: get_messages → convert → setMessages
4. refresh()                   ← reload sessions + currentSession
5. setActiveSessionPath(null)  ← let currentSession from RPC take over
```

### 6.4 Delete

```
1. User clicks x → confirmDelete = true
2. User clicks Del → onDelete(filePath)
3. IPC: get_state → verify not active → deleteSession(path)
4. On success: loadSessions() to refresh sidebar
```

### 6.5 Pi Connected Event

```
onStateChanged({ connected: true })
  → loadSessions()
  → loadCurrentSession()
```

## 7. Pi RPC Commands Reference

| Command | Direction | Response |
|---------|-----------|----------|
| `{ type: "get_state" }` | GUI → Pi | `{ sessionPath, ... }` |
| `{ type: "get_messages" }` | GUI → Pi | `{ messages: [...] }` |
| `{ type: "get_fork_messages" }` | GUI → Pi | `{ messages: [{ entryId, text }] }` |
| `{ type: "fork", entryId }` | GUI → Pi | Creates new session from entry |
| `{ type: "switch_session", sessionPath }` | GUI → Pi | Switches Pi to different session |
| `{ type: "new_session", parentSession? }` | GUI → Pi | Creates blank session |
| `{ type: "set_session_name", name }` | GUI → Pi | Sets name in Pi's state |

All RPC commands are sent with a UUID `id` field. Responses include matching `id` for correlation.

## 8. Types Reference

### SessionInfo
```typescript
interface SessionInfo {
  filePath: string        // Absolute path to .jsonl
  sessionId: string       // UUID from header
  name: string | null     // User-defined name (last session_info wins)
  createdAt: string       // ISO timestamp
  cwd: string             // Working directory
  parentSessionPath: string | null  // Parent .jsonl path
  messageCount: number    // User message count
  isMain: boolean         // Set by listSessions() based on currentSessionPath
}
```

### ForkPoint
```typescript
interface ForkPoint {
  entryId: string    // Pi message entry ID where fork occurred
  childName: string  // Name of the forked session
}
```

### ChatMessage
```typescript
interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  blocks: ContentBlock[]
  timestamp: number
  piEntryId?: string  // Pi's entry ID, used for fork point matching
}
```

### ContentBlock (union)
```typescript
type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolName: string; args: Record<string, unknown>; status: 'pending' | 'running' | 'completed' | 'error' }
  | { type: 'tool_result'; toolCallId: string; content: ContentBlock[] }
  | { type: 'image'; src: string; alt?: string; ... }
  | { type: 'html'; content: string; title?: string }
  | { type: 'action'; actionType: 'select' | 'confirm' | 'input'; label: string; ... }
```

## 9. Error Handling

| Scenario | Behavior |
|----------|----------|
| RPC timeout (30s) | Promise rejects, caller shows error or silently fails |
| `get_state` fails | `listSessions()` returns with no currentSessionPath marked |
| `set_session_name` RPC fails | Falls back to `nameSession()` direct file write |
| Delete active session | IPC returns `{ success: false, error: "Cannot delete the active session" }` |
| Parse invalid JSONL line | `parseSessionFile` skips line, continues |
| Empty project directory | `listSessions` skips it; `deleteSession` removes it |
| Pi disconnected during operation | RPC rejects, UI shows "Pi Disconnected" state |

## 10. Test Coverage

136 tests across 5 test files:

| File | Count | Coverage |
|------|-------|----------|
| `session-service.test.ts` | ~55 | decodeProjectDir, parseSessionFile, findMainSession, listSessions, buildSessionTree, nameSession, deleteSession, addForkPoint, getForkPoints |
| `app-integration.test.ts` | ~15 | Auto-start, fork parentSessionPath, refresh after operations, main session auto-naming, PiBridge readiness |
| `ipc-handlers.test.ts` | ~25 | newSession, renameSession, switchSession, forkAtEntry, getCurrentSession, listSessions, deleteSession, getForkPoints |
| `session-sidebar.test.ts` | ~20 | getDisplayName, formatRelativeTime, component props contract, tree rendering, delete button visibility |
| `load-history.test.ts` | ~26 | User/assistant/toolResult conversion, piEntryId extraction, fork point matching, fork flow, switch+loadHistory, ForkPopover validation |

All session-service tests use temp directories with optional `sessionDir` param — no real `~/.pi/agent/sessions` access needed.

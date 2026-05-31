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
| `session_info` | Session metadata (name, status) | `name`, `status` |
| `fork_point` | Records where a fork was created | `entryId`, `childName` |

**Name resolution**: If multiple `session_info` entries exist, the **last** one wins for each field (rename overwrites).

**Status resolution**: Same as name — if multiple `session_info` entries contain `status`, the **last** one wins. If no `session_info` entry contains `status`, the session is considered `active`.

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
- `isMain` is set in `listSessions()` based on the session name, **not** the currently active session
- The currently active session is tracked separately by `currentSession?.filePath` in the frontend

### 3.2 Session Naming

- **All new sessions and forks require user-provided names** — no auto-naming
- Unnamed sessions display their creation time (e.g. "May 29 16:24") instead of "Untitled"
- Names are persisted by appending `{"type":"session_info","name":"..."}` to the JSONL file
- For new sessions: name is set via `set_session_name` RPC, then `flush_session` writes the file with all entries (header + session_info) to disk. `nameSession()` is NOT called for new sessions to avoid conflicting with Pi's lazy-flush mechanism
- For existing sessions (rename): name is set via `set_session_name` RPC, then `nameSession()` appends session_info to the already-flushed file as a fallback

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

### 3.5 Session Status (Completed)

Each session can be marked as **completed** to indicate the user is done with it and likely won't revisit it soon.

- **Status values**: `active` (default) or `completed`
- **Storage**: Appended as `{"type":"session_info","status":"completed"}` to the JSONL file, reusing the existing `session_info` entry type
- **Resolution**: Last `session_info` entry's `status` field wins; absent `status` means `active`
- **Auto-recovery**: **None** — sending a message to a completed session does NOT automatically change it back to `active`. Only manual toggle.
- **Operations on completed sessions**: All operations (switch, fork, delete, rename) work the same regardless of status
- **Visual**: Completed sessions appear with gray text (`text-gray-400`) and strikethrough (`line-through`) in the sidebar; dot turns gray (`bg-gray-300 border-gray-300`). No separate section — completed sessions stay in their tree position.
- **Sorting**: No change — completed sessions remain in their original position in the tree; no grouping or reordering
- **Child sessions**: A completed session's children are unaffected; they may be active or completed independently

### 3.6 Delete

- Sessions can be deleted from the sidebar
- **Active sessions can be deleted** — the backend creates a new session first, then deletes the old one, similar to `clearSession`
- **Cannot delete main sessions** — UI hides the delete button
- When the last session in a project directory is deleted, the project directory is removed
- Delete is a two-step confirmation: hover shows `x`, click shows red `Del`, click again executes

### 3.6 New Child Session

Each session node in the sidebar has a **"+"** button (visible on hover). Clicking it creates a **child session** under that session. The child session is blank (no conversation history), unlike a fork which copies history.

**New child session flow (sidebar)**:
1. User clicks "+" button on any session node → inline name input appears
2. User types a session name → presses Enter (or clicks Create button)
3. Frontend calls `onNewSession(name, parentSessionPath)` where `parentSessionPath` is the clicked session's file path
4. Main process: `new_session` RPC (with parentSession) → `set_session_name` RPC → `flush_session` RPC
5. The new session becomes active and appears in the sidebar as a child of the parent session

**Why `flush_session` is needed**: Pi's `newSession()` only creates the session in memory (deferred file write). The file is not written until the first assistant response. `flush_session` calls `sessionManager._rewriteFile()` + sets `flushed=true`, which: (1) writes the file with the correct header (including `parentSession`), and (2) prevents Pi's subsequent `_persist` from using `openSync('wx')` which would fail on an existing file. This mirrors what `createBranchedSession` does when it has assistant messages.

### 3.7 Fork

When a session is active, a **Fork** button appears in the sidebar session node. Clicking it creates a new session that forks from the **last user message** in the current conversation — i.e., the new session shares the entire conversation history and then diverges.

**Fork flow (sidebar)**:
1. User clicks Fork button on the active session node → inline name input appears
2. User types a fork name → presses Enter (or clicks Fork button)
3. Frontend finds the last user message's `piEntryId` from the messages array
4. Frontend calls `forkAtEntry(lastUserEntryId, name)` — same RPC flow as regular fork
5. The new session becomes active and appears in the sidebar as a child of the original session

This is a shortcut for the most common fork use case — forking from the end of the conversation. The existing ForkPopover (fork from any message) remains available in ChatView.

### 3.8 Session Status Toggle

Users can toggle a session between `active` and `completed` via the right-click context menu:

- If the session is `active` → menu shows **"Mark as completed"**
- If the session is `completed` → menu shows **"Mark as active"**

The toggle writes a new `session_info` entry to the JSONL file and refreshes the sidebar. No RPC call to Pi is needed — this is a pure file operation.

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
| `nameSession()` | `(sessionPath, name) → boolean` | Append session_info entry to existing JSONL; no-op if file doesn't exist |
| `setSessionStatus()` | `(sessionPath, status: 'active' \| 'completed') → boolean` | Append session_info entry with status to JSONL |
| `deleteSession()` | `(sessionPath, sessionDir?) → boolean` | Delete file + cleanup empty directory |
| `addForkPoint()` | `(sessionPath, entryId, childName) → boolean` | Append fork_point entry to JSONL |
| `getForkPoints()` | `(sessionPath) → ForkPoint[]` | Extract all fork_point entries from JSONL |

#### IPC Handlers (`index.ts`)

| Channel | RPC Commands | Notes |
|---------|-------------|-------|
| `session:listSessions` | `get_state` (unused for isMain) → `listSessions()` | `isMain` based on name, not currentSessionPath |
| `session:getForkMessages` | `get_fork_messages` | Returns forkable user messages |
| `session:forkAtEntry` | `get_state` → `fork` → `set_session_name` → `get_state` | Records fork point in parent |
| `session:switchSession` | `switch_session` | Passes sessionPath |
| `session:newSession` | `new_session` → `set_session_name` → `flush_session` | Passes parentSession; flush ensures file written with correct header |
| `session:renameSession` | `set_session_name` + `nameSession()` | RPC first, file fallback always |
| `session:getCurrentSession` | `get_state` → `listSessions()` → find | Matches by sessionPath |
| `session:deleteSession` | `get_state` (check if active) → if active: `new_session` + `deleteSession()`; else: `deleteSession()` | Handles active session deletion by creating new session first |
| `session:getMessages` | `get_messages` | Returns raw Pi message array |
| `session:getForkPoints` | (no RPC) → `getForkPoints()` | Reads directly from disk |
| `session:setSessionStatus` | (no RPC) → `setSessionStatus()` | Pure file operation; no Pi RPC needed |
| `session:softPeek` | `soft_peek` | Reads messages from session without switching runtime (§6.6.7) |
| `session:getRuntimeSessionId` | `get_state` | Returns sessionId + sessionFile + isStreaming of runtime's current session |

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
| `session:newSession` | renderer → main | `name: string, parentSessionPath?: string` |
| `session:renameSession` | renderer → main | `name: string` |
| `session:getCurrentSession` | renderer → main | (none) |
| `session:refreshSessions` | renderer → main | (none) |
| `session:getMessages` | renderer → main | (none) |
| `session:deleteSession` | renderer → main | `sessionPath: string` |
| `session:getForkPoints` | renderer → main | `sessionPath: string` |
| `session:setSessionStatus` | renderer → main | `sessionPath: string, status: 'active' \| 'completed'` |
| `session:softPeek` | renderer → main | `sessionPath: string` |
| `session:getRuntimeSessionId` | renderer → main | (none) |

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
- `newSession(name, parentSessionPath?)` — create child session with name under specified parent
- `deleteSession(sessionPath)` — delete non-active session
- `setSessionStatus(sessionPath, status)` — toggle session active/completed
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
- **Delete button**: `x` on hover for non-main sessions (including the active session); click once → red `Del` confirm; deleting the active session creates a new session first then deletes the old one
- **Fork button**: `🔀` icon on hover for the active session; click → inline name input; forks from the last user message
- **Parent link**: `↑ parent` text below forked sessions, click to switch to parent
- **Completed session visual**: Gray text (`text-gray-400`) + strikethrough (`line-through`) + gray dot (`bg-gray-300 border-gray-300`). Stays in original tree position — no grouping or separate section.
- **Right-click context menu**: Includes "Mark as completed" / "Mark as active" toggle based on current status
- **New child session**: `+` button on each session node (visible on hover); click → inline name input; creates a blank child session under that node

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

On Pi connect, fork points are loaded automatically via `useEffect` that watches `isConnected` + `currentSession?.filePath`.

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
3. IPC: deleteSession(path)
   - If session is active: backend creates new session first, then deletes old one
   - If session is not active: directly deletes the session file
4. On success: loadSessions() + loadCurrentSession() + refresh()
```

### 6.5 Pi Connected Event

```
onStateChanged({ connected: true })
  → loadSessions()
  → loadCurrentSession()
```

### 6.6 Streaming State During Session Switch

Session switch may occur while the agent is streaming. The architecture uses a **single `AgentSessionRuntime`** that can only hold one active `AgentSession` at a time. When the user switches away from a streaming session, the agent **must continue running in the background** — it must NOT be aborted.

This requires a **Soft Switch** mechanism that changes the frontend view without changing the runtime's active session. The runtime only switches when the session is idle (Hard Switch).

#### 6.6.1 Two Switch Modes

| | Soft Switch | Hard Switch |
|---|---|---|
| Trigger | User clicks a different session while current session is streaming | User clicks a different session while current session is idle |
| Runtime | **No** `runtime.switchSession()` — the old session keeps streaming | Calls `runtime.switchSession()` — runtime switches to target |
| Old session | Continues streaming in background; events are buffered | N/A (was idle) |
| Can send prompt | **No** — runtime is still on the old session; input bar is disabled | Yes |
| UI indicator | Banner: "Session X 后台运行中" + Stop button | Normal |
|切回来 | Reload messages from the session; in-progress assistant turn is shown | Normal loadHistory |

**Why Soft Switch does not call `runtime.switchSession()`**: That function calls `session.dispose()` → `agent.abort()`, which kills the streaming. Soft Switch avoids this entirely by leaving the runtime on the old session and only changing what the frontend displays.

#### 6.6.2 Frontend State Machine

The frontend tracks two pieces of state for soft switching:

```
viewSessionPath: string | null   — which session the user is LOOKING AT
runtimeSessionPath: string | null — which session the runtime is ON (may differ during soft switch)
```

When `viewSessionPath !== runtimeSessionPath`, the frontend is in **soft-switched mode**.

```
                    ┌─────────────┐
                    │   Normal     │ viewSession === runtimeSession
                    │   Mode       │ Can send prompts, streaming events rendered
                    └──────┬──────┘
                           │ User clicks different session while streaming
                           ▼
                    ┌─────────────┐
                    │ Soft-Switch  │ viewSession ≠ runtimeSession
                    │ Mode         │ Cannot send prompts; background events buffered
                    └──────┬──────┘
                           │ User clicks back to runtimeSession OR agent ends
                           ▼
                    ┌─────────────┐
                    │   Normal     │
                    │   Mode       │
                    └─────────────┘
```

**Exiting soft-switch mode**:

1. **User clicks back to the runtime session**: Frontend sets `viewSessionPath = runtimeSessionPath`, replays buffered events, resumes rendering.
2. **Agent ends (background streaming completes)**: `agent_end` event arrives → frontend updates `runtimeSessionPath` to match `viewSessionPath` (the user is now looking at a different idle session), and calls `runtime.switchSession(viewSessionPath)` as a hard switch.
3. **User clicks Stop**: Aborts the background agent → `agent_end` fires → same as case 2.

#### 6.6.3 Event Buffering and Session ID Tagging

All events from the worker must include a `sessionId` field so the frontend can filter them during soft-switch mode.

**Worker change** — `forwardEvent` attaches `sessionId`:

```
function forwardEvent(event: AgentSessionEvent): void {
  send({ channel: 'event', data: { ...event, sessionId: session.sessionId } })
}
```

**Main process** — pass through `sessionId` unchanged (already a passthrough).

**Frontend event handler**:

```
handleEvent(event):
  if viewSessionPath === runtimeSessionPath:
    // Normal mode — process all events as before
    processEvent(event)
  else:
    // Soft-switch mode
    if event.sessionId === runtimeSessionId:
      // Event from the background (still-streaming) session
      bufferEvent(event)    // store for replay if user switches back
    else:
      // Event from an unexpected session — discard
      ignore
```

**Buffer structure**:

```
backgroundEventBuffer: AgentSessionEvent[]   // capped at 500 events
```

The buffer is cleared when soft-switch mode exits.

#### 6.6.4 Soft Switch Flow

**Entering soft switch** (user clicks session B while A is streaming):

```
1. viewSessionPath = B.path
2. loadHistoryForView(B.path)     // RPC: get_messages for session B
   // Uses new soft_peek command (see §6.6.7) — reads messages without switching runtime
3. loadForkPoints(B.path)
4. refresh()
5. // runtimeSessionPath remains A.path; A continues streaming
6. // Input bar disabled, banner shown
```

**User clicks back to A while A still streaming**:

```
1. viewSessionPath = A.path = runtimeSessionPath  // back to normal mode
2. replayBufferedEvents()          // apply buffered deltas to current messages
3. // Input bar still disabled (streaming), but deltas now render in real-time
```

**Agent ends while in soft-switch mode** (background session A finishes):

```
1. agent_end event arrives with sessionId = A.sessionId
2. bufferEvent(agent_end)          // buffer it
3. runtimeSessionPath = viewSessionPath (B.path)  // now we can hard-switch
4. runtime.switchSession(B.path)   // hard switch to what user is looking at
5. clearBuffer()
6. syncStreamingState()            // should be false
7. // Input bar enabled, banner removed
```

**User clicks Stop while in soft-switch mode**:

```
1. Send abort command to runtime (which is on session A)
2. agent_end arrives → same as "Agent ends" flow above
```

#### 6.6.5 Hard Switch Flow (Non-Streaming)

When the current session is NOT streaming, a session click is a hard switch — identical to the current behavior:

```
1. viewSessionPath = B.path
2. runtimeSessionPath = B.path
3. clearMessages()
4. result = switchSession(B.path)    // RPC: switch_session
5. if result.success:
     await loadHistory()
     await loadForkPoints(B.path)
     await refresh()
6. else:
     viewSessionPath = prevPath
     runtimeSessionPath = prevPath
```

#### 6.6.6 Other Operations During Soft-Switch Mode

| Operation | Allowed? | Behavior |
|-----------|----------|----------|
| New session | ❌ | Disabled — must stop background agent first or switch back |
| Fork | ❌ | Disabled — same reason |
| Clear session | ❌ | Disabled — same reason |
| Delete a session (not the background one) | ⚠️ | Allowed — only deletes the JSONL, doesn't affect runtime |
| Delete the background session | ❌ | Disabled — cannot delete a session the runtime is using |

When the user tries a disabled operation, show a toast: "请先停止后台运行的会话"

#### 6.6.7 New Worker Command: `soft_peek`

The frontend needs to read messages from a session WITHOUT switching the runtime. This is used by soft switch to display the target session's history.

```
case 'soft_peek': {
  // Read messages from a different session file without switching the runtime
  const targetPath = cmd.sessionPath as string
  const targetSm = pi.SessionManager.open(targetPath)
  const entries = targetSm.getEntries()
  const messages = entries
    .filter(e => e.type === 'message' && e.message)
    .map(e => ({ ...e.message, id: e.id }))
  send({
    channel: 'response',
    id: cmd.id,
    command: 'soft_peek',
    success: true,
    data: { messages, sessionId: entries[0]?.sessionId }
  })
  break
}
```

This creates a temporary `SessionManager` for reading, does NOT affect the runtime's active session, and does NOT call `bindSession()`.

#### 6.6.8 New IPC Channels

| Channel | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `session:softPeek` | renderer → main | `sessionPath: string` | Read messages without switching runtime |
| `session:getRuntimeSessionId` | renderer → main | (none) | Get the runtime's current sessionId |

Main process handlers:

```
ipcMain.handle('session:softPeek', async (_event, sessionPath: string) => {
  return piBridge.sendRpcCommand({ type: 'soft_peek', sessionPath })
})

ipcMain.handle('session:getRuntimeSessionId', async () => {
  const data = await piBridge.sendRpcCommand({ type: 'get_state' })
  return { sessionId: data.sessionId, sessionFile: data.sessionFile, isStreaming: data.isStreaming }
})
```

#### 6.6.9 UI: Soft-Switch Banner and Input State

When in soft-switch mode (`viewSessionPath !== runtimeSessionPath`):

**Banner** (above chat area, below title bar):

```
┌──────────────────────────────────────────────────┐
│ 🔄 Session "experiment-1" 后台运行中   [Stop]    │
└──────────────────────────────────────────────────┘
```

- Clicking "Stop" sends abort command
- Banner disappears when agent_end is received

**Input bar**:

- Disabled with placeholder: "当前会话后台运行中，无法发送消息"
- Stop button shown

**Sidebar**:

- Background streaming session shows a small animated dot (🔵 pulsing) to indicate it's running
- Current view session has the normal active highlight

#### 6.6.10 Replaying Buffered Events

When the user switches back to the runtime session while it's still streaming:

```
replayBufferedEvents():
  for event in backgroundEventBuffer:
    processEvent(event)    // same as normal handleEvent
  clearBuffer()
  // The in-progress assistant message now shows all accumulated content
```

The buffer may contain `message_update` (text_delta, toolcall_delta, etc.) and `tool_execution_end` events. These are processed sequentially to reconstruct the streaming state.

**Edge case — `message_start` in buffer**: If the background agent started a new assistant turn after the user soft-switched away, the buffer will contain a `message_start` event. Processing it will set `currentAssistantId` and create a new ChatMessage as normal.

**Buffer overflow protection**: If the buffer exceeds 500 events, drop the oldest events. This prevents memory issues during very long background streams. The user will see a gap in the replayed content, but `loadHistory()` will fill it on the next hard switch.

#### 6.6.11 Updated Lifecycle Flows

**Session Click** (replaces §6.2):

```
handleSessionClick(path):
  if isStreaming && path !== viewSessionPath:
    // Soft switch
    viewSessionPath = path
    messages = softPeek(path)      // RPC: soft_peek → convert → setMessages
    loadForkPoints(path)
    refresh()
    // runtimeSessionPath unchanged, input disabled, banner shown
  else if !isStreaming && path !== viewSessionPath:
    // Hard switch
    viewSessionPath = path
    runtimeSessionPath = path
    clearMessages()
    result = switchSession(path)   // RPC: switch_session
    if result.success:
      await loadHistory()
      await loadForkPoints(path)
      await refresh()
    else:
      viewSessionPath = prevPath
      runtimeSessionPath = prevPath
  else:
    // Already on this session, no-op
```

**New Session** (replaces §6.3):

```
handleNewSession(name):
  if isStreaming:
    // Show toast: "请先停止后台运行的会话"
    return
  clearMessages()
  result = newSession(name, parentPath)
  if result:
    viewSessionPath = runtimeSessionPath  // stays in sync
    await refresh()
```

**Fork** (replaces §6.3):

```
handleForkAtEntry(entryId, name):
  if isStreaming:
    // Show toast: "请先停止后台运行的会话"
    return
  clearMessages()
  await forkAtEntry(entryId, name)
  await loadHistory()
  await refresh()
```

**Clear Session**:

```
handleClearSession():
  if isStreaming:
    // Show toast: "请先停止后台运行的会话"
    return
  clearMessages()
  ok = await clearSession()
  if ok:
    clearMessages()
    await loadHistory()
    await refresh()
    viewSessionPath = null
```

#### 6.6.12 `clearMessages()` Rules

`clearMessages()` is only called during hard switches (when NOT streaming). In soft-switch mode, messages are replaced via `softPeek()` without calling `clearMessages()`.

```
clearMessages():
  setMessages([])
  setForkPoints([])
  setTokenUsage(initial)
  setIsStreaming(false)
  isStreamingRef.current = false
  currentAssistantId.current = null
  currentContentBlocks.current.clear()
  toolCallArgsBuffer.current.clear()
  pendingToolCallArgs.current.clear()
```

#### 6.6.13 Error Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| `soft_peek` RPC fails | Frontend shows empty message list for target session. User can retry by clicking again. |
| `switchSession` RPC fails during hard switch | `viewSessionPath` and `runtimeSessionPath` revert to previous. No action needed. |
| Worker crashes during soft switch | `onStateChanged({ connected: false })` fires. Both view and runtime paths reset. |
| Rapid clicking (A → B → C while A streaming) | Each click is a soft switch. Buffer accumulates events for A. Only the latest viewSessionPath is shown. |
| User clicks back to streaming session A | `viewSessionPath = runtimeSessionPath` → replay buffer → real-time rendering resumes. |
| Agent ends while user is viewing B (soft-switch) | `agent_end` buffered → hard switch to B → buffer cleared → input enabled. |
| `soft_peek` returns stale messages (agent appended more) | Expected — soft_peek is a point-in-time snapshot. User sees current state when they switch back. |
| Buffer overflow (>500 events) | Oldest events dropped. Gap in replayed content. `loadHistory()` fills on next hard switch. |
| Network disconnect during soft switch | Worker may crash → `disconnected` event → both paths reset. |

#### 6.6.14 Implementation Checklist

- [ ] Worker: add `sessionId` to all forwarded events
- [ ] Worker: add `soft_peek` command
- [ ] Main: add `session:softPeek` IPC handler
- [ ] Main: add `session:getRuntimeSessionId` IPC handler
- [ ] Preload: add `softPeek(sessionPath)` and `getRuntimeSessionId()` APIs
- [ ] Frontend: add `viewSessionPath` / `runtimeSessionPath` state
- [ ] Frontend: implement soft-switch detection (`isStreaming && clickedPath !== runtimeSessionPath`)
- [ ] Frontend: event filtering + buffering during soft-switch mode
- [ ] Frontend: buffer replay on switching back
- [ ] Frontend: soft-switch banner component
- [ ] Frontend: input bar disabled state + placeholder during soft-switch
- [ ] Frontend: sidebar pulsing dot on background-streaming session
- [ ] Frontend: disable new session / fork / clear during soft-switch
- [ ] Frontend: toast message "请先停止后台运行的会话"
- [ ] Frontend: agent_end handler during soft-switch (hard switch to view session)
- [ ] Types: add `sessionId` to `AgentSessionEvent`

## 7. Pi RPC Commands Reference

| Command | Direction | Response |
|---------|-----------|----------|
| `{ type: "get_state" }` | GUI → Pi | `{ sessionFile, sessionId, sessionName, isStreaming, isCompacting, thinkingLevel, messageCount }` |
| `{ type: "get_messages" }` | GUI → Pi | `{ messages: [...] }` |
| `{ type: "get_fork_messages" }` | GUI → Pi | `{ messages: [{ entryId, text }] }` |
| `{ type: "fork", entryId }` | GUI → Pi | Creates new session from entry |
| `{ type: "switch_session", sessionPath }` | GUI → Pi | Switches Pi to different session |
| `{ type: "new_session", parentSession? }` | GUI → Pi | Creates blank session (with optional parent) |
| `{ type: "flush_session" }` | GUI → Pi | Force-write session file to disk; sets `flushed=true` |
| `{ type: "set_session_name", name }` | GUI → Pi | Sets name in Pi's state |
| `{ type: "soft_peek", sessionPath }` | GUI → Pi | Reads messages from a session without switching runtime (§6.6.7) |

All RPC commands are sent with a UUID `id` field. Responses include matching `id` for correlation.

## 8. Types Reference

### SessionInfo
```typescript
interface SessionInfo {
  filePath: string        // Absolute path to .jsonl
  sessionId: string       // UUID from header
  name: string | null     // User-defined name (last session_info wins)
  status: 'active' | 'completed' | null  // null等同于active (last session_info wins)
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
| `set_session_name` RPC fails | Fork/new-session flows rely on `flush_session` instead; rename falls back to `nameSession()` if file exists |
| Delete active session | Backend creates new session first, then deletes old session file; similar to clearSession |
| Set session status on non-existent file | `setSessionStatus()` returns `false` |
| Delete when Pi disconnected | Safety check skipped (try/catch around get_state), delete proceeds |
| Parse invalid JSONL line | `parseSessionFile` skips line, continues |
| Empty project directory | `listSessions` skips it; `deleteSession` removes it |
| Pi disconnected during operation | RPC rejects, UI shows "Pi Disconnected" state |
| Switch session while streaming | Soft switch: frontend changes view, runtime stays on old session (§6.6.4) |
| Switch back to streaming session | Replay buffered events, resume real-time rendering (§6.6.10) |
| `soft_peek` RPC fails | Frontend shows empty messages for target session (§6.6.13) |
| New session / fork / clear while streaming | Operation blocked, toast shown: "请先停止后台运行的会话" (§6.6.6) |
| Buffer overflow during soft switch | Oldest events dropped, gap in replayed content (§6.6.10) |

## 10. Test Coverage

136 tests across 5 test files:

| File | Count | Coverage |
|------|-------|----------|
| `session-service.test.ts` | ~55 | decodeProjectDir, parseSessionFile, findMainSession, listSessions, buildSessionTree, nameSession, deleteSession, addForkPoint, getForkPoints, setSessionStatus, parseSessionFile status resolution |
| `app-integration.test.ts` | ~15 | Auto-start, fork parentSessionPath, refresh after operations, main session auto-naming, PiBridge readiness |
| `ipc-handlers.test.ts` | ~25 | newSession, renameSession, switchSession, forkAtEntry, getCurrentSession, listSessions, deleteSession, getForkPoints |
| `session-sidebar.test.ts` | ~20 | getDisplayName, formatRelativeTime, component props contract, tree rendering, delete button visibility |
| `load-history.test.ts` | ~26 | User/assistant/toolResult conversion, piEntryId extraction, fork point matching, fork flow, switch+loadHistory, ForkPopover validation |

All session-service tests use temp directories with optional `sessionDir` param — no real `~/.pi/agent/sessions` access needed.

### 10.1 Soft Switch Tests (§6.6)

| Scenario | Expected Result | Section |
|----------|----------------|---------|
| Click different session while streaming | Soft switch: view changes, runtime stays on old session | §6.6.4 |
| Click different session while NOT streaming | Hard switch: runtime switches | §6.6.5 |
| Click back to streaming session | Buffered events replayed, real-time rendering resumes | §6.6.10 |
| Agent ends while in soft-switch mode | Hard switch to view session, input enabled | §6.6.4 |
| User clicks Stop in soft-switch mode | Background agent aborted, hard switch to view session | §6.6.4 |
| New session while streaming | Blocked with toast | §6.6.6 |
| Fork while streaming | Blocked with toast | §6.6.6 |
| Clear session while streaming | Blocked with toast | §6.6.6 |
| `soft_peek` RPC fails | Empty messages shown for target session | §6.6.13 |
| Buffer overflow (>500 events) | Oldest events dropped | §6.6.10 |
| `message_start` in buffer | New ChatMessage created during replay | §6.6.10 |
| Event filtering during soft switch | Only runtime session events buffered; others discarded | §6.6.3 |
| `sessionId` attached to worker events | All forwarded events include `sessionId` field | §6.6.3 |
| Hard switch RPC fails | Paths revert to previous | §6.6.5 |
| `clearMessages()` resets `isStreaming` | `isStreaming === false` after clear | §6.6.12 |

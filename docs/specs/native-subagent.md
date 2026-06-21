# Native Subagent Spec

## Problem

pi-subagents extension spawns child processes, writes JSONL to nested directories, and doesn't provide real streaming. Xi already has `WorkerManager` with primary + 8 secondary workers, each with independent `PiSDKBridge`, session files, and event streams. We should use that.

## Goal

Register a `subagent` custom tool that, when called by the primary agent, creates a secondary worker to run the task. The subagent session appears in the sidebar immediately and streams in real-time — same as any other session.

## Architecture

```
Primary Worker (pi-worker.ts)
  ├─ Pi session with `subagent` custom tool
  │
  │  agent calls subagent tool
  │  ↓
  │  customTool.execute() sends parentPort message
  │  ↓                                         ↑
  │  waits for result promise                  │ onProgress → onUpdate()
  │                                             │
  Main Process (index.ts)                      │
  ├─ receives parentPort message               │
  ├─ sessionService.createSessionFile()        │
  ├─ sessionService.setSessionOrigin('subagent')│
  ├─ sessionService.setSubagentMeta()           │
  ├─ sessionService.reparentSession()           │
  ├─ broadcastToRenderers('subagent:detected')  │
  │                                             │
  ├─ workerManager.getOrCreateSecondary()       │
  ├─ secondary.bridge.sendRpcCommand({prompt})  │
  │                                             │
  │  secondary worker events ──→ WorkerManager ──→ broadcastToRenderers('pi:event')
  │  (agent_start, message_update, etc.)            │
  │                                                  ↓
  │                                          Renderer handleEvent()
  │                                          (routes by sessionPath, streams to sidebar)
  │
  ├─ on secondary 'agent_end' → collect last assistant message
  ├─ send result back to primary worker via parentPort
  │
  ↓
  customTool.execute() resolves → tool_execution_end in primary session
```

## Components

### 1. Custom Tool: `subagent` (pi-worker.ts)

Register a custom tool in `createRuntime()` alongside `search_sessions`:

```typescript
function createSubagentTool(cwd: string, currentSessionFile?: string) {
  return {
    name: 'subagent',
    label: 'subagent',
    description: 'Delegate a task to a subagent with its own session. The subagent runs in parallel with full tool access. Use for: exploration, research, implementing a specific subtask. The subagent\'s session appears in the sidebar and streams in real-time.',
    parameters: {
      type: 'object' as const,
      properties: {
        task: { type: 'string' as const, description: 'The task for the subagent to complete' },
      },
      required: ['task'],
    },
    execute: async (
      toolCallId: string,
      params: { task: string },
      _signal: AbortSignal | undefined,
      onUpdate: ((result: unknown) => void) | undefined,
    ) => {
      // Send request to main process, wait for response
      const result = await requestSubagentRun(toolCallId, params.task, onUpdate)
      return result
    },
  }
}
```

### 2. Worker ↔ Main IPC (pi-worker.ts)

Add a request-response channel for subagent execution:

```typescript
const pendingSubagentRequests = new Map<string, {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  onUpdate?: (result: unknown) => void
}>()

async function requestSubagentRun(
  toolCallId: string,
  task: string,
  onUpdate?: (result: unknown) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingSubagentRequests.set(toolCallId, { resolve, reject, onUpdate })
    send({
      channel: 'subagent:run',
      toolCallId,
      task,
      parentSessionFile: session?.sessionFile,
      cwd,
    })
  })
}
```

Handle incoming subagent messages from main process in the `parentPort.on('message')` handler:

```typescript
// In parentPort.on('message') handler, before handleCommand():
if (msg.type === 'subagent:progress') {
  const pending = pendingSubagentRequests.get(msg.toolCallId)
  pending?.onUpdate?.(msg.update)
  return
}
if (msg.type === 'subagent:result') {
  const pending = pendingSubagentRequests.get(msg.toolCallId)
  if (pending) {
    pendingSubagentRequests.delete(msg.toolCallId)
    if (msg.error) pending.reject(new Error(msg.error))
    else pending.resolve(msg.result)
  }
  return
}
```

### 3. Main Process Orchestration (index.ts)

Listen for `subagent:run` messages from the primary worker:

```typescript
// In PiSDKBridge or WorkerManager setup
primaryBridge.on('subagent:run', async (data) => {
  const { toolCallId, task, parentSessionFile, cwd } = data

  // 1. Create session file
  const sessionDir = sessionService.getSessionDir(cwd)
  const sessionPath = sessionService.createSessionFile(
    sessionDir, cwd, `subagent-${toolCallId.slice(0, 8)}`, parentSessionFile
  )

  // 2. Set metadata
  sessionService.setSessionOrigin(sessionPath, 'subagent')
  sessionService.setSubagentMeta(sessionPath, {
    agentName: 'subagent',
    task,
    mode: 'single',
    runId: toolCallId,
  })
  sessionService.reparentSession(sessionPath, parentSessionFile)

  // 3. Notify renderer — session appears in sidebar immediately
  broadcastToRenderers('subagent:status', {
    type: 'subagent:detected',
    sessionPath,
    parentSessionPath: parentSessionFile,
    toolCallId,
  })

  // 4. Create secondary worker
  const worker = await workerManager.getOrCreateSecondary(sessionPath, cwd)

  // 5. Send prompt
  await worker.bridge.sendRpcCommand({ type: 'prompt', message: task })

  // 6. Wait for agent_end (listen on WorkerManager events for this sessionPath)
  //    This can be done via a one-time event listener

  // 7. Collect last assistant message from session file
  const messages = sessionService.parseSessionMessages(sessionPath)
  const lastAssistant = [...messages].reverse().find(
    (m) => (m as { role?: string }).role === 'assistant'
  )

  // 8. Send result back to primary worker
  const resultText = lastAssistant
    ? extractTextFromMessage(lastAssistant)
    : '(subagent produced no output)'

  primaryBridge.sendCommand({
    type: 'subagent:result',
    toolCallId,
    result: {
      content: [{ type: 'text', text: resultText }],
      details: { sessionPath, exitStatus: 'success' },
    },
  })
})
```

### 4. Progress Updates (optional, for parent session)

While the secondary worker runs, forward key events as progress updates to the primary worker:

```typescript
// Listen to secondary worker events
workerManager.on('event', (data) => {
  const obj = data as Record<string, unknown>
  if (obj.sessionPath === sessionPath) {
    if (obj.type === 'message_end' || obj.type === 'tool_execution_end') {
      // Forward as progress update
      primaryBridge.sendCommand({
        type: 'subagent:progress',
        toolCallId,
        update: {
          content: [{ type: 'text', text: 'subagent running...' }],
          details: { results: [{ progress: { status: 'running' } }] },
        },
      })
    }
    if (obj.type === 'agent_end') {
      // Subagent finished — collect result
    }
  }
})
```

### 5. Renderer (minimal changes)

Already handled by existing infrastructure:
- `subagent:detected` → `onSubagentDetected` → `loadSessions()` (session appears in sidebar)
- Secondary worker events arrive as `pi:event` with subagent's `sessionPath` → `handleEvent` processes them naturally (streaming, tool calls, messages)
- `tool_execution_update` from primary worker shows progress in parent session's tool call block
- `tool_execution_end` shows final result in parent session

No new renderer code needed beyond what's already implemented.

## Event Flow

### Subagent session (sidebar, real-time)

Secondary worker events flow through the existing pipeline:
```
Secondary PiSDKBridge → WorkerManager.emit('event') → index.ts broadcastToRenderers('pi:event') → renderer handleEvent()
```

Events: `agent_start`, `turn_start`, `message_start`, `message_update` (streaming), `message_end`, `tool_execution_start/end`, `agent_end`

These all carry the subagent's `sessionPath`, so `handleEvent` routes them to the correct cache. The user can click the subagent session and watch it stream in real-time.

### Parent session (tool call progress)

Primary worker events:
- `tool_execution_start` — subagent tool starts
- `tool_execution_update` — progress updates (optional)
- `tool_execution_end` — final result text

## Session Lifecycle

1. **Creation**: `createSessionFile()` with parent reference
2. **Metadata**: `setSessionOrigin('subagent')`, `setSubagentMeta()`, `reparentSession()`
3. **Sidebar**: `subagent:detected` → `loadSessions()` → appears immediately
4. **Streaming**: Secondary worker events → renderer, same as any session
5. **Completion**: `agent_end` → result extracted → `tool_execution_end` in parent
6. **Cleanup**: Secondary worker stays alive (idle timeout via `WorkerManager` LRU eviction)

## What We Delete

- `src/main/subagent-watcher.ts` — no filesystem polling
- `pi-subagents` extension — no external dependency
- `findNode22PlusPath()` in `pi-sdk-bridge.ts` — no child process spawning
- Recursive `listSessions()` scan — subagent sessions are flat in sessions dir (created by `createSessionFile`)
- `subagentSessionMapRef` in `usePiRpc.ts` — no toolCallId mapping needed
- `tool_execution_update` handler for subagent in `usePiRpc.ts` — events come directly from secondary worker

## What Stays

- `SessionInfo.origin = 'subagent'` and `SubagentMeta` types
- Sidebar visual differentiation (⚡ icon, agent name, progress)
- `onSubagentDetected` callback → `loadSessions()`
- `setSessionOrigin`, `setSubagentMeta`, `reparentSession` in session-service

## Files to Modify

| File | Change |
|------|--------|
| `src/main/pi-worker.ts` | Add `createSubagentTool()`, `requestSubagentRun()`, handle `subagent:progress`/`subagent:result` messages |
| `src/main/index.ts` | Listen for `subagent:run` from primary bridge, orchestrate secondary worker, send result back |
| `src/main/pi-sdk-bridge.ts` | Emit `subagent:run` as a bridge event (or handle in `handleChildMessage`) |
| `src/main/session-service.ts` | Revert `listSessions()` recursive scan (no longer needed) |
| `src/main/subagent-watcher.ts` | **Delete** |
| `src/renderer/src/hooks/usePiRpc.ts` | Remove `tool_execution_update` subagent handler, remove `subagentSessionMapRef` |
| `src/main/pi-sdk-bridge.ts` | Remove `findNode22PlusPath()` (no longer needed) |

## Edge Cases

- **Abort**: If primary agent aborts, `AbortSignal` fires → tool should signal secondary worker to abort via `bridge.sendRpcCommand({ type: 'abort' })`
- **Error**: If secondary worker fails to start or errors, send error result back to primary
- **Timeout**: Secondary workers have idle timeout via `WorkerManager` (5 min default)
- **Max workers**: `WorkerManager` maxSecondaries = 8, LRU eviction handles overflow
- **Multiple subagents**: Each call creates a new secondary worker with its own session file

# Native Subagent Spec

## Problem

pi-subagents extension spawns child processes, writes JSONL to nested directories, and doesn't provide real streaming. Xi already has `WorkerManager` with primary + 8 secondary workers, each with independent `PiSDKBridge`, session files, and event streams. We should use that.

## Goal

Register a `subagent` custom tool that, when called by any worker, creates a secondary worker to run the task. The subagent session appears in the sidebar immediately and streams in real-time — same as any other session. The result is routed back to the **sender** worker (not always primary).

## Architecture

```
Sender Worker (pi-worker.ts)            Main Process (index.ts)
  ├─ Pi session with `subagent` tool      │
  │                                        │
  │  agent calls subagent tool             │
  │  ↓                                     │
  │  requestSubagentRun()                  │
  │  ├─ pendingSubagentRequests.set()      │
  │  └─ send({ channel: 'subagent:run',    │
  │         toolCallId, task,              │
  │         parentSessionFile })           │
  │                                        │
  │  awaits promise...                     │
  │                                   PiSDKBridge.handleChildMessage()
  │                                   ├─ case 'subagent:run'
  │                                   │  emit('subagent:run', { ...msg, senderSessionId })
  │                                   ↓
  │                                   WorkerManager.setupBridgeEvents()
  │                                   ├─ bridge.on('subagent:run')
  │                                   │  emit('subagent:run', { ...data, senderSessionPath })
  │                                   ↓
  │                                   workerManager.on('subagent:run', handler)
  │                                   ├─ createSessionFile()
  │                                   ├─ setSessionOrigin('subagent')
  │                                   ├─ setSubagentMeta()
  │                                   ├─ broadcastToRenderers('subagent:detected')
  │                                   ├─ getOrCreateSecondary()
  │                                   ├─ sendCommand({ type: 'prompt' })
  │                                   ├─ wait for agent_end (5-min timeout)
  │                                   ├─ parseSessionMessages() → extract result
  │                                   └─ route result to SENDER worker
  │                                        │
  │                                        │  sender.bridge.sendCommand({
  │                                        │    type: 'subagent:result',
  │                                        │    toolCallId, result })
  │  ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←│
  │  parentPort.on('message')              │
  │  ├─ msg.type === 'subagent:result'     │
  │  ├─ pendingSubagentRequests.get()      │
  │  └─ resolve(result)                    │
  │                                        │
  ↓  tool_execution_end in sender session  │
```

## Components

### 1. Custom Tool: `subagent` (pi-worker.ts)

Registered in `createRuntime()` via `customTools` array alongside `guardedWriteTool`, `guardedEditTool`, and `createSearchSessionsTool()`.

```typescript
const pendingSubagentRequests = new Map<string, {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}>()

function requestSubagentRun(toolCallId: string, task: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingSubagentRequests.set(toolCallId, { resolve, reject })
    send({
      channel: 'subagent:run',
      toolCallId,
      task,
      parentSessionFile: session?.sessionFile,
    })
  })
}

function createSubagentTool() {
  return {
    name: 'subagent',
    label: 'subagent',
    description: 'Delegate a task to a subagent with its own session...',
    parameters: {
      type: 'object' as const,
      properties: {
        task: { type: 'string' as const, description: '...' },
      },
      required: ['task'],
    },
    execute: async (toolCallId: string, params: { task: string }) => {
      return await requestSubagentRun(toolCallId, params.task)
    },
  }
}
```

Key design decisions:
- **No `onUpdate` callback** — progress updates are not forwarded to the parent. The parent sees only the final result via `tool_execution_end`. Real-time progress is visible by clicking the subagent session in the sidebar.
- **No `cwd` in the message** — main process uses its own `projectPath`.
- **Module-level `session`** — `createSubagentTool()` takes no parameters; `parentSessionFile` is read from the module-level `session` object.

### 2. Worker ↔ Main IPC (pi-worker.ts)

The `parentPort.on('message')` handler checks for `subagent:result` before delegating to `handleCommand()`:

```typescript
process.parentPort.on('message', (event: Electron.ParentPortMessageEvent) => {
  const msg = event.data as WorkerCommand | { type: 'init'; data: WorkerInit }
  if (msg.type === 'init') { /* ... */ return }

  if (msg.type === 'subagent:result') {
    const pending = pendingSubagentRequests.get(msg.toolCallId as string)
    if (pending) {
      pendingSubagentRequests.delete(msg.toolCallId as string)
      if (msg.error) {
        pending.reject(new Error(msg.error as string))
      } else {
        pending.resolve(msg.result)
      }
    }
    return
  }

  handleCommand(msg as WorkerCommand).catch(/* ... */)
})
```

### 3. Bridge Event Forwarding (pi-sdk-bridge.ts)

The bridge classifies worker messages by `channel` in `handleChildMessage()`. The `subagent:run` channel is emitted as a bridge event, tagged with `senderSessionId` so the main process knows which worker originated the request:

```typescript
case 'subagent:run': {
  this.emit('subagent:run', { ...msg, senderSessionId: this.sessionId })
  break
}
```

Additionally, `utilityProcess.fork()` uses `stdio: 'inherit'` (not `'pipe'`) so worker `console.error` output is visible in the terminal for debugging.

### 4. WorkerManager Forwarding (worker-manager.ts)

`setupBridgeEvents()` forwards `subagent:run` from each bridge, attaching `senderSessionPath` (the worker's session path) so the main process can route the result back:

```typescript
bridge.on('subagent:run', (data: unknown) => {
  this.emit('subagent:run', { ...(data as Record<string, unknown>), senderSessionPath: state.sessionPath })
})
```

### 5. Main Process Orchestration (index.ts)

The `workerManager.on('subagent:run')` handler orchestrates the full subagent lifecycle:

```typescript
workerManager.on('subagent:run', async (data: unknown) => {
  const msg = data as { toolCallId, task, parentSessionFile, senderSessionPath? }
  const { toolCallId, task, parentSessionFile } = msg
  const senderSessionPath = msg.senderSessionPath ?? ''

  // 1. Create session file
  const sessionDir = sessionService.getSessionDir(cwd)
  const subSessionPath = sessionService.createSessionFile(sessionDir, cwd, 'subagent', parentSessionFile)

  // 2. Set metadata
  sessionService.setSessionOrigin(subSessionPath, 'subagent')
  sessionService.setSubagentMeta(subSessionPath, { agentName: 'subagent', task, mode: 'single', runId: toolCallId })

  // 3. Notify renderer — session appears in sidebar immediately
  broadcastToRenderers('subagent:status', { type: 'subagent:detected', sessionPath: subSessionPath, parentSessionPath: parentSessionFile, toolCallId })

  try {
    // 4. Create secondary worker
    const worker = await workerManager!.getOrCreateSecondary(subSessionPath, cwd)

    // 5. Wait for agent_end BEFORE sending prompt (race condition fix)
    const agentEndPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        workerManager?.off('event', handler)
        reject(new Error('Subagent timed out (5 min)'))
      }, 5 * 60 * 1000)

      const handler = (eventData: unknown) => {
        const evt = eventData as Record<string, unknown>
        if (evt.type === 'agent_end' && evt.sessionPath === subSessionPath) {
          clearTimeout(timeout)
          workerManager?.off('event', handler)
          resolve()
        }
      }
      workerManager?.on('event', handler)
    })

    // 6. Send prompt (fire-and-forget, NOT sendRpcCommand which has 60s timeout)
    worker.bridge.sendCommand({ type: 'prompt', message: task })

    // 7. Wait for completion
    await agentEndPromise

    // 8. Extract last assistant message
    const messages = sessionService.parseSessionMessages(subSessionPath)
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    // ... extract text from content blocks ...

    // 9. Route result to SENDER worker (not always primary)
    const sender = (senderSessionPath ? workerManager?.get(senderSessionPath) : null) ?? workerManager?.getPrimary()
    sender?.bridge.sendCommand({
      type: 'subagent:result',
      toolCallId,
      result: { content: [{ type: 'text', text: resultText }], details: { sessionPath: subSessionPath, exitStatus: 'success' } },
    })
  } catch (err) {
    const sender = (senderSessionPath ? workerManager?.get(senderSessionPath) : null) ?? workerManager?.getPrimary()
    sender?.bridge.sendCommand({ type: 'subagent:result', toolCallId, error: err.message })
  }
})
```

Key design decisions:
- **`sendCommand` not `sendRpcCommand`** — `sendRpcCommand` has a 60-second timeout, far too short for subagent tasks. `sendCommand` is fire-and-forget; we wait for `agent_end` via event listener instead.
- **Event listener set up BEFORE prompt** — prevents a race condition where `agent_end` fires before the listener is attached.
- **5-minute timeout** — prevents hanging forever if `agent_end` never fires.
- **Sender routing** — the result is sent to the worker that called `requestSubagentRun`, not always the primary. This is critical because `pendingSubagentRequests` lives in the sender worker's process.

### 6. Renderer (minimal changes)

Already handled by existing infrastructure:
- `subagent:detected` → `onSubagentDetected` → `loadSessionsRef.current?.()` (session appears in sidebar)
- Secondary worker events arrive as `pi:event` with subagent's `sessionPath` → `handleEvent` processes them naturally (streaming, tool calls, messages)
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

### Parent session (tool call result)

Sender worker events:
- `tool_execution_start` — subagent tool starts (parent shows spinner)
- `tool_execution_end` — final result text (parent shows result)

No `tool_execution_update` — the parent doesn't receive incremental progress. Real-time progress is visible only by viewing the subagent session directly.

## Session Lifecycle

1. **Creation**: `createSessionFile()` with parent reference
2. **Metadata**: `setSessionOrigin('subagent')`, `setSubagentMeta()`
3. **Sidebar**: `subagent:detected` → `loadSessions()` → appears immediately
4. **Streaming**: Secondary worker events → renderer, same as any session
5. **Completion**: `agent_end` → result extracted → `subagent:result` sent to sender → `tool_execution_end` in parent
6. **Cleanup**: Secondary worker stays alive (idle timeout via `WorkerManager` LRU eviction)

## Files Modified

| File | Change |
|------|--------|
| `src/main/pi-worker.ts` | `createSubagentTool()`, `requestSubagentRun()`, `pendingSubagentRequests` Map, `subagent:result` handler in `parentPort.on('message')`, tool registered in `tools` + `customTools` arrays |
| `src/main/index.ts` | `workerManager.on('subagent:run')` handler — creates session, orchestrates secondary worker, routes result to sender |
| `src/main/pi-sdk-bridge.ts` | `handleChildMessage()` case `subagent:run` emits with `senderSessionId`; `stdio: 'inherit'` |
| `src/main/worker-manager.ts` | `setupBridgeEvents()` forwards `subagent:run` with `senderSessionPath` |
| `src/preload/index.ts` | `onSubagentStatus` IPC channel |
| `src/renderer/src/hooks/usePiRpc.ts` | `onSubagentDetected` option, `onSubagentStatus` listener |
| `src/renderer/src/App.tsx` | `loadSessionsRef` wiring for `onSubagentDetected` |
| `src/renderer/src/components/SessionSidebar.tsx` | ⚡ icon, agent name tag, progress line |
| `src/renderer/src/types/session.ts` | `SubagentMeta` interface, `SessionInfo.origin` + `subagentMeta` fields |
| `src/main/session-service.ts` | `setSessionOrigin()`, `setSubagentMeta()`, `parseSessionFile()` extracts origin + subagentMeta |

## Edge Cases

- **Timeout**: 5-minute timeout on `agent_end` wait. If exceeded, error result sent back to sender.
- **Error**: If secondary worker fails to start or errors, error result sent back to sender.
- **Sender not found**: Falls back to primary worker (should not happen in normal operation).
- **Max workers**: `WorkerManager` maxSecondaries = 8, LRU eviction handles overflow.
- **Multiple subagents**: Each call creates a new secondary worker with its own session file.
- **Nested subagents**: A subagent's worker can itself call the `subagent` tool — the sender routing ensures the result goes back to the correct intermediate worker.

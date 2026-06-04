# Subagent Sessions — Design Spec

## Overview

Integrate [pi-subagents](https://github.com/nicobailon/pi-subagents) into Xi's session UI so that subagent runs appear as first-class sessions in the sidebar, with real-time progress tracking and results.

## Background

`pi-subagents` is a Pi extension that registers a `subagent` tool. When the agent calls it, a **child `pi` process** is spawned with `--mode json -p <task>`. Key facts:

- Each subagent is a real `pi` child process, not an in-process call
- Child sessions are `.jsonl` files stored under the parent's session directory tree
- `context: "fork"` creates a real session fork (not a summary)
- Progress is event-driven: child emits JSONL events (`tool_execution_start`, `message_end`, etc.)
- Background runs write `status.json` + `events.jsonl` to a temp directory
- `WorkflowGraphSnapshot` provides a DAG for chain/parallel rendering
- Nested depth is guarded (default max depth = 2)

## User Stories

1. As a user, I want to see subagent runs as sessions in the sidebar with a distinct icon, so I can distinguish them from manually created sessions
2. As a user, I want to see real-time progress of a running subagent (current tool, turn count, status), so I know what it's doing
3. As a user, I want to click on a subagent session to see its conversation and results
4. As a user, I want background subagent completions to appear as notifications

## Design

### 1. Session Detection

**Source of truth**: Pi emits `subagent:async-started` and `subagent:async-complete` events through the Pi event stream.

**SessionInfo extension**:
```typescript
interface SessionInfo {
  // ... existing fields
  origin?: 'user' | 'subagent'
  parentSessionPath?: string
  subagentMeta?: {
    agentName: string
    task: string
    mode: 'single' | 'parallel' | 'chain'
    runId: string
  }
}
```

**Detection flow**:
1. Pi event stream emits `subagent:async-started` → extract session path, agent name, task
2. Create a new `SessionInfo` entry with `origin: 'subagent'` and the parent path
3. Add to session tree as a child of the parent session
4. Show in sidebar with distinct icon

### 2. Sidebar Rendering

**Visual differentiation**:
- Subagent sessions show a ⚡ (or robot) icon prefix instead of the default session icon
- The agent name is shown as a tag (e.g., `⚡ scout — audit auth`)
- Running subagents show a pulsing indicator
- Completed subagents show ✓ or ✗ based on exit status

**Grouping**: Subagent sessions appear as children of their parent session in the tree, collapsible under the parent.

### 3. Real-Time Progress

**Foreground subagents**: Pi streams JSONL events. The existing `onEvent` handler already receives these. Parse subagent-specific events to extract:
- Current tool name
- Turn count
- Running duration
- Activity state (`active_long_running` / `needs_attention`)

**Background subagents**: Poll `status.json` via IPC. The subagent runner updates it atomically.

**Progress UI**: In the sidebar, show a compact progress line under the subagent session name:
```
⚡ scout — audit auth
  🔧 read_file · 3 turns · 45s
```

### 4. Subagent Detail View

When clicking a subagent session, load its `.jsonl` file and render the conversation using the existing `ChatView` component. No special rendering needed — it's a normal Pi session.

For chain/parallel subagents, show a **workflow graph** based on `WorkflowGraphSnapshot`:
- Phases displayed as columns
- Nodes as cards with status (pending/running/completed/failed)
- Current node highlighted

### 5. IPC Changes

| IPC Channel | Direction | Purpose |
|---|---|---|
| `pi:event` (existing) | main→renderer | Receives `subagent:async-started`, `subagent:async-complete` |
| `subagent:status` | main→renderer | Periodic status updates from `status.json` polling |
| `subagent:list` | renderer→main | List all known subagent runs for current project |

### 6. Configuration

Add to General Settings:
- Show/hide subagent sessions in sidebar (default: show)
- Auto-switch to subagent session on creation (default: off)

## Implementation Phases

### Phase 1: Detection & Sidebar
- Extend `SessionInfo` with `origin` and `subagentMeta`
- Parse `subagent:async-started` events in `usePiRpc.ts`
- Add subagent entries to session tree
- Render with distinct icon in `SessionSidebar`

### Phase 2: Progress Tracking
- Parse subagent progress events from Pi event stream
- Poll `status.json` for background runs
- Show compact progress in sidebar

### Phase 3: Detail View
- Load subagent `.jsonl` sessions
- Render workflow graph for chain/parallel runs

### Phase 4: Notifications
- Show toast when background subagent completes
- Click notification to open the subagent session

## Open Questions

1. Should subagent sessions be closable/deletable independently?
2. Should we support the `contact_supervisor` intercom flow (child asking parent for decisions)?
3. How to handle subagent sessions when the parent session is deleted?

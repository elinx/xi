# SDK Migration & Session Sidebar Fix Log

Date: 2026-05-30

## Background

Migrated from Pi CLI RPC mode to Pi SDK mode (`@earendil-works/pi-coding-agent`) via Worker Thread. Sessions stored in project-local `.agent-gui/` directory instead of `~/.pi/`.

## Issues Fixed

### 1. Electron Worker "Crash" (Red Herring)

**Symptom**: Worker exited with code 1, no error output captured.

**Root Cause**: Two issues masked as a crash:
- **Double Worker spawn**: React Strict Mode (dev) calls `useEffect` twice, triggering `pi:start` IPC twice. Second `start()` created a new Worker, orphaning the first.
- **broadcastToRenderers crash on window disposal**: When app terminates, `broadcastToRenderers` sent to a disposed BrowserWindow, throwing `Render frame was disposed before WebFrameMain could be accessed`.

**Fix**:
- `PiSDKBridge.start()`: Guard with `if (this._isConnected) return` and wait for existing Worker if `this.worker` is set but not connected yet
- `broadcastToRenderers()`: Added `!win.webContents.isDestroyed()` check + try/catch around `win.webContents.send()`

### 2. Sidebar Not Showing "main" on First Launch

**Symptom**: First open shows empty sidebar. Only after restart does "main" appear.

**Root Cause**: `nameSession()` checked `if (!existsSync(sessionPath)) return false`. Pi SDK's session files are lazily created (only when actual data is written), so `nameSession` silently skipped when the file didn't exist.

**Fix**: `nameSession()` now creates the file with a proper session header + `session_info` entry when the file doesn't exist:
```typescript
if (!existsSync(sessionPath)) {
  const header = JSON.stringify({
    type: 'session', version: 3,
    id: idPart, timestamp: new Date().toISOString(),
    cwd: cwd ?? process.cwd(),
  })
  writeFileSync(sessionPath, header + '\n')
}
appendFileSync(sessionPath, JSON.stringify({ type: 'session_info', name }) + '\n')
```

### 3. Sidebar Not Updating After Agent Response

**Symptom**: User sends "hello", agent responds, but sidebar still shows no "main" session.

**Root Cause**: `agent_end` event didn't trigger sidebar refresh. `loadSessions()` only ran when `isConnected` changed.

**Fix**:
- `usePiRpc`: Added `onAgentEnd` ref callback + `setOnAgentEnd` setter
- `App.tsx`: `setOnAgentEnd(() => refresh)` — sidebar refreshes after every agent response

### 4. Session List Empty After Connect (Before Restart)

**Symptom**: After connecting, sidebar empty. Only populated after app restart.

**Root Cause**: `handleConnect()` called `window.api.start()` but never refreshed the session list afterward. The `isConnected`-triggered `loadSessions()` ran before the session name was written to disk.

**Fix**: `handleConnect()` calls `refresh()` after `start()` completes.

## Architecture Decisions

### PI_CODING_AGENT_DIR + Symlinks

Session storage redirected to `.agent-gui/` via `PI_CODING_AGENT_DIR` env var, set before Worker spawn. Global config files symlinked:
- `auth.json` → `~/.pi/agent/auth.json`
- `models.json` → `~/.pi/agent/models.json`
- `settings.json` → `~/.pi/agent/settings.json`

### PiSDKBridge.start() Concurrency

Second `start()` call (from React Strict Mode) now waits for the existing Worker to connect instead of returning immediately. This prevents race conditions where `sendRpcCommand` is called before the Worker finishes initialization.

## Files Changed

| File | Change |
|------|--------|
| `src/main/pi-sdk-bridge.ts` | Double-spawn guard, PI_CODING_AGENT_DIR + symlinks, stdout/stderr piping removed |
| `src/main/pi-worker.ts` | Cleaned up (rewrote from scratch after corruption), removed debug logs |
| `src/main/index.ts` | `broadcastToRenderers` crash fix, `nameSession` always called with cwd, `pi:start` race condition handling |
| `src/main/session-service.ts` | `nameSession` creates file when it doesn't exist, added `basename`/`randomUUID` imports, removed duplicate code block |
| `src/main/pi-bridge.ts` | Deleted (no longer imported) |
| `src/renderer/src/App.tsx` | `handleConnect()` calls `refresh()`, `setOnAgentEnd(() => refresh)` wired |
| `src/renderer/src/hooks/usePiRpc.ts` | Added `onAgentEnd` ref + `setOnAgentEnd` setter, fires on `agent_end` event |
| `src/renderer/src/hooks/useSessionManager.ts` | No changes (existing `onStateChanged` + `refresh` sufficient) |
| `.gitignore` | Added `.agent-gui/` |

## Verification

- `tsc --noEmit` clean
- `vitest run` 135/135 passing
- `electron-vite build` succeeds
- Session file created at `.agent-gui/sessions/--encoded-cwd--/` with correct header + name on first launch
- App runs 25+ seconds without crash
- GPU/network service errors only on process termination (normal Electron behavior)

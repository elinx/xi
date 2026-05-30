# Xi Improvement Roadmap

> Current version: 0.0.1 | Assessment score: 7.5/10 | Target: 8.5+

## 1. Error Handling & Observability

**Current Problem:** Errors are silently swallowed throughout the codebase.

```typescript
// Anti-pattern — found 15+ occurrences
} catch {
  return []
}
} catch {}
} catch { continue }
```

**Recommendations:**

- [ ] Replace all bare `catch {}` with structured error logging
- [ ] Introduce a centralized `ErrorHandler` service that:
  - Logs to `console.error` (dev) and a file (prod)
  - Surfaces user-facing errors via a toast/notification system
  - Classifies errors: `transient` (auto-retry), `user-actionable` (show message), `fatal` (crash report)
- [ ] Add error boundaries around major React components (`ChatView`, `SessionSidebar`, `ImageAnnotator`)
- [ ] For IPC handlers: return `{ ok: false, error: string, code: string }` with machine-readable error codes
- [ ] Add connection health monitoring — heartbeat ping to Pi Worker, detect zombie connections

**Priority:** P0 — foundational for reliability

---

## 2. Connection Resilience

**Current Problem:** If Pi disconnects, the user must manually click "Connect to Pi". No retry, no recovery.

**Recommendations:**

- [ ] Implement exponential backoff auto-reconnect:
  - 1s → 2s → 4s → 8s → max 30s
  - Reset on successful connection
- [ ] Add connection state machine: `disconnected → connecting → connected → reconnecting → disconnected`
  - Expose state to renderer via `pi:stateChanged`
- [ ] Preserve in-flight messages during reconnection (queue + replay)
- [ ] Show reconnection status in the UI (spinner + attempt count)
- [ ] Add "last connected" timestamp for diagnostics

**Priority:** P0 — critical for user experience

---

## 3. Type Safety & Runtime Validation

**Current Problem:** RPC responses are cast with `as Record<string, unknown>` and then manually drilled — no compile-time or runtime guarantees.

```typescript
const data = (await piBridge!.sendRpcCommand({ type: 'get_state' })) as Record<string, unknown>
const sessionPath = typeof data.sessionFile === 'string' ? data.sessionFile : null
```

**Recommendations:**

- [ ] Define Zod schemas for all RPC command responses:
  - `get_state`, `get_messages`, `get_fork_messages`, `fork`, `switch_session`, etc.
- [ ] Create typed wrapper functions:
  ```typescript
  async getState(): Promise<PiState> {
    const raw = await this.sendRpcCommand({ type: 'get_state' })
    return PiStateSchema.parse(raw)
  }
  ```
- [ ] Move all `as` assertions in `index.ts` IPC handlers to typed wrappers
- [ ] Add request/response type pairs for each IPC channel

**Priority:** P1 — prevents subtle bugs and improves maintainability

---

## 4. Performance & Scalability

**Current Problem:** All messages and fork points are held in memory with no pagination or virtualization.

**Recommendations:**

- [ ] Implement virtual scrolling for `ChatView` (e.g., `@tanstack/react-virtual`)
  - Only render visible messages + small buffer
  - Preserve scroll position on new messages when not at bottom
- [ ] Add message pagination for `get_messages` RPC:
  - Support `offset` / `limit` parameters
  - Load older messages on scroll-up
- [ ] Index fork points by entry ID instead of linear `.filter()` per message
  ```typescript
  // Before: O(n*m) — filter per message
  const msgForkPoints = forkPoints.filter(fp => fp.entryId === msg.piEntryId)
  
  // After: O(1) — pre-built index
  const forkPointMap = useMemo(() => groupBy(forkPoints, fp => fp.entryId), [forkPoints])
  const msgForkPoints = forkPointMap[msg.piEntryId] ?? []
  ```
- [ ] Lazy-load session content — only parse headers for sidebar, full content on demand
- [ ] Add `useMemo` / `useCallback` audit — several inline functions in render paths

**Priority:** P1 — required before sessions grow large

---

## 5. State Management Clarity

**Current Problem:** Active session is tracked in two places (`activeSessionPath` in App + `currentSession` from useSessionManager), leading to potential desync.

**Recommendations:**

- [ ] Consolidate session state into a single source of truth:
  - Option A: Lift all session state to App, pass down
  - Option B: Use a lightweight state manager (zustand) for `sessionStore`
- [ ] Remove manual orchestration patterns like:
  ```typescript
  clearMessages()
  await switchSession(sessionPath)
  await loadHistory()
  await loadForkPoints(sessionPath)
  await refresh()
  ```
  Replace with a single `switchToSession(path)` action that handles the full lifecycle atomically
- [ ] Add state invariants / assertions in dev mode to catch desync early

**Priority:** P1 — reduces bugs as features grow

---

## 6. Image Annotator Improvements

**Current Problem:** Annotator works but lacks polish for production use.

**Recommendations:**

- [ ] Handle window/container resize — recalculate Fabric canvas dimensions
- [ ] Add undo/redo support for annotations
- [ ] Support annotation colors (currently hardcoded `#ef4444`)
- [ ] Add touch/stylus support for tablet use
- [ ] Improve annotation-to-prompt generation — include spatial relationships ("between the header and the sidebar") not just coordinates
- [ ] Persist annotations per message so they survive re-renders
- [ ] Add export: download annotated image as PNG

**Priority:** P2 — feature completeness for a differentiating feature

---

## 7. Test Coverage Expansion

**Current State:** 135 tests passing, covering session-service, IPC handlers, load-history, and sidebar rendering.

**Gaps:**

- [ ] PiSDKBridge + Worker communication — mock the Worker thread, test RPC command/response lifecycle
- [ ] ImageAnnotator — test annotation creation, export, coordinate normalization
- [ ] ChatView integration — test message rendering, fork UI, annotation mode transitions
- [ ] Error paths — test what happens when Pi disconnects mid-stream, when session files are corrupt, when RPC times out
- [ ] E2E (Playwright?) — full user flow: connect → chat → annotate → fork → switch session
- [ ] Add code coverage threshold (e.g., 70% lines) in CI

**Priority:** P1 — prevents regressions as codebase evolves

---

## 8. UX Polish

**Current Problem:** Functional but feels like a prototype in places.

**Recommendations:**

- [ ] Loading states: skeleton/spinner while loading history, switching sessions
- [ ] Empty states: better onboarding for first-time users (no sessions, no messages)
- [ ] Keyboard shortcuts: `Cmd+K` for session search/switch, `Cmd+N` for new session, `Cmd+\` toggle sidebar
- [ ] Dark mode: Tailwind v4 + `nativeTheme` listener is half-set-up (hardcoded `themeSource: 'light'`)
- [ ] Drag-and-drop images into the input bar
- [ ] Message search within a session
- [ ] Copy code blocks with one click (common in chat UIs, missing here)
- [ ] Responsive layout — handle narrow windows gracefully

**Priority:** P2 — quality of life for daily use

---

## 9. Security

**Current Problem:** HTML is rendered in sandboxed iframes, but other vectors are open.

**Recommendations:**

- [ ] Audit the `sandbox` attribute on HTML iframes — `allow-same-origin` may be too permissive
- [ ] Sanitize image `src` URLs before passing to Fabric / `<img>`
- [ ] Validate session file paths to prevent directory traversal in `deleteSession` / `switchSession`
- [ ] Add CSP headers for the renderer process
- [ ] Review preload script — ensure only intended APIs are exposed

**Priority:** P1 — important before any public release

---

## 10. Architecture & Code Quality

**Recommendations:**

- [ ] Extract IPC handler registration into separate modules by domain (session IPC, pi IPC) instead of one 300-line `registerIpcHandlers()`
- [ ] Add ESLint + Prettier with enforced config
- [ ] Add `strict: true` to tsconfig (currently not set)
- [ ] Replace `piBridge!` non-null assertions with proper null checks
- [ ] Add JSDoc to public APIs in `session-service.ts` and `pi-sdk-bridge.ts`
- [ ] Consider extracting the Pi SDK bridge into a separate package for reusability

**Priority:** P2 — long-term maintainability

---

## Implementation Priority Order

| Phase | Items | Target Score |
|-------|-------|-------------|
| Phase 1 (Stability) | #1 Error Handling, #2 Connection Resilience, #3 Type Safety, #9 Security | 8.0 |
| Phase 2 (Scale) | #4 Performance, #5 State Management, #7 Test Coverage | 8.5 |
| Phase 3 (Polish) | #6 Annotator, #8 UX, #10 Architecture | 9.0+ |

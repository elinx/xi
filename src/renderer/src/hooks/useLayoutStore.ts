import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LeftPanelView = 'sessions' | 'skills' | 'mcp'
export type RightPanelView = 'files' | 'git' | 'search'

interface LayoutState {
  leftPanelView: LeftPanelView
  leftPanelCollapsed: boolean
  leftPanelWidth: number

  rightPanelView: RightPanelView
  rightPanelCollapsed: boolean
  rightPanelWidth: number
  setLeftPanelView: (view: LeftPanelView) => void
  toggleLeftPanel: () => void
  setLeftPanelCollapsed: (collapsed: boolean) => void
  setLeftPanelWidth: (width: number) => void

  setRightPanelView: (view: RightPanelView) => void
  toggleRightPanel: () => void
  setRightPanelCollapsed: (collapsed: boolean) => void
  setRightPanelWidth: (width: number) => void

  // Session tree collapse state
  sessionCollapsedPaths: string[]
  toggleSessionCollapsed: (sessionPath: string) => void
  collapseAllSessions: (expandablePaths: string[]) => void
  expandAllSessions: () => void
  expandSessionPaths: (paths: string[]) => void

  // Session tree scroll trigger (transient, not persisted)
  sessionScrollTrigger: number
  triggerSessionScroll: () => void
}

const LEFT_PANEL_MIN = 180
const LEFT_PANEL_MAX = 480
const LEFT_PANEL_DEFAULT = 260

const RIGHT_PANEL_MIN = 180
const RIGHT_PANEL_MAX = 400
const RIGHT_PANEL_DEFAULT = 220

function clamp(value: number, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** Migrate from the old standalone localStorage key into zustand persist. */
function migrateCollapsedPaths(): string[] {
  try {
    // First, try reading from the old key
    const stored = localStorage.getItem('xi-session-collapsed-paths')
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      // Clean up old key — it's now managed by zustand persist
      localStorage.removeItem('xi-session-collapsed-paths')
      return parsed
    }
  } catch { /* ignore */ }
  return []
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftPanelView: 'sessions',
      leftPanelCollapsed: false,
      leftPanelWidth: LEFT_PANEL_DEFAULT,

      rightPanelView: 'files',
      rightPanelCollapsed: false,
      rightPanelWidth: RIGHT_PANEL_DEFAULT,

      setLeftPanelView: (view) =>
        set((state) => {
          if (state.leftPanelCollapsed) {
            return { leftPanelView: view, leftPanelCollapsed: false }
          }
          return { leftPanelView: view }
        }),

      toggleLeftPanel: () =>
        set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),

      setLeftPanelCollapsed: (collapsed) =>
        set({ leftPanelCollapsed: collapsed }),

      setLeftPanelWidth: (width) =>
        set({ leftPanelWidth: clamp(width, LEFT_PANEL_MIN, LEFT_PANEL_MAX, LEFT_PANEL_DEFAULT) }),

      setRightPanelView: (view) =>
        set((state) => {
          if (state.rightPanelCollapsed) {
            return { rightPanelView: view, rightPanelCollapsed: false }
          }
          return { rightPanelView: view }
        }),

      toggleRightPanel: () =>
        set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),

      setRightPanelCollapsed: (collapsed) =>
        set({ rightPanelCollapsed: collapsed }),

      setRightPanelWidth: (width) =>
        set({ rightPanelWidth: clamp(width, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX, RIGHT_PANEL_DEFAULT) }),

      sessionCollapsedPaths: migrateCollapsedPaths(),
      toggleSessionCollapsed: (sessionPath) =>
        set((state) => {
          const set = new Set(state.sessionCollapsedPaths)
          if (set.has(sessionPath)) {
            set.delete(sessionPath)
          } else {
            set.add(sessionPath)
          }
          return { sessionCollapsedPaths: [...set] }
        }),
      collapseAllSessions: (expandablePaths) =>
        set({ sessionCollapsedPaths: expandablePaths }),
      expandAllSessions: () =>
        set({ sessionCollapsedPaths: [] }),
      expandSessionPaths: (paths) =>
        set((state) => {
          const currentSet = new Set(state.sessionCollapsedPaths)
          let changed = false
          for (const p of paths) {
            if (currentSet.has(p)) {
              currentSet.delete(p)
              changed = true
            }
          }
          if (!changed) return state
          return { sessionCollapsedPaths: [...currentSet] }
        }),

      sessionScrollTrigger: 0,
      triggerSessionScroll: () => set((state) => ({ sessionScrollTrigger: state.sessionScrollTrigger + 1 })),
    }),
    {
      name: 'xi-layout-store',
      // Merge persisted state with defaults so new keys (like sessionCollapsedPaths)
      // never end up as undefined when loading from an older persisted version
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<LayoutState>),
        // Safety: ensure sessionCollapsedPaths is always an array
        sessionCollapsedPaths: Array.isArray((persisted as Partial<LayoutState>)?.sessionCollapsedPaths)
          ? ((persisted as Partial<LayoutState>).sessionCollapsedPaths as string[])
          : current.sessionCollapsedPaths,
      }),
      partialize: (state) => ({
        leftPanelView: state.leftPanelView,
        leftPanelCollapsed: state.leftPanelCollapsed,
        leftPanelWidth: state.leftPanelWidth,
        rightPanelView: state.rightPanelView,
        rightPanelCollapsed: state.rightPanelCollapsed,
        rightPanelWidth: state.rightPanelWidth,
        sessionCollapsedPaths: state.sessionCollapsedPaths,
      }),
    }
  )
)

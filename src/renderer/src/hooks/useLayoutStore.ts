import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LeftPanelView = 'sessions' | 'skills' | 'mcp' | 'settings'
export type RightPanelView = 'files' | 'git'

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

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftPanelView: 'sessions',
      leftPanelCollapsed: false,
      leftPanelWidth: LEFT_PANEL_DEFAULT,

      rightPanelView: 'files',
      rightPanelCollapsed: true,
      rightPanelWidth: RIGHT_PANEL_DEFAULT,

      setLeftPanelView: (view) =>
        set((state) => {
          if (state.leftPanelView === view) {
            return { leftPanelCollapsed: !state.leftPanelCollapsed }
          }
          return { leftPanelView: view, leftPanelCollapsed: false }
        }),

      toggleLeftPanel: () =>
        set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),

      setLeftPanelCollapsed: (collapsed) =>
        set({ leftPanelCollapsed: collapsed }),

      setLeftPanelWidth: (width) =>
        set({ leftPanelWidth: clamp(width, LEFT_PANEL_MIN, LEFT_PANEL_MAX, LEFT_PANEL_DEFAULT) }),

      setRightPanelView: (view) =>
        set((state) => {
          if (state.rightPanelView === view) {
            return { rightPanelCollapsed: !state.rightPanelCollapsed }
          }
          return { rightPanelView: view, rightPanelCollapsed: false }
        }),

      toggleRightPanel: () =>
        set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),

      setRightPanelCollapsed: (collapsed) =>
        set({ rightPanelCollapsed: collapsed }),

      setRightPanelWidth: (width) =>
        set({ rightPanelWidth: clamp(width, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX, RIGHT_PANEL_DEFAULT) }),
    }),
    {
      name: 'xi-layout-store',
      partialize: (state) => ({
        leftPanelView: state.leftPanelView,
        leftPanelCollapsed: state.leftPanelCollapsed,
        leftPanelWidth: state.leftPanelWidth,
        rightPanelView: state.rightPanelView,
        rightPanelCollapsed: state.rightPanelCollapsed,
        rightPanelWidth: state.rightPanelWidth,
      }),
    }
  )
)

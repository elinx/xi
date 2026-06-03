import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TabType = 'session' | 'file' | 'diff' | 'terminal' | 'settings'

export interface TabInfo {
  id: string
  type: TabType
  title: string
  closable: boolean
  dirty?: boolean
  meta: Record<string, unknown>
}

const SESSION_TAB_ID = 'tab-session'
export const SETTINGS_TAB_ID = 'tab-settings'

function createSessionTab(): TabInfo {
  return {
    id: SESSION_TAB_ID,
    type: 'session',
    title: 'Session',
    closable: false,
    meta: {},
  }
}

interface TabState {
  tabs: TabInfo[]
  activeTabId: string

  addTab: (tab: Omit<TabInfo, 'id'> & { id?: string }) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTab: (tabId: string, updates: Partial<TabInfo>) => void
  findTabByMeta: (type: TabType, key: string, value: unknown) => TabInfo | undefined
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [createSessionTab()],
      activeTabId: SESSION_TAB_ID,

      addTab: (tab) => {
        const id = tab.id ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const existing = get().findTabByMeta(tab.type, 'filePath', tab.meta.filePath)
        if (existing) {
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === existing.id ? { ...t, meta: { ...t.meta, ...tab.meta } } : t
            ),
            activeTabId: existing.id,
          }))
          return existing.id
        }
        set((state) => ({
          tabs: [...state.tabs, { ...tab, id }],
          activeTabId: id,
        }))
        return id
      },

      closeTab: (tabId) => {
        const state = get()
        const tab = state.tabs.find((t) => t.id === tabId)
        if (!tab || !tab.closable) return

        if (tab.type === 'terminal') {
          window.api.terminalKill(tabId)
        }

        const idx = state.tabs.findIndex((t) => t.id === tabId)
        const remaining = state.tabs.filter((t) => t.id !== tabId)

        let nextActiveId = state.activeTabId
        if (state.activeTabId === tabId) {
          nextActiveId = remaining[Math.min(idx, remaining.length - 1)]?.id ?? SESSION_TAB_ID
        }

        set({ tabs: remaining, activeTabId: nextActiveId })
      },

      setActiveTab: (tabId) => {
        const exists = get().tabs.some((t) => t.id === tabId)
        if (exists) set({ activeTabId: tabId })
      },

      updateTab: (tabId, updates) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
        }))
      },

      findTabByMeta: (type, key, value) => {
        return get().tabs.find((t) => t.type === type && t.meta[key] === value)
      },
    }),
    {
      name: 'xi-tab-store',
      partialize: () => ({}),
    }
  )
)

export { SESSION_TAB_ID }

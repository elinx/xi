import { describe, it, expect, beforeEach } from 'vitest'
import { useTabStore, SESSION_TAB_ID } from '../src/renderer/src/hooks/useTabStore'

describe('Issue #25: session tab switching on sidebar click', () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [{ id: SESSION_TAB_ID, type: 'session', title: 'Session', closable: false, meta: {} }],
      activeTabId: SESSION_TAB_ID,
    })
  })

  it('session tab is active by default', () => {
    const state = useTabStore.getState()
    expect(state.activeTabId).toBe(SESSION_TAB_ID)
  })

  it('addTab for file type switches activeTabId away from session', () => {
    useTabStore.getState().addTab({
      type: 'file',
      title: 'App.tsx',
      closable: true,
      meta: { filePath: '/src/App.tsx' },
    })
    const state = useTabStore.getState()
    expect(state.activeTabId).not.toBe(SESSION_TAB_ID)
    const activeTab = state.tabs.find(t => t.id === state.activeTabId)
    expect(activeTab?.type).toBe('file')
  })

  it('setActiveTab(SESSION_TAB_ID) switches back from file tab', () => {
    useTabStore.getState().addTab({
      type: 'file',
      title: 'App.tsx',
      closable: true,
      meta: { filePath: '/src/App.tsx' },
    })
    expect(useTabStore.getState().activeTabId).not.toBe(SESSION_TAB_ID)

    useTabStore.getState().setActiveTab(SESSION_TAB_ID)
    expect(useTabStore.getState().activeTabId).toBe(SESSION_TAB_ID)
  })

  it('setActiveTab is idempotent when already on session tab', () => {
    useTabStore.getState().setActiveTab(SESSION_TAB_ID)
    expect(useTabStore.getState().activeTabId).toBe(SESSION_TAB_ID)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { useTabStore, SESSION_TAB_ID } from '../src/renderer/src/hooks/useTabStore'

describe('useTabStore', () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [{ id: SESSION_TAB_ID, type: 'session', title: 'Session', closable: false, meta: {} }],
      activeTabId: SESSION_TAB_ID,
    })
  })

  describe('initial state', () => {
    it('has a session tab by default', () => {
      const state = useTabStore.getState()
      expect(state.tabs).toHaveLength(1)
      expect(state.tabs[0].type).toBe('session')
      expect(state.tabs[0].closable).toBe(false)
      expect(state.activeTabId).toBe(SESSION_TAB_ID)
    })
  })

  describe('addTab', () => {
    it('adds a file tab and makes it active', () => {
      const id = useTabStore.getState().addTab({
        type: 'file',
        title: 'App.tsx',
        closable: true,
        meta: { filePath: '/src/App.tsx' },
      })
      const state = useTabStore.getState()
      expect(state.tabs).toHaveLength(2)
      expect(state.activeTabId).toBe(id)
      const newTab = state.tabs.find(t => t.id === id)
      expect(newTab?.type).toBe('file')
      expect(newTab?.title).toBe('App.tsx')
      expect(newTab?.closable).toBe(true)
    })

    it('reuses existing file tab instead of creating duplicate', () => {
      const id1 = useTabStore.getState().addTab({
        type: 'file',
        title: 'App.tsx',
        closable: true,
        meta: { filePath: '/src/App.tsx' },
      })
      const id2 = useTabStore.getState().addTab({
        type: 'file',
        title: 'App.tsx',
        closable: true,
        meta: { filePath: '/src/App.tsx' },
      })
      expect(id1).toBe(id2)
      expect(useTabStore.getState().tabs).toHaveLength(2)
    })

    it('allows different files as separate tabs', () => {
      useTabStore.getState().addTab({
        type: 'file',
        title: 'App.tsx',
        closable: true,
        meta: { filePath: '/src/App.tsx' },
      })
      useTabStore.getState().addTab({
        type: 'file',
        title: 'index.ts',
        closable: true,
        meta: { filePath: '/src/index.ts' },
      })
      expect(useTabStore.getState().tabs).toHaveLength(3)
    })

    it('uses provided id when given', () => {
      const id = useTabStore.getState().addTab({
        id: 'custom-id',
        type: 'terminal',
        title: 'Terminal',
        closable: true,
        meta: {},
      })
      expect(id).toBe('custom-id')
    })
  })

  describe('closeTab', () => {
    it('closes a closable tab', () => {
      const id = useTabStore.getState().addTab({
        type: 'file',
        title: 'App.tsx',
        closable: true,
        meta: { filePath: '/src/App.tsx' },
      })
      useTabStore.getState().closeTab(id)
      expect(useTabStore.getState().tabs).toHaveLength(1)
    })

    it('cannot close the session tab', () => {
      useTabStore.getState().closeTab(SESSION_TAB_ID)
      expect(useTabStore.getState().tabs).toHaveLength(1)
    })

    it('switches to adjacent tab when closing active tab', () => {
      useTabStore.getState().addTab({
        type: 'file',
        title: 'App.tsx',
        closable: true,
        meta: { filePath: '/src/App.tsx' },
      })
      const fileId = useTabStore.getState().tabs[1].id
      useTabStore.getState().setActiveTab(fileId)
      expect(useTabStore.getState().activeTabId).toBe(fileId)
      useTabStore.getState().closeTab(fileId)
      expect(useTabStore.getState().activeTabId).toBe(SESSION_TAB_ID)
    })

    it('no-ops for non-existent tab', () => {
      useTabStore.getState().closeTab('nonexistent')
      expect(useTabStore.getState().tabs).toHaveLength(1)
    })
  })

  describe('setActiveTab', () => {
    it('sets active tab if it exists', () => {
      const id = useTabStore.getState().addTab({
        type: 'file',
        title: 'App.tsx',
        closable: true,
        meta: { filePath: '/src/App.tsx' },
      })
      useTabStore.getState().setActiveTab(SESSION_TAB_ID)
      expect(useTabStore.getState().activeTabId).toBe(SESSION_TAB_ID)
      useTabStore.getState().setActiveTab(id)
      expect(useTabStore.getState().activeTabId).toBe(id)
    })

    it('ignores non-existent tab', () => {
      useTabStore.getState().setActiveTab('nonexistent')
      expect(useTabStore.getState().activeTabId).toBe(SESSION_TAB_ID)
    })
  })

  describe('updateTab', () => {
    it('updates tab title', () => {
      useTabStore.getState().updateTab(SESSION_TAB_ID, { title: 'My Session' })
      const tab = useTabStore.getState().tabs.find(t => t.id === SESSION_TAB_ID)
      expect(tab?.title).toBe('My Session')
    })

    it('updates tab meta', () => {
      useTabStore.getState().updateTab(SESSION_TAB_ID, { meta: { sessionPath: '/main.jsonl' } })
      const tab = useTabStore.getState().tabs.find(t => t.id === SESSION_TAB_ID)
      expect(tab?.meta.sessionPath).toBe('/main.jsonl')
    })

    it('no-ops for non-existent tab', () => {
      const before = useTabStore.getState().tabs
      useTabStore.getState().updateTab('nonexistent', { title: 'X' })
      expect(useTabStore.getState().tabs).toEqual(before)
    })
  })

  describe('findTabByMeta', () => {
    it('finds a file tab by filePath', () => {
      useTabStore.getState().addTab({
        type: 'file',
        title: 'App.tsx',
        closable: true,
        meta: { filePath: '/src/App.tsx' },
      })
      const found = useTabStore.getState().findTabByMeta('file', 'filePath', '/src/App.tsx')
      expect(found?.title).toBe('App.tsx')
    })

    it('returns undefined for non-matching search', () => {
      const found = useTabStore.getState().findTabByMeta('file', 'filePath', '/nonexistent.ts')
      expect(found).toBeUndefined()
    })

    it('only matches the specified type', () => {
      const found = useTabStore.getState().findTabByMeta('file', 'sessionPath', undefined)
      expect(found).toBeUndefined()
    })
  })
})

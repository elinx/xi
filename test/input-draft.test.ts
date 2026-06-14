import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage for node environment
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value) }),
  removeItem: vi.fn((key: string) => { store.delete(key) }),
  clear: vi.fn(() => { store.clear() }),
  get length() { return store.size },
  key: vi.fn((_index: number) => null),
}

// Replace global localStorage
vi.stubGlobal('localStorage', mockLocalStorage)

// Import after mocking
import { setInputDraft, getInputDraft, clearInputDraft } from '../src/renderer/src/hooks/useInputDraft'

describe('useInputDraft', () => {
  beforeEach(() => {
    // Clear both the in-memory Map and localStorage between tests
    // We need to clear in-memory drafts too — since the module is cached,
    // we clear via clearInputDraft or just reimport. But since the Map is
    // module-level, we'll clear by calling clearInputDraft for all known keys.
    store.clear()
    mockLocalStorage.setItem.mockClear()
    mockLocalStorage.getItem.mockClear()
    mockLocalStorage.removeItem.mockClear()
    mockLocalStorage.clear.mockClear()
    // Clear all in-memory drafts by iterating localStorage keys
    for (const [key] of store) {
      if (key.startsWith('xi-input-draft:')) {
        store.delete(key)
      }
    }
    // Also clear in-memory cache — we'll use clearInputDraft for known paths
  })

  it('stores and retrieves a draft', () => {
    const path = '/project/session-1.md'
    const draft = {
      innerHTML: '<span>hello world</span>',
      mentions: [{ type: 'file' as const, relativePath: 'src/index.ts', name: 'index.ts' }],
      pastedImages: [{ data: 'base64data', mimeType: 'image/png' }],
    }

    setInputDraft(path, draft)
    const result = getInputDraft(path)

    expect(result).toBeDefined()
    expect(result!.innerHTML).toBe('<span>hello world</span>')
    expect(result!.mentions).toHaveLength(1)
    expect(result!.mentions[0].relativePath).toBe('src/index.ts')
    expect(result!.pastedImages).toHaveLength(1)
  })

  it('returns undefined for non-existent draft', () => {
    const result = getInputDraft('/nonexistent/session.md')
    expect(result).toBeUndefined()
  })

  it('clears a draft', () => {
    const path = '/project/session-2.md'
    setInputDraft(path, { innerHTML: 'test', mentions: [], pastedImages: [] })
    expect(getInputDraft(path)).toBeDefined()

    clearInputDraft(path)
    expect(getInputDraft(path)).toBeUndefined()
  })

  it('persists text to localStorage (without pastedImages)', () => {
    const path = '/project/session-3.md'
    setInputDraft(path, {
      innerHTML: '<b>bold</b>',
      mentions: [],
      pastedImages: [{ data: 'huge-base64-string', mimeType: 'image/png' }],
    })

    // localStorage.setItem should have been called
    expect(mockLocalStorage.setItem).toHaveBeenCalled()

    const lsKey = 'xi-input-draft:' + path
    const stored = store.get(lsKey)
    expect(stored).toBeDefined()

    const parsed = JSON.parse(stored!)
    expect(parsed.innerHTML).toBe('<b>bold</b>')
    expect(parsed.mentions).toEqual([])
    expect(parsed.pastedImages).toBeUndefined() // not persisted
  })

  it('clears from both memory and localStorage', () => {
    const path = '/project/session-5.md'
    setInputDraft(path, { innerHTML: 'clearme', mentions: [], pastedImages: [] })
    clearInputDraft(path)

    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('xi-input-draft:' + path)
    expect(getInputDraft(path)).toBeUndefined()
  })
})

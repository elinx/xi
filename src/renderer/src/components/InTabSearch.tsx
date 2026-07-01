import { useState, useEffect, useCallback, useRef } from 'react'
import { useDomSearch } from '../hooks/useDomSearch'

export type InTabSearchMode = 'dom' | 'terminal'

interface InTabSearchProps {
  containerRef: React.RefObject<HTMLElement | null>
  mode: InTabSearchMode
  active: boolean
  tabId?: string
  onClose: () => void
}

export default function InTabSearch({ containerRef, mode, active, tabId, onClose }: InTabSearchProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const visibilityByTab = useRef<Map<string, boolean>>(new Map())
  const queryByTab = useRef<Map<string, string>>(new Map())

  const domSearch = useDomSearch({
    containerRef,
    query,
    caseSensitive,
    enabled: visible && mode === 'dom',
  })

  useEffect(() => {
    if (!active) {
      setVisible(false)
      setQuery('')
    }
  }, [active])

  useEffect(() => {
    if (!tabId) return
    const savedVisible = visibilityByTab.current.get(tabId) ?? false
    const savedQuery = queryByTab.current.get(tabId) ?? ''
    setVisible(savedVisible)
    setQuery(savedQuery)
    if (!savedVisible) {
      domSearch.clear()
    }
  }, [tabId])

  const updateQuery = useCallback((q: string) => {
    setQuery(q)
    if (tabId) {
      queryByTab.current.set(tabId, q)
    }
  }, [tabId])

  const toggleVisible = useCallback((v: boolean) => {
    setVisible(v)
    if (tabId) {
      visibilityByTab.current.set(tabId, v)
    }
    if (!v) {
      updateQuery('')
    }
  }, [tabId, updateQuery])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'f') {
        e.preventDefault()
        toggleVisible(!visible)
        return
      }
      if (e.key === 'Escape' && visible) {
        toggleVisible(false)
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose, toggleVisible])

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    } else {
      domSearch.clear()
    }
  }, [visible])

  useEffect(() => {
    if (!visible) {
      onClose()
    }
  }, [visible, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        domSearch.prev()
      } else {
        domSearch.next()
      }
    }
  }, [domSearch])

  if (!visible || !active) return null

  const matchCount = mode === 'dom' ? domSearch.matches.length : 0
  const currentIdx = mode === 'dom' ? domSearch.currentIndex : 0
  const truncated = mode === 'dom' ? domSearch.truncated : false

  return (
    <div className="absolute top-2 right-2 z-50 flex items-center gap-1 rounded-lg xi-glass px-2 py-1.5 shadow-lg">
      <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => updateQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        className="w-36 bg-transparent text-xs text-gray-700 placeholder-gray-400 outline-none"
      />
      <button
        onClick={() => setCaseSensitive(!caseSensitive)}
        className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold transition-colors ${caseSensitive ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-gray-200'}`}
        title="Match case"
      >
        Aa
      </button>
      <div className="mx-0.5 h-4 w-px bg-gray-300" />
      <button
        onClick={domSearch.prev}
        disabled={matchCount === 0}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-200 disabled:opacity-30 transition-colors"
        title="Previous (Shift+Enter)"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <button
        onClick={domSearch.next}
        disabled={matchCount === 0}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-200 disabled:opacity-30 transition-colors"
        title="Next (Enter)"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <span className="min-w-[3rem] text-center text-[10px] tabular-nums text-gray-500">
        {matchCount === 0
          ? query.trim() ? '0/0' : ''
          : `${currentIdx + 1}/${truncated ? matchCount + '+' : matchCount}`}
      </span>
      <button
        onClick={() => toggleVisible(false)}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-200 transition-colors"
        title="Close (Esc)"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

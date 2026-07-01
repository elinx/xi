import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { TabInfo, TabType } from '../hooks/useTabStore'

const noDrag: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

interface TabBarProps {
  tabs: TabInfo[]
  activeTabId: string
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onAddTab: (type: TabType) => void
  onTabContextMenu?: (tabId: string, x: number, y: number) => void
  onClearSession?: () => void
  onBranch?: () => void
}

function TabIcon({ type }: { type: TabType }) {
  switch (type) {
    case 'session':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 3v-3H4a2 2 0 0 1-2-2V4z" />
        </svg>
      )
    case 'file':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 1.5h5.5L13 5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" />
          <polyline points="9.5,1.5 9.5,5 13,5" />
        </svg>
      )
    case 'diff':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="2" x2="4" y2="6" />
          <line x1="2" y1="4" x2="6" y2="4" />
          <line x1="12" y1="10" x2="12" y2="14" />
          <path d="M9 1h4a1 1 0 0 1 1 1v4" />
          <path d="M2 10v4a1 1 0 0 0 1 1h4" />
        </svg>
      )
    case 'terminal':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
          <polyline points="4,6 6.5,8.5 4,11" />
          <line x1="8" y1="11" x2="12" y2="11" />
        </svg>
      )
    case 'settings':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="2" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M2.9 13.1l1.4-1.4M11.7 4.3l1.4-1.4" />
        </svg>
      )
    case 'skill':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 1.5a4.5 4.5 0 014.5 4.5c0 1.5-.8 2.8-2 3.6V13a1 1 0 01-1 1h-3a1 1 0 01-1-1V9.6C4.3 8.8 3.5 7.5 3.5 6A4.5 4.5 0 018 1.5z" />
          <path d="M6.5 14h3" />
        </svg>
      )
  }
}

const ADD_MENU_ITEMS: Array<{ type: TabType; label: string }> = [
  { type: 'terminal', label: 'Terminal' },
]

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onAddTab, onTabContextMenu, onClearSession, onBranch }: TabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const closeableTabs = tabs.filter(t => t.closable)
  const ctxTab = ctxMenu ? tabs.find(t => t.id === ctxMenu.tabId) : null
  const otherCloseableTabs = ctxMenu ? closeableTabs.filter(t => t.id !== ctxMenu.tabId) : []

  return (
    <div className="h-9 bg-gray-100 border-b border-gray-200 flex items-stretch relative">
      <div className="flex items-stretch overflow-x-auto overflow-y-hidden scrollbar-none flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <button
              key={tab.id}
              onClick={() => onTabClick(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCtxMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
              }}
              className={`
                group relative flex items-center gap-1.5 px-3 text-xs font-medium border-r border-gray-200
                min-w-0 h-9 transition-colors duration-150
                ${isActive
                  ? 'bg-gray-50 text-gray-900 border-b-2 border-b-blue-500 -mb-px'
                  : 'bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }
              `}
              style={noDrag}
            >
              <TabIcon type={tab.type} />
              {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
              <span className="truncate max-w-[200px]">{tab.title}</span>
              {isActive && tab.type === 'session' && onClearSession && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirmClear) {
                      onClearSession()
                      setConfirmClear(false)
                      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
                    } else {
                      setConfirmClear(true)
                      confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 3000)
                    }
                  }}
                  onBlur={() => {
                    setConfirmClear(false)
                    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
                  }}
                  className={`ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded transition-colors ${
                    confirmClear
                      ? 'opacity-100 bg-red-600 text-white'
                      : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-500 hover:bg-amber-50'
                  }`}
                  style={noDrag}
                  title={confirmClear ? 'Click again to confirm clear' : 'Clear conversation'}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </span>
              )}
              {tab.closable && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    onTabClose(tab.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-gray-200 transition-opacity"
                  style={noDrag}
                >
                  ×
                </span>
              )}
            </button>
          )
        })}
      </div>
      {onBranch && tabs.find(t => t.id === activeTabId)?.type === 'session' && (
        <button
          onClick={onBranch}
          className="h-9 px-2.5 text-sm text-gray-500 hover:text-green-600 hover:bg-gray-200 flex items-center justify-center transition-colors"
          style={noDrag}
          title="Branch session (Ctrl+B)"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="4" cy="3" r="1.5" />
            <circle cx="4" cy="13" r="1.5" />
            <circle cx="12" cy="6" r="1.5" />
            <path d="M4 4.5v7" />
            <path d="M4 8c0-2 2-3 4-3h2.5" />
          </svg>
        </button>
      )}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          className={`h-9 px-2.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200 flex items-center justify-center transition-colors ${menuOpen ? 'bg-gray-200 text-gray-700' : ''}`}
          style={noDrag}
        >
          +
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 mt-px xi-glass rounded-md z-50 py-0.5 min-w-[140px]">
            {ADD_MENU_ITEMS.map(item => (
              <button
                key={item.type}
                onClick={() => {
                  onAddTab(item.type)
                  setMenuOpen(false)
                }}
                className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 flex items-center gap-2 transition-colors"
              >
                <TabIcon type={item.type} />
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {ctxMenu && ctxTab && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }}
          />
          <div
            className="fixed xi-glass rounded-md py-0.5 min-w-[160px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
          >
            {ctxTab.closable && (
              <button
                onClick={() => { onTabClose(ctxTab.id); setCtxMenu(null) }}
                className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors"
              >
                Close
              </button>
            )}
            {otherCloseableTabs.length > 0 && (
              <button
                onClick={() => { otherCloseableTabs.forEach(t => onTabClose(t.id)); setCtxMenu(null) }}
                className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors"
              >
                Close Others
              </button>
            )}
            {closeableTabs.length > 1 && (
              <button
                onClick={() => { closeableTabs.forEach(t => onTabClose(t.id)); setCtxMenu(null) }}
                className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors"
              >
                Close All
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

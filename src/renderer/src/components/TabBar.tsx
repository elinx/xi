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
  }
}

const ADD_MENU_ITEMS: Array<{ type: TabType; label: string }> = [
  { type: 'terminal', label: 'Terminal' },
]

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onAddTab, onTabContextMenu }: TabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
      <div className="flex items-stretch overflow-x-auto scrollbar-none flex-1 min-w-0">
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
                shrink-0 h-9 transition-colors
                ${isActive
                  ? 'bg-white text-gray-900 border-b-2 border-b-blue-500 -mb-px'
                  : 'bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }
              `}
              style={noDrag}
            >
              <TabIcon type={tab.type} />
              {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
              <span className="truncate max-w-[120px]">{tab.title}</span>
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
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          className={`h-9 px-2.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200 flex items-center justify-center transition-colors ${menuOpen ? 'bg-gray-200 text-gray-700' : ''}`}
          style={noDrag}
        >
          +
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 mt-px bg-white border border-gray-200 rounded-md shadow-lg z-50 py-0.5 min-w-[140px]">
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
            className="fixed bg-white border border-gray-200 rounded-md shadow-lg py-0.5 min-w-[160px]"
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

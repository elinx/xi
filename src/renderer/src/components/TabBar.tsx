import type { CSSProperties } from 'react'
import type { TabInfo, TabType } from '../hooks/useTabStore'

const noDrag: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

interface TabBarProps {
  tabs: TabInfo[]
  activeTabId: string
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onAddTab: () => void
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
  }
}

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onAddTab }: TabBarProps) {
  return (
    <div className="h-9 bg-gray-100 border-b border-gray-200 flex items-stretch overflow-x-auto scrollbar-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <button
            key={tab.id}
            onClick={() => onTabClick(tab.id)}
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
      <button
        onClick={onAddTab}
        className="shrink-0 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded flex items-center justify-center transition-colors"
        style={noDrag}
      >
        +
      </button>
    </div>
  )
}

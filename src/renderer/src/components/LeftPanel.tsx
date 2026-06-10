import type { ReactNode } from 'react'
import type { LeftPanelView } from '../hooks/useLayoutStore'
import SessionSidebar from './SessionSidebar'
import SkillsPanel from './SkillsPanel'
import McpPanel from './McpPanel'

interface LeftPanelProps {
  view: LeftPanelView
  onViewChange: (view: LeftPanelView) => void
  collapsed: boolean
  onToggleCollapse: () => void
  width: number
  onResizeStart: (e: React.MouseEvent) => void
  projectName: string
  projectPath: string | undefined
  onOpenDirectory: () => void
  sessions: import('../types/session').SessionListResult | null
  currentSession: import('../types/session').SessionInfo | null
  displayedSessionPath: string | null
  workerStatuses: Map<string, 'none' | 'starting' | 'connected' | 'error'>
  onSwitchSession: (sessionPath: string) => void
  onNewSession: (name: string, parentSessionPath: string) => void
  onRenameSession: (sessionPath: string, name: string) => void
  onDeleteSession: (sessionPath: string) => Promise<boolean>
  onSetSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<boolean>
  onForkFromEnd: (sessionPath: string, name: string) => void
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18v14H7l-4 4V4z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h7" />
    </svg>
  )
}

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function McpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const toggleViews: { id: LeftPanelView; title: string; icon: ReactNode }[] = [
  { id: 'sessions', title: 'Sessions', icon: <ChatIcon className="w-4 h-4" /> },
  { id: 'skills', title: 'Skills', icon: <WrenchIcon className="w-4 h-4" /> },
  { id: 'mcp', title: 'MCP', icon: <McpIcon className="w-4 h-4" /> },
]

export default function LeftPanel({
  view,
  onViewChange,
  collapsed,
  onToggleCollapse,
  width,
  onResizeStart,
  projectName,
  projectPath,
  onOpenDirectory,
  sessions,
  currentSession,
  displayedSessionPath,
  workerStatuses,
  onSwitchSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  onSetSessionStatus,
  onForkFromEnd,
}: LeftPanelProps) {
  if (collapsed) return null

  return (
    <div
      className="relative flex flex-col bg-gray-50 border-r border-gray-200 overflow-hidden"
      style={{ width: `${width}px` }}
    >
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 hover:bg-blue-500/30 transition-all z-10"
        onMouseDown={onResizeStart}
      />

      <div className="h-8 flex items-center px-2 border-b border-gray-200 gap-1">
        {toggleViews.map((v) => (
          <button
            key={v.id}
            onClick={() => onViewChange(v.id)}
            className={view === v.id ? 'bg-gray-200 text-gray-900 rounded p-1' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded p-1'}
            title={v.title}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {v.icon}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {view === 'sessions' && (
          <SessionSidebar
            sessions={sessions}
            currentSession={currentSession}
            displayedSessionPath={displayedSessionPath}
            workerStatuses={workerStatuses}
            onSwitchSession={onSwitchSession}
            onNewSession={onNewSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onSetSessionStatus={onSetSessionStatus}
            onForkFromEnd={onForkFromEnd}
            isCollapsed={false}
            onToggleCollapse={onToggleCollapse}
            width={width}
            onResizeStart={onResizeStart}
          />
        )}
        {view === 'skills' && (
          <SkillsPanel />
        )}
        {view === 'mcp' && (
          <McpPanel />
        )}
      </div>
    </div>
  )
}

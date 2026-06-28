import type { ReactNode } from 'react'
import type { LeftPanelView } from '../hooks/useLayoutStore'
import SessionSidebar from './SessionSidebar'
import SkillsPanel from './SkillsPanel'
import McpPanel from './McpPanel'
import ToolsPanel from './ToolsPanel'

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
  onReparentSession: (sessionPath: string, newParentPath: string | null) => Promise<boolean>
  onForkFromEnd: (sessionPath: string, name: string) => void
  onInvokeSkill?: (name: string) => void
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

function ToolsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
    </svg>
  )
}

const toggleViews: { id: LeftPanelView; title: string; icon: ReactNode }[] = [
  { id: 'sessions', title: 'Sessions', icon: <ChatIcon className="w-4 h-4" /> },
  { id: 'skills', title: 'Skills', icon: <WrenchIcon className="w-4 h-4" /> },
  { id: 'mcp', title: 'MCP', icon: <McpIcon className="w-4 h-4" /> },
  { id: 'tools', title: 'Tools', icon: <ToolsIcon className="w-4 h-4" /> },
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
  onReparentSession,
  onForkFromEnd,
  onInvokeSkill,
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
            className={view === v.id ? 'bg-blue-50 text-blue-600 rounded p-1 transition-colors duration-150' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded p-1 transition-colors duration-150'}
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
            onReparentSession={onReparentSession}
            onForkFromEnd={onForkFromEnd}
            isCollapsed={false}
            onToggleCollapse={onToggleCollapse}
            width={width}
            onResizeStart={onResizeStart}
          />
        )}
        {view === 'skills' && (
          <SkillsPanel onInvokeSkill={onInvokeSkill} />
        )}
        {view === 'mcp' && (
          <McpPanel />
        )}
        {view === 'tools' && (
          <ToolsPanel />
        )}
      </div>
    </div>
  )
}

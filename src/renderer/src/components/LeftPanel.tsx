import type { ReactNode } from 'react'
import type { LeftPanelView } from '../hooks/useLayoutStore'
import SessionSidebar from './SessionSidebar'
import ProviderSetup from './ProviderSetup'

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
  onOpenConfigDir: () => void
  sessions: import('../types/session').SessionListResult | null
  currentSession: import('../types/session').SessionInfo | null
  onSwitchSession: (sessionPath: string) => void
  onNewSession: (name: string, parentSessionPath: string) => void
  onRenameSession: (name: string) => void
  onDeleteSession: (sessionPath: string) => Promise<boolean>
  onSetSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<boolean>
  onForkFromEnd: (sessionPath: string, name: string) => void
  getProviderAuthStatus: () => Promise<Record<string, { configured: boolean }>>
  setApiKey: (provider: string, key: string) => Promise<{ ok: boolean; error?: string }>
  removeAuth: (provider: string) => Promise<{ ok: boolean }>
  registerCustomProvider: (name: string, apiKey: string, baseUrl: string) => Promise<{ ok: boolean; error?: string }>
  onAuthChange: () => void
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

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

const toggleViews: { id: LeftPanelView; title: string; icon: ReactNode }[] = [
  { id: 'sessions', title: 'Sessions', icon: <ChatIcon className="w-4 h-4" /> },
  { id: 'skills', title: 'Skills', icon: <WrenchIcon className="w-4 h-4" /> },
  { id: 'mcp', title: 'MCP', icon: <McpIcon className="w-4 h-4" /> },
  { id: 'settings', title: 'Settings', icon: <SettingsIcon className="w-4 h-4" /> },
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
  onOpenConfigDir,
  sessions,
  currentSession,
  onSwitchSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  onSetSessionStatus,
  onForkFromEnd,
  getProviderAuthStatus,
  setApiKey,
  removeAuth,
  registerCustomProvider,
  onAuthChange,
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
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 truncate mr-1" title={projectPath}>{projectName}</span>
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
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            Skills — coming soon
          </div>
        )}
        {view === 'mcp' && (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            MCP Servers — coming soon
          </div>
        )}
        {view === 'settings' && (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
              <button
                onClick={onOpenConfigDir}
                className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="Open config directory (~/.pi/agent/)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </button>
            </div>
            <ProviderSetup
              getProviderAuthStatus={getProviderAuthStatus}
              setApiKey={setApiKey}
              removeAuth={removeAuth}
              registerCustomProvider={registerCustomProvider}
              onAuthChange={onAuthChange}
            />
          </div>
        )}
      </div>
    </div>
  )
}

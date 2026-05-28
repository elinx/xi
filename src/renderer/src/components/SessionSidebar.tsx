import { useState, useCallback } from 'react'
import type { SessionListResult, SessionInfo, SessionTreeNode } from '../types/session'

interface SessionSidebarProps {
  sessions: SessionListResult | null
  currentSession: SessionInfo | null
  onSwitchSession: (sessionPath: string) => void
  onNewSession: (name: string) => void
  onRenameSession: (name: string) => void
  onDeleteSession: (sessionPath: string) => Promise<boolean>
  isCollapsed: boolean
  onToggleCollapse: () => void
}

function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now()
  const then = new Date(isoTimestamp).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(isoTimestamp).toLocaleDateString()
}

function getDisplayName(session: SessionInfo): string {
  if (session.name) return session.name
  const d = new Date(session.createdAt)
  const month = d.toLocaleString('en', { month: 'short' })
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${month} ${day} ${hh}:${mm}`
}

function SessionNode({
  node,
  depth,
  currentSessionPath,
  onSwitch,
  onRename,
  onDelete,
}: {
  node: SessionTreeNode
  depth: number
  currentSessionPath: string | null
  onSwitch: (path: string) => void
  onRename: (name: string) => void
  onDelete: (path: string) => Promise<boolean>
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(getDisplayName(node.session))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isActive = currentSessionPath === node.session.filePath
  const hasChildren = node.children.length > 0

  const handleDoubleClick = useCallback(() => {
    setIsRenaming(true)
    setRenameValue(getDisplayName(node.session))
  }, [node.session])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== getDisplayName(node.session)) {
      onRename(trimmed)
    }
    setIsRenaming(false)
  }, [renameValue, node.session, onRename])

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded px-2 py-1.5 cursor-pointer transition-colors ${
          isActive
            ? 'bg-gray-800 text-gray-100'
            : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSwitch(node.session.filePath)}
        onDoubleClick={handleDoubleClick}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-300"
          >
            <svg
              className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        {!hasChildren && <span className="w-4 flex-shrink-0" />}

        {node.session.isMain && (
          <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}

        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit()
              if (e.key === 'Escape') setIsRenaming(false)
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-gray-700 rounded px-1 py-0.5 text-xs text-gray-100 outline-none border border-gray-600 focus:border-blue-500"
          />
        ) : (
          <span className="flex-1 truncate text-xs">
            {getDisplayName(node.session)}
          </span>
        )}

        <span className="flex-shrink-0 text-[10px] text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
          {formatRelativeTime(node.session.createdAt)}
        </span>

        {isActive && !node.session.isMain && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (confirmDelete) {
                onDelete(node.session.filePath)
                setConfirmDelete(false)
              } else {
                setConfirmDelete(true)
              }
            }}
            onBlur={() => setConfirmDelete(false)}
            className={`flex-shrink-0 rounded px-1 py-0.5 text-[10px] transition-colors ${
              confirmDelete
                ? 'bg-red-600 text-white'
                : 'text-gray-500 hover:text-red-400 hover:bg-gray-700'
            }`}
          >
            {confirmDelete ? 'Del' : 'x'}
          </button>
        )}
      </div>

      {node.session.parentSessionPath && (
        <div
          className="flex items-center gap-1 cursor-pointer hover:text-blue-400 transition-colors"
          style={{ paddingLeft: `${depth * 16 + 24}px` }}
          onClick={() => onSwitch(node.session.parentSessionPath!)}
        >
          <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
          <span className="text-[10px] text-gray-600 hover:text-blue-400">parent</span>
        </div>
      )}

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <SessionNode
              key={child.session.filePath}
              node={child}
              depth={depth + 1}
              currentSessionPath={currentSessionPath}
              onSwitch={onSwitch}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionSidebar({
  sessions,
  currentSession,
  onSwitchSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  isCollapsed,
  onToggleCollapse,
}: SessionSidebarProps): React.ReactElement {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [isCreating, setIsCreating] = useState(false)
  const [newSessionName, setNewSessionName] = useState('')

  const toggleProject = useCallback((projectPath: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectPath)) {
        next.delete(projectPath)
      } else {
        next.add(projectPath)
      }
      return next
    })
  }, [])

  const handleCreateSession = useCallback(() => {
    const trimmed = newSessionName.trim()
    if (!trimmed) return
    onNewSession(trimmed)
    setNewSessionName('')
    setIsCreating(false)
  }, [newSessionName, onNewSession])

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center w-12 bg-gray-950 border-r border-gray-800 py-3">
        <button
          onClick={onToggleCollapse}
          className="rounded p-2 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          title="Expand sidebar"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    )
  }

  const projects = sessions?.projects ?? []

  return (
    <div className="flex flex-col w-[260px] bg-gray-950 border-r border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Sessions</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setIsCreating(true); setNewSessionName('') }}
            className="rounded p-1 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            title="New session"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onToggleCollapse}
            className="rounded p-1 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>

      {isCreating && (
        <div className="flex items-center gap-1 border-b border-gray-800 px-3 py-2">
          <input
            autoFocus
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSession()
              if (e.key === 'Escape') setIsCreating(false)
            }}
            placeholder="Session name"
            className="flex-1 min-w-0 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 outline-none focus:border-blue-500"
          />
          <button
            onClick={handleCreateSession}
            disabled={!newSessionName.trim()}
            className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2">
        {projects.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-gray-600">
            No sessions found
          </div>
        ) : (
          projects.map((project) => {
            const projectName = project.projectPath.split('/').pop() ?? project.projectPath
            const isExpanded = expandedProjects.has(project.projectPath)

            return (
              <div key={project.encodedDir} className="mb-1">
                <button
                  onClick={() => toggleProject(project.projectPath)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="truncate">{projectName}</span>
                  <span className="ml-auto text-[10px] text-gray-700">{project.allSessions.length}</span>
                </button>

                {isExpanded && project.root && (
                  <div className="mt-0.5">
                    <SessionNode
                      node={project.root}
                      depth={0}
                      currentSessionPath={currentSession?.filePath ?? null}
                      onSwitch={onSwitchSession}
                      onRename={onRenameSession}
                      onDelete={onDeleteSession}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default SessionSidebar

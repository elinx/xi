import { useState, useCallback, useEffect } from 'react'
import type { SessionListResult, SessionInfo, SessionTreeNode } from '../types/session'
import TreeGraphRow, { sessionAncestorLinesToGuides, sessionDotToGuide } from './TreeGraph'
import { getSessionDisplayName } from '../utils/session-utils'

interface SessionSidebarProps {
  sessions: SessionListResult | null
  currentSession: SessionInfo | null
  displayedSessionPath: string | null
  workerStatuses: Map<string, 'none' | 'starting' | 'connected' | 'error'>
  onSwitchSession: (sessionPath: string) => void
  onNewSession: (name: string, parentSessionPath: string) => void
  onRenameSession: (name: string) => void
  onDeleteSession: (sessionPath: string) => Promise<boolean>
  onSetSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<boolean>
  onForkFromEnd: (sessionPath: string, name: string) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  width: number
  onResizeStart: (e: React.MouseEvent) => void
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

const GRAY = '#e5e7eb'
const BLUE = '#3b82f6'

function isDescendantOf(node: SessionTreeNode, sessionPath: string | null): boolean {
  if (!sessionPath) return false
  if (node.session.filePath === sessionPath) return true
  return node.children.some((child) => isDescendantOf(child, sessionPath))
}



function SessionNode({
  node,
  ancestorLines,
  currentSessionPath,
  isOnActivePath,
  workerStatuses,
  onSwitch,
  onRename,
  onDelete,
  onSetSessionStatus,
  onForkFromEnd,
  onNewSession,
  onContextMenu,
  triggerRenamePath,
  onRenameTriggered,
  triggerForkPath,
  onForkTriggered,
}: {
  node: SessionTreeNode
  ancestorLines: { hasLine: boolean; highlight: boolean; branchActive: boolean }[]
  currentSessionPath: string | null
  isOnActivePath: boolean
  workerStatuses: Map<string, 'none' | 'starting' | 'connected' | 'error'>
  onSwitch: (path: string) => void
  onRename: (name: string) => void
  onDelete: (path: string) => Promise<boolean>
  onSetSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<boolean>
  onForkFromEnd: (sessionPath: string, name: string) => void
  onNewSession: (name: string, parentSessionPath: string) => void
  onContextMenu: (e: React.MouseEvent, session: SessionInfo) => void
  triggerRenamePath: string | null
  onRenameTriggered: () => void
  triggerForkPath: string | null
  onForkTriggered: () => void
}): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(getSessionDisplayName(node.session))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isForking, setIsForking] = useState(false)
  const [forkName, setForkName] = useState('')
  const [isCreatingChild, setIsCreatingChild] = useState(false)
  const [childName, setChildName] = useState('')
  const isCompleted = node.session.status === 'completed'
  const isActive = currentSessionPath === node.session.filePath
  const hasChildren = node.children.length > 0

  useEffect(() => {
    if (triggerRenamePath === node.session.filePath) {
      setIsRenaming(true)
      setRenameValue(getSessionDisplayName(node.session))
      onRenameTriggered()
    }
  }, [triggerRenamePath, node.session.filePath, onRenameTriggered])

  useEffect(() => {
    if (triggerForkPath === node.session.filePath) {
      setIsForking(true)
      setForkName('')
      onForkTriggered()
    }
  }, [triggerForkPath, node.session.filePath, onForkTriggered])

  const handleDoubleClick = useCallback(() => {
    setIsRenaming(true)
    setRenameValue(getSessionDisplayName(node.session))
  }, [node.session])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== getSessionDisplayName(node.session)) {
      onRename(trimmed)
    }
    setIsRenaming(false)
  }, [renameValue, node.session, onRename])

  const hasChildOnActivePath = node.children.some(
    (child) =>
      currentSessionPath === child.session.filePath ||
      isDescendantOf(child, currentSessionPath)
  )

  const guides = [...sessionAncestorLinesToGuides(ancestorLines), sessionDotToGuide({
    active: isOnActivePath || isActive || node.session.isMain,
    hasChildren,
    isExpanded,
    highlight: hasChildOnActivePath,
    completed: isCompleted,
  })]

  return (
    <div>
      <div
        className={`group flex items-center rounded cursor-pointer transition-colors ${
          isActive
            ? isCompleted
              ? 'bg-gray-100 text-gray-400'
              : 'bg-gray-100 text-gray-900'
            : isCompleted
              ? 'text-gray-400 hover:bg-gray-100/60 hover:text-gray-500'
              : 'text-gray-600 hover:bg-gray-100/60 hover:text-gray-800'
        }`}
        onClick={() => onSwitch(node.session.filePath)}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, node.session)}
      >
        <TreeGraphRow guides={guides}>
          <div className="flex-1 flex items-center gap-1 py-1.5 pr-2 min-w-0">
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
              className="flex-1 min-w-0 bg-gray-100 rounded px-1 py-0.5 text-xs text-gray-900 outline-none border border-gray-300 focus:border-blue-500"
            />
          ) : (
            <span className={`flex-1 truncate text-xs ${isCompleted ? 'line-through' : ''}`}>
              {getSessionDisplayName(node.session)}
            </span>
          )}
          {node.session.isMain ? (
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-green-500" />
          ) : workerStatuses.get(node.session.filePath) === 'connected' ? (
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-green-500" />
          ) : workerStatuses.get(node.session.filePath) === 'starting' ? (
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          ) : workerStatuses.get(node.session.filePath) === 'error' ? (
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-red-500" />
          ) : null}

          <span className="flex-shrink-0 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatRelativeTime(node.session.createdAt)}
          </span>

          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(!isExpanded)
              }}
              className="flex-shrink-0 rounded px-0.5 py-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
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

          {node.session.parentSessionPath && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onSwitch(node.session.parentSessionPath!)
              }}
              className="flex-shrink-0 rounded px-0.5 py-0.5 text-gray-400 hover:text-blue-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-colors"
              title="Go to parent session"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
          )}

          {isActive && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsForking(true)
                setForkName('')
              }}
              className="flex-shrink-0 rounded px-0.5 py-0.5 text-gray-400 hover:text-purple-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-colors"
              title="Fork"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h4m6 0h4M12 5v4m0 6v4" />
                <circle cx="5" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsCreatingChild(true)
              setChildName('')
            }}
            className="flex-shrink-0 rounded px-0.5 py-0.5 text-gray-400 hover:text-blue-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-colors"
            title="New child session"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>

          {!node.session.isMain && (
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
              className={`flex-shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-colors ${
                confirmDelete
                  ? 'bg-red-600 text-white opacity-100'
                  : 'text-gray-400 hover:text-red-500 hover:bg-gray-100'
              }`}
            >
              {confirmDelete ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          )}
          </div>
        </TreeGraphRow>
      </div>

      {isForking && (
        <div
          className="flex items-center gap-1 pl-8 pr-2 py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={forkName}
            onChange={(e) => setForkName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const trimmed = forkName.trim()
                if (trimmed) {
                  onForkFromEnd(node.session.filePath, trimmed)
                  setIsForking(false)
                  setForkName('')
                }
              }
              if (e.key === 'Escape') {
                setIsForking(false)
                setForkName('')
              }
            }}
            placeholder="Fork name"
            className="flex-1 min-w-0 rounded border border-purple-300 bg-white px-2 py-0.5 text-xs text-gray-900 outline-none focus:border-purple-500"
          />
          <button
            onClick={() => {
              const trimmed = forkName.trim()
              if (trimmed) {
                onForkFromEnd(node.session.filePath, trimmed)
                setIsForking(false)
                setForkName('')
              }
            }}
            disabled={!forkName.trim()}
            className="rounded bg-purple-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Fork
          </button>
          <button
            onClick={() => {
              setIsForking(false)
              setForkName('')
            }}
            className="rounded px-1 py-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xs transition-colors"
            title="Cancel"
          >
            ✕
          </button>
        </div>
      )}

      {isCreatingChild && (
        <div
          className="flex items-center gap-1 pl-8 pr-2 py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const trimmed = childName.trim()
                if (trimmed) {
                  onNewSession(trimmed, node.session.filePath)
                  setIsCreatingChild(false)
                  setChildName('')
                }
              }
              if (e.key === 'Escape') {
                setIsCreatingChild(false)
                setChildName('')
              }
            }}
            placeholder="Child session name"
            className="flex-1 min-w-0 rounded border border-blue-300 bg-white px-2 py-0.5 text-xs text-gray-900 outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              const trimmed = childName.trim()
              if (trimmed) {
                onNewSession(trimmed, node.session.filePath)
                setIsCreatingChild(false)
                setChildName('')
              }
            }}
            disabled={!childName.trim()}
            className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create
          </button>
          <button
            onClick={() => {
              setIsCreatingChild(false)
              setChildName('')
            }}
            className="rounded px-1 py-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xs transition-colors"
            title="Cancel"
          >
            ✕
          </button>
        </div>
      )}

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child, i) => {
            const childIsActivePath =
              currentSessionPath === child.session.filePath ||
              isDescendantOf(child, currentSessionPath)
            const laterSiblingOnActivePath = node.children
              .slice(i + 1)
              .some(
                (sibling) =>
                  currentSessionPath === sibling.session.filePath ||
                  isDescendantOf(sibling, currentSessionPath)
              )
            const onPath = childIsActivePath || laterSiblingOnActivePath
            const newAncestorLines = [
              ...ancestorLines.map((entry) => ({
                hasLine: entry.hasLine,
                highlight: entry.branchActive
                  ? (entry.highlight && childIsActivePath)
                  : entry.highlight,
                branchActive: entry.branchActive && childIsActivePath,
              })),
              {
                hasLine: i < node.children.length - 1,
                highlight: onPath,
                branchActive: childIsActivePath,
              },
            ]
            return (
              <SessionNode
                key={child.session.filePath}
                node={child}
                ancestorLines={newAncestorLines}
                currentSessionPath={currentSessionPath}
                isOnActivePath={childIsActivePath}
                workerStatuses={workerStatuses}
                onSwitch={onSwitch}
                onRename={onRename}
                onDelete={onDelete}
                onSetSessionStatus={onSetSessionStatus}
                onForkFromEnd={onForkFromEnd}
                onNewSession={onNewSession}
                onContextMenu={onContextMenu}
                triggerRenamePath={triggerRenamePath}
                onRenameTriggered={onRenameTriggered}
                triggerForkPath={triggerForkPath}
                onForkTriggered={onForkTriggered}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function SessionSidebar({
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
  isCollapsed,
  onToggleCollapse,
  width,
  onResizeStart,
}: SessionSidebarProps): React.ReactElement {
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    session: SessionInfo
  } | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [triggerRenamePath, setTriggerRenamePath] = useState<string | null>(null)
  const [triggerForkPath, setTriggerForkPath] = useState<string | null>(null)

  const projects = sessions?.projects ?? []
  const root = projects[0]?.root ?? null

  const handleContextMenu = useCallback((e: React.MouseEvent, session: SessionInfo) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, session })
    setContextMenuPos(null) // will be adjusted in useEffect
  }, [])

  const handleRenameTriggered = useCallback(() => {
    setTriggerRenamePath(null)
  }, [])

  const handleForkTriggered = useCallback(() => {
    setTriggerForkPath(null)
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    const handleClick = () => setContextMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  // Adjust context menu position to keep it within viewport
  useEffect(() => {
    if (!contextMenu) return
    const el = document.querySelector('[data-context-menu]') as HTMLDivElement | null
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = contextMenu.x
    let y = contextMenu.y
    if (x + rect.width > vw) x = vw - rect.width - 4
    if (y + rect.height > vh) y = vh - rect.height - 4
    if (x < 0) x = 4
    if (y < 0) y = 4
    setContextMenuPos({ x, y })
  }, [contextMenu])

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center w-12 bg-gray-50 border-r border-gray-200 pb-3" />
    )
  }

  return (
    <div
      className="relative flex flex-col bg-gray-50 overflow-hidden"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 overflow-y-auto py-2">
        {projects.length === 0 || !root ? (
          <div className="px-3 py-6 text-center text-xs text-gray-600">
            No sessions found
          </div>
        ) : (
          <SessionNode
            node={root}
            ancestorLines={[]}
            currentSessionPath={displayedSessionPath ?? currentSession?.filePath ?? null}
            isOnActivePath={true}
            workerStatuses={workerStatuses}
            onSwitch={onSwitchSession}
            onRename={onRenameSession}
            onDelete={onDeleteSession}
            onSetSessionStatus={onSetSessionStatus}
            onForkFromEnd={onForkFromEnd}
            onNewSession={onNewSession}
            onContextMenu={handleContextMenu}
            triggerRenamePath={triggerRenamePath}
            onRenameTriggered={handleRenameTriggered}
            triggerForkPath={triggerForkPath}
            onForkTriggered={handleForkTriggered}
          />
        )}
      </div>

      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 hover:bg-blue-500/30 transition-all z-10"
        onMouseDown={onResizeStart}
      />

      {contextMenu && (
        <div
          data-context-menu
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-xs min-w-[140px]"
          style={{ left: contextMenuPos?.x ?? contextMenu.x, top: contextMenuPos?.y ?? contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="px-3 py-1.5 hover:bg-gray-100 cursor-pointer"
            onClick={() => {
              setTriggerRenamePath(contextMenu.session.filePath)
              setContextMenu(null)
            }}
          >
            Rename
          </div>
          <div
            className="px-3 py-1.5 hover:bg-gray-100 cursor-pointer"
            onClick={() => {
              const newStatus = contextMenu.session.status === 'completed' ? 'active' : 'completed'
              onSetSessionStatus(contextMenu.session.filePath, newStatus)
              setContextMenu(null)
            }}
          >
            {contextMenu.session.status === 'completed' ? 'Mark as active' : 'Mark as completed'}
          </div>
          {contextMenu.session.parentSessionPath && (
            <div
              className="px-3 py-1.5 hover:bg-gray-100 cursor-pointer"
              onClick={() => {
                onSwitchSession(contextMenu.session.parentSessionPath!)
                setContextMenu(null)
              }}
            >
              Go to parent
            </div>
          )}
          {contextMenu.session.filePath === currentSession?.filePath && (
            <div
              className="px-3 py-1.5 hover:bg-purple-50 cursor-pointer text-purple-600"
              onClick={() => {
                setTriggerForkPath(contextMenu.session.filePath)
                setContextMenu(null)
              }}
            >
              Fork
            </div>
          )}
          {!contextMenu.session.isMain && (
            <div
              className="px-3 py-1.5 hover:bg-red-50 cursor-pointer text-red-600"
              onClick={() => {
                onDeleteSession(contextMenu.session.filePath)
                setContextMenu(null)
              }}
            >
              Delete
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SessionSidebar

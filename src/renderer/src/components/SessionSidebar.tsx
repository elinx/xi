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
  onRenameSession: (sessionPath: string, name: string) => void
  onDeleteSession: (sessionPath: string) => Promise<boolean>
  onSetSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<boolean>
  onReparentSession: (sessionPath: string, newParentPath: string | null) => Promise<boolean>
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
  onReparentSession,
  onForkFromEnd,
  onNewSession,
  onContextMenu,
  triggerRenamePath,
  onRenameTriggered,
  triggerForkPath,
  onForkTriggered,
  moveUnderTarget,
  onMoveUnderTargetChange,
  onMoveUnderConfirm,
  onMoveUnderCancel,
}: {
  node: SessionTreeNode
  ancestorLines: { hasLine: boolean; highlight: boolean; branchActive: boolean }[]
  currentSessionPath: string | null
  isOnActivePath: boolean
  workerStatuses: Map<string, 'none' | 'starting' | 'connected' | 'error'>
  onSwitch: (path: string) => void
  onRename: (sessionPath: string, name: string) => void
  onDelete: (path: string) => Promise<boolean>
  onSetSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<boolean>
  onReparentSession: (sessionPath: string, newParentPath: string | null) => Promise<boolean>
  onForkFromEnd: (sessionPath: string, name: string) => void
  onNewSession: (name: string, parentSessionPath: string) => void
  onContextMenu: (e: React.MouseEvent, session: SessionInfo) => void
  triggerRenamePath: string | null
  onRenameTriggered: () => void
  triggerForkPath: string | null
  onForkTriggered: () => void
  moveUnderTarget: string | null  // session path being moved in 'move under' mode
  onMoveUnderTargetChange: (path: string | null) => void
  onMoveUnderConfirm: (sessionPath: string, newParentPath: string) => void
  onMoveUnderCancel: () => void
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
      onRename(node.session.filePath, trimmed)
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

  const isMoveUnderMode = moveUnderTarget !== null
  const isMoveUnderDropTarget = isMoveUnderMode && moveUnderTarget !== node.session.filePath

  return (
    <div>
      <div
        className={`group flex items-center rounded cursor-pointer transition-colors ${
          isMoveUnderMode && isMoveUnderDropTarget
            ? 'hover:bg-blue-100 hover:text-blue-900 ring-1 ring-blue-300 hover:ring-blue-500'
            : isActive
              ? isCompleted
                ? 'bg-gray-100 text-gray-400'
                : 'bg-gray-100 text-gray-900'
              : isCompleted
                ? 'text-gray-400 hover:bg-gray-100/60 hover:text-gray-500'
                : 'text-gray-600 hover:bg-gray-100/60 hover:text-gray-800'
        }`}
        onClick={() => {
          if (isMoveUnderMode && isMoveUnderDropTarget) {
            console.log('[MoveUnder] confirm:', moveUnderTarget, '->', node.session.filePath)
            onMoveUnderConfirm(moveUnderTarget!, node.session.filePath)
          } else {
            onSwitch(node.session.filePath)
          }
        }}
        onDoubleClick={isMoveUnderMode ? undefined : handleDoubleClick}
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
                onReparentSession={onReparentSession}
                onForkFromEnd={onForkFromEnd}
                onNewSession={onNewSession}
                onContextMenu={onContextMenu}
                triggerRenamePath={triggerRenamePath}
                onRenameTriggered={onRenameTriggered}
                triggerForkPath={triggerForkPath}
                onForkTriggered={onForkTriggered}
                moveUnderTarget={moveUnderTarget}
                onMoveUnderTargetChange={onMoveUnderTargetChange}
                onMoveUnderConfirm={onMoveUnderConfirm}
                onMoveUnderCancel={onMoveUnderCancel}
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
  onReparentSession,
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
  const [moveUnderTarget, setMoveUnderTarget] = useState<string | null>(null)

  const handleMoveUnderConfirm = useCallback(async (sessionPath: string, newParentPath: string) => {
    console.log('[MoveUnder] handleMoveUnderConfirm:', sessionPath, '->', newParentPath)
    const ok = await onReparentSession(sessionPath, newParentPath)
    console.log('[MoveUnder] result:', ok)
    setMoveUnderTarget(null)
    if (!ok) {
      // TODO: show error toast
    }
  }, [onReparentSession])

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
      {moveUnderTarget && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-800">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
          <span className="flex-1 truncate">Click a session to move under it</span>
          <button
            onClick={() => setMoveUnderTarget(null)}
            className="flex-shrink-0 rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-100 font-medium"
          >
            Cancel
          </button>
        </div>
      )}
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
            onReparentSession={onReparentSession}
            onForkFromEnd={onForkFromEnd}
            onNewSession={onNewSession}
            onContextMenu={handleContextMenu}
            triggerRenamePath={triggerRenamePath}
            onRenameTriggered={handleRenameTriggered}
            triggerForkPath={triggerForkPath}
            onForkTriggered={handleForkTriggered}
            moveUnderTarget={moveUnderTarget}
            onMoveUnderTargetChange={setMoveUnderTarget}
            onMoveUnderConfirm={handleMoveUnderConfirm}
            onMoveUnderCancel={() => setMoveUnderTarget(null)}
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
          className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-0.5 min-w-[180px]"
          style={{ left: contextMenuPos?.x ?? contextMenu.x, top: contextMenuPos?.y ?? contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2"
            onClick={() => {
              setTriggerRenamePath(contextMenu.session.filePath)
              setContextMenu(null)
            }}
          >
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Rename
          </button>
          <button
            className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2"
            onClick={() => {
              const newStatus = contextMenu.session.status === 'completed' ? 'active' : 'completed'
              onSetSessionStatus(contextMenu.session.filePath, newStatus)
              setContextMenu(null)
            }}
          >
            {contextMenu.session.status === 'completed' ? (
              <>
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Mark as Active
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Mark as Completed
              </>
            )}
          </button>
          {contextMenu.session.parentSessionPath && (
            <button
              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2"
              onClick={() => {
                onSwitchSession(contextMenu.session.parentSessionPath!)
                setContextMenu(null)
              }}
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
              Go to Parent
            </button>
          )}
          {!contextMenu.session.isMain && (
            <button
              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2"
              onClick={() => {
                console.log('[MoveUnder] starting move-under for:', contextMenu.session.filePath)
                setMoveUnderTarget(contextMenu.session.filePath)
                setContextMenu(null)
              }}
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
              Move under...
            </button>
          )}
          {!contextMenu.session.isMain && contextMenu.session.parentSessionPath && (
            <button
              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2"
              onClick={async () => {
                await onReparentSession(contextMenu.session.filePath, null)
                setContextMenu(null)
              }}
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15m0 0l6.75 6.75M4.5 12l6.75-6.75" />
              </svg>
              Detach from parent
            </button>
          )}
          {(contextMenu.session.filePath === currentSession?.filePath || !contextMenu.session.isMain) && (
            <div className="border-t border-gray-100 my-0.5" />
          )}
          {contextMenu.session.filePath === currentSession?.filePath && (
            <button
              className="w-full px-3 py-1.5 text-xs text-purple-600 hover:bg-purple-50 text-left transition-colors flex items-center gap-2"
              onClick={() => {
                setTriggerForkPath(contextMenu.session.filePath)
                setContextMenu(null)
              }}
            >
              <svg className="w-3.5 h-3.5 text-purple-400" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 000 1.5zm-3 8.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" />
              </svg>
              Fork
            </button>
          )}
          {!contextMenu.session.isMain && (
            <button
              className="w-full px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 text-left transition-colors flex items-center gap-2"
              onClick={() => {
                onDeleteSession(contextMenu.session.filePath)
                setContextMenu(null)
              }}
            >
              <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default SessionSidebar

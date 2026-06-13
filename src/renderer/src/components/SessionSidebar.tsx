import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { SessionListResult, SessionInfo, SessionTreeNode } from '../types/session'
import TreeGraphRow, { sessionAncestorLinesToGuides, sessionDotToGuide } from './TreeGraph'
import { getSessionDisplayName } from '../utils/session-utils'
import { useLayoutStore } from '../hooks/useLayoutStore'

/** Collect all ancestor paths from root to the given target session path (exclusive of target, inclusive of root). */
function getAncestorPaths(root: SessionTreeNode | null, targetPath: string): string[] {
  if (!root) return []
  const result: string[] = []
  function walk(node: SessionTreeNode, path: string[]): boolean {
    const currentPath = [...path, node.session.filePath]
    if (node.session.filePath === targetPath) {
      result.push(...currentPath)
      return true
    }
    for (const child of node.children) {
      if (walk(child, currentPath)) return true
    }
    return false
  }
  walk(root, [])
  return result
}

/** Get ancestor chain from root to target (inclusive of root, exclusive of target), ordered root → direct parent. */
function getAncestorChain(
  root: SessionTreeNode | null,
  targetPath: string
): SessionInfo[] {
  if (!root) return []
  const result: SessionInfo[] = []
  function walk(node: SessionTreeNode): boolean {
    if (node.session.filePath === targetPath) return true
    for (const child of node.children) {
      if (walk(child)) {
        result.push(node.session)
        return true
      }
    }
    return false
  }
  walk(root)
  return result.reverse()
}

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

/** Count total number of descendants (recursive) of a tree node. */
function countDescendants(node: SessionTreeNode): number {
  let count = 0
  for (const child of node.children) {
    count += 1 + countDescendants(child)
  }
  return count
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

/** Find a tree node by session file path. */
function findNodeInTree(root: SessionTreeNode | null, path: string): SessionTreeNode | null {
  if (!root) return null
  if (root.session.filePath === path) return root
  for (const child of root.children) {
    const found = findNodeInTree(child, path)
    if (found) return found
  }
  return null
}

/** Collect all descendant file paths of a tree node (not including the node itself). */
function computeDescendantPaths(node: SessionTreeNode): Set<string> {
  const paths = new Set<string>()
  const walk = (n: SessionTreeNode) => {
    for (const child of n.children) {
      paths.add(child.session.filePath)
      walk(child)
    }
  }
  walk(node)
  return paths
}

/** Drop position within a target row. */
type DropPosition = 'before' | 'child' | 'after'

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
  // Collapse persistence
  collapsedPaths,
  onToggleCollapsed,
  // Drag props
  dragSourcePath,
  dropTargetInfo,
  dragDescendantPaths,
  onDragSessionStart,
  onDragSessionEnd,
  onDropTargetChange,
  onDropOnSession,
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
  moveUnderTarget: string | null
  onMoveUnderTargetChange: (path: string | null) => void
  onMoveUnderConfirm: (sessionPath: string, newParentPath: string) => void
  onMoveUnderCancel: () => void
  // Collapse persistence
  collapsedPaths: Set<string>
  onToggleCollapsed: (sessionPath: string) => void
  // Drag props
  dragSourcePath: string | null
  dropTargetInfo: { path: string; position: DropPosition } | null
  dragDescendantPaths: Set<string>
  onDragSessionStart: (path: string) => void
  onDragSessionEnd: () => void
  onDropTargetChange: (info: { path: string; position: DropPosition } | null) => void
  onDropOnSession: (sourcePath: string, targetPath: string, position: DropPosition) => void
}): React.ReactElement {
  const isExpanded = !collapsedPaths.has(node.session.filePath)
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
  const hiddenCount = hasChildren && !isExpanded ? countDescendants(node) : 0

  // Auto-expand timer for drag hover
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (autoExpandTimerRef.current) clearTimeout(autoExpandTimerRef.current)
    }
  }, [])

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

  // Drag state
  const canDrag = !node.session.isMain && !isRenaming && !isMoveUnderMode && !isForking && !isCreatingChild
  const isDragging = dragSourcePath === node.session.filePath
  const isCurrentDropTarget = dropTargetInfo?.path === node.session.filePath
  const isInvalidDropTarget = dragSourcePath !== null &&
    dragSourcePath !== node.session.filePath &&
    dragDescendantPaths.has(node.session.filePath)

  // Compute drop position from cursor Y relative to row
  const computeDropPosition = useCallback((clientY: number, rect: DOMRect): DropPosition | null => {
    const y = clientY - rect.top
    const h = rect.height
    if (y < h / 3) return 'before'
    if (y > h * 2 / 3) return 'after'
    return 'child'
  }, [])

  // Is this a valid drop? (not self, not descendant, not dropping before/after main)
  const isValidDrop = useCallback((position: DropPosition): boolean => {
    if (!dragSourcePath) return false
    if (dragSourcePath === node.session.filePath) return false
    if (isInvalidDropTarget) return false
    // Can't insert as sibling of main (main has no parent)
    if (node.session.isMain && position !== 'child') return false
    return true
  }, [dragSourcePath, node.session.filePath, node.session.isMain, isInvalidDropTarget])

  // Clear auto-expand timer helper
  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current)
      autoExpandTimerRef.current = null
    }
  }, [])

  const dropPosition = isCurrentDropTarget ? dropTargetInfo.position : null

  return (
    <div className="relative">
      {/* Drop indicator line - before */}
      {dropPosition === 'before' && (
        <div className="absolute top-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full z-10" style={{ marginTop: '-1px' }} />
      )}

      <div
        data-session-row={node.session.filePath}
        draggable={canDrag}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.session.filePath)
          onDragSessionStart(node.session.filePath)
        }}
        onDragOver={(e) => {
          e.stopPropagation()
          const pos = computeDropPosition(e.clientY, e.currentTarget.getBoundingClientRect())
          if (!pos || !isValidDrop(pos)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          // Only update if changed
          if (dropTargetInfo?.path !== node.session.filePath || dropTargetInfo?.position !== pos) {
            onDropTargetChange({ path: node.session.filePath, position: pos })
          }
          // Auto-expand collapsed nodes after 500ms hover
          if (!isExpanded && hasChildren && autoExpandTimerRef.current === null) {
            autoExpandTimerRef.current = setTimeout(() => {
              onToggleCollapsed(node.session.filePath) // expand by removing from collapsed set
              autoExpandTimerRef.current = null
            }, 500)
          }
        }}
        onDragLeave={(e) => {
          const relatedTarget = e.relatedTarget as Node | null
          if (relatedTarget && e.currentTarget.contains(relatedTarget)) return
          if (isCurrentDropTarget) {
            onDropTargetChange(null)
          }
          clearAutoExpandTimer()
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          clearAutoExpandTimer()
          if (dragSourcePath && isCurrentDropTarget && dropTargetInfo) {
            onDropOnSession(dragSourcePath, dropTargetInfo.path, dropTargetInfo.position)
          }
        }}
        onDragEnd={() => {
          onDragSessionEnd()
          clearAutoExpandTimer()
        }}
        className={`group flex items-center rounded cursor-pointer transition-colors ${
          isDragging
            ? 'opacity-40'
            : isCurrentDropTarget && dropPosition === 'child'
              ? 'bg-blue-50 ring-2 ring-blue-400 text-blue-900'
              : isCurrentDropTarget && (dropPosition === 'before' || dropPosition === 'after')
                ? isActive
                  ? 'bg-blue-50/60 text-blue-900'
                  : 'bg-blue-50/60 text-blue-900'
                : isMoveUnderMode && isMoveUnderDropTarget
                  ? 'hover:bg-blue-100 hover:text-blue-900 ring-1 ring-blue-300 hover:ring-blue-500'
                  : isActive
                    ? isCompleted
                      ? 'bg-blue-50/40 text-gray-500'
                      : 'bg-blue-50/80 text-blue-900'
                    : isCompleted
                      ? 'text-gray-400 hover:bg-blue-100/80 hover:text-gray-500'
                      : hiddenCount > 0
                        ? 'bg-gray-50/80 text-gray-700 hover:bg-blue-100/80 hover:text-gray-800'
                        : 'text-gray-600 hover:bg-blue-100/80 hover:text-gray-800'
        }`}
        onClick={() => {
          if (isMoveUnderMode && isMoveUnderDropTarget) {
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
          {/* Drag handle grip icon — w-0 when idle, expands on hover */}
          {canDrag && (
            <span className="flex-shrink-0 w-0 overflow-hidden group-hover:w-3.5 transition-[width] duration-150">
              <span className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-gray-400 hover:text-gray-600 transition-opacity cursor-grab active:cursor-grabbing flex items-center">
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="5" cy="3" r="1.5" />
                  <circle cx="11" cy="3" r="1.5" />
                  <circle cx="5" cy="8" r="1.5" />
                  <circle cx="11" cy="8" r="1.5" />
                  <circle cx="5" cy="13" r="1.5" />
                  <circle cx="11" cy="13" r="1.5" />
                </svg>
              </span>
            </span>
          )}
          {/* Name + collapse indicator (always together, name shrinks) */}
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
            <span className={`shrink truncate text-xs ${isCompleted ? 'line-through' : ''}`}>
              {getSessionDisplayName(node.session)}
            </span>
          )}
          {/* Status dot — right after name */}
          {node.session.isMain ? (
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-green-500" />
          ) : workerStatuses.get(node.session.filePath) === 'connected' ? (
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-green-500" />
          ) : workerStatuses.get(node.session.filePath) === 'starting' ? (
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          ) : workerStatuses.get(node.session.filePath) === 'error' ? (
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-red-500" />
          ) : null}

          {/* Collapse/expand arrow — always visible when collapsed, hover-only when expanded */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleCollapsed(node.session.filePath)
              }}
              className={`flex-shrink-0 rounded px-0.5 py-0.5 transition-colors ${
                isExpanded
                  ? 'text-gray-300 hover:text-gray-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title={isExpanded ? 'Collapse' : `Expand (${hiddenCount} hidden)`}
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
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
          {/* Hidden count badge — only when collapsed with children */}
          {hasChildren && !isExpanded && (
            <span
              className="flex-shrink-0 min-w-[1.25rem] h-[1.25rem] flex items-center justify-center rounded-full bg-gray-200/80 text-gray-500 text-[9px] font-semibold leading-none px-1"
              title={`${hiddenCount} sub-session${hiddenCount > 1 ? 's' : ''} hidden`}
            >
              {hiddenCount}
            </span>
          )}

          {/* Spacer to push right-side items to the end */}
          <span className="flex-1 min-w-1" />

          <span className="flex-shrink-0 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatRelativeTime(node.session.createdAt)}
          </span>

          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsForking(true)
              setForkName('')
            }}
            className="flex-shrink-0 rounded px-0.5 py-0.5 text-gray-400 hover:text-purple-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-colors"
            title="Fork"
          >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 001.5 0zm-3 8.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" />
              </svg>
          </button>

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

      {/* Drop indicator line - after */}
      {dropPosition === 'after' && (
        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full z-10" style={{ marginBottom: '-1px' }} />
      )}

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
                collapsedPaths={collapsedPaths}
                onToggleCollapsed={onToggleCollapsed}
                dragSourcePath={dragSourcePath}
                dropTargetInfo={dropTargetInfo}
                dragDescendantPaths={dragDescendantPaths}
                onDragSessionStart={onDragSessionStart}
                onDragSessionEnd={onDragSessionEnd}
                onDropTargetChange={onDropTargetChange}
                onDropOnSession={onDropOnSession}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function FloatingParentStack({
  ancestors,
  onSwitch,
}: {
  ancestors: { session: SessionInfo; originalIndex: number }[]
  onSwitch: (path: string) => void
}) {
  if (ancestors.length === 0) return null

  const ROW_H = 26

  return (
    <div className="absolute left-0 right-0 top-0 z-10 flex flex-col shadow-sm">
      {ancestors.map((entry, i) => {
        const isDirectParent = i === ancestors.length - 1
        return (
          <div
            key={entry.session.filePath}
            className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-colors ${
              isDirectParent
                ? 'bg-white border-b border-gray-200/80 text-gray-700 font-medium hover:bg-gray-50'
                : 'bg-white/95 border-b border-gray-100 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
            style={{ height: ROW_H, paddingLeft: 8 + entry.originalIndex * 16, paddingRight: 8 }}
            onClick={() => onSwitch(entry.session.filePath)}
            title={getSessionDisplayName(entry.session)}
          >
            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-gray-300" />
            <span className="truncate">
              {entry.session.isMain ? 'main' : getSessionDisplayName(entry.session)}
            </span>
          </div>
        )
      })}
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

  const projects = sessions?.projects ?? []
  const root = projects[0]?.root ?? null

  // Collapsed state from layout store (shared with App.tsx toolbar)
  const sessionCollapsedPathsArr = useLayoutStore(s => s.sessionCollapsedPaths)
  const toggleSessionCollapsed = useLayoutStore(s => s.toggleSessionCollapsed)
  const expandSessionPaths = useLayoutStore(s => s.expandSessionPaths)
  const sessionScrollTrigger = useLayoutStore(s => s.sessionScrollTrigger)
  const collapsedPaths = new Set(sessionCollapsedPathsArr)
  const handleToggleCollapsed = toggleSessionCollapsed

  // Auto-scroll to active session: expand ancestors + scroll into view
  const activeSessionPath = displayedSessionPath ?? currentSession?.filePath ?? null

  // Floating parent stack: compute ancestor chain for active session
  const ancestorChain = useMemo(() => {
    if (!activeSessionPath || !root) return []
    return getAncestorChain(root, activeSessionPath)
  }, [activeSessionPath, root])

  // Track which ancestor nodes are scrolled out of the scroll viewport (per-ancestor)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [hiddenAncestorPaths, setHiddenAncestorPaths] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (ancestorChain.length === 0 || !scrollRef.current) {
      setHiddenAncestorPaths(new Set())
      return
    }
    const container = scrollRef.current
    const ancestorPaths = ancestorChain.map(a => a.filePath)

    const check = () => {
      const containerRect = container.getBoundingClientRect()
      const hidden = new Set<string>()
      for (const p of ancestorPaths) {
        const el = container.querySelector(`[data-session-row="${CSS.escape(p)}"]`) as HTMLElement | null
        if (!el) {
          hidden.add(p)
          continue
        }
        const elRect = el.getBoundingClientRect()
        // Only float ancestors that scrolled ABOVE the viewport (elRect.bottom < containerRect.top)
        // Ancestors below the viewport (scrolled up past them) should NOT float
        if (elRect.bottom < containerRect.top) {
          hidden.add(p)
        }
      }
      setHiddenAncestorPaths(hidden)
    }

    // Initial check after DOM is ready
    const frameId = requestAnimationFrame(check)
    container.addEventListener('scroll', check, { passive: true })
    return () => {
      cancelAnimationFrame(frameId)
      container.removeEventListener('scroll', check)
    }
  }, [ancestorChain])

  useEffect(() => {
    if (!activeSessionPath || !root) return

    // Expand ancestors of the active session so it's visible in the DOM
    const ancestors = getAncestorPaths(root, activeSessionPath)
    const needsExpand = ancestors.filter(p => collapsedPaths.has(p))
    if (needsExpand.length > 0) {
      expandSessionPaths(needsExpand)
    }

    // Scroll after a frame to allow React to re-render expanded nodes
    const frameId = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-session-row="${CSS.escape(activeSessionPath)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    })

    return () => cancelAnimationFrame(frameId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionPath, root, sessionScrollTrigger])

  // Drag state
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null)
  const [dropTargetInfo, setDropTargetInfo] = useState<{ path: string; position: DropPosition } | null>(null)
  const [dragDescendantPaths, setDragDescendantPaths] = useState<Set<string>>(new Set())

  // Build session map for looking up parent paths
  const sessionMap = useCallback(() => {
    const map = new Map<string, SessionInfo>()
    if (sessions?.projects) {
      for (const p of sessions.projects) {
        for (const s of p.allSessions) {
          map.set(s.filePath, s)
        }
      }
    }
    return map
  }, [sessions])

  const handleMoveUnderConfirm = useCallback(async (sessionPath: string, newParentPath: string) => {
    const ok = await onReparentSession(sessionPath, newParentPath)
    setMoveUnderTarget(null)
    if (!ok) {
      // TODO: show error toast
    }
  }, [onReparentSession])

  // Drag callbacks
  const handleDragSessionStart = useCallback((path: string) => {
    setDragSourcePath(path)
    setDropTargetInfo(null)
    if (root) {
      const sourceNode = findNodeInTree(root, path)
      if (sourceNode) {
        setDragDescendantPaths(computeDescendantPaths(sourceNode))
      }
    }
  }, [root])

  const handleDragSessionEnd = useCallback(() => {
    setDragSourcePath(null)
    setDropTargetInfo(null)
    setDragDescendantPaths(new Set())
  }, [])

  const handleDropTargetChange = useCallback((info: { path: string; position: DropPosition } | null) => {
    setDropTargetInfo(info)
  }, [])

  const handleDropOnSession = useCallback(async (sourcePath: string, targetPath: string, position: DropPosition) => {
    let newParentPath: string | null
    if (position === 'child') {
      newParentPath = targetPath
    } else {
      // 'before' or 'after': become sibling of target (same parent as target)
      const sMap = sessionMap()
      const targetSession = sMap.get(targetPath)
      newParentPath = targetSession?.parentSessionPath ?? null
    }

    // Skip if no change
    const sMap = sessionMap()
    const sourceSession = sMap.get(sourcePath)
    if (sourceSession && sourceSession.parentSessionPath === newParentPath && position === 'child') {
      // Already a child of the target, no-op
      handleDragSessionEnd()
      return
    }

    await onReparentSession(sourcePath, newParentPath)
    handleDragSessionEnd()
  }, [onReparentSession, sessionMap, handleDragSessionEnd])

  const handleDropOnBackground = useCallback(async () => {
    if (dragSourcePath) {
      await onReparentSession(dragSourcePath, null)
      handleDragSessionEnd()
    }
  }, [dragSourcePath, onReparentSession, handleDragSessionEnd])

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
      className="relative flex flex-col bg-gray-50 overflow-hidden h-full"
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
      {/* Scroll area wrapper — provides positioning context for floating overlay */}
      <div className="relative flex-1 min-h-0">
        {/* Floating parent stack — only show ancestors that are scrolled out */}
        {!moveUnderTarget && (() => {
          const hiddenEntries = ancestorChain
            .map((session, originalIndex) => ({ session, originalIndex }))
            .filter(entry => hiddenAncestorPaths.has(entry.session.filePath))
          return hiddenEntries.length > 0 ? (
            <FloatingParentStack ancestors={hiddenEntries} onSwitch={onSwitchSession} />
          ) : null
        })()}
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto py-2"
          onDragOver={(e) => {
            // Allow drop on background (empty area)
            if (dragSourcePath) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            // Only handle background drops (session nodes stopPropagation)
            handleDropOnBackground()
          }}
        >
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
            collapsedPaths={collapsedPaths}
            onToggleCollapsed={handleToggleCollapsed}
            dragSourcePath={dragSourcePath}
            dropTargetInfo={dropTargetInfo}
            dragDescendantPaths={dragDescendantPaths}
            onDragSessionStart={handleDragSessionStart}
            onDragSessionEnd={handleDragSessionEnd}
            onDropTargetChange={handleDropTargetChange}
            onDropOnSession={handleDropOnSession}
          />
        )}
      </div>
      </div>{/* end scroll area wrapper */}

      {/* Background drop hint when dragging */}
      {dragSourcePath && (
        <div className="px-3 py-1.5 text-[10px] text-gray-400 text-center border-t border-dashed border-gray-200 flex-shrink-0">
          Drop on empty area to detach from parent
        </div>
      )}

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

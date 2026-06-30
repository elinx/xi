import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { FileSystemIpcApi } from '../types/session'

interface FileTreeProps {
  onFileSelect: (filePath: string) => void
}

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
}

const HIDDEN = new Set(['node_modules', '.git', 'out', 'dist', '.pi', '.DS_Store'])

const persistedExpandedDirs = new Set<string>()

type ReadDirectoryApi = typeof window.api & FileSystemIpcApi

function isHidden(name: string): boolean {
  return HIDDEN.has(name) || name.startsWith('.')
}

function sortEntries(entries: TreeNode[]): TreeNode[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function FolderOpenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
    </svg>
  )
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

function ChevronIcon({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''} ${className ?? ''}`}
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  )
}

interface CtxMenuState {
  node: TreeNode
  x: number
  y: number
}

function TreeNodeRow({
  node,
  depth,
  expandedDirs,
  onToggleDir,
  onFileClick,
  onContextMenu,
}: {
  node: TreeNode
  depth: number
  expandedDirs: Set<string>
  onToggleDir: (path: string) => void
  onFileClick: (path: string) => void
  onContextMenu: (node: TreeNode, x: number, y: number) => void
}) {
  const isExpanded = expandedDirs.has(node.path)

  const handleClick = useCallback(() => {
    if (node.isDirectory) {
      onToggleDir(node.path)
    } else {
      onFileClick(node.path)
    }
  }, [node, onToggleDir, onFileClick])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(node, e.clientX, e.clientY)
  }, [node, onContextMenu])

  return (
    <div>
      <div
        className="hover:bg-gray-100 cursor-pointer flex items-center gap-1 text-xs text-gray-700 py-0.5 pr-2"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {node.isDirectory ? (
          <>
            <ChevronIcon expanded={isExpanded} className="flex-shrink-0 text-gray-400" />
            <FolderOpenIcon className="w-4 h-4 flex-shrink-0 text-gray-500" />
          </>
        ) : (
          <>
            <span className="w-3 flex-shrink-0" />
            <FileIcon className="w-4 h-4 flex-shrink-0 text-gray-400" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FileTree({ onFileSelect }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(persistedExpandedDirs))
  const [loading, setLoading] = useState(true)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const [ctxMenuPos, setCtxMenuPos] = useState<{ x: number; y: number } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const refreshVersion = useRef(0)

  const loadDirectory = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const api = window.api as ReadDirectoryApi
    if (!api.readDirectory) return []
    const result = await api.readDirectory(dirPath)
    if (!result.ok || !result.entries) return []
    const filtered = result.entries.filter((e) => !isHidden(e.name))
    return sortEntries(
      filtered.map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: e.isDirectory,
        children: e.isDirectory ? [] : undefined,
      }))
    )
  }, [])

  const loadChildren = useCallback(
    async (dirPath: string) => {
      const children = await loadDirectory(dirPath)
      setTree((prev) => {
        const update = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map((n) => {
            if (n.path === dirPath) {
              return { ...n, children }
            }
            if (n.isDirectory && n.children) {
              return { ...n, children: update(n.children) }
            }
            return n
          })
        return update(prev)
      })
    },
    [loadDirectory]
  )

  const handleToggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        if (next.has(dirPath)) {
          next.delete(dirPath)
          persistedExpandedDirs.delete(dirPath)
        } else {
          next.add(dirPath)
          persistedExpandedDirs.add(dirPath)
          loadChildren(dirPath)
        }
        return next
      })
    },
    [loadChildren]
  )

  const handleFileClick = useCallback(
    (filePath: string) => {
      onFileSelect(filePath)
    },
    [onFileSelect]
  )

  const handleContextMenu = useCallback((node: TreeNode, x: number, y: number) => {
    setCtxMenu({ node, x, y })
    setCtxMenuPos(null)
  }, [])

  const handleCopyPath = useCallback(async () => {
    if (!ctxMenu) return
    const nodePath = ctxMenu.node.path
    const projectPath = await window.api.getProjectPath()
    const fullPath = nodePath.startsWith('/') ? nodePath : `${projectPath}/${nodePath}`
    window.api.copyToClipboard(fullPath)
    setCtxMenu(null)
  }, [ctxMenu])

  const handleCopyRelativePath = useCallback(() => {
    if (!ctxMenu) return
    window.api.copyToClipboard(ctxMenu.node.path)
    setCtxMenu(null)
  }, [ctxMenu])

  const handleRevealInFinder = useCallback(() => {
    if (!ctxMenu) return
    window.api.showItemInFolder(ctxMenu.node.path)
    setCtxMenu(null)
  }, [ctxMenu])

  // Viewport boundary adjustment
  useEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return
    const rect = ctxMenuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = ctxMenu.x
    let y = ctxMenu.y
    if (x + rect.width > vw) x = vw - rect.width - 8
    if (y + rect.height > vh) y = vh - rect.height - 8
    if (x < 0) x = 8
    if (y < 0) y = 8
    setCtxMenuPos({ x, y })
  }, [ctxMenu])

  // ESC to close
  useEffect(() => {
    if (!ctxMenu) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [ctxMenu])

  const loadRoot = useCallback(async () => {
    const api = window.api as ReadDirectoryApi
    if (!api.readDirectory) {
      setLoading(false)
      return
    }
    const result = await api.readDirectory('.')
    if (result.ok && result.entries) {
      const filtered = result.entries.filter((e) => !isHidden(e.name))
      setTree(sortEntries(filtered.map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: e.isDirectory,
        children: e.isDirectory ? [] : undefined,
      }))))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  useEffect(() => {
    if (tree.length === 0 || persistedExpandedDirs.size === 0) return
    const hasEmptyChildren = (nodes: TreeNode[]): boolean => {
      for (const n of nodes) {
        if (n.isDirectory && persistedExpandedDirs.has(n.path) && n.children?.length === 0) return true
        if (n.isDirectory && n.children && hasEmptyChildren(n.children)) return true
      }
      return false
    }
    if (!hasEmptyChildren(tree)) return
    const dirsToLoad: string[] = []
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.isDirectory && persistedExpandedDirs.has(n.path) && n.children?.length === 0) {
          dirsToLoad.push(n.path)
        }
        if (n.isDirectory && n.children) collect(n.children)
      }
    }
    collect(tree)
    dirsToLoad.forEach((dir) => loadChildren(dir))
  }, [tree, loadChildren])

  useEffect(() => {
    const api = window.api as typeof window.api & { onFsChanged?: (cb: () => void) => () => void }
    if (!api.onFsChanged) return

    const unsub = api.onFsChanged(() => {
      refreshVersion.current++
      const currentVersion = refreshVersion.current

      setTimeout(() => {
        if (refreshVersion.current !== currentVersion) return
        const expanded = Array.from(expandedDirs)
        loadRoot().then(() => {
          expanded.forEach(dir => loadChildren(dir))
        })
      }, 100)
    })

    return unsub
  }, [loadRoot, loadChildren])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-xs">
        Loading files...
      </div>
    )
  }

  if (tree.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-xs">
        No files found
      </div>
    )
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          expandedDirs={expandedDirs}
          onToggleDir={handleToggleDir}
          onFileClick={handleFileClick}
          onContextMenu={handleContextMenu}
        />
      ))}
      {ctxMenu && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }}
          />
          <div
            ref={ctxMenuRef}
            className="fixed xi-glass rounded-md py-0.5 min-w-[180px]"
            style={{ left: ctxMenuPos?.x ?? ctxMenu.x, top: ctxMenuPos?.y ?? ctxMenu.y, zIndex: 9999 }}
          >
            <button
              onClick={() => { handleCopyPath() }}
              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              Copy Path
            </button>
            <button
              onClick={() => { handleCopyRelativePath() }}
              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              Copy Relative Path
            </button>
            <div className="border-t border-gray-100 my-0.5" />
            <button
              onClick={() => { handleRevealInFinder() }}
              className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-16.5 0h16.5m-16.5 0A2.25 2.25 0 003 15v3.75A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V15a2.25 2.25 0 00-1.5-2.25m-16.5 0V6A2.25 2.25 0 015.25 3.75h5.379a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18.75A2.25 2.25 0 0121 9v.75" />
              </svg>
              Reveal in Finder
            </button>
          </div>
        </>,
        document.body
      )}
     </div>
   )
}

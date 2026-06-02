import { useState, useEffect, useCallback, useRef } from 'react'
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

function TreeNodeRow({
  node,
  depth,
  expandedDirs,
  onToggleDir,
  onFileClick,
}: {
  node: TreeNode
  depth: number
  expandedDirs: Set<string>
  onToggleDir: (path: string) => void
  onFileClick: (path: string) => void
}) {
  const isExpanded = expandedDirs.has(node.path)

  const handleClick = useCallback(() => {
    if (node.isDirectory) {
      onToggleDir(node.path)
    } else {
      onFileClick(node.path)
    }
  }, [node, onToggleDir, onFileClick])

  return (
    <div>
      <div
        className="hover:bg-gray-100 cursor-pointer flex items-center gap-1 text-xs text-gray-700 py-0.5 pr-2"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={handleClick}
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FileTree({ onFileSelect }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
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
        } else {
          next.add(dirPath)
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
        />
      ))}
    </div>
  )
}

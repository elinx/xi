import { useState, useEffect, useCallback, useRef } from 'react'
import CommitDetailInline from './CommitDetailInline'
import type { CommitEntry, CommitDetail } from '../types/git'

// Graph column constants
const GRAPH_W = 20         // total width of the graph column
const CENTER_X = 10        // center of the column (dot center & line center)
const DOT_R = 3            // dot radius
const DOT_SIZE = DOT_R * 2 + 1  // dot diameter (7px)
const LINE_W = 1.5         // line width
const LINE_LEFT = CENTER_X - LINE_W / 2  // 9.25px

const BRANCH_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#8b5cf6', // violet-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
]

const GRAY = '#e5e7eb'

function getBranchColor(branchName: string): string {
  let hash = 0
  for (let i = 0; i < branchName.length; i++) {
    hash = ((hash << 5) - hash + branchName.charCodeAt(i)) | 0
  }
  return BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length]
}

function formatRelativeTime(dateStr: string): string {
  try {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    if (isNaN(then)) return dateStr
    const diffMs = now - then
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)

    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    if (diffDay < 30) return `${diffDay}d ago`
    return new Date(dateStr).toLocaleDateString()
  } catch {
    return dateStr
  }
}

/** Parse refs string to extract branch names and tags */
function parseRefs(refsStr: string): { branches: string[]; tags: string[]; isHead: boolean } {
  const branches: string[] = []
  const tags: string[] = []
  let isHead = false

  if (!refsStr) return { branches, tags, isHead }

  const parts = refsStr.split(',').map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    if (part.startsWith('HEAD -> ')) {
      isHead = true
      const branch = part.replace('HEAD -> ', '').trim()
      branches.push(branch)
    } else if (part.startsWith('tag: ')) {
      tags.push(part.replace('tag: ', '').trim())
    } else {
      branches.push(part)
    }
  }

  return { branches, tags, isHead }
}

/** Determine the primary branch name for a commit (for coloring) */
function getCommitBranch(refsStr: string): string | null {
  const { branches } = parseRefs(refsStr)
  for (const b of branches) {
    if (!b.startsWith('origin/') && !b.startsWith('upstream/')) return b
  }
  return branches[0] ?? null
}

/**
 * Renders the graph column for a single commit row.
 * Uses absolute positioning for pixel-perfect alignment.
 */
function CommitGraph({
  dotColor,
  dotStyle,
  hasLineAbove,
  hasLineBelow,
  lineColor,
}: {
  dotColor: string
  dotStyle: 'filled' | 'outlined' | 'hollow'
  hasLineAbove: boolean
  hasLineBelow: boolean
  lineColor: string
}) {
  const dotCSS: React.CSSProperties =
    dotStyle === 'filled'
      ? { width: DOT_SIZE, height: DOT_SIZE, backgroundColor: dotColor, border: `2px solid ${dotColor}` }
      : dotStyle === 'hollow'
        ? { width: DOT_SIZE, height: DOT_SIZE, backgroundColor: GRAY, border: `2px solid ${GRAY}` }
        : { width: DOT_SIZE, height: DOT_SIZE, backgroundColor: 'white', border: `2px solid ${dotColor}` }

  return (
    <div
      className="flex-shrink-0 relative"
      style={{ width: GRAPH_W }}
    >
      {/* Vertical line above dot: from row top to dot top edge */}
      {hasLineAbove && (
        <div
          className="absolute"
          style={{
            left: LINE_LEFT,
            top: 0,
            height: `calc(50% - ${DOT_SIZE / 2 + 1}px)`,
            width: LINE_W,
            backgroundColor: lineColor,
          }}
        />
      )}
      {/* Dot: centered at row vertical center */}
      <div
        className="absolute rounded-full"
        style={{
          left: CENTER_X - DOT_SIZE / 2,
          top: `calc(50% - ${DOT_SIZE / 2}px)`,
          ...dotCSS,
        }}
      />
      {/* Vertical line below dot: from dot bottom edge to row bottom */}
      {hasLineBelow && (
        <div
          className="absolute"
          style={{
            left: LINE_LEFT,
            top: `calc(50% + ${DOT_SIZE / 2 + 1}px)`,
            bottom: 0,
            width: LINE_W,
            backgroundColor: lineColor,
          }}
        />
      )}
    </div>
  )
}

export default function GitLogList({
  onCommitFileSelect,
}: {
  onCommitFileSelect?: (hash: string, filePath: string) => void
}) {
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedHash, setExpandedHash] = useState<string | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<CommitDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const skipRef = useRef(0)

  const loadCommits = useCallback(async (skip: number, append: boolean) => {
    if (skip === 0) setLoading(true)
    else setLoadingMore(true)
    setError(null)
    try {
      const result = await window.api.gitLog({ maxCount: 50, skip })
      if (result.ok && result.data) {
        const newCommits = result.data
        if (append) {
          setCommits(prev => [...prev, ...newCommits])
        } else {
          setCommits(newCommits)
        }
        setHasMore(newCommits.length >= 50)
        skipRef.current = skip + newCommits.length
      } else {
        setError(result.error ?? 'Failed to load git log')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    loadCommits(0, false)
  }, [loadCommits])

  const handleLoadMore = useCallback(() => {
    loadCommits(skipRef.current, true)
  }, [loadCommits])

  const handleToggleCommit = useCallback(async (hash: string) => {
    setExpandedHash(prev => {
      if (prev === hash) {
        setExpandedDetail(null)
        return null
      }
      setDetailLoading(true)
      setExpandedDetail(null)
      window.api.gitCommitDetail(hash)
        .then(result => {
          if (result.ok && result.data) {
            setExpandedDetail(result.data)
          }
        })
        .catch(() => {})
        .finally(() => setDetailLoading(false))
      return hash
    })
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 text-xs">
        Loading log...
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-gray-400 text-center">
        {error}
      </div>
    )
  }

  if (commits.length === 0) {
    return (
      <div className="px-3 py-4 text-gray-400 text-center">
        No commits found
      </div>
    )
  }

  // Track which branches have been seen to assign colors
  const branchColorMap = new Map<string, string>()
  let colorIdx = 0
  const getOrAssignColor = (branch: string): string => {
    let color = branchColorMap.get(branch)
    if (!color) {
      color = BRANCH_COLORS[colorIdx % BRANCH_COLORS.length]
      branchColorMap.set(branch, color)
      colorIdx++
    }
    return color
  }

  return (
    <div>
      {commits.map((commit, idx) => {
        const branch = getCommitBranch(commit.refs)
        const { branches, tags, isHead } = parseRefs(commit.refs)
        const isExpanded = expandedHash === commit.hash
        const isFirst = idx === 0
        const isLast = idx === commits.length - 1 && !hasMore

        const dotColor = branch ? getOrAssignColor(branch) : GRAY
        const dotStyle: 'filled' | 'outlined' | 'hollow' = isHead ? 'filled' : branch ? 'outlined' : 'hollow'

        return (
          <div key={commit.hash} className="border-b border-gray-100">
            <div
              className={`group flex cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-100'}`
              onClick={() => handleToggleCommit(commit.hash)}
            >
              {/* Graph column — fixed width, absolute-positioned dot & lines */}
              <CommitGraph
                dotColor={dotColor}
                dotStyle={dotStyle}
                hasLineAbove={!isFirst}
                hasLineBelow={!isLast}
                lineColor={GRAY}
              />

              {/* Content column */}
              <div className="flex-1 py-1.5 pr-2 min-w-0">
                {/* Line 1: hash + branch/tag badges */}
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-gray-400 flex-shrink-0">{commit.shortHash}</span>
                  {branches.map(b => (
                    <span
                      key={b}
                      className="flex-shrink-0 px-1 py-0 rounded text-[10px] font-medium truncate max-w-[80px]"
                      style={{
                        backgroundColor: getOrAssignColor(b) + '18',
                        color: getOrAssignColor(b),
                      }}
                      title={b}
                    >
                      {b}
                    </span>
                  ))}
                  {tags.map(t => (
                    <span
                      key={t}
                      className="flex-shrink-0 px-1 py-0 rounded text-[10px] font-medium bg-amber-50 text-amber-600 truncate max-w-[80px]"
                      title={t}
                    >
                      {t}
                    </span>
                  ))}
                </div>

                {/* Line 2: message + meta */}
                <div className="flex items-center gap-1">
                  <span className="text-gray-700 truncate flex-1">{commit.message}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {commit.author_name} · {formatRelativeTime(commit.date)}
                  </span>
                  <svg
                    className={`w-3 h-3 text-gray-300 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Expanded commit detail */}
            {isExpanded && (
              <CommitDetailInline
                hash={commit.hash}
                detail={expandedDetail}
                loading={detailLoading}
                onFileSelect={(filePath) => onCommitFileSelect?.(commit.hash, filePath)}
                onClose={() => {
                  setExpandedHash(null)
                  setExpandedDetail(null)
                }}
              />
            )}
          </div>
        )
      })}

      {/* Load more */}
      {hasMore && (
        <div className="px-3 py-2 text-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="text-xs text-blue-500 hover:text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}

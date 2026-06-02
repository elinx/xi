import { useState, useEffect, useCallback } from 'react'

interface GitFile {
  path: string
  status: string
  staged: boolean
}

interface GitStatusData {
  branch: string
  ahead: number
  behind: number
  files: GitFile[]
}

function statusLabel(status: string): string {
  switch (status) {
    case 'M': return 'M'
    case 'A': return 'A'
    case 'D': return 'D'
    case '?': return 'U'
    case 'R': return 'R'
    default: return status
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'M': return 'text-amber-600'
    case 'A': return 'text-green-600'
    case 'D': return 'text-red-500'
    case '?': return 'text-gray-400'
    default: return 'text-gray-500'
  }
}

export default function GitPanel({ onFileSelect }: { onFileSelect?: (filePath: string) => void }) {
  const [status, setStatus] = useState<GitStatusData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [staging, setStaging] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.gitStatus()
      if (result.ok && result.data) {
        setStatus(result.data)
      } else {
        setError(result.error ?? 'Failed to get git status')
        setStatus(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const api = window.api as typeof window.api & { onFsChanged?: (cb: () => void) => () => void }
    if (!api.onFsChanged) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = api.onFsChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 500)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [refresh])

  const handleStage = useCallback(async (filePath: string) => {
    setStaging(filePath)
    try {
      const result = await window.api.gitStage([filePath])
      if (result.ok) await refresh()
    } finally {
      setStaging(null)
    }
  }, [refresh])

  const handleUnstage = useCallback(async (filePath: string) => {
    setStaging(filePath)
    try {
      const result = await window.api.gitUnstage([filePath])
      if (result.ok) await refresh()
    } finally {
      setStaging(null)
    }
  }, [refresh])

  const handleStageAll = useCallback(async () => {
    if (!status) return
    const paths = status.files.filter(f => !f.staged).map(f => f.path)
    if (paths.length === 0) return
    setStaging('__all__')
    try {
      await window.api.gitStage(paths)
      await refresh()
    } finally {
      setStaging(null)
    }
  }, [status, refresh])

  const handleDiscardAll = useCallback(async () => {
    if (!status) return
    const paths = status.files.filter(f => !f.staged && f.status !== '?').map(f => f.path)
    if (paths.length === 0) return
    setStaging('__discard__')
    try {
      await window.api.gitDiscard(paths)
      await refresh()
    } finally {
      setStaging(null)
    }
  }, [status, refresh])

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return
    setCommitting(true)
    try {
      const result = await window.api.gitCommit(commitMsg.trim())
      if (result.ok) {
        setCommitMsg('')
        await refresh()
      }
    } finally {
      setCommitting(false)
    }
  }, [commitMsg, refresh])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-xs">
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-gray-400">
        {error}
      </div>
    )
  }

  if (!status) return null

  const staged = status.files.filter(f => f.staged)
  const unstaged = status.files.filter(f => !f.staged && f.status !== '?')
  const untracked = status.files.filter(f => f.status === '?')

  const hasUnstagedOrUntracked = unstaged.length > 0 || untracked.length > 0
  const hasUnstagedChanges = unstaged.length > 0

  return (
    <div className="text-xs flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2 flex-shrink-0">
        <span className="font-medium text-gray-700">{status.branch}</span>
        {status.ahead > 0 && <span className="text-green-600">↑{status.ahead}</span>}
        {status.behind > 0 && <span className="text-amber-600">↓{status.behind}</span>}
        {hasUnstagedOrUntracked && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={handleStageAll}
              className="rounded p-1 text-gray-400 hover:text-green-600 hover:bg-gray-100 transition-colors"
              disabled={staging !== null}
              title="Stage All"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            {hasUnstagedChanges && (
              <button
                onClick={handleDiscardAll}
                className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 transition-colors"
                disabled={staging !== null}
                title="Discard All Changes"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                </svg>
              </button>
            )}
          </div>
        )}
        {!hasUnstagedOrUntracked && (
          <button
            onClick={refresh}
            className="ml-auto rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {staged.length > 0 && (
          <div className="border-b border-gray-200">
            <div className="px-3 py-1.5 text-gray-500 font-medium">Staged Changes ({staged.length})</div>
            {staged.map(f => (
              <div key={f.path} className="px-3 py-1 flex items-center gap-1 hover:bg-gray-100 group" title={f.path}>
                <span className={`w-4 text-center font-mono font-semibold ${statusColor(f.status)}`}>{statusLabel(f.status)}</span>
                <span className="text-gray-700 truncate flex-1 cursor-pointer" onClick={() => onFileSelect?.(f.path)}>{f.path}</span>
                <button
                  onClick={() => handleUnstage(f.path)}
                  disabled={staging !== null}
                  className="rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  title="Unstage"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {unstaged.length > 0 && (
          <div className="border-b border-gray-200">
            <div className="px-3 py-1.5 text-gray-500 font-medium">Changes ({unstaged.length})</div>
            {unstaged.map(f => (
              <div key={f.path} className="px-3 py-1 flex items-center gap-1 hover:bg-gray-100 group" title={f.path}>
                <span className={`w-4 text-center font-mono font-semibold ${statusColor(f.status)}`}>{statusLabel(f.status)}</span>
                <span className="text-gray-700 truncate flex-1 cursor-pointer" onClick={() => onFileSelect?.(f.path)}>{f.path}</span>
                <button
                  onClick={() => handleStage(f.path)}
                  disabled={staging !== null}
                  className="rounded p-0.5 text-gray-400 hover:text-green-600 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  title="Stage"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {untracked.length > 0 && (
          <div className="border-b border-gray-200">
            <div className="px-3 py-1.5 text-gray-500 font-medium">Untracked ({untracked.length})</div>
            {untracked.map(f => (
              <div key={f.path} className="px-3 py-1 flex items-center gap-1 hover:bg-gray-100 group" title={f.path}>
                <span className={`w-4 text-center font-mono font-semibold ${statusColor(f.status)}`}>U</span>
                <span className="text-gray-700 truncate flex-1 cursor-pointer" onClick={() => onFileSelect?.(f.path)}>{f.path}</span>
                <button
                  onClick={() => handleStage(f.path)}
                  disabled={staging !== null}
                  className="rounded p-0.5 text-gray-400 hover:text-green-600 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  title="Stage"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {status.files.length === 0 && (
          <div className="px-3 py-4 text-gray-400 text-center">
            No changes
          </div>
        )}
      </div>

      {staged.length > 0 && (
        <div className="border-t border-gray-200 p-2 flex-shrink-0">
          <textarea
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commitMsg.trim()) {
                e.preventDefault()
                handleCommit()
              }
            }}
            placeholder="Commit message (⌘+Enter)"
            className="w-full resize-none border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400"
            rows={2}
            disabled={committing}
          />
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || committing}
            className="w-full mt-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {committing ? 'Committing...' : 'Commit'}
          </button>
        </div>
      )}
    </div>
  )
}

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

  return (
    <div className="text-xs">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
        <span className="font-medium text-gray-700">{status.branch}</span>
        {status.ahead > 0 && <span className="text-green-600">↑{status.ahead}</span>}
        {status.behind > 0 && <span className="text-amber-600">↓{status.behind}</span>}
        <button
          onClick={refresh}
          className="ml-auto rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Refresh"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {staged.length > 0 && (
        <div className="border-b border-gray-200">
          <div className="px-3 py-1.5 text-gray-500 font-medium">Staged Changes ({staged.length})</div>
          {staged.map(f => (
            <div key={f.path} className="px-3 py-1 flex items-center gap-2 hover:bg-gray-100 cursor-pointer" title={f.path} onClick={() => onFileSelect?.(f.path)}>
              <span className={`w-4 text-center font-mono font-semibold ${statusColor(f.status)}`}>{statusLabel(f.status)}</span>
              <span className="text-gray-700 truncate">{f.path}</span>
            </div>
          ))}
        </div>
      )}

      {unstaged.length > 0 && (
        <div className="border-b border-gray-200">
          <div className="px-3 py-1.5 text-gray-500 font-medium">Changes ({unstaged.length})</div>
          {unstaged.map(f => (
            <div key={f.path} className="px-3 py-1 flex items-center gap-2 hover:bg-gray-100 cursor-pointer" title={f.path} onClick={() => onFileSelect?.(f.path)}>
              <span className={`w-4 text-center font-mono font-semibold ${statusColor(f.status)}`}>{statusLabel(f.status)}</span>
              <span className="text-gray-700 truncate">{f.path}</span>
            </div>
          ))}
        </div>
      )}

      {untracked.length > 0 && (
        <div>
          <div className="px-3 py-1.5 text-gray-500 font-medium">Untracked ({untracked.length})</div>
          {untracked.map(f => (
            <div key={f.path} className="px-3 py-1 flex items-center gap-2 hover:bg-gray-100 cursor-pointer" title={f.path} onClick={() => onFileSelect?.(f.path)}>
              <span className={`w-4 text-center font-mono font-semibold ${statusColor(f.status)}`}>U</span>
              <span className="text-gray-700 truncate">{f.path}</span>
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
  )
}

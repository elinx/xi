import { useState, useEffect, useCallback } from 'react'
import GitLogList from './GitLogList'

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

type SubTab = 'changes' | 'log'

export default function GitPanel({
  onFileSelect,
  onCommitFileSelect,
  onRequestCommitMessage,
  commitMessageFromAI,
}: {
  onFileSelect?: (filePath: string) => void
  onCommitFileSelect?: (hash: string, filePath: string) => void
  onRequestCommitMessage?: (diff: string) => void
  commitMessageFromAI?: string
}) {
  const [status, setStatus] = useState<GitStatusData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [staging, setStaging] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<SubTab>('changes')
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null)

  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    window.api.checkGitAvailable().then(({ available }) => setGitAvailable(available))
  }, [])

  useEffect(() => {
    if (commitMessageFromAI) {
      setCommitMsg(commitMessageFromAI)
    }
  }, [commitMessageFromAI])

  const handleGenerateCommitMsg = useCallback(async () => {
    if (!onRequestCommitMessage || generating) return
    setGenerating(true)
    try {
      const result = await window.api.gitDiffCached()
      if (result.ok && result.data) {
        onRequestCommitMessage(result.data)
      }
    } finally {
      setGenerating(false)
    }
  }, [onRequestCommitMessage, generating])

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
    const isNotInstalled = gitAvailable === false || error.includes('Git is not installed')
    const isNotRepo = error.includes('Not a git repository')

    if (isNotInstalled) {
      return (
        <div className="p-4 flex flex-col items-center justify-center h-full text-gray-400 text-xs gap-2">
          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="font-medium text-gray-500">Git is not installed</span>
          <span className="text-center text-[11px] text-gray-400 leading-relaxed">
            Install Git from <a href="https://git-scm.com" className="text-blue-500 hover:underline" onClick={(e) => { e.preventDefault(); window.open('https://git-scm.com', '_blank') }}>git-scm.com</a> and restart Xi.
          </span>
        </div>
      )
    }

    if (isNotRepo) {
      return (
        <div className="p-4 flex flex-col items-center justify-center h-full text-gray-400 text-xs gap-2">
          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          <span className="font-medium text-gray-500">Not a git repository</span>
          <span className="text-center text-[11px] text-gray-400 leading-relaxed">
            Initialize a repository with <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600">git init</code> to use Git features.
          </span>
        </div>
      )
    }

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
      {/* Branch header */}
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

      {/* Sub-tab: Changes / Log */}
      <div className="flex border-b border-gray-200 flex-shrink-0">
        <button
          onClick={() => setSubTab('changes')}
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
            subTab === 'changes'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Changes
          {status.files.length > 0 && (
            <span className="ml-1 text-[10px] text-gray-400">({status.files.length})</span>
          )}
        </button>
        <button
          onClick={() => setSubTab('log')}
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
            subTab === 'log'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Log
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {subTab === 'changes' && (
          <>
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
                <div className="mt-1 text-[10px]">
                  Switch to <button onClick={() => setSubTab('log')} className="text-blue-500 hover:underline">Log</button> to see commit history
                </div>
              </div>
            )}
          </>
        )}

        {subTab === 'log' && (
          <GitLogList onCommitFileSelect={onCommitFileSelect} />
        )}
      </div>

      {/* Commit input (only in Changes tab with staged files) */}
      {subTab === 'changes' && staged.length > 0 && (
        <div className="border-t border-gray-200 p-2 flex-shrink-0">
          <div className="flex gap-1">
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
              className="flex-1 resize-none border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400"
              rows={2}
              disabled={committing}
            />
            {onRequestCommitMessage && (
              <button
                onClick={handleGenerateCommitMsg}
                disabled={generating}
                className="self-stretch rounded border border-gray-200 px-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors cursor-pointer"
                title="Generate commit message with AI"
              >
                {generating ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                )}
              </button>
            )}
          </div>
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

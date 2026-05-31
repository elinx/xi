import { useEffect, useState, useCallback, useRef } from 'react'
import { usePiRpc } from './hooks/usePiRpc'
import { useSessionManager } from './hooks/useSessionManager'
import ChatView from './components/ChatView'
import InputBar from './components/InputBar'
import SessionSidebar from './components/SessionSidebar'
import { TokenUsageRing } from './components/TokenUsageRing'
import type { ViewMode } from './utils/compact-view'

function getDisplayName(session: { name: string | null; createdAt: string }): string {
  if (session.name) return session.name
  const d = new Date(session.createdAt)
  const month = d.toLocaleString('en', { month: 'short' })
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${month} ${day} ${hh}:${mm}`
}

function App(): React.ReactElement {
  const { messages, isConnected, isStreaming, streamingMessageId, sendPrompt, abort, pendingUiRequests, respondToUiRequest, clearMessages, loadHistory, forkPoints, loadForkPoints, setOnAgentEnd, tokenUsage } = usePiRpc()
  const { sessions, currentSession, forkAtEntry, switchSession, newSession, renameSession, deleteSession, setSessionStatus, getForkMessages, clearSession, refresh } = useSessionManager(isConnected)
  const [error, setError] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('xi-sidebar-collapsed')
    return saved === 'true'
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('xi-sidebar-width')
    const parsed = saved ? parseInt(saved, 10) : 260
    return Number.isNaN(parsed) ? 260 : Math.min(480, Math.max(180, parsed))
  })
  const [isResizing, setIsResizing] = useState(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return
      const delta = e.clientX - resizeStartRef.current.startX
      const newWidth = Math.min(480, Math.max(180, resizeStartRef.current.startWidth + delta))
      setSidebarWidth(newWidth)
    }
    const handleMouseUp = () => {
      setIsResizing(false)
      resizeStartRef.current = null
      localStorage.setItem('xi-sidebar-width', String(sidebarWidthRef.current))
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeStartRef.current = { startX: e.clientX, startWidth: sidebarWidth }
  }, [sidebarWidth])
  const [activeSessionPath, setActiveSessionPath] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('xi-view-mode') as ViewMode
    return saved === 'normal' || saved === 'turn' || saved === 'outline' ? saved : 'normal'
  })

  const activeSession = activeSessionPath
    ? sessions?.projects?.flatMap(p => p.allSessions).find(s => s.filePath === activeSessionPath)
    : currentSession

  const activeSessionName = activeSession ? getDisplayName(activeSession) : null

  async function handleConnect(): Promise<void> {
    setError(null)
    const result = await window.api.start()
    if (!result.ok && result.error) {
      setError(result.error)
    }
    refresh()
  }

  // Auto-start Pi on mount
  useEffect(() => {
    handleConnect()
  }, [])

  const handleSwitchSession = useCallback(async (sessionPath: string) => {
    const prevPath = activeSessionPath
    setActiveSessionPath(sessionPath)
    const result = await switchSession(sessionPath)
    if (result.success) {
      clearMessages()
      await loadHistory()
      await loadForkPoints(sessionPath)
      await refresh()
    } else {
      setActiveSessionPath(prevPath)
    }
  }, [activeSessionPath, clearMessages, switchSession, loadHistory, loadForkPoints, refresh])

  const handleNewSession = useCallback(async (name: string, parentSessionPath: string) => {
    clearMessages()
    const result = await newSession(name, parentSessionPath)
    if (result) await refresh()
  }, [clearMessages, newSession, refresh])

  const handleForkAtEntry = useCallback(async (entryId: string, name: string) => {
    clearMessages()
    await forkAtEntry(entryId, name)
    await loadHistory()
    await refresh()
  }, [clearMessages, forkAtEntry, loadHistory, refresh])

  const handleForkFromEnd = useCallback(async (sessionPath: string, name: string) => {
    const msgs = await getForkMessages()
    const lastEntry = msgs[msgs.length - 1]
    if (!lastEntry?.entryId) return
    clearMessages()
    await forkAtEntry(lastEntry.entryId, name)
    await loadHistory()
    await refresh()
    setActiveSessionPath(null)
  }, [getForkMessages, clearMessages, forkAtEntry, loadHistory, refresh, setActiveSessionPath])

  const handleClearSession = useCallback(async () => {
    clearMessages()
    const ok = await clearSession()
    if (ok) {
      clearMessages()
      await loadHistory()
      await refresh()
      setActiveSessionPath(null)
    }
  }, [clearMessages, clearSession, loadHistory, refresh])

  useEffect(() => {
    if (isConnected) {
      loadHistory()
    }
  }, [isConnected, loadHistory])

  useEffect(() => {
    if (isConnected && currentSession?.filePath) {
      loadForkPoints(currentSession.filePath)
    }
  }, [isConnected, currentSession?.filePath, loadForkPoints])

  useEffect(() => {
    setOnAgentEnd(() => refresh)
  }, [setOnAgentEnd, refresh])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && isStreaming) {
        abort()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isStreaming, abort])

  useEffect(() => {
    const cleanup = window.api.onEvent((rawEvent) => {
      const evt = rawEvent as { type: string; error?: string; errorMessage?: string }
      if (evt.type === 'extension_error' && evt.error) {
        setError(`Extension error: ${evt.error}`)
      }
    })
    return cleanup
  }, [])

  const projects = sessions?.projects ?? []
  const projectName = projects[0]?.projectPath.split('/').pop() ?? 'Sessions'
  const collapsedSidebarWidth = 48
  const currentSidebarWidth = sidebarCollapsed ? collapsedSidebarWidth : sidebarWidth

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-gray-900">
      {/* Unified header row split at sidebar width */}
      <div className="flex border-b border-gray-200 bg-gray-50" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        {/* Left: sidebar header zone */}
        <div
          className="flex items-center justify-between px-3 pt-10 pb-2 flex-shrink-0"
          style={{ width: currentSidebarWidth }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 truncate">{sidebarCollapsed ? '' : projectName}</span>
          <button
            onClick={() => {
              const next = !sidebarCollapsed
              setSidebarCollapsed(next)
              localStorage.setItem('xi-sidebar-collapsed', String(next))
            }}
            className="rounded p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title={sidebarCollapsed ? 'Show sessions' : 'Hide sessions'}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {sidebarCollapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              )}
            </svg>
          </button>
        </div>
        {/* Right: main header zone */}
        <div className="flex items-center justify-between flex-1 px-4 pt-10 pb-2 min-w-0">
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {activeSessionName && (
              <>
                <span className="text-xs text-gray-700 font-medium">
                  {activeSessionName}
                </span>
                <button
                  onClick={handleClearSession}
                  className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 transition-colors"
                  title="Clear conversation"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </>
            )}

            {error && (
              <span className="text-xs text-red-500" title={error}>Error</span>
            )}
          </div>
          <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <TokenUsageRing
              usedTokens={tokenUsage.totalTokens}
              contextWindowSize={tokenUsage.contextWindowSize}
              inputTokens={tokenUsage.inputTokens}
              outputTokens={tokenUsage.outputTokens}
              cacheReadTokens={tokenUsage.cacheReadTokens}
              totalCost={tokenUsage.totalCost}
            />
          </div>
          <div className="flex items-center rounded-md border border-gray-200 bg-gray-100 p-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              onClick={() => { localStorage.setItem('xi-view-mode', 'normal'); setViewMode('normal') }}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${viewMode === 'normal' ? 'bg-gray-200 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              title="Full view"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M3 8h18M3 12h18M3 16h18M3 20h18" />
              </svg>
            </button>
            <button
              onClick={() => { localStorage.setItem('xi-view-mode', 'turn'); setViewMode('turn') }}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${viewMode === 'turn' ? 'bg-gray-200 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              title="Turn view"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 9h12M3 13h18M6 17h12" />
              </svg>
            </button>
            <button
              onClick={() => { localStorage.setItem('xi-view-mode', 'outline'); setViewMode('outline') }}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${viewMode === 'outline' ? 'bg-gray-200 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              title="Outline view"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {!isConnected && (
              <button
                onClick={handleConnect}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
              >
                Connect to Pi
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">
        <SessionSidebar
          sessions={sessions}
          currentSession={currentSession}
          onSwitchSession={handleSwitchSession}
          onNewSession={handleNewSession}
          onRenameSession={renameSession}
          onDeleteSession={deleteSession}
          onSetSessionStatus={setSessionStatus}
          onForkFromEnd={handleForkFromEnd}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => {
            const next = !sidebarCollapsed
            setSidebarCollapsed(next)
            localStorage.setItem('xi-sidebar-collapsed', String(next))
          }}
          width={sidebarWidth}
          onResizeStart={handleResizeStart}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <ChatView
            messages={messages}
            isStreaming={isStreaming}
            streamingMessageId={streamingMessageId}
            pendingUiRequests={pendingUiRequests}
            respondToUiRequest={respondToUiRequest}
            onSendPrompt={sendPrompt}
            onForkAtEntry={handleForkAtEntry}
            getForkMessages={getForkMessages}
            forkPoints={forkPoints}
            viewMode={viewMode}
          />

          <InputBar onSend={sendPrompt} disabled={!isConnected || isStreaming} isConnected={isConnected} isStreaming={isStreaming} onStop={isStreaming ? abort : undefined} />
        </div>
      </div>
    </div>
  )
}

export default App

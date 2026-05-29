import { useEffect, useState, useCallback } from 'react'
import { usePiRpc } from './hooks/usePiRpc'
import { useSessionManager } from './hooks/useSessionManager'
import ChatView from './components/ChatView'
import InputBar from './components/InputBar'
import SessionSidebar from './components/SessionSidebar'

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
  const { messages, isConnected, isStreaming, sendPrompt, abort, pendingUiRequests, respondToUiRequest, clearMessages, loadHistory, forkPoints, loadForkPoints } = usePiRpc()
  const { sessions, currentSession, forkAtEntry, switchSession, newSession, renameSession, deleteSession, getForkMessages, refresh } = useSessionManager(isConnected)
  const [error, setError] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeSessionPath, setActiveSessionPath] = useState<string | null>(null)

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
  }

  // Auto-start Pi on mount
  useEffect(() => {
    handleConnect()
  }, [])

  const handleSwitchSession = useCallback(async (sessionPath: string) => {
    setActiveSessionPath(sessionPath)
    clearMessages()
    await switchSession(sessionPath)
    await loadHistory()
    await loadForkPoints(sessionPath)
    await refresh()
  }, [clearMessages, switchSession, loadHistory, loadForkPoints, refresh])

  const handleNewSession = useCallback(async (name: string) => {
    const parentPath = currentSession?.filePath
    clearMessages()
    const result = await newSession(name, parentPath)
    if (result) await refresh()
  }, [clearMessages, newSession, currentSession, refresh])

  const handleForkAtEntry = useCallback(async (entryId: string, name: string) => {
    clearMessages()
    await forkAtEntry(entryId, name)
    await loadHistory()
    await refresh()
  }, [clearMessages, forkAtEntry, loadHistory, refresh])

  useEffect(() => {
    if (isConnected && currentSession?.filePath) {
      loadHistory()
      loadForkPoints(currentSession.filePath)
    }
  }, [isConnected, currentSession?.filePath, loadHistory, loadForkPoints])

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900 text-gray-100">
      <SessionSidebar
        sessions={sessions}
        currentSession={currentSession}
        onSwitchSession={handleSwitchSession}
        onNewSession={handleNewSession}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-800 bg-gray-950 px-4 py-2">
          <div className="flex items-center gap-2">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="rounded p-1 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                title="Show sessions"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-400">
              {isConnected ? 'Pi Connected' : 'Pi Disconnected'}
            </span>
            {activeSessionName && (
              <span className="text-xs text-gray-300 font-medium border-l border-gray-700 pl-2">
                {activeSessionName}
              </span>
            )}
            {isStreaming && (
              <span className="text-xs text-blue-400 animate-pulse">Streaming...</span>
            )}
            {error && (
              <span className="text-xs text-red-400" title={error}>Error</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isConnected && (
              <button
                onClick={handleConnect}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
              >
                Connect to Pi
              </button>
            )}
            {isStreaming && (
              <button
                onClick={abort}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
              >
                Stop (Esc)
              </button>
            )}
          </div>
        </div>

        <ChatView
          messages={messages}
          pendingUiRequests={pendingUiRequests}
          respondToUiRequest={respondToUiRequest}
          onSendPrompt={sendPrompt}
          onForkAtEntry={handleForkAtEntry}
          getForkMessages={getForkMessages}
          forkPoints={forkPoints}
        />

        <InputBar onSend={sendPrompt} disabled={!isConnected || isStreaming} />
      </div>
    </div>
  )
}

export default App

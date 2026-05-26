import { useEffect, useState } from 'react'
import { usePiRpc } from './hooks/usePiRpc'
import ChatView from './components/ChatView'
import InputBar from './components/InputBar'

function App(): React.ReactElement {
  const { messages, isConnected, isStreaming, sendPrompt, abort, pendingUiRequests, respondToUiRequest } = usePiRpc()
  const [error, setError] = useState<string | null>(null)

  function handleConnect(): void {
    setError(null)
    window.api.sendCommand({ type: 'pi:start' })
  }

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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-900 text-gray-100">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-950 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-400">
            {isConnected ? 'Pi Connected' : 'Pi Disconnected'}
          </span>
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

      <ChatView messages={messages} pendingUiRequests={pendingUiRequests} respondToUiRequest={respondToUiRequest} onSendPrompt={sendPrompt} />

      <InputBar onSend={sendPrompt} disabled={!isConnected || isStreaming} />
    </div>
  )
}

export default App

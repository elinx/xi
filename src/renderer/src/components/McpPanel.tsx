import { useState, useEffect, useCallback } from 'react'

interface McpServer {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export default function McpPanel() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.listMcpServers()
      if (result.ok && result.data) {
        setServers(result.data)
      } else {
        setError(result.error ?? 'Failed to load MCP servers')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const toggleExpand = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-xs">
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-gray-400">{error}</div>
    )
  }

  if (servers.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-400">
        No MCP servers configured.
        <br />
        <br />
        Add servers to <span className="font-mono">~/.pi/agent/settings.json</span> under the <span className="font-mono">"mcpServers"</span> key:
        <pre className="mt-2 p-2 bg-gray-100 rounded text-gray-500 overflow-x-auto">
{`{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    }
  }
}`}
        </pre>
      </div>
    )
  }

  return (
    <div className="text-xs">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
        <span className="font-medium text-gray-700">MCP Servers</span>
        <span className="text-gray-400">({servers.length})</span>
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
      {servers.map(server => {
        const isOpen = expanded.has(server.name)
        return (
          <div key={server.name} className="border-b border-gray-100">
            <button
              onClick={() => toggleExpand(server.name)}
              className="w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-100 text-left"
            >
              <svg className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span className="font-medium text-gray-800">{server.name}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-2 ml-5">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-gray-400">$</span>
                  <span className="font-mono text-gray-600">{server.command}</span>
                  {server.args && server.args.length > 0 && (
                    <span className="font-mono text-gray-400">{server.args.join(' ')}</span>
                  )}
                </div>
                {server.env && Object.keys(server.env).length > 0 && (
                  <div className="mt-1">
                    <span className="text-gray-400">env:</span>
                    {Object.entries(server.env).map(([key]) => (
                      <div key={key} className="ml-2 font-mono text-gray-500">
                        {key}=•••
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

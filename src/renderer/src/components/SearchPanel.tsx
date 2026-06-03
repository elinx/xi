import { useState, useCallback, useRef, useEffect } from 'react'

interface SearchResult {
  filePath: string
  relativePath: string
  matches: Array<{
    lineNumber: number
    lineContent: string
    matchStart: number
    matchEnd: number
  }>
}

interface SearchPanelProps {
  onFileSelect: (filePath: string) => void
}

export default function SearchPanel({ onFileSelect }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string) => {
    if (abortRef.current) {
      abortRef.current.abort()
    }

    if (q.length < 2) {
      setResults([])
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await window.api.searchFiles(q)
      if (controller.signal.aborted) return
      if (result.ok && result.results) {
        setResults(result.results)
      } else {
        setError(result.error ?? 'Search failed')
        setResults([])
      }
    } catch (err) {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, doSearch])

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const toggleFile = useCallback((filePath: string) => {
    setCollapsedFiles(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }, [])

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0)

  function highlightLine(lineContent: string, matchStart: number, matchEnd: number) {
    const before = lineContent.slice(0, matchStart)
    const match = lineContent.slice(matchStart, matchEnd)
    const after = lineContent.slice(matchEnd)
    return (
      <>
        <span>{before}</span>
        <span className="bg-yellow-200 text-yellow-900 rounded px-0.5">{match}</span>
        <span>{after}</span>
      </>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search in files..."
          className="w-full text-xs bg-gray-100 rounded-md px-2.5 py-1.5 text-gray-900 placeholder-gray-400 outline-none focus:ring-1 focus:ring-gray-300"
          autoFocus
        />
      </div>

      {loading && (
        <div className="px-3 py-2 text-xs text-gray-400 flex items-center gap-1.5">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Searching...
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-xs text-red-500">{error}</div>
      )}

      {!loading && !error && query.length >= 2 && results.length > 0 && (
        <div className="px-3 py-1 text-[11px] text-gray-400">
          {results.length} file{results.length !== 1 ? 's' : ''}, {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
        </div>
      )}

      {!loading && !error && query.length >= 2 && results.length === 0 && (
        <div className="px-3 py-4 text-xs text-gray-400 text-center">No results</div>
      )}

      {query.length < 2 && (
        <div className="px-3 py-4 text-xs text-gray-400 text-center">Type 2+ characters to search</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {results.map((file) => {
          const collapsed = collapsedFiles.has(file.filePath)
          return (
            <div key={file.filePath}>
              <button
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                onClick={() => toggleFile(file.filePath)}
              >
                <svg className={`w-3 h-3 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
                <span className="truncate flex-1 text-left">{file.relativePath}</span>
                <span className="text-gray-400 shrink-0">{file.matches.length}</span>
              </button>
              {!collapsed && file.matches.map((match, i) => (
                <button
                  key={i}
                  className="w-full flex items-start gap-2 px-3 pl-8 py-1 text-[11px] font-mono text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors text-left"
                  onClick={() => onFileSelect(file.filePath)}
                >
                  <span className="text-gray-300 shrink-0 select-none w-6 text-right">{match.lineNumber}</span>
                  <span className="truncate">{highlightLine(match.lineContent, match.matchStart, match.matchEnd)}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

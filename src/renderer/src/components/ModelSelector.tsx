import { useState, useEffect, useRef, useCallback } from 'react'
import type { PiModelInfo } from '../types/session'

interface ModelSelectorProps {
  currentModel: PiModelInfo | null
  onSetModel: (modelId: string, provider?: string) => Promise<{ success: boolean; error?: string }>
  getAvailableModels: () => Promise<PiModelInfo[]>
  onClose: () => void
}

function ModelSelector({ currentModel, onSetModel, getAvailableModels, onClose }: ModelSelectorProps): React.ReactElement {
  const [models, setModels] = useState<PiModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [switching, setSwitching] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getAvailableModels().then((result) => {
      setModels(result)
      setLoading(false)
    })
  }, [getAvailableModels])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const [error, setError] = useState<string | null>(null)

  const handleSelect = useCallback(async (model: PiModelInfo) => {
    const key = `${model.provider}/${model.id}`
    setSwitching(key)
    setError(null)
    const result = await onSetModel(model.id, model.provider)
    setSwitching(null)
    if (result.success) {
      onClose()
    } else {
      setError(result.error ?? `Failed to switch to ${model.name || model.id}`)
      setTimeout(() => setError(null), 6000)
    }
  }, [onSetModel, onClose])

  const filtered = models
    .filter(m => m.hasAuth)
    .filter(m => !search ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.id.toLowerCase().includes(search.toLowerCase()) ||
        m.provider.toLowerCase().includes(search.toLowerCase())
      )

  const grouped = filtered.reduce<Record<string, PiModelInfo[]>>((acc, m) => {
    const key = m.provider
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {})

  const providerOrder = Object.keys(grouped).sort((a, b) => {
    if (currentModel?.provider === a) return -1
    if (currentModel?.provider === b) return 1
    return a.localeCompare(b)
  })

  function formatModelName(name: string): string {
    return name.length > 36 ? name.slice(0, 34) + '…' : name
  }

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full right-0 mb-1 w-80 max-h-96 overflow-hidden xi-glass rounded-lg z-50 flex flex-col"
    >
      <div className="p-2 border-b border-gray-100">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models..."
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="overflow-y-auto flex-1">
        {loading && (
          <div className="px-3 py-6 text-center text-xs text-gray-400">Loading models…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-gray-400">
            {models.length === 0 ? 'No models available' : 'No matching models'}
          </div>
        )}

        {providerOrder.map((provider) => (
          <div key={provider}>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 sticky top-0">
              {provider}
            </div>
            {grouped[provider].map((model) => {
              const isCurrent = currentModel?.provider === model.provider && currentModel?.id === model.id
              const isSwitching = switching === `${model.provider}/${model.id}`

              return (
                <button
                  key={`${model.provider}/${model.id}`}
                  onClick={() => handleSelect(model)}
                  disabled={isSwitching || !model.hasAuth}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors duration-150 ${
                    isCurrent
                      ? 'bg-blue-50 text-blue-700'
                      : model.hasAuth
                        ? 'text-gray-700 hover:bg-gray-50'
                        : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {model.hasAuth ? (
                    <svg className="w-3 h-3 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}

                  <span className="flex-1 truncate" title={model.name}>
                    {formatModelName(model.name)}
                  </span>

                  {isCurrent && (
                    <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}

                  {isSwitching && (
                    <svg className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {error && (
        <div className="px-3 py-1.5 border-t border-red-100 bg-red-50 text-[10px] text-red-600 flex items-center gap-1">
          <svg className="w-2.5 h-2.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-400">
        <span className="inline-flex items-center gap-1">
          <svg className="w-2.5 h-2.5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
          auth configured
        </span>
        <span className="mx-2">·</span>
        <span className="inline-flex items-center gap-1">
          <svg className="w-2.5 h-2.5 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
          no auth
        </span>
      </div>
    </div>
  )
}

export default ModelSelector

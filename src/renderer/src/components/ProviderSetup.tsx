import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

const PROVIDER_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
  deepseek: 'https://platform.deepseek.com/api_keys',
  openrouter: 'https://openrouter.ai/settings/keys',
  groq: 'https://console.groq.com/keys',
  xai: 'https://console.x.ai/',
  mistral: 'https://console.mistral.ai/api-keys/',
}

const POPULAR_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', subtitle: 'Claude', color: '#d97706' },
  { id: 'openai', name: 'OpenAI', subtitle: 'GPT', color: '#10a37f' },
  { id: 'google', name: 'Google', subtitle: 'Gemini', color: '#4285f4' },
  { id: 'deepseek', name: 'DeepSeek', subtitle: 'DeepSeek', color: '#4f46e5' },
  { id: 'openrouter', name: 'OpenRouter', subtitle: 'Multi-provider', color: '#6d28d9' },
  { id: 'groq', name: 'Groq', subtitle: 'Fast inference', color: '#f55036' },
  { id: 'xAI', name: 'xAI', subtitle: 'Grok', color: '#1d1d1f' },
  { id: 'mistral', name: 'Mistral', subtitle: 'Mistral AI', color: '#f97316' },
]

const POPULAR_IDS = new Set(POPULAR_PROVIDERS.map(p => p.id.toLowerCase()))
const CUSTOM_COLOR = '#6b7280'

function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = ((hash % 360) + 360) % 360
  return `hsl(${hue}, 55%, 50%)`
}

type AuthStatusMap = Record<string, { configured: boolean; source?: string }>
type TestResult = { ok: boolean; error?: string; latencyMs?: number }

interface ModelInfo {
  provider: string
  id: string
  name: string
  hasAuth: boolean
  reasoning: boolean | null
  contextWindow: number | null
}

interface DeleteTarget {
  type: 'provider' | 'model' | 'auth'
  providerId: string
  providerName: string
  modelId?: string
  modelName?: string
}

interface ProviderSetupProps {
  getProviderAuthStatus: () => Promise<AuthStatusMap>
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeAuth: (provider: string) => Promise<boolean>
  registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<boolean>
  deleteCustomProvider: (provider: string) => Promise<{ ok: boolean; error?: string }>
  removeModelFromProvider: (provider: string, modelId: string) => Promise<{ ok: boolean; error?: string }>
  testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<TestResult>
  getProviderConfig: (provider: string) => Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }>
  listCustomProviders: () => Promise<{ ok: boolean; providers: Record<string, { baseUrl: string; name?: string }> }>
  getAvailableModels?: () => Promise<Array<ModelInfo>>
  onSetModel?: (modelId: string, provider?: string) => Promise<{ success: boolean; error?: string }>
  onAuthChange?: () => void
  currentModel?: { provider: string; id: string } | null
}

function categorizeError(error: string): string {
  if (/401|403/.test(error)) return 'Invalid API key'
  if (/network|fetch|ECONNREFUSED|ENOTFOUND|net::/i.test(error)) return 'Cannot reach server'
  if (/timeout|timed out|ETIMEDOUT/i.test(error)) return 'Connection timed out'
  return error
}

function ProviderIcon({ name, color, size = 'md' }: { name: string; color: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-xs'
  return (
    <span
      className={`${dim} rounded-md text-white font-bold flex items-center justify-center flex-shrink-0`}
      style={{ backgroundColor: color }}
    >
      {name[0]}
    </span>
  )
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
         onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl xi-glass shadow-2xl p-5"
           onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}>
            {confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TestConnectionButton({ providerId, testProvider, apiKeyOverride, baseUrlOverride }: { providerId: string; testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<TestResult>; apiKeyOverride?: string; baseUrlOverride?: string }) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const handleTest = useCallback(async () => {
    setTesting(true)
    setResult(null)
    const overrides: { baseUrl?: string; apiKey?: string } = {}
    if (apiKeyOverride?.trim()) overrides.apiKey = apiKeyOverride.trim()
    if (baseUrlOverride?.trim()) overrides.baseUrl = baseUrlOverride.trim()
    const r = await testProvider(providerId, Object.keys(overrides).length > 0 ? overrides : undefined)
    setTesting(false)
    setResult(r)
    setTimeout(() => setResult(null), 5000)
  }, [providerId, testProvider, apiKeyOverride, baseUrlOverride])

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleTest}
        disabled={testing}
        className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {testing ? 'Testing...' : 'Test'}
      </button>
      {result && (
        <span className={`text-xs font-medium ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
          {result.ok
            ? `Connected (${result.latencyMs ?? 0}ms)`
            : categorizeError(result.error ?? 'Unknown error')}
        </span>
      )}
    </div>
  )
}

function RightPanel({
  providerId,
  providerInfo,
  authStatus,
  models,
  selectedModelKey,
  switchingModel,
  setApiKey,
  removeAuth,
  testProvider,
  onAuthChange,
  onSelectModel,
  onDeleteProvider,
  onRemoveModel,
  providerBaseUrl,
  isCustomProvider,
}: {
  providerId: string
  providerInfo: { name: string; subtitle: string; color: string; configured: boolean; source?: string }
  authStatus: AuthStatusMap
  models: ModelInfo[]
  selectedModelKey: string | null
  switchingModel: boolean
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeAuth: (provider: string) => Promise<boolean>
  testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<TestResult>
  onAuthChange?: () => void
  onSelectModel: (model: ModelInfo) => void
  onDeleteProvider?: (providerId: string, providerName: string) => void
  onRemoveModel?: (providerId: string, modelId: string, modelName: string) => void
  providerBaseUrl?: string
  isCustomProvider: boolean
}) {
  const [apiKey, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingAuth, setRemovingAuth] = useState(false)

  const isConfigured = authStatus[providerId]?.configured ?? false

  useEffect(() => {
    setApiKeyInput('')
    setShowApiKey(false)
  }, [providerId])

  const handleSetApiKey = useCallback(async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    const ok = await setApiKey(providerId, apiKey.trim())
    setSaving(false)
    if (ok) {
      setApiKeyInput('')
      onAuthChange?.()
    }
  }, [providerId, apiKey, setApiKey, onAuthChange])

  const handleClearApiKey = useCallback(async () => {
    setRemovingAuth(true)
    await removeAuth(providerId)
    setRemovingAuth(false)
    onAuthChange?.()
  }, [providerId, removeAuth, onAuthChange])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ProviderIcon name={providerInfo.name} color={providerInfo.color} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900">{providerInfo.name}</div>
          </div>
          {isConfigured && (
            <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full font-medium">OK</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">API Key</label>
            <div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={isConfigured ? 'sk-••••••••' : 'sk-...'}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 pr-9 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSetApiKey() }}
                  />
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {showApiKey
                        ? <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        : <><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>}
                    </svg>
                  </button>
                </div>
              </div>
              {PROVIDER_URLS[providerId] && (
                <a href={PROVIDER_URLS[providerId]} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors mt-2"
                >
                  Get API key from {providerInfo.name}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Model</label>
            {models.length > 0 ? (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="max-h-36 overflow-y-auto divide-y divide-gray-100">
                  {models.map((model) => {
                    const modelKey = `${model.provider}/${model.id}`
                    const isSelected = selectedModelKey === modelKey
                    return (
                      <div key={modelKey} className="group flex items-center">
                        <button
                          onClick={() => onSelectModel(model)}
                          disabled={switchingModel}
                          className={`flex-1 px-3 py-2 text-left text-sm flex items-center gap-3 transition-colors ${
                            isSelected
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-gray-700 hover:bg-gray-50'
                          } disabled:opacity-50`}
                        >
                          <span className={`w-4 h-4 rounded-full flex-shrink-0 border-2 flex items-center justify-center ${
                            isSelected ? 'border-blue-500' : 'border-gray-300'
                          }`}>
                            {isSelected && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                          </span>
                          <span className="flex-1 truncate">{model.name}</span>
                          {switchingModel && isSelected && (
                            <svg className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          )}
                        </button>
                        {isCustomProvider && onRemoveModel && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveModel(providerId, model.id, model.name) }}
                            className="opacity-0 group-hover:opacity-100 mr-2 p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
                            title="Remove model"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">No models available</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleSetApiKey} disabled={!apiKey.trim() || saving}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : isConfigured ? 'Update' : 'Save'}
            </button>
            <TestConnectionButton providerId={providerId} testProvider={testProvider} apiKeyOverride={apiKey || undefined} baseUrlOverride={providerBaseUrl} />
          </div>

          {/* Danger zone */}
          <div className="pt-3 mt-1 border-t border-gray-100">
            {isCustomProvider ? (
              <button
                onClick={() => onDeleteProvider?.(providerId, providerInfo.name)}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                Delete Provider
              </button>
            ) : isConfigured ? (
              <button
                onClick={handleClearApiKey}
                disabled={removingAuth}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {removingAuth ? 'Clearing...' : 'Clear API Key'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function CustomProviderForm({
  editingProviderId,
  editingConfig,
  registerCustomProvider,
  testProvider,
  onAuthChange,
  onDone,
  onSuccess,
}: {
  editingProviderId?: string | null
  editingConfig?: Record<string, unknown> | null
  registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<boolean>
  testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<TestResult>
  onAuthChange?: () => void
  onDone: () => void
  onSuccess: (providerId: string, config: Record<string, unknown>) => void
}) {
  const [customId, setCustomId] = useState('')
  const [customName, setCustomName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [customModelName, setCustomModelName] = useState('')
  const [customReasoning, setCustomReasoning] = useState(false)
  const [customContextWindow, setCustomContextWindow] = useState(128000)
  const [customApi, setCustomApi] = useState('openai-completions')
  const [customSaving, setCustomSaving] = useState(false)
  const [customTestResult, setCustomTestResult] = useState<TestResult | null>(null)
  const [customTesting, setCustomTesting] = useState(false)
  const [registeredProviderId, setRegisteredProviderId] = useState<string | null>(null)

  useEffect(() => {
    if (editingProviderId && editingConfig) {
      const models = editingConfig.models as Array<Record<string, unknown>> | undefined
      const firstModel = models?.[0]
      setCustomId(editingProviderId)
      setCustomName((editingConfig.name as string) ?? '')
      setCustomBaseUrl((editingConfig.baseUrl as string) ?? '')
      setCustomApi((editingConfig.api as string) ?? 'openai-completions')
      setCustomApiKey('')
      setCustomModelId((firstModel?.id as string) ?? '')
      setCustomModelName((firstModel?.name as string) ?? '')
      setCustomReasoning((firstModel?.reasoning as boolean) ?? false)
      setCustomContextWindow((firstModel?.contextWindow as number) ?? 128000)
    }
  }, [editingProviderId, editingConfig])

  const handleSubmit = useCallback(async () => {
    const id = editingProviderId ?? customId.trim()
    if (!id || !customBaseUrl.trim() || !customModelId.trim()) return
    setCustomSaving(true)
    const config: Record<string, unknown> = {
      name: customName.trim() || id,
      baseUrl: customBaseUrl.trim(),
      api: customApi.trim(),
      models: [{
        id: customModelId.trim(),
        name: customModelName.trim() || customModelId.trim(),
        reasoning: customReasoning,
        input: ['text' as const, 'image' as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: customContextWindow,
        maxTokens: customContextWindow,
      }],
    }
    if (customApiKey.trim()) {
      config.apiKey = customApiKey.trim()
    }
    const ok = await registerCustomProvider(id, config)
    setCustomSaving(false)
    if (ok) {
      setRegisteredProviderId(id)
      await onAuthChange?.()
      onSuccess(id, config)
    }
  }, [editingProviderId, customId, customName, customBaseUrl, customApiKey, customModelId, customModelName, customReasoning, customContextWindow, registerCustomProvider, onAuthChange, onSuccess])

  const handleTest = useCallback(async () => {
    const id = editingProviderId ?? customId.trim()
    if (!id || !customBaseUrl.trim()) return
    setCustomTesting(true)
    setCustomTestResult(null)
    const result = await testProvider(id, { baseUrl: customBaseUrl.trim(), apiKey: customApiKey.trim() || undefined })
    setCustomTesting(false)
    setCustomTestResult(result)
  }, [editingProviderId, customId, customBaseUrl, customApiKey, testProvider])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ProviderIcon name="C" color={CUSTOM_COLOR} size="sm" />
          <div className="text-sm font-semibold text-gray-900">
            {editingProviderId ? 'Edit Custom Provider' : 'Add Custom Provider'}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Provider ID</label>
              <input type="text" value={customId} onChange={(e) => setCustomId(e.target.value.replace(/[^a-z0-9-]/g, ''))} placeholder="my-llm" disabled={!!(editingProviderId ?? registeredProviderId)}
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Display name</label>
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="My LLM Server"
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Base URL</label>
            <input type="text" value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)} placeholder="https://api.my-llm.com/v1"
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">API Type</label>
            <select value={customApi} onChange={(e) => setCustomApi(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="openai-completions">OpenAI Compatible (chat/completions)</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
              <option value="google-generative-ai">Google Generative AI</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              API Key {(editingProviderId ?? registeredProviderId) && <span className="text-gray-400 font-normal">(leave empty to keep current)</span>}
            </label>
            <input type="password" value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder="sk-..."
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Model ID</label>
              <input type="text" value={customModelId} onChange={(e) => setCustomModelId(e.target.value)} placeholder="my-model-v1"
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Model name</label>
              <input type="text" value={customModelName} onChange={(e) => setCustomModelName(e.target.value)} placeholder="My Model V1"
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={customReasoning} onChange={(e) => setCustomReasoning(e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              Reasoning
            </label>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-700">Context:</label>
              <input type="number" value={customContextWindow} onChange={(e) => setCustomContextWindow(Number(e.target.value) || 128000)}
                className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={!(editingProviderId ?? registeredProviderId ?? customId.trim()) || !customBaseUrl.trim() || !customModelId.trim() || customSaving}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {customSaving ? ((editingProviderId ?? registeredProviderId) ? 'Updating...' : 'Adding...') : ((editingProviderId ?? registeredProviderId) ? 'Update' : 'Add Provider')}
            </button>
            {((editingProviderId ?? registeredProviderId) || (customId.trim() && customBaseUrl.trim())) && (
              <button
                onClick={handleTest}
                disabled={customTesting}
                className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {customTesting ? 'Testing...' : 'Test'}
              </button>
            )}
            {customTestResult && (
              <span className={`text-sm font-medium ${customTestResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                {customTestResult.ok ? `Connected (${customTestResult.latencyMs ?? 0}ms)` : categorizeError(customTestResult.error ?? 'Unknown error')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ProviderSetup({
  getProviderAuthStatus,
  setApiKey,
  removeAuth,
  registerCustomProvider,
  deleteCustomProvider,
  removeModelFromProvider,
  testProvider,
  getProviderConfig,
  listCustomProviders,
  getAvailableModels,
  onSetModel,
  onAuthChange,
  currentModel,
}: ProviderSetupProps): React.ReactElement {
  const [authStatus, setAuthStatus] = useState<AuthStatusMap>({})
  const [models, setModels] = useState<ModelInfo[]>([])
  const [focusedProvider, setFocusedProvider] = useState<string | null>(null)
  const [switchingModel, setSwitchingModel] = useState(false)
  const [editingCustom, setEditingCustom] = useState<{ providerId: string; config: Record<string, unknown> } | null>(null)
  const [customProviderBaseUrls, setCustomProviderBaseUrls] = useState<Record<string, { baseUrl: string; name?: string }>>({})

  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null)
  const pendingModelKeyRef = useRef<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (pendingModelKeyRef.current) {
      if (currentModel && `${currentModel.provider}/${currentModel.id}` === pendingModelKeyRef.current) {
        pendingModelKeyRef.current = null
      }
      return
    }
    if (currentModel) {
      setSelectedModelKey(`${currentModel.provider}/${currentModel.id}`)
    }
  }, [currentModel])

  const hasModelsSupport = !!(getAvailableModels && onSetModel)

  const refreshAuth = useCallback(async () => {
    const status = await getProviderAuthStatus()
    setAuthStatus(status)
  }, [getProviderAuthStatus])

  const refreshModels = useCallback(async () => {
    if (!getAvailableModels) return
    const result = await getAvailableModels()
    setModels(result)
  }, [getAvailableModels])

  const refreshCustomProviders = useCallback(async () => {
    const result = await listCustomProviders()
    if (result.ok) {
      setCustomProviderBaseUrls(result.providers)
    }
  }, [listCustomProviders])

  useEffect(() => {
    refreshAuth()
  }, [refreshAuth])

  useEffect(() => {
    refreshCustomProviders()
  }, [refreshCustomProviders])

  useEffect(() => {
    if (hasModelsSupport) {
      refreshModels()
    }
  }, [hasModelsSupport, refreshModels])

  const customProvidersList = useMemo(() => {
    return Object.entries(authStatus)
      .filter(([id]) => id in customProviderBaseUrls)
      .map(([id, s]) => ({ id, name: customProviderBaseUrls[id]?.name || id, subtitle: 'Custom', configured: s.configured, source: s.source, color: stringToColor(id) }))
  }, [authStatus, customProviderBaseUrls])

  const otherProvidersList = useMemo(() => {
    return Object.entries(authStatus)
      .filter(([id]) => !POPULAR_IDS.has(id.toLowerCase()) && !(id in customProviderBaseUrls))
      .map(([id, s]) => ({ id, name: id, subtitle: 'Other', configured: s.configured, source: s.source, color: stringToColor(id) }))
  }, [authStatus, customProviderBaseUrls])

  const handleSelectModel = useCallback(async (model: ModelInfo) => {
    const modelKey = `${model.provider}/${model.id}`
    setSelectedModelKey(modelKey)
    pendingModelKeyRef.current = modelKey
    setFocusedProvider(model.provider)
    setSwitchingModel(true)
    try {
      await onSetModel?.(model.id, model.provider)
    } catch {
      setSelectedModelKey(null)
      pendingModelKeyRef.current = null
    }
    setSwitchingModel(false)
  }, [onSetModel])

  const handleAuthChange = useCallback(async () => {
    await refreshAuth()
    onAuthChange?.()
    if (hasModelsSupport) {
      refreshModels()
    }
  }, [refreshAuth, onAuthChange, hasModelsSupport, refreshModels])

  const handleEditCustom = useCallback((providerId: string, config: Record<string, unknown>) => {
    setEditingCustom({ providerId, config })
    setFocusedProvider('__custom__')
  }, [])

  const handleCustomProviderSuccess = useCallback(async (providerId: string, config: Record<string, unknown>) => {
    setCustomProviderBaseUrls(prev => ({ ...prev, [providerId]: { baseUrl: (config.baseUrl as string) ?? '', name: (config.name as string) ?? providerId } }))
    if (hasModelsSupport && (!currentModel || (currentModel.provider === 'unknown' && currentModel.id === 'unknown'))) {
      try {
        const availableModels = await getAvailableModels?.()
        if (availableModels && availableModels.length > 0) {
          const match = availableModels.find(m => m.provider === providerId) ?? availableModels[0]
          await onSetModel?.(match.id, match.provider)
        }
      } catch {}
    }
  }, [hasModelsSupport, currentModel, getAvailableModels, onSetModel])

  const handleDeleteProvider = useCallback((providerId: string, providerName: string) => {
    setDeleteTarget({ type: 'provider', providerId, providerName })
  }, [])

  const handleRemoveModel = useCallback((providerId: string, modelId: string, modelName: string) => {
    const providerName = customProviderBaseUrls[providerId]?.name || providerId
    setDeleteTarget({ type: 'model', providerId, providerName, modelId, modelName })
  }, [customProviderBaseUrls])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.type === 'provider') {
        const result = await deleteCustomProvider(deleteTarget.providerId)
        if (result.ok) {
          if (focusedProvider === deleteTarget.providerId) {
            setFocusedProvider(null)
            setEditingCustom(null)
          }
          await refreshAuth()
          await refreshCustomProviders()
          if (hasModelsSupport) {
            await refreshModels()
          }
          onAuthChange?.()
        }
      } else if (deleteTarget.type === 'model' && deleteTarget.modelId) {
        const result = await removeModelFromProvider(deleteTarget.providerId, deleteTarget.modelId)
        if (result.ok) {
          await refreshAuth()
          await refreshCustomProviders()
          if (hasModelsSupport) {
            await refreshModels()
          }
          onAuthChange?.()
        }
      }
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, focusedProvider, deleteCustomProvider, removeModelFromProvider, refreshAuth, refreshCustomProviders, hasModelsSupport, refreshModels, onAuthChange])

  const popularProvidersList = useMemo(() => {
    const authLower: Record<string, { configured: boolean; source?: string }> = {}
    for (const [k, v] of Object.entries(authStatus)) {
      authLower[k.toLowerCase()] = v
    }
    return POPULAR_PROVIDERS.map(p => ({
      id: p.id,
      name: p.name,
      subtitle: p.subtitle,
      color: p.color,
      configured: authLower[p.id.toLowerCase()]?.configured ?? false,
      source: authLower[p.id.toLowerCase()]?.source,
    }))
  }, [authStatus])

  const allProviders = useMemo(() => {
    return [...customProvidersList, ...popularProvidersList, ...otherProvidersList]
  }, [customProvidersList, popularProvidersList, otherProvidersList])

  const focusedModels = useMemo(() => {
    if (!focusedProvider) return []
    return models.filter(m => m.provider === focusedProvider)
  }, [models, focusedProvider])

  const focusedProviderInfo = useMemo(() => {
    if (!focusedProvider) return null
    return allProviders.find(p => p.id === focusedProvider) ?? { id: focusedProvider, name: focusedProvider, subtitle: 'Custom', color: stringToColor(focusedProvider), configured: false }
  }, [allProviders, focusedProvider])

  const effectiveFocusedProvider = focusedProvider
  const isFocusedCustomProvider = effectiveFocusedProvider ? effectiveFocusedProvider in customProviderBaseUrls : false

  return (
    <div className="flex w-full rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="w-52 flex-shrink-0 border-r border-gray-100 flex flex-col max-h-[26rem]">
        <div className="px-3 py-2.5 border-b border-gray-100">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Providers</span>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {customProvidersList.map((p) => {
            const isFocused = effectiveFocusedProvider === p.id
            return (
              <button
                key={p.id}
                onClick={() => {
                  setFocusedProvider(p.id)
                  getProviderConfig(p.id).then(result => {
                    if (result.ok && result.config) {
                      setEditingCustom({ providerId: p.id, config: result.config })
                    } else {
                      setEditingCustom(null)
                    }
                  })
                }}
                className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-all group ${
                  isFocused
                    ? 'bg-blue-50 border border-blue-200'
                    : 'border border-transparent hover:bg-gray-50'
                }`}
              >
                <ProviderIcon name={p.name} color={p.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{p.name}</div>
                </div>
                {/* Delete button for custom providers - visible on hover */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteProvider(p.id, p.name) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
                  title="Delete provider"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                {p.configured ? (
                  <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : isFocused ? (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-blue-500 flex-shrink-0 flex items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  </span>
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                )}
              </button>
            )
          })}
          <button
            onClick={() => { setFocusedProvider('__custom__'); setEditingCustom(null) }}
            className={`w-full flex items-center justify-center gap-1 rounded-md border-2 border-dashed px-2.5 py-1.5 text-sm font-medium transition-colors ${
              effectiveFocusedProvider === '__custom__' && !editingCustom
                ? 'border-blue-300 text-blue-600 bg-blue-50'
                : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Custom
          </button>
          {popularProvidersList.length > 0 && <div className="border-t border-gray-200 my-1.5" />}
          {popularProvidersList.map((p) => {
            const isFocused = effectiveFocusedProvider === p.id
            return (
              <button
                key={p.id}
                onClick={() => { setFocusedProvider(p.id); setEditingCustom(null) }}
                className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-all ${
                  isFocused
                    ? 'bg-blue-50 border border-blue-200'
                    : 'border border-transparent hover:bg-gray-50'
                }`}
              >
                <ProviderIcon name={p.name} color={p.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{p.name}</div>
                </div>
                {p.configured ? (
                  <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : isFocused ? (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-blue-500 flex-shrink-0 flex items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  </span>
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                )}
              </button>
            )
          })}
          {otherProvidersList.length > 0 && <div className="border-t border-gray-200 my-1.5" />}
          {otherProvidersList.map((p) => {
            const isFocused = effectiveFocusedProvider === p.id
            return (
              <button
                key={p.id}
                onClick={() => { setFocusedProvider(p.id); setEditingCustom(null) }}
                className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-all ${
                  isFocused
                    ? 'bg-blue-50 border border-blue-200'
                    : 'border border-transparent hover:bg-gray-50'
                }`}
              >
                <ProviderIcon name={p.name} color={p.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{p.name}</div>
                </div>
                {p.configured ? (
                  <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : isFocused ? (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-blue-500 flex-shrink-0 flex items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  </span>
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 max-h-[26rem]">
        {effectiveFocusedProvider === '__custom__' || editingCustom ? (
          <CustomProviderForm
            editingProviderId={editingCustom?.providerId}
            editingConfig={editingCustom?.config}
            registerCustomProvider={registerCustomProvider}
            testProvider={testProvider}
            onAuthChange={handleAuthChange}
            onDone={() => { setEditingCustom(null); setFocusedProvider(null) }}
            onSuccess={handleCustomProviderSuccess}
          />
        ) : focusedProvider && focusedProviderInfo ? (
          <RightPanel
            providerId={focusedProvider}
            providerInfo={focusedProviderInfo}
            authStatus={authStatus}
            models={focusedModels}
            selectedModelKey={selectedModelKey}
            switchingModel={switchingModel}
            setApiKey={setApiKey}
            removeAuth={removeAuth}
            testProvider={testProvider}
            onAuthChange={handleAuthChange}
            onSelectModel={handleSelectModel}
            onDeleteProvider={handleDeleteProvider}
            onRemoveModel={handleRemoveModel}
            providerBaseUrl={customProviderBaseUrls[focusedProvider]?.baseUrl}
            isCustomProvider={isFocusedCustomProvider}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
                </svg>
              </div>
              <p className="text-sm text-gray-400">Select a provider to configure</p>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <ConfirmDialog
          title={
            deleteTarget.type === 'provider'
              ? 'Delete Provider'
              : 'Remove Model'
          }
          message={
            deleteTarget.type === 'provider'
              ? `Are you sure you want to delete "${deleteTarget.providerName}"? This will remove the provider and all its models. This action cannot be undone.`
              : `Are you sure you want to remove model "${deleteTarget.modelName}" from "${deleteTarget.providerName}"?`
          }
          confirmLabel={
            deleteTarget.type === 'provider'
              ? 'Delete Provider'
              : 'Remove Model'
          }
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Deleting overlay */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="rounded-lg bg-gray-50 px-4 py-3 shadow-xl flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-gray-700">
              {deleteTarget?.type === 'provider' ? 'Deleting provider...' : 'Removing model...'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProviderSetup

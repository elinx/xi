import { useState, useEffect, useCallback } from 'react'
import ProviderSetup from './ProviderSetup'

type AuthStatusMap = Record<string, { configured: boolean; source?: string }>

interface WelcomeDialogProps {
  getProviderAuthStatus: () => Promise<AuthStatusMap>
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeAuth: (provider: string) => Promise<boolean>
  registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<boolean>
  testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>
  getProviderConfig: (provider: string) => Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }>
  getAvailableModels?: () => Promise<Array<{ provider: string; id: string; name: string; hasAuth: boolean; reasoning: boolean | null; contextWindow: number | null }>>
  onSetModel?: (modelId: string, provider?: string) => Promise<boolean>
  onAuthChange?: () => void
  onSkip: () => void
}

function WelcomeDialog({ getProviderAuthStatus, setApiKey, removeAuth, registerCustomProvider, testProvider, getProviderConfig, getAvailableModels, onSetModel, onAuthChange, onSkip }: WelcomeDialogProps): React.ReactElement {
  const [showSetup, setShowSetup] = useState(false)
  const [hasConfiguredProvider, setHasConfiguredProvider] = useState(false)

  const refreshHasConfigured = useCallback(() => {
    getProviderAuthStatus().then((status) => {
      setHasConfiguredProvider(Object.values(status).some(s => s.configured))
    })
  }, [getProviderAuthStatus])

  useEffect(() => {
    if (showSetup) {
      refreshHasConfigured()
    }
  }, [showSetup, refreshHasConfigured])

  const handleAuthChange = useCallback(() => {
    refreshHasConfigured()
    onAuthChange?.()
  }, [refreshHasConfigured, onAuthChange])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(!showSetup || hasConfiguredProvider) ? onSkip : undefined}>
      <div className="w-full max-w-3xl max-h-[85vh] rounded-2xl bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        {!showSetup ? (
          <div className="px-8 py-10 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
              <span className="text-3xl text-gray-700" style={{ fontFamily: 'Georgia, serif' }}>ξ</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Welcome to Xi</h1>
            <p className="mt-2 text-sm text-gray-500">Configure an AI provider to get started</p>
            <p className="mt-3 text-xs text-gray-400 leading-relaxed max-w-xs mx-auto">
              Xi needs an API key from an AI provider to work. Choose a provider below or add a custom one.
            </p>
            <div className="mt-8 flex flex-col items-center gap-2.5">
              <button
                onClick={() => setShowSetup(true)}
                className="rounded-lg bg-blue-600 px-8 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
              >
                Get Started
              </button>
              <button
                onClick={onSkip}
                className="rounded-lg px-4 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-6 py-5 flex-shrink-0">
              <h2 className="text-sm font-semibold text-gray-900">Configure Providers</h2>
              <button
                onClick={() => {
                  if (hasConfiguredProvider) {
                    onSkip()
                  } else {
                    setShowSetup(false)
                  }
                }}
                className="rounded p-1 text-gray-400 hover:text-gray-600 transition-colors"
                title={hasConfiguredProvider ? 'Done' : 'Back'}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 overflow-y-auto">
              <ProviderSetup
                getProviderAuthStatus={getProviderAuthStatus}
                setApiKey={setApiKey}
                removeAuth={removeAuth}
                registerCustomProvider={registerCustomProvider}
                testProvider={testProvider}
                getProviderConfig={getProviderConfig}
                getAvailableModels={getAvailableModels}
                onSetModel={onSetModel}
                onAuthChange={handleAuthChange}
              />
            </div>
            {hasConfiguredProvider && (
              <div className="px-6 py-4 flex-shrink-0 border-t border-gray-100">
                <button
                  onClick={onSkip}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
                >
                  Start Using Xi
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default WelcomeDialog

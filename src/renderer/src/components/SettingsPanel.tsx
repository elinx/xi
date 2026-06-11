import { useState } from 'react'
import ProviderSetup from './ProviderSetup'
import GeneralSettings from './GeneralSettings'

type SettingsSection = 'providers' | 'general'

type AuthStatusMap = Record<string, { configured: boolean; source?: string }>

interface SettingsPanelProps {
  onOpenConfigDir: () => void
  getProviderAuthStatus: () => Promise<AuthStatusMap>
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeAuth: (provider: string) => Promise<boolean>
  registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<boolean>
  testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>
  getProviderConfig: (provider: string) => Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }>
  listCustomProviders: () => Promise<{ ok: boolean; providers: Record<string, { baseUrl: string; name?: string }> }>
  getAvailableModels?: () => Promise<Array<{ provider: string; id: string; name: string; hasAuth: boolean; reasoning: boolean | null; contextWindow: number | null }>>
  onSetModel?: (modelId: string, provider?: string) => Promise<{ success: boolean; error?: string }>
  onAuthChange?: () => void
  currentModel?: { provider: string; id: string } | null
}

function SettingsPanel({
  onOpenConfigDir,
  getProviderAuthStatus,
  setApiKey,
  removeAuth,
  registerCustomProvider,
  testProvider,
  getProviderConfig,
  listCustomProviders,
  getAvailableModels,
  onSetModel,
  onAuthChange,
  currentModel,
}: SettingsPanelProps): React.ReactElement {
  const [showProviderDialog, setShowProviderDialog] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <button
          onClick={() => setShowProviderDialog(true)}
          className="rounded-md px-3 py-1.5 text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          Providers
        </button>
        <button
          className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-400 dark:text-gray-500"
        >
          General
        </button>
        <div className="flex-1" />
        <button
          onClick={onOpenConfigDir}
          className="rounded-md p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Open config directory"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <GeneralSettings />
      </div>

      {showProviderDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowProviderDialog(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] rounded-2xl bg-white dark:bg-gray-800 shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-gray-100 dark:border-gray-700/50">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Configure Providers</h2>
              <button
                onClick={() => setShowProviderDialog(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              <ProviderSetup
                getProviderAuthStatus={getProviderAuthStatus}
                setApiKey={setApiKey}
                removeAuth={removeAuth}
                registerCustomProvider={registerCustomProvider}
                testProvider={testProvider}
                getProviderConfig={getProviderConfig}
                listCustomProviders={listCustomProviders}
                getAvailableModels={getAvailableModels}
                onSetModel={onSetModel}
                onAuthChange={onAuthChange}
                currentModel={currentModel}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsPanel

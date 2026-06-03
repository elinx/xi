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
  onAuthChange?: () => void
}

const sections: { id: SettingsSection; label: string; icon: JSX.Element }[] = [
  {
    id: 'providers',
    label: 'Providers',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
      </svg>
    ),
  },
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

function SettingsPanel({
  onOpenConfigDir,
  getProviderAuthStatus,
  setApiKey,
  removeAuth,
  registerCustomProvider,
  testProvider,
  getProviderConfig,
  onAuthChange,
}: SettingsPanelProps): React.ReactElement {
  const [activeSection, setActiveSection] = useState<SettingsSection>('providers')

  return (
    <div className="flex h-full">
      <div className="w-48 flex-shrink-0 border-r border-gray-200 bg-gray-50/80 flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Settings</span>
          <button
            onClick={onOpenConfigDir}
            className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Open config directory"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 py-1">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors ${
                activeSection === s.id
                  ? 'bg-white text-gray-900 border-r-2 border-blue-500'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-4">
          {activeSection === 'providers' ? (
            <ProviderSetup
              getProviderAuthStatus={getProviderAuthStatus}
              setApiKey={setApiKey}
              removeAuth={removeAuth}
              registerCustomProvider={registerCustomProvider}
              testProvider={testProvider}
            getProviderConfig={getProviderConfig}
              onAuthChange={onAuthChange}
            />
          ) : (
            <GeneralSettings />
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel

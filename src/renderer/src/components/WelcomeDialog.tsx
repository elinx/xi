import { useState } from 'react'
import ProviderSetup from './ProviderSetup'

type AuthStatusMap = Record<string, { configured: boolean; source?: string }>

interface WelcomeDialogProps {
  getProviderAuthStatus: () => Promise<AuthStatusMap>
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeAuth: (provider: string) => Promise<boolean>
  registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<boolean>
  onAuthChange?: () => void
  onSkip: () => void
}

function WelcomeDialog({ getProviderAuthStatus, setApiKey, removeAuth, registerCustomProvider, onAuthChange, onSkip }: WelcomeDialogProps): React.ReactElement {
  const [showSetup, setShowSetup] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
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
            <div className="mt-8 flex flex-col gap-2.5">
              <button
                onClick={() => setShowSetup(true)}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
              >
                Get Started
              </button>
              <button
                onClick={onSkip}
                className="rounded-lg px-4 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-gray-900">Configure Providers</h2>
              <button
                onClick={() => setShowSetup(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ProviderSetup
              getProviderAuthStatus={getProviderAuthStatus}
              setApiKey={setApiKey}
              removeAuth={removeAuth}
              registerCustomProvider={registerCustomProvider}
              onAuthChange={onAuthChange}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default WelcomeDialog

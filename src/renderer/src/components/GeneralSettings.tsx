import { useState, useEffect } from 'react'

type Theme = 'system' | 'light' | 'dark'
type StartupSession = 'last' | 'main'

function GeneralSettings(): React.ReactElement {
  const [fontSize, setFontSize] = useState(() => {
    return Number(localStorage.getItem('xi-settings-font-size')) || 14
  })
  const [defaultModel, setDefaultModel] = useState(() => {
    return localStorage.getItem('xi-settings-default-model') || ''
  })
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('xi-settings-theme') as Theme) || 'system'
  })
  const [startupSession, setStartupSession] = useState<StartupSession>(() => {
    return (localStorage.getItem('xi-settings-startup-session') as StartupSession) || 'last'
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--xi-font-size', `${fontSize}px`)
  }, [fontSize])

  const handleFontSizeChange = (value: number) => {
    const clamped = Math.min(24, Math.max(10, value))
    setFontSize(clamped)
    localStorage.setItem('xi-settings-font-size', String(clamped))
    document.documentElement.style.setProperty('--xi-font-size', `${clamped}px`)
  }

  const handleDefaultModelChange = (value: string) => {
    setDefaultModel(value)
    localStorage.setItem('xi-settings-default-model', value)
  }

  const handleThemeChange = (value: Theme) => {
    setTheme(value)
    localStorage.setItem('xi-settings-theme', value)
  }

  const handleStartupSessionChange = (value: StartupSession) => {
    setStartupSession(value)
    localStorage.setItem('xi-settings-startup-session', value)
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Editor</h3>
        <div className="flex items-center justify-between h-9">
          <span className="text-xs text-gray-700">Font Size</span>
          <input
            type="number"
            min={10}
            max={24}
            step={1}
            value={fontSize}
            onChange={(e) => handleFontSizeChange(Number(e.target.value))}
            className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">AI</h3>
        <div className="flex items-center justify-between h-9">
          <span className="text-xs text-gray-700">Default Model</span>
          <input
            type="text"
            value={defaultModel}
            onChange={(e) => handleDefaultModelChange(e.target.value)}
            placeholder="e.g. claude-3-5-sonnet-20241022"
            className="w-full max-w-[180px] rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div className="flex items-center justify-between h-9">
          <span className="text-xs text-gray-700">Startup Session</span>
          <select
            value={startupSession}
            onChange={(e) => handleStartupSessionChange(e.target.value as StartupSession)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="last">Last Session</option>
            <option value="main">Main Session</option>
          </select>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Appearance</h3>
        <div className="flex items-center justify-between h-9">
          <span className="text-xs text-gray-700">Theme</span>
          <div className="flex items-center gap-2">
            <select
              value={theme}
              onChange={(e) => handleThemeChange(e.target.value as Theme)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <span className="text-[10px] text-gray-400">Dark theme coming soon</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GeneralSettings

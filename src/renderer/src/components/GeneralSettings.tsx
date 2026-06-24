import { useState, useEffect } from 'react'
import { DEFAULT_SUMMARY_PROMPT } from '../../../shared/summary-prompt'
import { useTheme, type Theme } from '../hooks/useTheme'

type StartupSession = 'last' | 'main'

interface GeneralSettingsProps {
  captureEnabled?: boolean
  setCaptureEnabled?: (enabled: boolean) => Promise<boolean>
  clearSnapshots?: () => Promise<number>
  getCaptureStatus?: () => Promise<{ enabled: boolean; snapshotCount: number }>
  onSkillsSettingsChanged?: () => void
}

function GeneralSettings({ captureEnabled, setCaptureEnabled, clearSnapshots, getCaptureStatus, onSkillsSettingsChanged }: GeneralSettingsProps): React.ReactElement {
  const [fontSize, setFontSize] = useState(() => {
    return Number(localStorage.getItem('xi-settings-font-size')) || 14
  })
  const [defaultModel, setDefaultModel] = useState(() => {
    return localStorage.getItem('xi-settings-default-model') || ''
  })
  const { theme, setTheme } = useTheme()
  const [startupSession, setStartupSession] = useState<StartupSession>(() => {
    return (localStorage.getItem('xi-settings-startup-session') as StartupSession) || 'last'
  })
  const [workerIdleTimeout, setWorkerIdleTimeout] = useState(() => {
    return Number(localStorage.getItem('xi-settings-worker-idle-timeout')) || 5
  })
  const [workerMaxSecondaries, setWorkerMaxSecondaries] = useState(() => {
    return Number(localStorage.getItem('xi-settings-worker-max-secondaries')) || 8
  })
  const [isCaptureOn, setIsCaptureOn] = useState(false)
  const [snapshotCount, setSnapshotCount] = useState(0)
  const [clearing, setClearing] = useState(false)
  const [summaryPrompt, setSummaryPrompt] = useState(() => {
    return localStorage.getItem('xi-settings-summary-prompt') || ''
  })

  // Skill sources state
  const [harnessDirs, setHarnessDirs] = useState<Array<{ id: string; label: string; dir: string; skillCount: number }>>([])
  const [enabledHarnessIds, setEnabledHarnessIds] = useState<Set<string>>(new Set())
  const [skillSettingsLoading, setSkillSettingsLoading] = useState(true)
  const [skillSettingsSaving, setSkillSettingsSaving] = useState(false)

  // Load harness dirs + current settings on mount
  useEffect(() => {
    Promise.all([
      window.api.skillsDiscoverHarnessDirs(),
      window.api.skillsGetSettings(),
    ]).then(([dirsResult, settingsResult]) => {
      if (dirsResult.ok && dirsResult.data) setHarnessDirs(dirsResult.data)
      if (settingsResult.ok && settingsResult.data) {
        const paths = settingsResult.data.skillsPaths
        // Map paths back to harness IDs
        const enabledIds = new Set<string>()
        for (const dir of dirsResult.data ?? []) {
          if (paths.some(p => p.includes(`/.${dir.id}/skills`))) {
            enabledIds.add(dir.id)
          }
        }
        setEnabledHarnessIds(enabledIds)
      }
      setSkillSettingsLoading(false)
    }).catch(() => {
      setSkillSettingsLoading(false)
    })
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--xi-font-size', `${fontSize}px`)
  }, [fontSize])

  useEffect(() => {
    // On mount, query the actual worker state (workers bootstrap from settings.json)
    getCaptureStatus?.().then((status) => {
      setIsCaptureOn(status.enabled)
      setSnapshotCount(status.snapshotCount)
    })
  }, [])

  useEffect(() => {
    if (!isCaptureOn) return
    const interval = setInterval(() => {
      getCaptureStatus?.().then(status => setSnapshotCount(status.snapshotCount))
    }, 5000)
    return () => clearInterval(interval)
  }, [isCaptureOn, getCaptureStatus])

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
  }

  const handleStartupSessionChange = (value: StartupSession) => {
    setStartupSession(value)
    localStorage.setItem('xi-settings-startup-session', value)
  }

  const handleWorkerIdleTimeoutChange = (value: number) => {
    const clamped = Math.min(120, Math.max(1, value))
    setWorkerIdleTimeout(clamped)
    localStorage.setItem('xi-settings-worker-idle-timeout', String(clamped))
    const apiWithWorker = window.api as typeof window.api & { workerSetIdleTimeout?: (m: number) => Promise<{ ok: boolean }> }
    apiWithWorker.workerSetIdleTimeout?.(clamped)
  }

  const handleWorkerMaxSecondariesChange = (value: number) => {
    const clamped = Math.min(16, Math.max(1, value))
    setWorkerMaxSecondaries(clamped)
    localStorage.setItem('xi-settings-worker-max-secondaries', String(clamped))
    const apiWithWorker = window.api as typeof window.api & { workerSetMaxSecondaries?: (n: number) => Promise<{ ok: boolean }> }
    apiWithWorker.workerSetMaxSecondaries?.(clamped)
  }

  useEffect(() => {
    const apiWithWorker = window.api as typeof window.api & {
      workerSetIdleTimeout?: (m: number) => Promise<{ ok: boolean }>
      workerSetMaxSecondaries?: (n: number) => Promise<{ ok: boolean }>
    }
    apiWithWorker.workerSetIdleTimeout?.(workerIdleTimeout)
    apiWithWorker.workerSetMaxSecondaries?.(workerMaxSecondaries)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleHarnessToggle = async (harnessId: string) => {
    const next = new Set(enabledHarnessIds)
    if (next.has(harnessId)) {
      next.delete(harnessId)
    } else {
      next.add(harnessId)
    }
    setEnabledHarnessIds(next)
    setSkillSettingsSaving(true)

    // Build the skills paths array from enabled harnesses
    const skillsPaths = harnessDirs
      .filter(h => next.has(h.id))
      .map(h => h.dir)

    try {
      await window.api.skillsUpdateSettings(skillsPaths)
      onSkillsSettingsChanged?.()
    } catch {}
    setSkillSettingsSaving(false)
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
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Summary</h3>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-gray-700">Summary Prompt</span>
              <span className="text-[10px] text-gray-400">Used by /summary and mark-completed. Empty = default.</span>
            </div>
            <button
              onClick={() => {
                setSummaryPrompt('')
                localStorage.removeItem('xi-settings-summary-prompt')
              }}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              Reset to default
            </button>
          </div>
          <textarea
            value={summaryPrompt}
            onChange={(e) => {
              setSummaryPrompt(e.target.value)
              if (e.target.value.trim()) {
                localStorage.setItem('xi-settings-summary-prompt', e.target.value)
              } else {
                localStorage.removeItem('xi-settings-summary-prompt')
              }
            }}
            placeholder={DEFAULT_SUMMARY_PROMPT}
            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-300 resize-y min-h-[100px] focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
          />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Workers</h3>
        <div className="flex items-center justify-between h-9">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-700">Idle Timeout</span>
            <span className="text-[10px] text-gray-400">min</span>
          </div>
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={workerIdleTimeout}
            onChange={(e) => handleWorkerIdleTimeoutChange(Number(e.target.value))}
            className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div className="flex items-center justify-between h-9">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-700">Max Workers</span>
            <span className="text-[10px] text-gray-400">excluding primary, ~150MB each</span>
          </div>
          <input
            type="number"
            min={1}
            max={16}
            step={1}
            value={workerMaxSecondaries}
            onChange={(e) => handleWorkerMaxSecondariesChange(Number(e.target.value))}
            className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Skill Sources</h3>
        {skillSettingsLoading ? (
          <div className="text-xs text-gray-400 py-2">Loading...</div>
        ) : harnessDirs.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">
            No other agent tool skill directories found on this machine.
            <br />
            <span className="text-[10px]">
              Detected paths: ~/.claude/skills, ~/.codex/skills, ~/.opencode/skills, ~/.config/opencode/skills, ~/.agents/skills
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {harnessDirs.map(harness => (
              <div key={harness.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleHarnessToggle(harness.id)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                      enabledHarnessIds.has(harness.id) ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                    disabled={skillSettingsSaving}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                        enabledHarnessIds.has(harness.id) ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>
                  <div>
                    <span className="text-xs text-gray-700">{harness.label}</span>
                    <span className="text-[10px] text-gray-400 ml-1.5">{harness.skillCount} skill{harness.skillCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <span className="text-[10px] text-gray-400 font-mono truncate max-w-[50%]" title={harness.dir}>
                  {harness.dir.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')}
                </span>
              </div>
            ))}
            {skillSettingsSaving && (
              <div className="text-[10px] text-blue-500">Saving & reloading...</div>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Debug</h3>
        <div className="flex items-center justify-between h-9">
          <div className="flex flex-col">
            <span className="text-xs text-gray-700">Prompt Capture</span>
            <span className="text-[10px] text-gray-400">
              Record full API request payloads for debugging.
              Payloads may contain sensitive data. Stored locally only.
            </span>
          </div>
          <button
            onClick={async () => {
              const next = !isCaptureOn
              setIsCaptureOn(next)
              await setCaptureEnabled?.(next)
              if (next) {
                const status = await getCaptureStatus?.()
                if (status) setSnapshotCount(status.snapshotCount)
              }
            }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
              isCaptureOn ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                isCaptureOn ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
        </div>
        <div className="flex items-center justify-between h-8 mt-1">
          <span className="text-[10px] text-gray-400">
            Status: {isCaptureOn ? 'ON' : 'OFF'} · {snapshotCount} snapshot{snapshotCount !== 1 ? 's' : ''} stored
          </span>
          {snapshotCount > 0 && (
            <button
              onClick={async () => {
                setClearing(true)
                const deleted = await clearSnapshots?.() ?? 0
                if (deleted > 0) setSnapshotCount(0)
                setClearing(false)
              }}
              disabled={clearing}
              className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-40"
            >
              {clearing ? 'Clearing...' : 'Clear all snapshots'}
            </button>
          )}
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
          </div>
        </div>
      </div>
    </div>
  )
}

export default GeneralSettings

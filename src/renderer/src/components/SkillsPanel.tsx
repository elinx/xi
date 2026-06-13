import { useState, useEffect, useMemo } from 'react'
import { useSkillStore, HARNESS_CONFIG, SCOPE_CONFIG, normalizeHarness, type SkillInfo } from '../hooks/useSkillStore'
import type { SkillDiagnostic } from '../hooks/useSkillStore'

interface SkillsPanelProps {
  onInvokeSkill?: (name: string) => void
}

function ScopeLabel({ scope }: { scope: string }) {
  const config = SCOPE_CONFIG[scope] ?? { label: scope, className: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}

function DiagnosticsDialog({ diagnostics, onClose }: { diagnostics: SkillDiagnostic[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[60vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-800">Skill Diagnostics</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {diagnostics.map((d, i) => (
            <div key={i} className={`p-2 rounded text-xs ${
              d.type === 'error' ? 'bg-red-50 text-red-700' :
              d.type === 'collision' ? 'bg-amber-50 text-amber-700' :
              'bg-yellow-50 text-yellow-700'
            }`}>
              <div className="flex items-center gap-1">
                <span className="font-medium uppercase text-[10px]">{d.type}</span>
                {d.path && <span className="text-[10px] opacity-60 truncate">{d.path}</span>}
              </div>
              <div className="mt-0.5">{d.message}</div>
              {d.collision && (
                <div className="mt-1 text-[10px] opacity-70">
                  Winner: {d.collision.winnerPath}<br />
                  Loser: {d.collision.loserPath}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function SkillsPanel({ onInvokeSkill }: SkillsPanelProps) {
  const {
    skills, diagnostics, loading, error,
    expandedSkill, skillDetail, detailLoading,
    fetchSkills, expandSkill,
  } = useSkillStore()

  const [showDiagnostics, setShowDiagnostics] = useState(false)
  // Track which harness groups are collapsed
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  useEffect(() => { fetchSkills() }, [fetchSkills])

  // Group skills by normalized harness
  const groups = useMemo(() => {
    const map = new Map<string, SkillInfo[]>()
    for (const skill of skills) {
      const key = normalizeHarness(skill.harness)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(skill)
    }
    // Sort groups by order
    const sorted = [...map.entries()].sort((a, b) => {
      const orderA = HARNESS_CONFIG[a[0]]?.order ?? 99
      const orderB = HARNESS_CONFIG[b[1]]?.order ?? 99
      return orderA - orderB
    })
    return sorted
  }, [skills])

  const toggleGroup = (harness: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(harness)) next.delete(harness)
      else next.add(harness)
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
    const isWorkerError = error.includes('Worker not connected')
    return (
      <div className={`p-3 text-xs ${isWorkerError ? 'text-gray-400' : 'text-red-500'}`}>
        <div className={`font-medium mb-1 ${isWorkerError ? 'text-gray-500' : ''}`}>
          {isWorkerError ? 'Waiting for worker...' : 'Failed to load skills'}
        </div>
        {!isWorkerError && <div className="text-red-400">{error}</div>}
        <button
          onClick={fetchSkills}
          className={`mt-2 ${isWorkerError ? 'text-gray-500 hover:text-gray-600' : 'text-blue-500 hover:text-blue-600'}`}
        >
          Retry
        </button>
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-400 leading-relaxed">
        <div className="font-medium text-gray-500 mb-2">No skills found.</div>
        <div className="space-y-1">
          <div>Add skills via:</div>
          <div className="ml-2 font-mono text-[11px]">~/.xi/skills/ <span className="font-sans text-gray-400">(global)</span></div>
          <div className="ml-2 font-mono text-[11px]">.pi/skills/ <span className="font-sans text-gray-400">(project)</span></div>
          <div className="ml-2 font-mono text-[11px]">settings.json <span className="font-sans text-gray-400">"skills" array</span></div>
        </div>
        <div className="mt-3 space-y-1">
          <div>Or import from other tools:</div>
          <div className="ml-2 font-mono text-[11px]">~/.claude/skills <span className="font-sans text-gray-400">(Claude Code)</span></div>
          <div className="ml-2 font-mono text-[11px]">~/.codex/skills <span className="font-sans text-gray-400">(Codex)</span></div>
          <div className="ml-2 font-mono text-[11px]">~/.config/opencode/skills <span className="font-sans text-gray-400">(OpenCode)</span></div>
        </div>
        <button
          onClick={fetchSkills}
          className="mt-3 text-blue-500 hover:text-blue-600"
        >
          Refresh
        </button>
        <button
          onClick={() => {
            import('../hooks/useTabStore').then(({ useTabStore, SETTINGS_TAB_ID }) => {
              useTabStore.getState().setActiveTab(SETTINGS_TAB_ID)
            })
          }}
          className="block mt-2 text-blue-500 hover:text-blue-600"
        >
          Configure skill sources →
        </button>
      </div>
    )
  }

  const warningCount = diagnostics.filter(d => d.type === 'warning' || d.type === 'error' || d.type === 'collision').length

  return (
    <div className="text-xs">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
        <span className="font-medium text-gray-700">Skills</span>
        <span className="text-gray-400">({skills.length})</span>
        <div className="ml-auto flex items-center gap-1">
          {warningCount > 0 && (
            <button
              onClick={() => setShowDiagnostics(true)}
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-amber-500 hover:bg-amber-50 transition-colors"
              title={`${warningCount} diagnostics`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span className="text-[10px]">{warningCount}</span>
            </button>
          )}
          <button
            onClick={fetchSkills}
            className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Grouped skill list */}
      {groups.map(([harness, groupSkills]) => {
        const cfg = HARNESS_CONFIG[harness] ?? HARNESS_CONFIG['unknown']!
        const isCollapsed = collapsedGroups.has(harness)

        return (
          <div key={harness} className="">
            {/* Group header */}
            <button
              className={`w-full px-3 py-2 flex items-center gap-2 text-left border-l-[3px] ${cfg.mutedBorder} ${cfg.mutedBg} hover:brightness-95 transition-colors`}
              onClick={() => toggleGroup(harness)}
            >
              <svg
                className={`w-3 h-3 ${cfg.mutedText} transition-transform flex-shrink-0 ${isCollapsed ? '' : 'rotate-90'}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className={`w-5 h-5 rounded text-[11px] font-bold flex items-center justify-center flex-shrink-0 ${cfg.className}`}>
                {cfg.icon}
              </span>
              <span className={`text-[13px] font-semibold tracking-tight ${cfg.mutedText}`}>{cfg.label}</span>
              <span className={`text-[11px] ${cfg.mutedText} opacity-70`}>{groupSkills.length}</span>
            </button>

            {/* Skills in group */}
            {!isCollapsed && groupSkills.map(skill => (
              <div
                key={skill.name}
                className={`cursor-pointer transition-colors ${
                  expandedSkill === skill.filePath ? 'bg-gray-50' : 'hover:bg-gray-50'
                }`}
                onClick={() => expandSkill(skill.filePath)}
              >
                <div className="pl-10 pr-3 py-[7px] flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-[12px] text-gray-800 font-semibold truncate leading-tight">{skill.name}</span>
                  {skill.disableModelInvocation && (
                    <span title="Only invokable via /skill:name" className="text-gray-400 text-[10px]">🔒</span>
                  )}
                  <ScopeLabel scope={skill.scope} />
                  <button
                    onClick={(e) => { e.stopPropagation(); onInvokeSkill?.(skill.name) }}
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex-shrink-0"
                    title="Insert /skill:name into input"
                  >
                    ▶ Use
                  </button>
                </div>
                <div className="pl-10 pr-3 pb-1.5 text-[11px] text-gray-500 leading-relaxed truncate">{skill.description || ''}</div>
                {expandedSkill === skill.filePath && (
                  <div className="pl-9 pr-3 pb-2">
                    {detailLoading ? (
                      <div className="text-gray-400 py-1">Loading...</div>
                    ) : skillDetail ? (
                      <div className="mt-1 p-2 bg-white rounded border border-gray-200 max-h-[300px] overflow-y-auto">
                        <pre className="whitespace-pre-wrap text-[11px] text-gray-700 leading-relaxed font-mono">
                          {skillDetail.content}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-gray-400 py-1">Failed to load skill content</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}

      {showDiagnostics && (
        <DiagnosticsDialog diagnostics={diagnostics} onClose={() => setShowDiagnostics(false)} />
      )}
    </div>
  )
}

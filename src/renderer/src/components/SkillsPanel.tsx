import { useState, useEffect, useCallback } from 'react'

interface SkillInfo {
  name: string
  description: string
  source: string
}

export default function SkillsPanel() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.listSkills()
      if (result.ok && result.data) {
        setSkills(result.data)
      } else {
        setError(result.error ?? 'Failed to load skills')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-xs">
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-gray-400">{error}</div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-400">
        No skills found.
        <br />
        <br />
        Add skills to <span className="font-mono">~/.pi/agent/skills/</span> or <span className="font-mono">.pi/skills/</span>
      </div>
    )
  }

  return (
    <div className="text-xs">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
        <span className="font-medium text-gray-700">Skills</span>
        <span className="text-gray-400">({skills.length})</span>
        <button
          onClick={refresh}
          className="ml-auto rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Refresh"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
      {skills.map(skill => (
        <div key={skill.name} className="px-3 py-2 border-b border-gray-100 hover:bg-gray-100">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="font-medium text-gray-800">{skill.name}</span>
          </div>
          {skill.description && (
            <div className="mt-0.5 text-gray-500 leading-relaxed">{skill.description}</div>
          )}
        </div>
      ))}
    </div>
  )
}

import { create } from 'zustand'

export interface SkillInfo {
  name: string
  description: string
  filePath: string
  baseDir: string
  source: string       // 'auto' | 'local' | 'cli' | 'npm' | 'git' | 'sdk' | ...
  scope: string        // 'user' | 'project' | 'temporary'
  origin: string       // 'top-level' | 'package'
  disableModelInvocation: boolean
  harness?: string     // inferred source tool
}

export interface SkillDiagnostic {
  type: string         // 'warning' | 'error' | 'collision'
  message: string
  path?: string
  collision?: {
    resourceType: string
    name: string
    winnerPath: string
    loserPath: string
  }
}

export interface SkillDetail extends SkillInfo {
  content: string
}

/** Infer which harness a skill comes from based on its filePath */
export function inferHarness(filePath: string, _baseDir: string): string {
  const path = filePath.replace(/\\/g, '/')

  // Match /Users/<name>/.xxx/ or /home/<name>/.xxx/ — works without process.env
  const homeMatch = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/)
  const home = homeMatch ? homeMatch[1] : ''

  if (home) {
    if (path.startsWith(`${home}/.claude/`)) return 'claude'
    if (path.startsWith(`${home}/.codex/`)) return 'codex'
    if (path.startsWith(`${home}/.opencode/`)) return 'opencode'
    if (path.startsWith(`${home}/.config/opencode/`)) return 'opencode'
    if (path.startsWith(`${home}/.agents/`)) return 'agents'
    if (path.startsWith(`${home}/.xi/`)) return 'xi'
    if (path.startsWith(`${home}/.pi/`)) return 'pi'

    // Generic: any ~/.<name>/skills/ pattern
    const match = path.match(new RegExp(`^${home}/\\.([^/]+)/skills/`))
    if (match) return match[1]
  }

  // Project-level
  if (path.includes('/.agents/skills/')) return 'agents'
  if (path.includes('/.pi/skills/')) return 'xi'

  return 'unknown'
}

/** Harness label config for UI rendering */
export const HARNESS_CONFIG: Record<string, { label: string; className: string; icon: string; order: number; border: string; bg: string; text: string }> = {
  xi:       { label: 'Xi',       className: 'bg-violet-50 text-violet-600', icon: 'ξ', order: 0, border: 'border-violet-400', bg: 'bg-violet-50/50', text: 'text-violet-700' },
  pi:       { label: 'Xi',       className: 'bg-violet-50 text-violet-600', icon: 'ξ', order: 0, border: 'border-violet-400', bg: 'bg-violet-50/50', text: 'text-violet-700' },
  claude:   { label: 'Claude',   className: 'bg-orange-50 text-orange-600', icon: 'C', order: 1, border: 'border-orange-400', bg: 'bg-orange-50/50', text: 'text-orange-700' },
  codex:    { label: 'Codex',    className: 'bg-green-50 text-green-600',   icon: '◆', order: 2, border: 'border-green-400', bg: 'bg-green-50/50',  text: 'text-green-700' },
  opencode: { label: 'OpenCode', className: 'bg-teal-50 text-teal-600',     icon: '◎', order: 3, border: 'border-teal-400',  bg: 'bg-teal-50/50',   text: 'text-teal-700' },
  agents:   { label: 'Agents',   className: 'bg-gray-100 text-gray-500',    icon: '⚡', order: 4, border: 'border-gray-400',  bg: 'bg-gray-50/50',   text: 'text-gray-700' },
  npm:      { label: 'npm',      className: 'bg-red-50 text-red-600',       icon: '📦', order: 5, border: 'border-red-400',   bg: 'bg-red-50/50',    text: 'text-red-700' },
  git:      { label: 'git',      className: 'bg-amber-50 text-amber-600',   icon: '📦', order: 6, border: 'border-amber-400', bg: 'bg-amber-50/50',  text: 'text-amber-700' },
  cli:      { label: 'CLI',      className: 'bg-amber-50 text-amber-600',   icon: '>',  order: 7, border: 'border-amber-400', bg: 'bg-amber-50/50',  text: 'text-amber-700' },
  unknown:  { label: 'Other',    className: 'bg-gray-100 text-gray-500',    icon: '?',  order: 8, border: 'border-gray-300',  bg: 'bg-gray-50/50',   text: 'text-gray-700' },
}

/** Get a normalized harness key for grouping (xi and pi both → 'xi') */
export function normalizeHarness(harness?: string): string {
  if (!harness || harness === 'pi') return 'xi'
  return harness
}

/** Scope label config for UI rendering */
export const SCOPE_CONFIG: Record<string, { label: string; className: string }> = {
  user:      { label: 'Global',  className: 'bg-gray-100 text-gray-500' },
  project:   { label: 'Project', className: 'bg-blue-50 text-blue-600' },
  temporary: { label: 'Temp',    className: 'bg-amber-50 text-amber-600' },
}

interface SkillState {
  skills: SkillInfo[]
  diagnostics: SkillDiagnostic[]
  loading: boolean
  error: string | null
  expandedSkill: string | null   // filePath of expanded skill
  skillDetail: SkillDetail | null
  detailLoading: boolean

  fetchSkills: () => Promise<void>
  expandSkill: (filePath: string) => Promise<void>
  collapseSkill: () => void
}

export const useSkillStore = create<SkillState>()((set, get) => ({
  skills: [],
  diagnostics: [],
  loading: false,
  error: null,
  expandedSkill: null,
  skillDetail: null,
  detailLoading: false,

  fetchSkills: async () => {
    set({ loading: true, error: null })
    try {
      const result = await window.api.listSkills()
      if (result.ok && result.data) {
        const skills = result.data.map(s => ({
          ...s,
          harness: inferHarness(s.filePath, s.baseDir),
        }))
        set({
          skills,
          diagnostics: result.diagnostics ?? [],
          loading: false,
        })
      } else {
        set({ error: result.error ?? 'Failed to load skills', loading: false })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  expandSkill: async (filePath: string) => {
    const { expandedSkill } = get()
    // Toggle: click same skill → collapse
    if (expandedSkill === filePath) {
      set({ expandedSkill: null, skillDetail: null })
      return
    }
    set({ expandedSkill: filePath, detailLoading: true, skillDetail: null })
    try {
      const result = await window.api.readSkill(filePath)
      if (result.ok && result.data) {
        set({
          skillDetail: {
            ...result.data,
            harness: inferHarness(result.data.filePath, result.data.baseDir),
          },
          detailLoading: false,
        })
      } else {
        set({ skillDetail: null, detailLoading: false })
      }
    } catch {
      set({ skillDetail: null, detailLoading: false })
    }
  },

  collapseSkill: () => {
    set({ expandedSkill: null, skillDetail: null })
  },
}))

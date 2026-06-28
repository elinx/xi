interface ToolEntry {
  name: string
  icon: string
  description: string
  category: 'built-in' | 'custom'
}

const TOOLS: ToolEntry[] = [
  { name: 'read', icon: '📄', description: 'Read file contents', category: 'built-in' },
  { name: 'bash', icon: '💻', description: 'Execute bash commands (ls, grep, find, etc.)', category: 'built-in' },
  { name: 'edit', icon: '✏️', description: 'Make precise file edits with exact text replacement, including multiple disjoint edits in one call', category: 'built-in' },
  { name: 'write', icon: '📝', description: 'Create or overwrite files', category: 'built-in' },
  { name: 'grep', icon: '🔍', description: 'Search file contents for patterns (respects .gitignore)', category: 'built-in' },
  { name: 'find', icon: '📂', description: 'Find files by glob pattern (respects .gitignore)', category: 'built-in' },
  { name: 'ls', icon: '📋', description: 'List directory contents', category: 'built-in' },
  { name: 'search_sessions', icon: '🔄', description: 'Search conversations from other sessions — recovers past decisions, design rationale, and failed approaches', category: 'custom' },
  { name: 'subagent', icon: '🤖', description: 'Delegate a task to a subagent with its own session. Runs in parallel with real-time streaming.', category: 'custom' },
  { name: 'webfetch', icon: '🌐', description: 'Fetch a URL and return content as Markdown. Use for reading docs, API references, or web pages.', category: 'custom' },
  { name: 'todowrite', icon: ' ✓', description: 'Create or update a task list for multi-step work. Pass the COMPLETE list every time.', category: 'custom' },
  { name: 'question', icon: '❓', description: 'Ask the user a question with options and wait for their answer. Use when you need a decision or clarification.', category: 'custom' },
]

function ToolRow({ tool }: { tool: ToolEntry }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded text-[11px] font-mono">
      <span className="shrink-0 w-4 text-center">{tool.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-600 font-medium">{tool.name}</span>
          {tool.category === 'custom' && (
            <span className="text-[9px] px-1 rounded bg-blue-50 text-blue-500">custom</span>
          )}
        </div>
        <div className="text-gray-400 mt-0.5 leading-relaxed">{tool.description}</div>
      </div>
    </div>
  )
}

export default function ToolsPanel() {
  const builtIn = TOOLS.filter(t => t.category === 'built-in')
  const custom = TOOLS.filter(t => t.category === 'custom')

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-200">
        <span className="text-xs text-gray-500 font-mono">{TOOLS.length} tools available</span>
      </div>

      <div className="px-3 py-1.5">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Built-in</div>
      </div>
      <div className="space-y-0.5 px-1">
        {builtIn.map(tool => (
          <ToolRow key={tool.name} tool={tool} />
        ))}
      </div>

      <div className="px-3 py-1.5 mt-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Custom</div>
      </div>
      <div className="space-y-0.5 px-1 pb-3">
        {custom.map(tool => (
          <ToolRow key={tool.name} tool={tool} />
        ))}
      </div>
    </div>
  )
}

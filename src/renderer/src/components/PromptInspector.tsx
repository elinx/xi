import { useState, useCallback, Component, type ReactNode } from 'react'
import type { PromptSnapshot } from '../types/pi-events'

interface ErrorBoundaryProps {
  children: ReactNode
  onClose: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class InspectorErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-y-0 right-0 z-50 w-[480px] bg-white border-l border-gray-200 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
            <h2 className="text-sm font-semibold text-gray-900">Prompt Inspector</h2>
            <button
              onClick={this.props.onClose}
              className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-red-500">Failed to render prompt snapshot</p>
              <p className="text-xs text-gray-400 mt-1">{this.state.error?.message ?? 'Unknown error'}</p>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const MAX_STRINGIFY_LENGTH = 500_000

function safeStringify(obj: unknown): string {
  try {
    const result = JSON.stringify(obj, null, 2)
    if (result && result.length > MAX_STRINGIFY_LENGTH) {
      return result.slice(0, MAX_STRINGIFY_LENGTH) + '\n\n... (truncated)'
    }
    return result ?? ''
  } catch {
    return '[Unable to serialize payload]'
  }
}

interface PromptInspectorProps {
  snapshot: PromptSnapshot | null
  loading: boolean
  onClose: () => void
}

function CopyButton({ text, label }: { text: string; label?: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      title={label ?? 'Copy'}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function SectionHeader({ title, count, onCopy, copyText }: {
  title: string
  count?: string
  onCopy?: () => void
  copyText?: string
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
      <span className="text-xs font-semibold text-gray-700">
        {title}
        {count && <span className="ml-1.5 text-[10px] font-normal text-gray-400">{count}</span>}
      </span>
      {copyText && <CopyButton text={copyText} />}
    </div>
  )
}

function MessagesSection({ messages }: { messages: unknown[] }): React.ReactElement {
  if (!Array.isArray(messages)) {
    return <div className="text-xs text-gray-400 py-2">No messages</div>
  }

  const copyText = safeStringify(messages)

  return (
    <div>
      <SectionHeader title="Messages" count={`${messages.length} messages`} copyText={copyText} />
      <div className="max-h-96 overflow-y-auto py-1">
        {messages.map((msg, i) => {
          const m = msg as Record<string, unknown>
          const role = m.role as string ?? 'unknown'
          const roleColors: Record<string, string> = {
            user: 'bg-blue-50 text-blue-700 border-blue-200',
            assistant: 'bg-gray-50 text-gray-700 border-gray-200',
          }
          const roleColor = roleColors[role] ?? 'bg-gray-50 text-gray-500 border-gray-200'
          const content = typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? (m.content as Array<Record<string, unknown>>)
                  .map(c => {
                    if (c.type === 'text') return typeof c.text === 'string' ? c.text : safeStringify(c.text)
                    if (c.type === 'tool_use') return `[Tool: ${c.name ?? 'unknown'}]`
                    if (c.type === 'tool_result') return `[Tool Result: ${c.tool_use_id ?? c.id ?? ''}]`
                    return `[${String(c.type ?? 'unknown')}]`
                  })
                  .join('')
              : safeStringify(m.content)

          return (
            <div key={i} className={`mb-1 rounded border px-2 py-1 text-[11px] ${roleColor}`}>
              <span className="font-mono text-[10px] opacity-60">{role}</span>
              <span className="ml-2 line-clamp-3 whitespace-pre-wrap break-all">{content}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SystemSection({ system }: { system: unknown }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const text = typeof system === 'string'
    ? system
    : Array.isArray(system)
      ? (system as Array<Record<string, unknown>>)
          .map(c => c.type === 'text' ? (typeof c.text === 'string' ? c.text : safeStringify(c.text)) : `[${String(c.type ?? 'unknown')}]`)
          .join('\n')
      : safeStringify(system)

  const lines = text.split('\n')
  const previewLines = 15
  const collapsed = !expanded && lines.length > previewLines
  const displayText = collapsed ? lines.slice(0, previewLines).join('\n') : text

  return (
    <div>
      <SectionHeader title="System Prompt" count={`${text.length.toLocaleString()} chars`} copyText={text} />
      <pre className="whitespace-pre-wrap text-[11px] text-gray-600 leading-relaxed py-1 max-h-80 overflow-y-auto font-mono">
        {displayText}
      </pre>
      {collapsed && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-blue-500 hover:text-blue-600 py-0.5"
        >
          Show all {lines.length} lines
        </button>
      )}
      {!collapsed && lines.length > previewLines && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[11px] text-gray-400 hover:text-gray-600 py-0.5"
        >
          Collapse
        </button>
      )}
    </div>
  )
}

function ToolsSection({ tools }: { tools: unknown[] }): React.ReactElement {
  if (!Array.isArray(tools)) {
    return <div className="text-xs text-gray-400 py-2">No tools</div>
  }

  const copyText = safeStringify(tools)

  return (
    <div>
      <SectionHeader title="Tools" count={`${tools.length} tools`} copyText={copyText} />
      <div className="py-1">
        {tools.map((tool, i) => {
          const t = tool as Record<string, unknown>
          const fnObj = typeof t.function === 'object' && t.function !== null ? t.function as Record<string, unknown> : null
          const name = String(fnObj?.name ?? t.name ?? i)
          const desc = String(fnObj?.description ?? t.description ?? '')
          return (
            <div key={i} className="flex items-baseline gap-2 py-0.5">
              <span className="font-mono text-[10px] text-blue-600 bg-blue-50 rounded px-1 py-px flex-shrink-0">{name}</span>
              <span className="text-[10px] text-gray-400 truncate">{desc}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TokenStats({ payload }: { payload: Record<string, unknown> }): React.ReactElement {
  const model = String(payload.model ?? 'unknown')
  const maxTokens = typeof payload.max_tokens === 'number' ? payload.max_tokens : undefined

  return (
    <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-gray-500">Model: <span className="font-mono text-gray-700">{model}</span></span>
        {maxTokens !== undefined && (
          <span className="text-gray-500">Max tokens: <span className="font-mono text-gray-700">{maxTokens.toLocaleString()}</span></span>
        )}
      </div>
    </div>
  )
}

function PromptInspector({ snapshot, loading, onClose }: PromptInspectorProps): React.ReactElement {
  const [activeFilter, setActiveFilter] = useState<Record<string, boolean>>({
    system: true,
    messages: true,
    tools: true,
    raw: false,
  })

  const toggleFilter = (key: string) => {
    setActiveFilter(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const payload = (snapshot?.payload ?? null) as Record<string, unknown> | null

  const system = payload ? (payload.system ?? payload.system_prompt) : null
  const messages = payload?.messages as unknown[] | undefined
  const tools = payload?.tools as unknown[] | undefined
  const rawJson = payload ? safeStringify(payload) : ''

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[480px] bg-white border-l border-gray-200 shadow-2xl flex flex-col animate-slide-in-right">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-900">Prompt Inspector</h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading prompt snapshot...
            </div>
          </div>
        )}

        {!loading && !snapshot && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="w-8 h-8 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-sm text-gray-400">Prompt snapshot not available</p>
            <p className="text-xs text-gray-300 mt-1">This message was generated before capture was enabled, or the Pi SDK version does not support prompt capture.</p>
          </div>
        )}

        {!loading && snapshot && payload && (
          <>
            <TokenStats payload={payload} />

            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterChip label="System Prompt" active={activeFilter.system} onClick={() => toggleFilter('system')} />
              <FilterChip label="Messages" active={activeFilter.messages} onClick={() => toggleFilter('messages')} />
              <FilterChip label="Tools" active={activeFilter.tools} onClick={() => toggleFilter('tools')} />
              <FilterChip label="Raw JSON" active={activeFilter.raw} onClick={() => toggleFilter('raw')} />
            </div>

            {activeFilter.system && system && <SystemSection system={system} />}
            {activeFilter.messages && messages && <MessagesSection messages={messages} />}
            {activeFilter.tools && tools && <ToolsSection tools={tools} />}

            {activeFilter.raw && (
              <div>
                <SectionHeader title="Raw JSON" count={`${rawJson.length.toLocaleString()} chars`} copyText={rawJson} />
                <pre className="whitespace-pre-wrap text-[10px] text-gray-500 leading-relaxed py-1 max-h-80 overflow-y-auto font-mono">
                  {rawJson}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700 border border-blue-200'
          : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200'
      }`}
    >
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

export default PromptInspector
export { InspectorErrorBoundary }

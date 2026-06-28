import { useState, useCallback, useMemo, Component, type ReactNode, type CSSProperties } from 'react'
import type { PromptSnapshot } from '../types/pi-events'

// ─── Error Boundary ───────────────────────────────────────────────

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
        <div className="fixed inset-y-0 right-0 z-50 w-[480px] bg-gray-50 border-l border-gray-200 shadow-2xl flex flex-col" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
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

// ─── Utilities ────────────────────────────────────────────────────

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

/** Extract plain text from a message content (string or content-block array) */
function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .map(c => {
        if (c.type === 'text') return typeof c.text === 'string' ? c.text : safeStringify(c.text)
        if (c.type === 'tool_use') return `[Tool: ${c.name ?? 'unknown'}]`
        if (c.type === 'tool_result') return `[Tool Result: ${c.tool_use_id ?? c.id ?? ''}]`
        return `[${String(c.type ?? 'unknown')}]`
      })
      .join('')
  }
  return safeStringify(content)
}

/** Truncate text to N lines with ellipsis marker */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return lines.slice(0, maxLines).join('\n')
}

// ─── Shared UI Components ─────────────────────────────────────────

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
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function CollapsibleSection({ title, count, copyText, defaultCollapsed = false, children }: {
  title: string
  count?: string
  copyText?: string
  defaultCollapsed?: boolean
  children: ReactNode
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div
        onClick={() => setCollapsed(c => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(c => !c) } }}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform flex-shrink-0 ${collapsed ? '' : 'rotate-90'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-xs font-semibold text-gray-700">{title}</span>
          {count && <span className="text-[10px] text-gray-400">{count}</span>}
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {copyText && <CopyButton text={copyText} />}
        </div>
      </div>
      {!collapsed && <div className="px-3 py-2">{children}</div>}
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

// ─── System Prompt Section ────────────────────────────────────────

/**
 * Parse a system prompt text into collapsible sub-sections.
 * Recognizes:
 *   <Tag attr="..."> ... </Tag>   → xml section with title
 *   ## Heading                    → heading section
 *   ``` ... ```                   → code block
 *   everything else               → plain paragraph
 */
interface SysSubSection {
  title?: string
  content: string
  kind: 'xml' | 'heading' | 'code' | 'plain'
  /** For XML tags with attributes, e.g. <project_instructions path="..."> */
  attrs?: string
}

function parseSystemPromptSections(text: string): SysSubSection[] {
  const sections: SysSubSection[] = []
  const lines = text.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // XML-like open tag on its own line: <TagName ...>
    const xmlOpenMatch = line.match(/^\s*<(\w[\w-]*)(\s[^>]*)?>\s*$/)
    if (xmlOpenMatch) {
      const tagName = xmlOpenMatch[1]
      const attrs = xmlOpenMatch[2]?.trim() || undefined
      const closeTag = `</${tagName}>`
      let foundClose = false
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === closeTag) {
          sections.push({
            title: tagName,
            attrs,
            content: lines.slice(i, j + 1).join('\n'),
            kind: 'xml',
          })
          i = j + 1
          foundClose = true
          break
        }
      }
      if (foundClose) continue
      // No close tag → fall through to plain
    }

    // Markdown heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const headingText = headingMatch[2]
      const contentLines = [line]
      let j = i + 1
      while (j < lines.length) {
        if (lines[j].match(/^#{1,4}\s+/) || lines[j].match(/^\s*<\w[\w-]*(?:\s[^>]*)?>\s*$/)) break
        contentLines.push(lines[j])
        j++
      }
      sections.push({
        title: headingText,
        content: contentLines.join('\n'),
        kind: 'heading',
      })
      i = j
      continue
    }

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const contentLines = [line]
      let j = i + 1
      while (j < lines.length) {
        contentLines.push(lines[j])
        if (lines[j].trimStart().startsWith('```') && j > i) break
        j++
      }
      sections.push({
        title: 'Code',
        content: contentLines.join('\n'),
        kind: 'code',
      })
      i = j + 1
      continue
    }

    // Plain text — collect until next structured element
    const contentLines = [line]
    let j = i + 1
    while (j < lines.length) {
      const next = lines[j]
      if (next.match(/^#{1,4}\s+/) || next.match(/^\s*<\w[\w-]*(?:\s[^>]*)?>\s*$/) || next.trimStart().startsWith('```')) break
      contentLines.push(next)
      j++
    }
    const content = contentLines.join('\n').trimEnd()
    if (content) {
      sections.push({ content, kind: 'plain' })
    }
    i = j
  }

  return sections
}

/** Render a single sub-section with collapse/expand */
function SysSubSection({ section, defaultCollapsed }: { section: SysSubSection; defaultCollapsed: boolean }): React.ReactElement {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const titleColor = section.kind === 'xml'
    ? 'text-purple-700'
    : section.kind === 'heading'
      ? 'text-blue-700'
      : section.kind === 'code'
        ? 'text-green-700'
        : 'text-gray-600'

  const titleLabel = section.kind === 'xml'
    ? `<${section.title}${section.attrs ? ' ' + section.attrs : ''}>`
    : section.kind === 'heading'
      ? section.title
      : section.title ?? ''

  return (
    <div className="mb-1 last:mb-0">
      {section.title && (
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full flex items-center gap-1.5 py-1 text-left hover:bg-gray-50 rounded px-1 transition-colors"
        >
          <svg
            className={`w-2.5 h-2.5 text-gray-400 transition-transform flex-shrink-0 ${collapsed ? '' : 'rotate-90'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className={`text-[11px] font-semibold ${titleColor} font-mono`}>{titleLabel}</span>
          {collapsed && (
            <span className="text-[10px] text-gray-300 ml-0.5">…</span>
          )}
        </button>
      )}
      {!collapsed && (
        <div className={section.title ? 'ml-3.5' : ''}>
          <SysContentRenderer content={section.content} kind={section.kind} />
        </div>
      )}
    </div>
  )
}

/** Line-by-line renderer with lightweight syntax coloring */
function SysContentRenderer({ content, kind }: { content: string; kind: string }): React.ReactElement {
  const rendered = useMemo(() => {
    // For code blocks, render as a single <pre> with background
    if (kind === 'code') {
      return (
        <pre className="whitespace-pre-wrap text-[11px] text-gray-700 leading-relaxed bg-gray-50 rounded px-2 py-1.5 font-mono border border-gray-100">
          {content}
        </pre>
      )
    }

    const lines = content.split('\n')
    return (
      <div className="space-y-px">
        {lines.map((line, i) => (
          <SysLine key={i} line={line} />
        ))}
      </div>
    )
  }, [content, kind])

  return rendered
}

/** Render a single line of system prompt with syntax awareness */
function SysLine({ line }: { line: string }): React.ReactElement {
  // Empty line → spacer
  if (line.trim() === '') {
    return <div className="h-2" />
  }

  // XML tag line (open / close / self-closing)
  if (/^\s*<\/?[\w-]+(?:\s[^>]*)?\/>\s*$/.test(line)) {
    return <div className="text-[11px] text-purple-600/70 font-mono leading-relaxed">{line}</div>
  }

  // Markdown heading inside content
  const headingMatch = line.match(/^(#{1,4})\s+(.+)$/)
  if (headingMatch) {
    const level = headingMatch[1].length
    return (
      <div className={`font-semibold text-gray-800 leading-relaxed ${level <= 2 ? 'text-[12px]' : 'text-[11px]'}`}>
        {headingMatch[2]}
      </div>
    )
  }

  // List item: "- ..." or "* ..."
  if (/^[\s]*[-*]\s/.test(line)) {
    return (
      <div className="text-[11px] text-gray-600 font-mono leading-relaxed">
        <span className="text-gray-400 mr-1">•</span>
        {line.replace(/^[\s]*[-*]\s/, '')}
      </div>
    )
  }

  // Line with inline XML tags — split and colorize
  const parts = splitInlineTags(line)
  if (parts.length > 1) {
    return (
      <div className="text-[11px] text-gray-600 font-mono leading-relaxed">
        {parts.map((part, j) =>
          part.type === 'tag'
            ? <span key={j} className="text-purple-600/80">{part.text}</span>
            : part.type === 'bold'
              ? <span key={j} className="font-semibold text-gray-800">{part.text}</span>
              : <span key={j}>{part.text}</span>
        )}
      </div>
    )
  }

  // Default plain line
  return <div className="text-[11px] text-gray-600 font-mono leading-relaxed">{line}</div>
}

interface TextPart {
  type: 'text' | 'tag' | 'bold'
  text: string
}

function splitInlineTags(line: string): TextPart[] {
  const parts: TextPart[] = []
  const re = /(<\/?[\w-]+(?:\s[^>]*)?\/?>)|(\*\*[^*]+\*\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: line.slice(lastIndex, match.index) })
    }
    if (match[1]) {
      parts.push({ type: 'tag', text: match[1] })
    } else if (match[2]) {
      parts.push({ type: 'bold', text: match[2].slice(2, -2) })
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < line.length) {
    parts.push({ type: 'text', text: line.slice(lastIndex) })
  }
  if (parts.length === 0 || (parts.length === 1 && parts[0].type === 'text')) {
    return [{ type: 'text', text: line }]
  }
  return parts
}

function SystemSection({ system }: { system: unknown }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)

  const text = useMemo(() => {
    if (typeof system === 'string') return system
    if (Array.isArray(system)) {
      return (system as Array<Record<string, unknown>>)
        .map(c => c.type === 'text' ? (typeof c.text === 'string' ? c.text : safeStringify(c.text)) : `[${String(c.type ?? 'unknown')}]`)
        .join('\n')
    }
    return safeStringify(system)
  }, [system])

  const { totalLines, collapsed, displayText } = useMemo(() => {
    const tl = text.split('\n').length
    const pl = 30
    const c = !expanded && tl > pl
    const dt = c ? truncateLines(text, pl) : text
    return { totalLines: tl, collapsed: c, displayText: dt }
  }, [text, expanded])

  const sections = useMemo(() => parseSystemPromptSections(displayText), [displayText])

  return (
    <CollapsibleSection
      title="System Prompt"
      count={`${text.length.toLocaleString()} chars · ${totalLines} lines`}
      copyText={text}
      defaultCollapsed={true}
    >
      <div>
        {sections.map((sec, i) => (
          <SysSubSection key={i} section={sec} defaultCollapsed={i > 1 && !expanded} />
        ))}
      </div>
      {collapsed && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-1 text-[11px] text-blue-500 hover:text-blue-600"
        >
          Show all {totalLines} lines
        </button>
      )}
      {!collapsed && totalLines > 30 && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1 text-[11px] text-gray-400 hover:text-gray-600"
        >
          Collapse
        </button>
      )}
    </CollapsibleSection>
  )
}

// ─── Messages Section ─────────────────────────────────────────────

const ROLE_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  developer: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200', label: 'system' },
  system:    { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200', label: 'system' },
  user:      { bg: 'bg-blue-50',  text: 'text-blue-800',  border: 'border-blue-200',  label: 'user' },
  assistant: { bg: 'bg-slate-50',  text: 'text-gray-800',  border: 'border-slate-200', label: 'assistant' },
  tool:      { bg: 'bg-gray-50',  text: 'text-gray-600',  border: 'border-gray-200',  label: 'tool' },
}

function MessageBubble({ msg, index, isLastUser }: { msg: Record<string, unknown>; index: number; isLastUser: boolean }): React.ReactElement {
  const role = String(msg.role ?? 'unknown')
  const [collapsed, setCollapsed] = useState(true)
  const style = ROLE_STYLES[role] ?? { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200', label: role }

  const contentText = useMemo(() => extractContentText(msg.content), [msg.content])
  const reasoningText = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : undefined
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : undefined

  const lines = contentText.split('\n')
  const shouldTruncate = !collapsed && !isLastUser && lines.length > 4
  const displayText = shouldTruncate ? truncateLines(contentText, 4) : contentText

  return (
    <div className={`${style.bg} ${style.border} border rounded-md px-2.5 py-1.5 hover:brightness-95 transition-all cursor-pointer`}>
      {/* Role badge + collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 text-left min-w-0"
      >
        <svg
          className={`w-2.5 h-2.5 text-gray-400 transition-transform flex-shrink-0 ${collapsed ? '' : 'rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${style.text} opacity-70 flex-shrink-0`}>
          {style.label}
        </span>
        {isLastUser && (
          <span className="text-[9px] bg-blue-100 text-blue-600 rounded px-1.5 py-px font-medium flex-shrink-0">current</span>
        )}
        {toolCalls && toolCalls.length > 0 && (
          <span className="text-[9px] bg-gray-100 text-gray-500 rounded px-1.5 py-px flex-shrink-0 whitespace-nowrap">
            {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''}
          </span>
        )}
        {collapsed && contentText.length > 0 && (
          <span className="text-[10px] text-gray-300 truncate ml-1 min-w-0">{contentText.slice(0, 80)}{contentText.length > 80 ? '…' : ''}</span>
        )}
      </button>

      {!collapsed && (
        <>
          {/* Reasoning (thinking) */}
          {reasoningText && (
            <div className="mb-1.5 pl-2 border-l-2 border-gray-200 mt-1">
              <div className="text-[10px] text-gray-400 font-medium mb-0.5">thinking</div>
              <pre className="whitespace-pre-wrap text-[10px] text-gray-500 font-mono leading-relaxed line-clamp-3">
                {reasoningText}
              </pre>
            </div>
          )}

          {/* Tool calls */}
          {toolCalls && toolCalls.map((tc: Record<string, unknown>, ti: number) => {
            const fn = tc.function as Record<string, unknown> | undefined
            const name = String(fn?.name ?? tc.name ?? 'unknown')
            let argsPreview = ''
            try {
              const args = typeof fn?.arguments === 'string' ? JSON.parse(fn.arguments) : fn?.arguments
              argsPreview = safeStringify(args)
              if (argsPreview.length > 200) argsPreview = argsPreview.slice(0, 200) + '…'
            } catch {
              argsPreview = String(fn?.arguments ?? '')
            }
            return (
              <div key={ti} className="mb-1 pl-2 border-l-2 border-purple-200 bg-purple-50/50 rounded-r">
                <span className="text-[10px] font-mono text-purple-700 font-medium">{name}</span>
                <pre className="text-[10px] text-purple-600/70 font-mono leading-relaxed whitespace-pre-wrap mt-0.5">{argsPreview}</pre>
              </div>
            )
          })}

          {/* Content text */}
          <pre className={`whitespace-pre-wrap text-[11px] ${style.text} font-mono leading-relaxed ${shouldTruncate ? 'line-clamp-4' : ''}`}>
            {displayText}
          </pre>

          {shouldTruncate && (
            <button
              onClick={() => setCollapsed(false)}
              className="text-[10px] text-blue-500 hover:text-blue-600 mt-0.5"
            >
              Show {lines.length} lines
            </button>
          )}
        </>
      )}
    </div>
  )
}

function MessagesSection({ messages }: { messages: unknown[] }): React.ReactElement {
  if (!Array.isArray(messages)) {
    return <div className="text-xs text-gray-400 py-2">No messages</div>
  }

  // Separate developer/system messages from conversation messages
  const { systemMsgs, conversationMsgs, lastUserIdx } = useMemo(() => {
    const sys: Array<Record<string, unknown>> = []
    const conv: Array<Record<string, unknown>> = []
    let lastUser = -1

    messages.forEach((msg, i) => {
      const m = msg as Record<string, unknown>
      const role = String(m.role ?? '')
      if (role === 'developer' || role === 'system') {
        sys.push(m)
      } else {
        conv.push(m)
        if (role === 'user') lastUser = conv.length - 1
      }
    })

    return { systemMsgs: sys, conversationMsgs: conv, lastUserIdx: lastUser }
  }, [messages])

  const copyText = useMemo(() => safeStringify(messages), [messages])

  return (
    <CollapsibleSection
      title="Messages"
      count={`${messages.length} messages`}
      copyText={copyText}
    >
      <div className="space-y-1.5">
        {/* Developer/system messages shown as system prompt content */}
        {systemMsgs.map((msg, i) => (
          <SystemSection key={i} system={msg.content} />
        ))}

        {/* Conversation messages — tool results indented under their assistant */}
        {conversationMsgs.map((msg, i) => {
          const curRole = String((msg as Record<string, unknown>).role ?? '')
          // A tool message is part of an assistant's tool-use block if it follows
          // an assistant or another tool message (consecutive tool results)
          const isToolGroup = curRole === 'tool' && i > 0 && (() => {
            for (let k = i - 1; k >= 0; k--) {
              const r = String((conversationMsgs[k] as Record<string, unknown>).role ?? '')
              if (r === 'assistant') return true
              if (r === 'tool') continue
              return false
            }
            return false
          })()
          return (
            <div key={i} className={isToolGroup ? 'ml-4' : ''}>
              <MessageBubble msg={msg as Record<string, unknown>} index={i} isLastUser={i === lastUserIdx} />
            </div>
          )
        })}
      </div>
    </CollapsibleSection>
  )
}

// ─── Tools Section ────────────────────────────────────────────────

function ToolsSection({ tools }: { tools: unknown[] }): React.ReactElement {
  if (!Array.isArray(tools)) {
    return <div className="text-xs text-gray-400 py-2">No tools</div>
  }

  const copyText = useMemo(() => safeStringify(tools), [tools])

  return (
    <CollapsibleSection title="Tools" count={`${tools.length} tools`} copyText={copyText} defaultCollapsed={true}>
      <div className="space-y-px">
        {tools.map((tool, i) => {
          const t = tool as Record<string, unknown>
          const fnObj = typeof t.function === 'object' && t.function !== null ? t.function as Record<string, unknown> : null
          const name = String(fnObj?.name ?? t.name ?? i)
          const desc = String(fnObj?.description ?? t.description ?? '')
          return (
            <div key={i} className="flex items-baseline gap-2 py-0.5">
              <span className="font-mono text-[10px] text-blue-600 bg-blue-50 rounded px-1.5 py-px flex-shrink-0">{name}</span>
              <span className="text-[10px] text-gray-400 truncate">{desc}</span>
            </div>
          )
        })}
      </div>
    </CollapsibleSection>
  )
}

// ─── Token Stats ──────────────────────────────────────────────────

function TokenStats({ payload }: { payload: Record<string, unknown> }): React.ReactElement {
  const model = String(payload.model ?? 'unknown')
  const maxTokens = typeof payload.max_tokens === 'number' ? payload.max_tokens : undefined
  const thinking = payload.thinking as Record<string, unknown> | undefined
  const thinkingBudget = typeof thinking?.budget_tokens === 'number' ? thinking.budget_tokens : undefined

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-3 text-[11px] flex-wrap">
        <span className="text-gray-500">Model: <span className="font-mono text-gray-700 font-medium">{model}</span></span>
        {maxTokens !== undefined && (
          <span className="text-gray-500">Max tokens: <span className="font-mono text-gray-700">{maxTokens.toLocaleString()}</span></span>
        )}
        {thinkingBudget !== undefined && (
          <span className="text-gray-500">Thinking: <span className="font-mono text-gray-700">{thinkingBudget.toLocaleString()}</span></span>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────

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

  // System prompt can be a top-level field, or embedded as developer/system message
  const system = payload ? (payload.system ?? payload.system_prompt) : null
  const messages = payload?.messages as unknown[] | undefined
  const tools = payload?.tools as unknown[] | undefined
  const rawJson = useMemo(() => payload ? safeStringify(payload) : '', [payload])

  // Check if any messages are developer/system role (they'll be shown in System section)
  const hasDeveloperMessages = useMemo(() => {
    if (!Array.isArray(messages)) return false
    return messages.some(m => {
      const role = (m as Record<string, unknown>).role as string
      return role === 'developer' || role === 'system'
    })
  }, [messages])

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[480px] bg-gray-50 border-l border-gray-200 shadow-2xl flex flex-col animate-slide-in-right" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
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

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
              {!hasDeveloperMessages && <FilterChip label="System Prompt" active={activeFilter.system} onClick={() => toggleFilter('system')} />}
              <FilterChip label="Messages" active={activeFilter.messages} onClick={() => toggleFilter('messages')} />
              <FilterChip label="Tools" active={activeFilter.tools} onClick={() => toggleFilter('tools')} />
              <FilterChip label="Raw JSON" active={activeFilter.raw} onClick={() => toggleFilter('raw')} />
            </div>

            {activeFilter.system && system && !hasDeveloperMessages && <SystemSection system={system} />}
            {activeFilter.messages && messages && <MessagesSection messages={messages} />}
            {activeFilter.tools && tools && <ToolsSection tools={tools} />}

            {activeFilter.raw && (
              <CollapsibleSection title="Raw JSON" count={`${rawJson.length.toLocaleString()} chars`} copyText={rawJson} defaultCollapsed>
                <pre className="whitespace-pre-wrap text-[10px] text-gray-500 leading-relaxed font-mono max-h-96 overflow-y-auto">
                  {rawJson}
                </pre>
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default PromptInspector
export { InspectorErrorBoundary }

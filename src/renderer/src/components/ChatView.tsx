import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import type {
  ChatMessage,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolResultBlock,
  ImageBlock,
  HtmlBlock,
  Annotation,
  ChangeAnchor,
  TodoItem,
  QuestionDetails,
} from '../types/message'
import ChatContextMenu from './ChatContextMenu'
import SkillBlockRenderer from './SkillBlockRenderer'
import ForkAskDialog from './ForkAskDialog'
import type { ForkableMessage, ForkPoint } from '../types/session'
import { ImageAnnotator, annotationsToPrompt } from './ImageAnnotator'
import type { ImageAnnotatorHandle } from './ImageAnnotator'
import type { ViewMode } from '../utils/compact-view'
import { groupByTurns, getUserSummary, getAgentSummary } from '../utils/compact-view'
import type { ConversationTurn } from '../utils/compact-view'
import { getSummaryPrompt } from '../../../shared/summary-prompt'
import PromptInspector, { InspectorErrorBoundary } from './PromptInspector'
import type { PromptSnapshot } from '../types/pi-events'

interface ChatViewProps {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  onSendPrompt: (text: string, images?: { data: string; mimeType: string }[]) => void
  pendingUiRequests: Array<{ id: string; method: string; [key: string]: unknown }>
  respondToUiRequest: (requestId: string, response: Record<string, unknown>) => void
  onForkAtEntry: (entryId: string, name: string) => void
  getForkMessages: () => Promise<ForkableMessage[]>
  forkPoints: ForkPoint[]
  viewMode: ViewMode
  onFileSelect?: (filePath: string) => void
  onSessionSelect?: (sessionName: string) => void
  onQuoteMessage?: (messageId: string, role: 'user' | 'assistant', content: string, timestamp: number) => void
  onForwardMessage?: (messageId: string, role: 'user' | 'assistant', content: string, targetSessionPath: string) => void
  currentSessionPath?: string
  sessions?: Array<{ filePath: string; name: string | null; isMain: boolean }>
  onInspectPrompt?: (messageId: string) => Promise<PromptSnapshot | null>
  captureEnabled?: boolean
  sessionSummary?: string | null
  onSetSessionSummary?: (sessionPath: string, summary: string) => Promise<boolean>
  currentSessionPathForSummary?: string | null
  onForkAskConfirm?: (anchor: ChangeAnchor, sessionName: string, question: string) => void
}

function CopyButton({ blocks }: { blocks: ContentBlock[] }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const textParts: string[] = []
    for (const block of blocks) {
      if (block.type === 'text' && !block.subtype) {
        textParts.push(block.content)
      }
    }
    navigator.clipboard.writeText(textParts.join('\n\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [blocks])

  return (
    <button
      onClick={handleCopy}
      className="rounded p-1 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 hover:bg-gray-100 group-hover:opacity-100"
      title="Copy text"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
      )}
    </button>
  )
}

function BashCopyButton({ command }: { command: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [command])

  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleCopy() }}
      className="absolute top-0.5 right-0.5 rounded bg-white/80 p-1 text-gray-500 backdrop-blur-sm transition-opacity hover:bg-white hover:text-gray-700 group-hover/cmd:opacity-100 opacity-0"
      title="Copy command"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
      )}
    </button>
  )
}

const LinkComponent = ({ href, children }: { href?: string; children?: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    onClick={(e) => { e.preventDefault(); if (href) window.api.openExternal(href) }}
  >
    {children}
  </a>
)

const mdComponentsInline = {
  p: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  li: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  a: LinkComponent,
}

function TextBlockRenderer({ block, isStreaming, onFileSelect, onSessionSelect, sessionNames, isUser }: { block: TextBlock; isStreaming?: boolean; onFileSelect?: (filePath: string) => void; onSessionSelect?: (sessionName: string) => void; sessionNames?: Set<string>; isUser?: boolean }): React.ReactElement {
  if (block.subtype === 'thinking') {
    return <ThinkingBlockRenderer content={block.content} isStreaming={isStreaming} />
  }

  if (isUser && block.content === getSummaryPrompt()) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        /summary
      </span>
    )
  }

  if (isStreaming) {
    return (
      <div className="prose prose-sm max-w-none whitespace-pre-wrap break-words text-sm leading-relaxed">
        {block.content}
        <span className="inline-block w-1.5 h-4 ml-0.5 bg-gray-400 animate-pulse align-text-bottom" />
      </div>
    )
  }

  if (onFileSelect || onSessionSelect) {
    const segments = splitByMentions(block.content, sessionNames)
    if (segments.length === 1 && segments[0].type === 'text') {
      return (
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: LinkComponent }}>{block.content}</ReactMarkdown>
        </div>
      )
    }
    return (
      <div className="prose prose-sm max-w-none">
        <p>
          {segments.map((seg, i) =>
            seg.type === 'mention'
              ? <MentionPill key={i} filePath={seg.value} onClick={() => onFileSelect?.(seg.value)} />
              : seg.type === 'session-mention'
                ? <SessionMentionPill key={i} sessionName={seg.value} onClick={() => onSessionSelect?.(seg.value)} />
                : <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={mdComponentsInline}>{seg.value}</ReactMarkdown>
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: LinkComponent }}>{block.content}</ReactMarkdown>
    </div>
  )
}

const FILE_MENTION_RE = /@([\w][\w-]*(?:[\/.][\w./-]+)+)/g

interface TextSegment { type: 'text'; value: string }
interface FileMentionSegment { type: 'mention'; value: string }
interface SessionMentionSegment { type: 'session-mention'; value: string }
type Segment = TextSegment | FileMentionSegment | SessionMentionSegment

function splitByMentions(text: string, sessionNames?: Set<string>): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0

  // Pre-compute inline code spans to skip mentions inside them
  const codeSpans: [number, number][] = []
  const codeRe = /`[^`]*`/g
  let cm: RegExpExecArray | null
  while ((cm = codeRe.exec(text)) !== null) {
    codeSpans.push([cm.index, codeRe.lastIndex])
  }
  function isInCodeSpan(start: number, end: number): boolean {
    for (const [cs, ce] of codeSpans) {
      if (start >= cs && end <= ce) return true
    }
    return false
  }

  // Collect all matches from both patterns
  const matches: { index: number; endIndex: number; segType: 'mention' | 'session-mention'; value: string }[] = []

  const fileRe = new RegExp(FILE_MENTION_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = fileRe.exec(text)) !== null) {
    if (!isInCodeSpan(m.index, fileRe.lastIndex)) {
      matches.push({ index: m.index, endIndex: fileRe.lastIndex, segType: 'mention', value: m[1] })
    }
  }

  // Session mention: match against actual session names instead of a fixed regex.
  // This handles names with colons, spaces, etc. (e.g. "bugfix: nothing got").
  // Build a single alternation pattern sorted by length desc so longer names match first.
  if (sessionNames && sessionNames.size > 0) {
    const sortedNames = [...sessionNames].sort((a, b) => b.length - a.length)
    const alternation = sortedNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const backtick = '`'
    const sessionRe = new RegExp(`(${backtick}?)\\$(${alternation})\\1`, 'g')
    while ((m = sessionRe.exec(text)) !== null) {
      if (isInCodeSpan(m.index, sessionRe.lastIndex)) continue
      // Avoid overlapping matches with file mentions
      if (matches.some(existing => m.index < existing.endIndex && sessionRe.lastIndex > existing.index)) continue
      matches.push({ index: m.index, endIndex: sessionRe.lastIndex, segType: 'session-mention', value: m[2] })
    }
  }

  // Sort by position
  matches.sort((a, b) => a.index - b.index)

  for (const match of matches) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: match.segType, value: match.value } as Segment)
    lastIndex = match.endIndex
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }]
}

function MentionPill({ filePath, onClick }: { filePath: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-0.5 px-1.5 py-px mx-0.5 rounded-md bg-blue-100 text-blue-700 text-[13px] leading-5 align-baseline hover:bg-blue-200 transition-colors duration-150 cursor-pointer border-0"
    >
      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      {filePath}
    </button>
  )
}

function SessionMentionPill({ sessionName, onClick }: { sessionName: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-0.5 px-1.5 py-px mx-0.5 rounded-md bg-purple-500/10 text-purple-400 text-[13px] leading-5 align-baseline hover:bg-purple-500/20 transition-colors duration-150 cursor-pointer border-0"
    >
      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      {sessionName}
    </button>
  )
}

/** Clickable file-path pill used inside tool call headers and details.
 *  Default: inherits the surrounding gray text color — blends in completely.
 *  Hover: surfaces a subtle blue tint + underline to signal clickability. */
function ToolPathPill({ filePath, onClick }: { filePath: string; onClick: () => void }): React.ReactElement {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClick() } }}
      className="inline-flex items-center gap-0.5 px-0.5 py-px rounded text-inherit text-[11px] font-mono leading-4 align-baseline hover:text-blue-600 hover:bg-blue-50 hover:underline underline-offset-2 transition-colors duration-150 cursor-pointer max-w-[280px] truncate"
      title={filePath}
    >
      <svg className="w-2.5 h-2.5 shrink-0 opacity-40 hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <span className="truncate">{filePath}</span>
    </span>
  )
}

function QuoteBlockRenderer({ block }: { block: { type: 'quote'; role: 'user' | 'assistant'; content: string; sourceSessionName?: string } }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const isForward = !!block.sourceSessionName
  return (
    <div className={`mb-1 rounded-md border-l-2 ${isForward ? 'border-amber-400 bg-amber-50' : 'border-blue-400 bg-blue-50'}`}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-1 px-3 py-1.5 text-[11px] transition-colors duration-150 cursor-pointer ${isForward ? 'text-amber-400 hover:text-amber-300' : 'text-blue-500 hover:text-blue-700'}`}
      >
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        {isForward ? `↗ "${block.sourceSessionName}" · ` : ''}{isForward ? 'Forwarded' : 'Quoted'} {block.role === 'user' ? 'You' : 'Xi'} message
      </button>
      {open && (
        <div className={`px-3 pb-2 text-xs leading-4 whitespace-pre-wrap ${isForward ? 'text-amber-400' : 'text-blue-700'}`}>{block.content}</div>
      )}
    </div>
  )
}

function ThinkingBlockRenderer({ content, isStreaming }: { content: string; isStreaming?: boolean }): React.ReactElement {
  const [collapsed, setCollapsed] = useState(true)
  const lineCount = content.split('\n').length
  const firstLine = content.split('\n')[0] || 'Thinking...'

  return (
    <div className="py-1 border-l-3 border-violet-300 pl-3">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 text-left text-xs font-medium text-violet-400 hover:text-violet-300 transition-colors duration-150"
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        {isStreaming && (
          <svg className="h-3 w-3 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        <span>{isStreaming ? 'Thinking...' : 'Thinking'}</span>
        {!isStreaming && (
          <span className="text-violet-400">({lineCount} line{lineCount !== 1 ? 's' : ''})</span>
        )}
        {collapsed && firstLine && (
          <span className="flex-1 truncate text-violet-400 italic">{firstLine}</span>
        )}
      </button>
      {!collapsed && (
        <div className="whitespace-pre-wrap text-xs italic text-violet-500/70 leading-relaxed">
          {content}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-violet-400 animate-pulse align-text-bottom" />
          )}
        </div>
      )}
    </div>
  )
}

function buildChangeAnchor(toolCall: ToolCallBlock, explanation?: string): ChangeAnchor | null {
  const filePath = typeof toolCall.args.path === 'string' ? toolCall.args.path : ''
  if (!filePath) return null

  if (toolCall.toolName === 'edit') {
    const edits: { oldText: string; newText: string }[] = []
    if (Array.isArray(toolCall.args.edits)) {
      const rawEdits = toolCall.args.edits as Array<{ oldText?: string; newText?: string }>
      for (const e of rawEdits) {
        edits.push({ oldText: e.oldText ?? '', newText: e.newText ?? '' })
      }
    } else {
      const oldText = typeof toolCall.args.oldText === 'string' ? toolCall.args.oldText : ''
      const newText = typeof toolCall.args.newText === 'string' ? toolCall.args.newText : ''
      edits.push({ oldText, newText })
    }
    const oldText = edits.map((e) => e.oldText).join('\n')
    const newText = edits.map((e) => e.newText).join('\n')
    return { toolCallId: toolCall.toolCallId, toolName: 'edit', filePath, oldText, newText, edits, explanation }
  }

  if (toolCall.toolName === 'write') {
    const content = typeof toolCall.args.content === 'string' ? toolCall.args.content : ''
    return { toolCallId: toolCall.toolCallId, toolName: 'write', filePath, newText: content, explanation }
  }

  return null
}

function ExplanationBlockRenderer({ content, anchor, onForkAsk }: { content: string; anchor: ChangeAnchor; onForkAsk: (anchor: ChangeAnchor) => void }): React.ReactElement {
  const [isDark] = useState(() => !document.documentElement.classList.contains('light'))
  return (
    <div
      className="rounded-md border-l-2 pl-3 py-1.5 pr-2"
      style={{ borderColor: '#36d399', backgroundColor: isDark ? 'rgba(54, 211, 153, 0.06)' : 'rgba(54, 211, 153, 0.05)' }}
    >
      <div className="flex items-start gap-1.5">
        <span className="text-xs mt-0.5">💬</span>
        <div className="flex-1 min-w-0">
          <div
            className="text-xs leading-relaxed"
            style={{ color: isDark ? '#d1d5db' : '#374151' }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: LinkComponent, p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>, ul: ({ children }) => <ul className="list-disc pl-4 mb-1 last:mb-0">{children}</ul>, li: ({ children }) => <li className="mb-0.5">{children}</li> }}>{content}</ReactMarkdown>
          </div>
          <button
            onClick={() => onForkAsk(anchor)}
            className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] transition-colors duration-150"
            style={{ color: '#36d399' }}
          >
            追问
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

const COLLAPSE_THRESHOLD = 15

/** Extract HTML blocks from tool result content for inline rendering */
function extractHtmlFromResult(result: ToolResultBlock | undefined): HtmlBlock[] {
  if (!result) return []
  return result.content.filter((c): c is HtmlBlock => c.type === 'html')
}

function TodoStatusIcon({ status, className }: { status: TodoItem['status']; className?: string }) {
  if (status === 'completed') {
    return (
      <svg className={`shrink-0 ${className ?? 'text-green-500'}`} width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-30" />
        <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (status === 'in_progress') {
    return (
      <svg className={`shrink-0 animate-spin ${className ?? 'text-blue-500'}`} width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25" />
        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )
  }
  return (
    <svg className={`shrink-0 ${className ?? 'text-gray-400'}`} width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-40" />
    </svg>
  )
}

function TodoListRenderer({ todos }: { todos: TodoItem[] }): React.ReactElement {
  const priorityDot: Record<TodoItem['priority'], string> = {
    high: 'bg-red-400',
    medium: 'bg-yellow-400',
    low: 'bg-gray-400',
  }

  return (
    <div className="py-1 space-y-0.5">
      {todos.map((todo, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
          <TodoStatusIcon status={todo.status} />
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot[todo.priority]}`} />
          <span className={
            todo.status === 'completed' ? 'text-gray-400 line-through'
            : todo.status === 'in_progress' ? 'text-blue-500'
            : 'text-gray-600'
          }>{todo.content}</span>
        </div>
      ))}
    </div>
  )
}

function QuestionResultRenderer({ details }: { details: QuestionDetails }): React.ReactElement {
  if (details.answer === null) {
    return <span className="text-gray-400 text-xs italic">Cancelled</span>
  }
  const answerText = Array.isArray(details.answer) ? details.answer.join(', ') : details.answer
  return (
    <div className="space-y-1 py-0.5">
      <div className="text-gray-500 text-[11px]">{details.question}</div>
      <div className="flex items-center gap-1.5 text-[11px] font-mono">
        <svg className="w-3.5 h-3.5 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-gray-600">
          {details.wasCustom ? '(wrote) ' : ''}
          {answerText}
        </span>
      </div>
    </div>
  )
}

const ToolCallRenderer = memo(function ToolCallRenderer({ block, result, onFileSelect }: { block: ToolCallBlock; result?: ToolResultBlock; onFileSelect?: (filePath: string) => void }): React.ReactElement {
  // Always collapsed by default
  const [expanded, setExpanded] = useState(false)
  const [isDark, setIsDark] = useState(() => !document.documentElement.classList.contains('light'))
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(!document.documentElement.classList.contains('light'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  const diffBg = isDark ? 'rgba(0, 0, 0, 0.22)' : 'rgba(0, 0, 0, 0.03)'
  const diffFg = isDark ? '#adbac7' : '#57606a'
  const diffAddedBg = isDark ? 'rgba(46, 160, 67, 0.16)' : 'rgba(26, 127, 55, 0.12)'
  const diffAddedFg = isDark ? '#7ee787' : '#1a7f37'
  const diffRemovedBg = isDark ? 'rgba(248, 81, 73, 0.16)' : 'rgba(207, 34, 46, 0.12)'
  const diffRemovedFg = isDark ? '#ffa198' : '#cf222e'
  const diffWordAddedBg = isDark ? 'rgba(46, 160, 67, 0.45)' : 'rgba(26, 127, 55, 0.35)'
  const diffWordRemovedBg = isDark ? 'rgba(248, 81, 73, 0.45)' : 'rgba(207, 34, 46, 0.35)'

  // Tool-specific header info
  const toolIcon: Record<string, string> = {
    bash: '💻',
    read: '📄',
    edit: '✏️',
    write: '📝',
    ls: '📁',
    find: '🔍',
    grep: '🔎',
    search_sessions: '💬',
    todowrite: '📋',
    question: '❓',
  }
  const icon = toolIcon[block.toolName] ?? '🔧'

  // Build header summary based on tool type
  // If the tool has a file path and onFileSelect is provided, render the path as a clickable pill
  const filePath = ['write', 'edit', 'read', 'ls', 'find'].includes(block.toolName) && block.args.path
    ? String(block.args.path)
    : null

  let headerSummary: React.ReactNode = ''
  switch (block.toolName) {
    case 'bash':
      headerSummary = block.args.command
        ? String(block.args.command).length > 80
          ? String(block.args.command).substring(0, 80) + '...'
          : String(block.args.command)
        : ''
      break
    case 'read': {
      const pathEl = filePath && onFileSelect
        ? <ToolPathPill key="path" filePath={filePath} onClick={() => onFileSelect(filePath)} />
        : filePath
      const suffixParts: string[] = []
      if (block.args.offset) suffixParts.push(`L${block.args.offset}`)
      if (block.args.limit) suffixParts.push(`limit ${block.args.limit}`)
      const suffix = suffixParts.length > 0 ? ' ' + suffixParts.join(' ') : ''
      headerSummary = pathEl
        ? <>{pathEl}{suffix}</>
        : suffix || ''
      break
    }
    case 'edit':
    case 'write':
      headerSummary = filePath && onFileSelect
        ? <ToolPathPill filePath={filePath} onClick={() => onFileSelect(filePath)} />
        : filePath ?? ''
      break
    case 'ls':
      headerSummary = filePath && onFileSelect
        ? <ToolPathPill filePath={filePath} onClick={() => onFileSelect(filePath)} />
        : filePath ?? '.'
      break
    case 'find': {
      const patternPart = block.args.pattern ? String(block.args.pattern) : ''
      const inPart = filePath ? (onFileSelect
        ? <> in <ToolPathPill filePath={filePath} onClick={() => onFileSelect(filePath)} /></>
        : ` in ${filePath}`) : ''
      headerSummary = patternPart || inPart ? <>{patternPart}{inPart}</> : ''
      break
    }
    case 'grep':
      headerSummary = block.args.pattern ? String(block.args.pattern) : ''
      break
    case 'search_sessions':
      headerSummary = block.args.query ? String(block.args.query) : ''
      break
    case 'todowrite': {
      const todos = result?.details?.todos
      if (todos && todos.length > 0) {
        const completed = todos.filter(t => t.status === 'completed').length
        headerSummary = `${completed}/${todos.length} tasks`
      } else {
        headerSummary = block.args.todos ? `${(block.args.todos as unknown[]).length} tasks` : ''
      }
      break
    }
    case 'question': {
      const d = result?.details as QuestionDetails | undefined
      if (d) {
        if (!d.answer) {
          headerSummary = 'cancelled'
        } else {
          const text = Array.isArray(d.answer) ? d.answer.join(', ') : d.answer
          headerSummary = d.wasCustom ? `wrote: ${text.slice(0, 30)}` : `selected: ${text.slice(0, 30)}`
        }
      } else {
        headerSummary = ''
      }
      break
    }
    default:
      headerSummary = ''
  }

  // Status indicator
  const statusEl = (() => {
    switch (block.status) {
      case 'running':
        return (
          <svg className="h-3.5 w-3.5 animate-spin text-yellow-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )
      case 'completed':
        return <span className="text-green-500 text-xs">✓</span>
      case 'error':
        return <span className="text-red-500 text-xs">✗</span>
      case 'pending':
        return <span className="text-gray-400 text-xs">⋯</span>
    }
  })()

  // HTML blocks from result — rendered inline (always visible, outside collapsed section)
  const htmlBlocks = extractHtmlFromResult(result)

  // Result text content
  const resultText = result
    ? result.content.filter((c): c is TextBlock => c.type === 'text').map((c) => c.content).join('\n')
    : ''
  const resultLines = resultText.split('\n')
  const resultLineCount = resultLines.length
  const resultIsLong = resultLineCount > COLLAPSE_THRESHOLD
  const [outputCollapsed, setOutputCollapsed] = useState(true)
  const displayResult = (outputCollapsed && resultIsLong)
    ? resultLines.slice(0, COLLAPSE_THRESHOLD).join('\n')
    : resultText

  const todoDetails = result?.details && 'todos' in result.details ? result.details.todos : undefined
  const questionDetails = result?.details && 'question' in result.details ? result.details as QuestionDetails : undefined

  return (
    <div className="first:border-t-0">
      {/* Header line — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 py-0.5 text-left text-gray-400 hover:text-gray-600 transition-colors duration-150"
      >
        <span className="text-[10px]">{icon}</span>
        <span className="font-mono text-[11px]">{block.toolName}</span>
        {headerSummary ? (
          <span className="flex-1 truncate font-mono text-[11px] text-gray-300">{headerSummary}</span>
        ) : (
          <span className="flex-1" />
        )}
        {statusEl}
        <svg
          className={`h-3 w-3 text-gray-300 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </button>
      {/* HTML preview — always visible when result contains HTML */}
      {htmlBlocks.length > 0 && htmlBlocks.map((htmlBlock, i) => (
        <HtmlBlockRenderer key={`html-inline-${i}`} block={htmlBlock} />
      ))}
      {/* Expandable details */}
      {expanded && (
        <div className="ml-4 border-l-2 border-gray-200 pl-3 py-1">
          {block.toolName === 'edit' ? (
            <div>
              {filePath && onFileSelect
                ? <div className="mb-1"><ToolPathPill filePath={filePath} onClick={() => onFileSelect(filePath)} /></div>
                : block.args.path ? <div className="text-xs text-gray-400 mb-1">{String(block.args.path)}</div> : null
              }
              {Array.isArray(block.args.edits) ? (
                (block.args.edits as Array<{ oldText?: string; newText?: string }>).map((edit, i) => (
                  <div key={i} className={Array.isArray(block.args.edits) && (block.args.edits as unknown[]).length > 1 ? 'mb-2 pb-2 border-b border-gray-200 last:border-b-0' : ''}>
                    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                    <ReactDiffViewer
                      oldValue={String(edit.oldText ?? '')}
                      newValue={String(edit.newText ?? '')}
                      splitView={false}
                      compareMethod={DiffMethod.WORDS}
                      useDarkTheme={isDark}
                      hideLineNumbers
                      hideSummary
                      styles={{
                        variables: isDark ? {
                          dark: {
                            diffViewerBackground: diffBg,
                            diffViewerColor: diffFg,
                            addedBackground: diffAddedBg,
                            addedColor: diffAddedFg,
                            removedBackground: diffRemovedBg,
                            removedColor: diffRemovedFg,
                            wordAddedBackground: diffWordAddedBg,
                            wordRemovedBackground: diffWordRemovedBg,
                            gutterBackground: diffBg,
                            gutterBackgroundDark: diffBg,
                          },
                        } : {
                          light: {
                            diffViewerBackground: diffBg,
                            diffViewerColor: diffFg,
                            addedBackground: diffAddedBg,
                            addedColor: diffAddedFg,
                            removedBackground: diffRemovedBg,
                            removedColor: diffRemovedFg,
                            wordAddedBackground: diffWordAddedBg,
                            wordRemovedBackground: diffWordRemovedBg,
                            gutterBackground: diffBg,
                          },
                        },
                        contentText: { color: diffFg, fontFamily: 'ui-monospace, monospace', fontSize: '12px', wordBreak: 'break-word' },
                        line: { padding: '0 8px' },
                      }}
                    />
                    </div>
                  </div>
                ))
              ) : (
                <>
                  {block.args.oldText != null && block.args.newText != null && (
                    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                    <ReactDiffViewer
                      oldValue={String(block.args.oldText)}
                      newValue={String(block.args.newText)}
                      splitView={false}
                      compareMethod={DiffMethod.WORDS}
                      useDarkTheme={isDark}
                      hideLineNumbers
                      hideSummary
                      styles={{
                        variables: isDark ? {
                          dark: {
                            diffViewerBackground: diffBg,
                            diffViewerColor: diffFg,
                            addedBackground: diffAddedBg,
                            addedColor: diffAddedFg,
                            removedBackground: diffRemovedBg,
                            removedColor: diffRemovedFg,
                            wordAddedBackground: diffWordAddedBg,
                            wordRemovedBackground: diffWordRemovedBg,
                            gutterBackground: diffBg,
                            gutterBackgroundDark: diffBg,
                          },
                        } : {
                          light: {
                            diffViewerBackground: diffBg,
                            diffViewerColor: diffFg,
                            addedBackground: diffAddedBg,
                            addedColor: diffAddedFg,
                            removedBackground: diffRemovedBg,
                            removedColor: diffRemovedFg,
                            wordAddedBackground: diffWordAddedBg,
                            wordRemovedBackground: diffWordRemovedBg,
                            gutterBackground: diffBg,
                          },
                        },
                        contentText: { color: diffFg, fontFamily: 'ui-monospace, monospace', fontSize: '12px', wordBreak: 'break-word' },
                        line: { padding: '0 8px' },
                      }}
                    />
                    </div>
                  )}
                </>
              )}
            </div>
          ) : block.toolName === 'bash' && block.args.command ? (
            <div className="relative group/cmd">
              <pre className="overflow-x-auto text-xs text-gray-700 bg-gray-100 rounded border border-gray-200 px-2 py-1 pr-7">{String(block.args.command)}</pre>
              <BashCopyButton command={String(block.args.command)} />
            </div>
          ) : block.toolName === 'read' && block.args.path ? (
            <span className="text-xs text-gray-500">
              {filePath && onFileSelect
                ? <ToolPathPill filePath={filePath} onClick={() => onFileSelect(filePath)} />
                : String(block.args.path)
              }{block.args.offset ? ` (from line ${block.args.offset})` : ''}{block.args.limit ? ` limit ${block.args.limit}` : ''}
            </span>
          ) : block.toolName === 'write' && block.args.path ? (
            <div>
              {filePath && onFileSelect
                ? <ToolPathPill filePath={filePath} onClick={() => onFileSelect(filePath)} />
                : <span className="text-xs text-gray-400">{String(block.args.path)}</span>
              }
              {block.args.content && (
                <pre className="overflow-x-auto text-xs text-gray-500 mt-1 whitespace-pre-wrap max-h-40">{String(block.args.content).length > 500 ? String(block.args.content).substring(0, 500) + '...' : String(block.args.content)}</pre>
              )}
            </div>
          ) : block.toolName === 'ls' ? (
            <span className="text-xs text-gray-500">
              {filePath && onFileSelect
                ? <ToolPathPill filePath={filePath} onClick={() => onFileSelect(filePath)} />
                : filePath ?? '.'
              }{block.args.limit ? ` (limit ${block.args.limit})` : ''}
            </span>
          ) : block.toolName === 'find' ? (
            <span className="text-xs text-gray-500">{block.args.pattern ? String(block.args.pattern) : ''}{filePath ? (onFileSelect ? <> in <ToolPathPill filePath={filePath} onClick={() => onFileSelect(filePath)} /></> : ` in ${filePath}`) : ''}</span>
          ) : block.toolName === 'grep' ? (
            <div>
              <span className="text-xs text-gray-500">{block.args.pattern ? `/${String(block.args.pattern)}/` : ''}{block.args.path ? (onFileSelect ? <> in <ToolPathPill filePath={String(block.args.path)} onClick={() => onFileSelect(String(block.args.path))} /></> : ` in ${String(block.args.path)}`) : ''}{block.args.glob ? ` (${String(block.args.glob)})` : ''}</span>
            </div>
          ) : block.toolName === 'search_sessions' ? (
            <span className="text-xs text-gray-500">query: {block.args.query ? String(block.args.query) : ''}{block.args.limit ? ` (limit ${block.args.limit})` : ''}</span>
          ) : (
            <pre className="overflow-x-auto text-xs text-gray-500">
              {JSON.stringify(block.args, null, 2)}
            </pre>
          )}
          {/* Structured result rendering: todo list, question result, or text output */}
          {todoDetails && todoDetails.length > 0 ? (
            <TodoListRenderer todos={todoDetails} />
          ) : questionDetails ? (
            <QuestionResultRenderer details={questionDetails} />
          ) : resultText.trim().length > 0 ? (
            <div className="mt-1">
              <div className="flex items-center justify-between py-0.5">
                <span className="text-xs text-gray-400">
                  Output{resultLineCount > 1 ? ` (${resultLineCount} lines)` : ''}
                </span>
                {resultIsLong && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setOutputCollapsed(!outputCollapsed) }}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    {outputCollapsed ? `Show all ${resultLineCount} lines` : 'Collapse'}
                  </button>
                )}
              </div>
              <pre className="whitespace-pre-wrap text-xs font-mono text-gray-500">
                {displayResult}
              </pre>
              {outputCollapsed && resultIsLong && (
                <div className="text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); setOutputCollapsed(false) }}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    ▸ Show all {resultLineCount} lines
                  </button>
                </div>
              )}
            </div>
          ) : null}
          {/* Non-text result content (images only — html is rendered inline above) */}
          {result && result.content.map((child, i) => {
            if (child.type === 'image') {
              return <ImageBlockRenderer key={`img-${i}`} block={child as ImageBlock} />
            }
            return null
          })}
        </div>
      )}
    </div>
  )
})

function HtmlBlockRenderer({ block }: { block: HtmlBlock }): React.ReactElement {
  const [expanded, setExpanded] = useState(true)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const handleLoad = useCallback(() => {
    if (!iframeRef.current) return
    const doc = iframeRef.current.contentDocument
    if (!doc?.body) return
    const height = doc.body.scrollHeight
    iframeRef.current.style.height = `${Math.min(Math.max(height, 100), 600)}px`
  }, [])

  return (
    <div className="my-2 overflow-hidden rounded border border-gray-200">
      <div className="flex items-center justify-between bg-gray-100 px-3 py-1.5">
        <span className="text-xs font-medium text-gray-500">
          {block.title ?? 'HTML Preview'}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {expanded && (
        <iframe
          ref={iframeRef}
          srcDoc={block.content}
          sandbox="allow-scripts allow-same-origin"
          onLoad={handleLoad}
          className="w-full border-0 bg-white"
          style={{ height: '300px' }}
          title={block.title ?? 'HTML Preview'}
        />
      )}
    </div>
  )
}

interface AnnotatableImageBlockProps {
  block: ImageBlock
  messageId: string
  blockIndex: number
  isAnnotating: boolean
  onEnterAnnotation: () => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
}

function AnnotatableImageBlock({
  block,
  messageId,
  blockIndex,
  isAnnotating,
  onEnterAnnotation,
  onExitAnnotation,
  onSendFeedback,
}: AnnotatableImageBlockProps): React.ReactElement {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const annotatorRef = useRef<ImageAnnotatorHandle>(null)

  void messageId
  void blockIndex

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((prev) => Math.max(0.25, Math.min(4, prev + (e.deltaY > 0 ? -0.15 : 0.15))))
  }, [])

  useEffect(() => {
    if (!isFullscreen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false)
        setZoom(1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isFullscreen])

  const handleSendFeedback = useCallback(() => {
    if (!annotatorRef.current) return
    const result = annotatorRef.current.getAnnotatedImage()
    if (!result) return

    const base64Match = result.dataUrl.match(/^data:image\/png;base64,(.+)$/)
    if (!base64Match) return

    onSendFeedback(result.description, base64Match[1])
    onExitAnnotation()
  }, [onSendFeedback, onExitAnnotation])

  if (isAnnotating) {
    return (
      <div className="my-2 overflow-hidden rounded border border-blue-600">
        <ImageAnnotator
          ref={annotatorRef}
          src={block.src}
          alt={block.alt}
          annotations={annotations}
          onAnnotationsChange={setAnnotations}
          isActive={true}
        />
        <div className="flex items-center justify-between border-t border-blue-600 bg-gray-100 px-3 py-2">
          <span className="text-xs text-gray-600">
            {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onExitAnnotation}
              className="rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              onClick={handleSendFeedback}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
            >
              Send Feedback
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (isFullscreen) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={() => {
          setIsFullscreen(false)
          setZoom(1)
        }}
      >
        <img
          src={block.src}
          alt={block.alt ?? 'image'}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
          className="max-h-[90vh] max-w-[90vw] cursor-zoom-out transition-transform"
          onWheel={handleWheel}
          onClick={(e) => e.stopPropagation()}
        />
        <div className="absolute bottom-4 right-4 flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setZoom((z) => Math.min(4, z + 0.25))
            }}
            className="rounded bg-gray-100/80 px-3 py-1 text-sm text-white hover:bg-gray-200"
          >
            +
          </button>
          <span className="rounded bg-gray-100/80 px-3 py-1 text-sm text-white">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setZoom((z) => Math.max(0.25, z - 0.25))
            }}
            className="rounded bg-gray-100/80 px-3 py-1 text-sm text-white hover:bg-gray-200"
          >
            -
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsFullscreen(false)
              setZoom(1)
            }}
            className="rounded bg-red-800/80 px-3 py-1 text-sm text-white hover:bg-red-700"
          >
            ESC
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="my-2 overflow-hidden rounded border border-gray-200">
      <div className="relative group">
        <img
          src={block.src}
          alt={block.alt ?? 'image'}
          className="max-w-full cursor-zoom-in transition-opacity hover:opacity-90"
          onClick={() => setIsFullscreen(true)}
          loading="lazy"
        />
        <button
          onClick={onEnterAnnotation}
          className="absolute top-2 right-2 rounded bg-blue-600/90 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity hover:bg-blue-500 group-hover:opacity-100"
        >
          Annotate
        </button>
      </div>
      {block.alt && (
        <div className="border-t border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500">
          {block.alt}
        </div>
      )}
    </div>
  )
}

/**
 * Render blocks from multiple merged messages as one unit.
 * Collects all tool_call/tool_result pairs across messages into one group.
 */
function MergedBlocksRenderer({
  messages,
  isStreaming,
  streamingMessageId,
  annotatingTarget,
  onEnterAnnotation,
  onExitAnnotation,
  onSendFeedback,
  onFileSelect,
  onSessionSelect,
  sessionNames,
  onForkAsk,
}: {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
  onFileSelect?: (filePath: string) => void
  onSessionSelect?: (sessionName: string) => void
  sessionNames?: Set<string>
  onForkAsk?: (anchor: ChangeAnchor) => void
}): React.ReactElement {
  // Flatten all blocks, track which message each came from
  const allBlocks: { block: ContentBlock; msgId: string; blockIdx: number; isUser: boolean }[] = []
  for (const msg of messages) {
    msg.blocks.forEach((block, idx) => {
      allBlocks.push({ block, msgId: msg.id, blockIdx: idx, isUser: msg.role === 'user' })
    })
  }

  const toolResultById = new Map<string, number>()
  for (let j = 0; j < allBlocks.length; j++) {
    if (allBlocks[j].block.type === 'tool_result') {
      toolResultById.set((allBlocks[j].block as ToolResultBlock).toolCallId, j)
    }
  }

  const pairedResultIndices = new Set<number>()
  for (let j = 0; j < allBlocks.length; j++) {
    if (allBlocks[j].block.type === 'tool_call') {
      const tcId = (allBlocks[j].block as ToolCallBlock).toolCallId
      const resultIdx = toolResultById.get(tcId)
      if (resultIdx !== undefined) {
        pairedResultIndices.add(resultIdx)
      }
    }
  }

  // Render blocks in original order
  const elements: React.ReactElement[] = []

  for (let j = 0; j < allBlocks.length; j++) {
    const { block, msgId, blockIdx } = allBlocks[j]

    // Skip paired tool_result (will be rendered inside its tool_call)
    if (pairedResultIndices.has(j)) continue

    if (block.type === 'tool_call') {
      const tcId = (block as ToolCallBlock).toolCallId
      const resultIdx = toolResultById.get(tcId)
      const result = resultIdx !== undefined ? allBlocks[resultIdx].block as ToolResultBlock : undefined
      elements.push(
        <ToolCallRenderer key={`tc-${tcId}`} block={block} result={result} onFileSelect={onFileSelect} />
      )
      continue
    }

    if (block.type === 'tool_result') {
      elements.push(
        <OrphanToolResultRenderer key={`tr-${msgId}-${blockIdx}`} block={block} />
      )
      continue
    }

    if (block.type === 'text' && (block as TextBlock).subtype === 'explanation' && onForkAsk) {
      let toolCallBlock: ToolCallBlock | null = null
      for (let k = j - 1; k >= 0; k--) {
        if (allBlocks[k].block.type === 'tool_call') {
          toolCallBlock = allBlocks[k].block as ToolCallBlock
          break
        }
      }
      if (toolCallBlock) {
        const anchor = buildChangeAnchor(toolCallBlock, block.content)
        if (anchor) {
          elements.push(
            <ExplanationBlockRenderer
              key={`expl-${msgId}-${blockIdx}`}
              content={block.content}
              anchor={anchor}
              onForkAsk={onForkAsk}
            />
          )
          continue
        }
      }
    }

    elements.push(
      <ContentBlockRenderer
        key={`cb-${msgId}-${blockIdx}`}
        block={block}
        messageId={msgId}
        blockIndex={blockIdx}
        isStreamingBlock={isStreaming && streamingMessageId === msgId && block.type === 'text'}
        annotatingTarget={annotatingTarget}
        onEnterAnnotation={onEnterAnnotation}
        onExitAnnotation={onExitAnnotation}
        onSendFeedback={onSendFeedback}
        onFileSelect={onFileSelect}
        onSessionSelect={onSessionSelect}
        sessionNames={sessionNames}
        isUser={allBlocks[j].isUser}
      />
    )
  }

  return <div className="space-y-2">{elements}</div>
}

/**
 * Render all blocks of a single message.
 * Collects all tool_call/tool_result pairs from the message into one card.
 * Other blocks render normally in order.
 */
function MessageBlocksRenderer({
  msg,
  isStreaming,
  streamingMessageId,
  annotatingTarget,
  onEnterAnnotation,
  onExitAnnotation,
  onSendFeedback,
  onFileSelect,
  onSessionSelect,
  sessionNames,
  onForkAsk,
}: {
  msg: ChatMessage
  isStreaming: boolean
  streamingMessageId: string | null
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
  onFileSelect?: (filePath: string) => void
  onSessionSelect?: (sessionName: string) => void
  sessionNames?: Set<string>
  onForkAsk?: (anchor: ChangeAnchor) => void
}): React.ReactElement {
  const toolResultById = new Map<string, number>()
  for (let j = 0; j < msg.blocks.length; j++) {
    if (msg.blocks[j].type === 'tool_result') {
      toolResultById.set((msg.blocks[j] as ToolResultBlock).toolCallId, j)
    }
  }

  const pairedResultIndices = new Set<number>()
  for (let j = 0; j < msg.blocks.length; j++) {
    if (msg.blocks[j].type === 'tool_call') {
      const tcId = (msg.blocks[j] as ToolCallBlock).toolCallId
      const resultIdx = toolResultById.get(tcId)
      if (resultIdx !== undefined) {
        pairedResultIndices.add(resultIdx)
      }
    }
  }

  const elements: React.ReactElement[] = []

  for (let j = 0; j < msg.blocks.length; j++) {
    const block = msg.blocks[j]

    if (pairedResultIndices.has(j)) continue

    if (block.type === 'tool_call') {
      const tcId = (block as ToolCallBlock).toolCallId
      const resultIdx = toolResultById.get(tcId)
      const result = resultIdx !== undefined ? msg.blocks[resultIdx] as ToolResultBlock : undefined
      elements.push(
        <ToolCallRenderer key={`tc-${tcId}`} block={block} result={result} onFileSelect={onFileSelect} />
      )
      continue
    }

    if (block.type === 'tool_result') {
      elements.push(
        <OrphanToolResultRenderer key={`tr-${msg.id}-${j}`} block={block} />
      )
      continue
    }

    if (block.type === 'text' && (block as TextBlock).subtype === 'explanation' && onForkAsk) {
      let toolCallBlock: ToolCallBlock | null = null
      for (let k = j - 1; k >= 0; k--) {
        if (msg.blocks[k].type === 'tool_call') {
          toolCallBlock = msg.blocks[k] as ToolCallBlock
          break
        }
      }
      if (toolCallBlock) {
        const anchor = buildChangeAnchor(toolCallBlock, block.content)
        if (anchor) {
          elements.push(
            <ExplanationBlockRenderer
              key={`expl-${msg.id}-${j}`}
              content={block.content}
              anchor={anchor}
              onForkAsk={onForkAsk}
            />
          )
          continue
        }
      }
    }

    elements.push(
      <ContentBlockRenderer
        key={`cb-${msg.id}-${j}`}
        block={block}
        messageId={msg.id}
        blockIndex={j}
        isStreamingBlock={isStreaming && streamingMessageId === msg.id && block.type === 'text'}
        annotatingTarget={annotatingTarget}
        onEnterAnnotation={onEnterAnnotation}
        onExitAnnotation={onExitAnnotation}
        onSendFeedback={onSendFeedback}
        onFileSelect={onFileSelect}
        onSessionSelect={onSessionSelect}
        sessionNames={sessionNames}
        isUser={msg.role === 'user'}
      />
    )
  }

  return <div className="space-y-2">{elements}</div>
}

/** Render a tool_result that has no matching tool_call (rare edge case) */
function OrphanToolResultRenderer({ block }: { block: ToolResultBlock }): React.ReactElement {
  const textItems = block.content.filter((c): c is TextBlock => c.type === 'text')
  const fullText = textItems.map((c) => c.content).join('\n')
  return (
    <div className="my-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 overflow-x-auto">
      <pre className="whitespace-pre-wrap text-xs font-mono text-gray-600">{fullText}</pre>
    </div>
  )
}

const ContentBlockRenderer = memo(function ContentBlockRenderer({
  block,
  messageId,
  blockIndex,
  isStreamingBlock,
  annotatingTarget,
  onEnterAnnotation,
  onExitAnnotation,
  onSendFeedback,
  onFileSelect,
  onSessionSelect,
  sessionNames,
  isUser,
}: {
  block: ContentBlock
  messageId: string
  blockIndex: number
  isStreamingBlock?: boolean
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
  onFileSelect?: (filePath: string) => void
  onSessionSelect?: (sessionName: string) => void
  sessionNames?: Set<string>
  isUser?: boolean
}): React.ReactElement | null {
  switch (block.type) {
    case 'text':
      return <TextBlockRenderer block={block} isStreaming={isStreamingBlock} onFileSelect={onFileSelect} onSessionSelect={onSessionSelect} sessionNames={sessionNames} isUser={isUser} />
    case 'quote':
      return <QuoteBlockRenderer block={block} />
    case 'image':
      return (
        <AnnotatableImageBlock
          block={block}
          messageId={messageId}
          blockIndex={blockIndex}
          isAnnotating={
            annotatingTarget !== null &&
            annotatingTarget.messageId === messageId &&
            annotatingTarget.blockIndex === blockIndex
          }
          onEnterAnnotation={() => onEnterAnnotation(messageId, blockIndex)}
          onExitAnnotation={onExitAnnotation}
          onSendFeedback={onSendFeedback}
        />
      )
    case 'action':
      return <div className="text-xs text-yellow-600">[Action: {block.actionType}]</div>
    case 'skill':
      return <SkillBlockRenderer name={block.name} location={block.location} content={block.content} userMessage={block.userMessage} />
    case 'html':
      return <HtmlBlockRenderer block={block} />
    default:
      return null
  }
})

function ForkNameInput({
  onForkAtEntry,
  onClose,
  defaultEntryId,
}: {
  onForkAtEntry: (entryId: string, name: string) => void
  onClose: () => void
  defaultEntryId: string
}): React.ReactElement {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [forkName, setForkName] = useState('')

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleConfirm = useCallback(() => {
    if (forkName.trim()) {
      onForkAtEntry(defaultEntryId, forkName.trim())
      onClose()
    }
  }, [forkName, defaultEntryId, onForkAtEntry, onClose])

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-8 z-30 w-64 rounded-lg border border-gray-200 bg-white shadow-xl"
    >
      <div className="px-3 py-2 space-y-1.5">
        <input
          autoFocus
          value={forkName}
          onChange={(e) => setForkName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Fork session name"
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-blue-500"
        />
        <button
          onClick={handleConfirm}
          disabled={!forkName.trim()}
          className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Fork from here
        </button>
      </div>
    </div>
  )
}

/** Collapsible agent content within Turn mode */
function CollapsibleAgentContent({ turn, isExpanded, onToggleExpand, annotatingTarget, onEnterAnnotation, onExitAnnotation, onSendFeedback, onFileSelect, onSessionSelect, sessionNames, isStreaming, streamingMessageId, forkPoints, onForkClick, forkInputMessageId, forkEntryId, onForkClose, onForkAtEntry, onQuoteMessage, onForwardClick, sessions, onForkAsk }: {
  turn: ConversationTurn
  isExpanded: boolean
  onToggleExpand: () => void
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
  onFileSelect?: (filePath: string) => void
  onSessionSelect?: (sessionName: string) => void
  sessionNames?: Set<string>
  isStreaming: boolean
  streamingMessageId: string | null
  forkPoints: ForkPoint[]
  onForkClick: (messageId: string, piEntryId: string | undefined) => void
  forkInputMessageId: string | null
  forkEntryId: string | null
  onForkClose: () => void
  onForkAtEntry: (entryId: string, name: string) => void
  onQuoteMessage?: (messageId: string, role: 'user' | 'assistant', content: string, timestamp: number) => void
  onForwardClick?: (messageId: string, role: 'user' | 'assistant', content: string) => void
  sessions?: Array<{ filePath: string; name: string | null; isMain: boolean }>
  onForkAsk?: (anchor: ChangeAnchor) => void
}): React.ReactElement {
  const allBlocks = turn.assistantMessages.flatMap((m) => m.blocks)
  const textBlocks = allBlocks.filter((b): b is TextBlock => b.type === 'text' && !b.subtype)
  const fullText = textBlocks.map((b) => b.content).join('\n\n')
  const lines = fullText.split('\n').filter(l => l.trim())
  const needCollapse = lines.length > 3 || fullText.length > 150

  // Collect fork points — match against the user message's entry ID,
  // since Pi SDK only creates fork_points with user message entry IDs.
  const lastAssistantMsg = turn.assistantMessages[turn.assistantMessages.length - 1]
  const userForkPoints = forkPoints.filter((fp) => turn.userMessage.piEntryId === fp.entryId)

  return (
    <>
        {isExpanded || !needCollapse ? (
          <MergedBlocksRenderer
            messages={turn.assistantMessages}
            isStreaming={isStreaming}
            streamingMessageId={streamingMessageId}
            annotatingTarget={annotatingTarget}
            onEnterAnnotation={onEnterAnnotation}
            onExitAnnotation={onExitAnnotation}
            onSendFeedback={onSendFeedback}
            onFileSelect={onFileSelect}
            onSessionSelect={onSessionSelect}
            sessionNames={sessionNames}
            onForkAsk={onForkAsk}
          />
        ) : (
          <div className="relative max-h-[4.8em] overflow-hidden">
            <MergedBlocksRenderer
              messages={turn.assistantMessages}
              isStreaming={isStreaming}
              streamingMessageId={streamingMessageId}
              annotatingTarget={annotatingTarget}
              onEnterAnnotation={onEnterAnnotation}
              onExitAnnotation={onExitAnnotation}
              onSendFeedback={onSendFeedback}
              onFileSelect={onFileSelect}
              onSessionSelect={onSessionSelect}
              sessionNames={sessionNames}
              onForkAsk={onForkAsk}
            />
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 to-transparent" />
          </div>
        )}
        {needCollapse && (
          <button
            onClick={onToggleExpand}
            className={`text-[11px] font-medium mt-1 transition-colors duration-150 ${isExpanded ? 'text-gray-400 hover:text-gray-600' : 'text-blue-500 hover:text-blue-600'}`}
          >
            {isExpanded ? '收起' : '展开'}
          </button>
        )}
        {userForkPoints.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {userForkPoints.map((fp, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                </svg>
                forked: {fp.childName || '(unnamed)'}
              </span>
            ))}
          </div>
        )}
    </>
  )
}

function TurnCard({
  turn,
  isExpanded,
  onToggleExpand,
  annotatingTarget,
  onEnterAnnotation,
  onExitAnnotation,
  onSendFeedback,
  onForkClick,
  forkInputMessageId,
  forkEntryId,
  onForkClose,
  onForkAtEntry,
  forkPoints,
  isStreaming,
  streamingMessageId,
  onFileSelect,
  onSessionSelect,
  sessionNames,
  onQuoteMessage,
  onForwardClick,
  sessions,
  captureEnabled,
  onInspect,
  onForkAsk,
}: {
  turn: ConversationTurn
  isFirst: boolean
  isLast: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
  onForkClick: (messageId: string, piEntryId: string | undefined) => void
  forkInputMessageId: string | null
  forkEntryId: string | null
  onForkClose: () => void
  onForkAtEntry: (entryId: string, name: string) => void
  forkPoints: ForkPoint[]
  isStreaming: boolean
  streamingMessageId: string | null
  onFileSelect?: (filePath: string) => void
  onSessionSelect?: (sessionName: string) => void
  sessionNames?: Set<string>
  onQuoteMessage?: (messageId: string, role: 'user' | 'assistant', content: string, timestamp: number) => void
  onForwardClick?: (messageId: string, role: 'user' | 'assistant', content: string) => void
  sessions?: Array<{ filePath: string; name: string | null; isMain: boolean }>
  captureEnabled?: boolean
  onInspect?: (messageId: string) => void
  onForkAsk?: (anchor: ChangeAnchor) => void
}): React.ReactElement {
  const userSummary = getUserSummary(turn.userMessage)
  const allUserBlocks = turn.userMessage.blocks
  const userTextBlocks = allUserBlocks.filter((b): b is TextBlock => b.type === 'text' && !b.subtype)
  const userTextContent = userTextBlocks.map((b) => b.content).join('\n')
  const allAgentBlocks = turn.assistantMessages.flatMap((m) => m.blocks)
  const agentTextBlocks = allAgentBlocks.filter((b): b is TextBlock => b.type === 'text' && !b.subtype)
  const agentTextContent = agentTextBlocks.map((b) => b.content).join('\n')
  const firstAgentMsg = turn.assistantMessages[0]

  const isUserStreaming = isStreaming && streamingMessageId != null && turn.userMessage.id === streamingMessageId
  const isAgentStreaming = isStreaming && (streamingMessageId != null ? turn.assistantMessages.some(m => m.id === streamingMessageId) : true)

  const userActions = (
    <div className="relative flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
      <CopyButton blocks={allUserBlocks} />
      {onQuoteMessage && !isUserStreaming && (
        <button
          onClick={() => onQuoteMessage(turn.userMessage.id, 'user', userTextContent, turn.userMessage.timestamp ?? Date.now())}
          className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
          title="Quote message"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        </button>
      )}
      {onForwardClick && sessions && !isUserStreaming && (
        <button
          onClick={() => onForwardClick(turn.userMessage.id, 'user', userTextContent)}
          className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
          title="Forward to session"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      )}
      {captureEnabled && !isUserStreaming && onInspect && (
        <button
          onClick={() => onInspect(turn.userMessage.id)}
          className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
          title="Inspect prompt"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </button>
      )}
      <button
        onClick={() => onForkClick(turn.userMessage.id, turn.userMessage.piEntryId)}
        className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
        title="Fork from here"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 001.5 0zm-3 8.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" />
        </svg>
      </button>
      {forkInputMessageId === turn.userMessage.id && forkEntryId && (
        <ForkNameInput
          onForkAtEntry={onForkAtEntry}
          onClose={onForkClose}
          defaultEntryId={forkEntryId}
        />
      )}
    </div>
  )

  const agentActions = (
    <div className={`flex items-center gap-0.5 ${isAgentStreaming ? 'opacity-0 pointer-events-none' : ''}`}>
      {!isAgentStreaming && <CopyButton blocks={allAgentBlocks} />}
      {onQuoteMessage && !isAgentStreaming && firstAgentMsg && (
        <button
          onClick={() => onQuoteMessage(firstAgentMsg.id, 'assistant', agentTextContent, firstAgentMsg.timestamp ?? Date.now())}
          className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
          title="Quote message"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        </button>
      )}
      {onForwardClick && sessions && !isAgentStreaming && firstAgentMsg && (
        <button
          onClick={() => onForwardClick(firstAgentMsg.id, 'assistant', agentTextContent)}
          className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
          title="Forward to session"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      )}
      {firstAgentMsg && !isAgentStreaming && (
        <button
          onClick={() => onForkClick(firstAgentMsg.id, firstAgentMsg.piEntryId)}
          className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
          title="Fork from here"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 001.5 0zm-3 8.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" />
          </svg>
        </button>
      )}
      {firstAgentMsg && !isAgentStreaming && forkInputMessageId === firstAgentMsg.id && forkEntryId && (
        <ForkNameInput
          onForkAtEntry={onForkAtEntry}
          onClose={onForkClose}
          defaultEntryId={forkEntryId}
        />
      )}
    </div>
  )

  return (
    <div className="space-y-2">
      {/* User message — same style as normal mode */}
      <div className="group flex items-center justify-end gap-2">
        {userActions}
        <div className="max-w-[85%] min-w-0 xi-bubble-user px-3 py-2">
          <MessageBlocksRenderer
            msg={turn.userMessage}
            isStreaming={isStreaming}
            streamingMessageId={streamingMessageId}
            annotatingTarget={annotatingTarget}
            onEnterAnnotation={onEnterAnnotation}
            onExitAnnotation={onExitAnnotation}
            onSendFeedback={onSendFeedback}
            onFileSelect={onFileSelect}
            onSessionSelect={onSessionSelect}
            sessionNames={sessionNames}
            onForkAsk={onForkAsk}
          />
        </div>
        <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-blue-500">
          You
        </div>
      </div>

      {/* Agent message — same style as normal mode, with collapse */}
      <div className="group">
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm font-serif text-white bg-orange-500">
            ξ
          </div>
          <div className="flex-1 min-w-0 xi-bubble px-3 py-2">
            <CollapsibleAgentContent
              turn={turn}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              annotatingTarget={annotatingTarget}
              onEnterAnnotation={onEnterAnnotation}
              onExitAnnotation={onExitAnnotation}
              onSendFeedback={onSendFeedback}
              onFileSelect={onFileSelect}
              onSessionSelect={onSessionSelect}
              sessionNames={sessionNames}
              isStreaming={isStreaming}
              streamingMessageId={streamingMessageId}
              forkPoints={forkPoints}
              onForkClick={onForkClick}
              forkInputMessageId={forkInputMessageId}
              forkEntryId={forkEntryId}
              onForkClose={onForkClose}
              onForkAtEntry={onForkAtEntry}
              onQuoteMessage={onQuoteMessage}
              onForwardClick={onForwardClick}
              sessions={sessions}
              onForkAsk={onForkAsk}
            />
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 w-6 h-6" />
          <div>
            {agentActions}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Tool name to color mapping */
const TOOL_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  read: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', dot: '#059669' },
  write: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', dot: '#36d399' },
  edit: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', dot: '#d97706' },
  bash: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200', dot: '#9ca3af' },
  ls: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', dot: '#7c3aed' },
  find: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20', dot: '#db2777' },
  grep: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', dot: '#0891b2' },
  search_sessions: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20', dot: '#ea580c' },
}

function OutlineRow({
  turn,
  isExpanded,
  onToggleExpand,
  annotatingTarget,
  onEnterAnnotation,
  onExitAnnotation,
  onSendFeedback,
  onForkClick,
  forkInputMessageId,
  forkEntryId,
  onForkClose,
  onForkAtEntry,
  forkPoints,
  isStreaming,
  streamingMessageId,
  onFileSelect,
  onSessionSelect,
  sessionNames,
  onQuoteMessage,
  onForwardClick,
  sessions,
}: {
  turn: ConversationTurn
  isFirst: boolean
  isLast: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
  onForkClick: (messageId: string, piEntryId: string | undefined) => void
  forkInputMessageId: string | null
  forkEntryId: string | null
  onForkClose: () => void
  onForkAtEntry: (entryId: string, name: string) => void
  forkPoints: ForkPoint[]
  isStreaming: boolean
  streamingMessageId: string | null
  onFileSelect?: (filePath: string) => void
  onSessionSelect?: (sessionName: string) => void
  sessionNames?: Set<string>
  onQuoteMessage?: (messageId: string, role: 'user' | 'assistant', content: string, timestamp: number) => void
  onForwardClick?: (messageId: string, role: 'user' | 'assistant', content: string) => void
  sessions?: Array<{ filePath: string; name: string | null; isMain: boolean }>
}): React.ReactElement {
  const userSummary = getUserSummary(turn.userMessage)
  const allTools = turn.assistantMessages.flatMap((m) => m.blocks.filter((b): b is ToolCallBlock => b.type === 'tool_call'))

  // Color dots for tools
  const toolDots = allTools.map((tool, i) => {
    const c = TOOL_COLORS[tool.toolName] || TOOL_COLORS.bash
    return <span key={i} style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: c.dot }} />
  })

  return (
    <div>
      {/* Main row: one line per turn */}
      <div
        className="flex items-center gap-3 px-3 py-2 rounded cursor-pointer hover:bg-gray-50 transition-colors duration-150"
        onClick={onToggleExpand}
      >
        <span className="text-[11px] font-mono text-gray-300 w-4 text-right flex-shrink-0">{turn.index}</span>
        <span className="text-[13px] text-gray-700 flex-1 truncate">{userSummary}</span>
        <div className="flex items-center gap-0.5 flex-shrink-0">{toolDots}</div>
      </div>

      {/* Expanded: tool list + agent summary */}
      {isExpanded && (
        <div className="ml-9 mr-3 mb-1 pl-4 border-l border-gray-200 space-y-0.5">
          {allTools.map((tool, i) => {
            const c = TOOL_COLORS[tool.toolName] || TOOL_COLORS.bash
            const headerSummary = tool.toolName === 'ls' ? (tool.args.path ? String(tool.args.path) : '.') : tool.toolName === 'find' ? [tool.args.pattern ? String(tool.args.pattern).substring(0, 50) : '', tool.args.path ? String(tool.args.path) : ''].filter(Boolean).join(' in ') : tool.args.path ? String(tool.args.path) : tool.args.command ? String(tool.args.command).substring(0, 50) : tool.args.pattern ? String(tool.args.pattern).substring(0, 50) : tool.args.query ? String(tool.args.query).substring(0, 50) : ''
            return (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${c.bg} ${c.text} ${c.border}`}>{tool.toolName}</span>
                <span className="text-[11px] text-gray-400 mono truncate">{headerSummary}</span>
              </div>
            )
          })}
          {turn.assistantMessages.some(m => m.blocks.some(b => b.type === 'text' && !b.subtype)) && (
            <div className="flex items-center gap-2 py-0.5">
              <div className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-xs font-serif text-white bg-orange-500">ξ</div>
              <span className="text-[11px] text-gray-400 truncate">{getAgentSummary(turn.assistantMessages)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SessionPickerModal({ sessions, currentSessionPath, onSelect, onClose }: { sessions: Array<{ filePath: string; name: string | null; isMain: boolean }>; currentSessionPath?: string; onSelect: (sessionPath: string) => void; onClose: () => void }): React.ReactElement {
  const [query, setQuery] = useState('')
  const filtered = sessions.filter(s => {
    if (s.filePath === currentSessionPath) return false
    const name = s.name || (s.isMain ? 'Main' : 'Session')
    return name.toLowerCase().includes(query.toLowerCase())
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-72 rounded-lg border border-gray-200 bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-200 px-3 py-2">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full text-sm outline-none"
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && filtered.length > 0) onSelect(filtered[0].filePath)
            }}
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-gray-400">No sessions found</div>
          )}
          {filtered.map(s => (
            <button
              key={s.filePath}
              onClick={() => onSelect(s.filePath)}
              className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 flex items-center gap-2 cursor-pointer transition-colors duration-150"
            >
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 000 1.5zm-3 8.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" />
              </svg>
              <span className="truncate">{s.name || (s.isMain ? 'Main' : 'Session')}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SessionSummaryCard({ summary, onSave, sessionPath, isDark }: { summary: string; onSave: (sessionPath: string, summary: string) => Promise<boolean>; sessionPath: string | null; isDark: boolean }): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(summary)
  const [isSaving, setIsSaving] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const handleSave = useCallback(async () => {
    if (!sessionPath) return
    setIsSaving(true)
    try {
      await onSave(sessionPath, editText.trim())
    } finally {
      setIsSaving(false)
    }
    setIsEditing(false)
  }, [editText, onSave, sessionPath])

  const handleCancel = useCallback(() => {
    setEditText(summary)
    setIsEditing(false)
  }, [summary])

  const cardStyle: React.CSSProperties = isDark
    ? { backgroundColor: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.20)' }
    : { backgroundColor: 'rgba(255, 251, 235, 0.95)', borderColor: '#fde68a' }

  const titleColor = isDark ? '#fbbf24' : '#d97706'
  const titleHoverColor = isDark ? '#fcd34d' : '#b45309'
  const editHoverBg = isDark ? 'rgba(245, 158, 11, 0.12)' : '#fef3c7'
  const textColor = isDark ? '#e5e7eb' : '#78350f'
  const textareaBg = isDark ? '#1e2026' : '#ffffff'
  const textareaText = isDark ? '#e5e7eb' : '#1f2937'
  const textareaBorder = isDark ? 'rgba(245, 158, 11, 0.30)' : '#fcd34d'
  const saveBtnBg = isDark ? '#d97706' : '#d97706'
  const saveBtnHoverBg = isDark ? '#b45309' : '#b45309'
  const cancelBtnBg = isDark ? '#2c2f36' : '#e5e7eb'
  const cancelBtnText = isDark ? '#d1d5db' : '#374151'
  const cancelBtnHoverBg = isDark ? '#343840' : '#d1d5db'

  return (
    <div className="rounded-lg backdrop-blur-sm border shadow-sm" style={cardStyle}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 font-medium text-xs transition-colors duration-150"
          style={{ color: titleColor }}
          onMouseEnter={(e) => { e.currentTarget.style.color = titleHoverColor }}
          onMouseLeave={(e) => { e.currentTarget.style.color = titleColor }}
        >
          <svg className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <span className="w-3 h-3 flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="9" x2="15" y2="9" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
          </span>
          <span>Summary</span>
        </button>
        <div className="flex items-center gap-0.5">
          {!isEditing && !collapsed && (
            <button
              onClick={() => { setEditText(summary); setIsEditing(true) }}
              className="rounded p-1 transition-colors duration-150"
              style={{ color: titleColor }}
              onMouseEnter={(e) => { e.currentTarget.style.color = titleHoverColor; e.currentTarget.style.backgroundColor = editHoverBg }}
              onMouseLeave={(e) => { e.currentTarget.style.color = titleColor; e.currentTarget.style.backgroundColor = 'transparent' }}
              title="Edit summary"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        isEditing ? (
          <div className="px-3 pb-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs resize-y min-h-[60px] focus:outline-none focus:ring-2"
              style={{
                backgroundColor: textareaBg,
                color: textareaText,
                borderColor: textareaBorder,
                '--tw-ring-color': isDark ? 'rgba(245, 158, 11, 0.4)' : '#fbbf24',
              } as React.CSSProperties}
              autoFocus
            />
            <div className="flex items-center gap-2 mt-1.5">
              <button
                onClick={handleSave}
                disabled={isSaving || !editText.trim()}
                className="rounded px-2.5 py-0.5 text-[11px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: saveBtnBg }}
                onMouseEnter={(e) => { if (!isSaving && editText.trim()) e.currentTarget.style.backgroundColor = saveBtnHoverBg }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = saveBtnBg }}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleCancel}
                className="rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors"
                style={{ backgroundColor: cancelBtnBg, color: cancelBtnText }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = cancelBtnHoverBg }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = cancelBtnBg }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="px-3 pb-2">
            <p className="text-xs whitespace-pre-wrap leading-relaxed line-clamp-3" style={{ color: textColor }}>{summary}</p>
          </div>
        )
      )}
    </div>
  )
}

function ChatView({ messages, isStreaming, streamingMessageId, onSendPrompt, pendingUiRequests, respondToUiRequest, onForkAtEntry, getForkMessages, forkPoints, viewMode, onFileSelect, onSessionSelect, onQuoteMessage, onForwardMessage, currentSessionPath, sessions, onInspectPrompt, captureEnabled, sessionSummary, onSetSessionSummary, currentSessionPathForSummary, onForkAskConfirm }: ChatViewProps): React.ReactElement {
  const sessionNames = useMemo(() => new Set((sessions ?? []).map(s => s.name).filter(Boolean) as string[]), [sessions])
  const [isDark, setIsDark] = useState(() => !document.documentElement.classList.contains('light'))
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(!document.documentElement.classList.contains('light'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const savedScrollTopRef = useRef<number>(0)
  const userScrolledUpRef = useRef(false)
  const scrollPositionsRef = useRef<Map<string, number>>(new Map())
  // Track whether user was at the bottom when leaving a session/tab
  // so we can auto-scroll to the new bottom on return if they were at bottom
  const wasAtBottomRef = useRef<Map<string, boolean>>(new Map())
  const prevSessionPathRef = useRef<string | undefined>(currentSessionPath)
  const isRestoringScrollRef = useRef(false)
  const currentSessionPathRef = useRef(currentSessionPath)
  currentSessionPathRef.current = currentSessionPath
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [annotatingTarget, setAnnotatingTarget] = useState<{
    messageId: string
    blockIndex: number
  } | null>(null)
  const [forkInputMessageId, setForkInputMessageId] = useState<string | null>(null)
  const [forkEntryId, setForkEntryId] = useState<string | null>(null)
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set())
  const [forwardingMessage, setForwardingMessage] = useState<{ id: string; role: 'user' | 'assistant'; content: string } | null>(null)
  const [inspectorMessageId, setInspectorMessageId] = useState<string | null>(null)
  const [inspectorSnapshot, setInspectorSnapshot] = useState<PromptSnapshot | null>(null)
  const [inspectorLoading, setInspectorLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    messageId: string
    messageRole: 'user' | 'assistant'
    messageBlocks: ContentBlock[]
    selectedText?: string
  } | null>(null)
  const [forkAskAnchor, setForkAskAnchor] = useState<ChangeAnchor | null>(null)

  const handleForkAsk = useCallback((anchor: ChangeAnchor) => {
    setForkAskAnchor(anchor)
  }, [])

  const handleEnterAnnotation = useCallback((messageId: string, blockIndex: number) => {
    setAnnotatingTarget({ messageId, blockIndex })
  }, [])

  const handleExitAnnotation = useCallback(() => {
    setAnnotatingTarget(null)
  }, [])

  const handleSendFeedback = useCallback(
    (description: string, imageData: string) => {
      onSendPrompt(description, [{ data: imageData, mimeType: 'image/png' }])
      setAnnotatingTarget(null)
    },
    [onSendPrompt],
  )

  const handleForkClick = useCallback(async (messageId: string, piEntryId: string | undefined) => {
    if (forkInputMessageId === messageId) {
      setForkInputMessageId(null)
      setForkEntryId(null)
      return
    }
    if (piEntryId) {
      setForkEntryId(piEntryId)
    } else {
      const msgs = await getForkMessages()
      const lastMsg = msgs[msgs.length - 1]
      setForkEntryId(lastMsg?.entryId ?? null)
    }
    setForkInputMessageId(messageId)
  }, [forkInputMessageId, getForkMessages])

  const toggleTurn = useCallback((turnId: string) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev)
      if (next.has(turnId)) {
        next.delete(turnId)
      } else {
        next.add(turnId)
      }
      return next
    })
  }, [])

  const handleForkClose = useCallback(() => {
    setForkInputMessageId(null)
    setForkEntryId(null)
  }, [])

  const handleInspect = useCallback(async (messageId: string) => {
    setInspectorMessageId(messageId)
    setInspectorSnapshot(null)
    setInspectorLoading(true)
    try {
      const result = await onInspectPrompt?.(messageId) ?? null
      setInspectorSnapshot(result)
    } finally {
      setInspectorLoading(false)
    }
  }, [onInspectPrompt])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const msgEl = (e.target as HTMLElement).closest('[data-msg-id]') as HTMLElement | null
    if (!msgEl) return
    e.preventDefault()
    const msgId = msgEl.dataset.msgId!
    const msgRole = msgEl.dataset.msgRole as 'user' | 'assistant'
    const msgBlocks = msgEl.dataset.msgBlocks
    // Check if user has selected text within this message
    const selection = window.getSelection()
    let selectedText: string | undefined
    if (selection && selection.toString().trim().length > 0) {
      const range = selection.getRangeAt(0)
      if (msgEl.contains(range.commonAncestorContainer)) {
        selectedText = selection.toString().trim()
      }
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      messageId: msgId,
      messageRole: msgRole,
      messageBlocks: msgBlocks ? JSON.parse(msgBlocks) : [],
      selectedText,
    })
  }, [])

  const scrollRafRef = useRef<number | null>(null)

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    savedScrollTopRef.current = el.scrollTop
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    isNearBottomRef.current = nearBottom
    // Continuously save scroll position per-session so it's available
    // even when the browser resets scrollTop on display:none
    const sp = currentSessionPathRef.current
    if (sp) {
      scrollPositionsRef.current.set(sp, el.scrollTop)
      // Continuously track near-bottom state per-session
      wasAtBottomRef.current.set(sp, nearBottom)
    }
    if (nearBottom) {
      userScrolledUpRef.current = false
    } else {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
    setShowScrollToBottom(!nearBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      const sp = currentSessionPathRef.current
      if (sp) {
        scrollPositionsRef.current.set(sp, el.scrollTop)
      }
    }
    isNearBottomRef.current = true
    userScrolledUpRef.current = false
    setShowScrollToBottom(false)
  }, [])

  // Save/restore scroll position when switching sessions
  useEffect(() => {
    if (currentSessionPath === prevSessionPathRef.current) return

    const el = scrollContainerRef.current

    // Save previous session's scroll position
    // Prefer the continuously-updated scrollPositionsRef (from handleScroll),
    // fall back to savedScrollTopRef / el.scrollTop
    if (prevSessionPathRef.current != null) {
      if (!scrollPositionsRef.current.has(prevSessionPathRef.current) && el) {
        scrollPositionsRef.current.set(prevSessionPathRef.current, el.scrollTop || savedScrollTopRef.current)
      }
      // Remember if user was at bottom for this session
      wasAtBottomRef.current.set(prevSessionPathRef.current, isNearBottomRef.current)
    }

    // Mark that we're restoring to prevent auto-scroll interference
    isRestoringScrollRef.current = true

    const saved = currentSessionPath ? scrollPositionsRef.current.get(currentSessionPath) : undefined
    const wasAtBottom = currentSessionPath ? wasAtBottomRef.current.get(currentSessionPath) : undefined

    const rafId = requestAnimationFrame(() => {
      isRestoringScrollRef.current = false
      const el = scrollContainerRef.current
      if (!el) return
      // If user was at the bottom when they left this session, scroll to the
      // new bottom (content may have changed while away)
      if (wasAtBottom) {
        el.scrollTop = el.scrollHeight
        isNearBottomRef.current = true
      } else if (saved != null) {
        el.scrollTop = saved
        isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      } else {
        el.scrollTop = el.scrollHeight
        isNearBottomRef.current = true
      }
      setShowScrollToBottom(!isNearBottomRef.current)
    })

    prevSessionPathRef.current = currentSessionPath
    return () => {
      cancelAnimationFrame(rafId)
      isRestoringScrollRef.current = false
    }
  }, [currentSessionPath])

  // Handle tab visibility changes (display:none ↔ display:block)
  // When the container becomes display:none, the browser resets scrollTop to 0.
  // So we rely on handleScroll to continuously save positions — we only need
  // to restore here when the container becomes visible again.
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    let wasVisible = el.clientHeight > 0
    let pendingRaf: number | null = null

    const observer = new ResizeObserver(() => {
      const isVisible = el.clientHeight > 0
      if (isVisible && !wasVisible) {
        // Became visible — restore scroll position for current session
        const sp = currentSessionPathRef.current
        const saved = sp ? scrollPositionsRef.current.get(sp) : undefined
        const wasAtBottom = sp ? wasAtBottomRef.current.get(sp) : undefined

        // Guard against auto-scroll overwriting our restore
        isRestoringScrollRef.current = true

        // Cancel any previous pending restore
        if (pendingRaf !== null) cancelAnimationFrame(pendingRaf)

        // Use double-rAF to ensure the browser has finished layout after
        // switching from display:none to display:block
        requestAnimationFrame(() => {
          pendingRaf = requestAnimationFrame(() => {
            pendingRaf = null
            isRestoringScrollRef.current = false
            // If user was at the bottom when they left, scroll to new bottom
            if (wasAtBottom) {
              el.scrollTop = el.scrollHeight
              isNearBottomRef.current = true
            } else if (saved != null) {
              el.scrollTop = saved
              isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            } else {
              el.scrollTop = el.scrollHeight
              isNearBottomRef.current = true
            }
            setShowScrollToBottom(!isNearBottomRef.current)
          })
        })
      }
      // No need to save on hidden — handleScroll already saves continuously
      wasVisible = isVisible
    })

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf)
      isRestoringScrollRef.current = false
    }
  }, [])

  // Auto-scroll on new messages (respects session-switch restoration)
  useEffect(() => {
    // Don't auto-scroll while restoring scroll position from session switch
    if (isRestoringScrollRef.current) return
    // Don't auto-scroll when hidden (display: none)
    const el = scrollContainerRef.current
    if (el && el.clientHeight === 0) return

    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'user') {
      userScrolledUpRef.current = false
      isNearBottomRef.current = true
    }
    if (userScrolledUpRef.current) return
    if (!isNearBottomRef.current) return
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const el = scrollContainerRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [messages, isStreaming])

  useEffect(() => {
    if (!isStreaming) {
      userScrolledUpRef.current = false
      return
    }
    const el = scrollContainerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userScrolledUpRef.current = true
        if (scrollRafRef.current !== null) {
          cancelAnimationFrame(scrollRafRef.current)
          scrollRafRef.current = null
        }
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [isStreaming])

  const turns = viewMode !== 'normal' ? groupByTurns(messages) : []

  return (
    <div className="relative flex h-full">
      <div ref={scrollContainerRef} onScroll={handleScroll} onContextMenu={handleContextMenu} className="flex-1 overflow-y-auto bg-white px-4 py-6">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-400">Start a conversation with Xi</p>
            <p className="mt-2 text-sm text-gray-400">Type a message below or connect to Xi first</p>
          </div>
        </div>
      ) : viewMode === 'normal' ? (
        <div className="mx-auto max-w-2xl xl:max-w-4xl 2xl:max-w-5xl space-y-3">
          {(() => {
            // Group consecutive same-role messages
            const groups: { role: 'user' | 'assistant'; msgs: ChatMessage[] }[] = []
            for (const msg of messages) {
              if (msg.role === 'system') continue
              const last = groups[groups.length - 1]
              if (last && last.role === msg.role) {
                last.msgs.push(msg)
              } else {
                groups.push({ role: msg.role as 'user' | 'assistant', msgs: [msg] })
              }
            }

            return groups.map((group, gi) => {
              const isUser = group.role === 'user'
              const allBlocks = group.msgs.flatMap((m) => m.blocks)
              const firstMsg = group.msgs[0]
              const msgForkPoints = forkPoints.filter((fp) => group.msgs.some((m) => m.piEntryId === fp.entryId))
              const msgTextBlocks = allBlocks.filter((b): b is TextBlock => b.type === 'text' && !b.subtype)
              const msgTextContent = msgTextBlocks.map((b) => b.content).join('\n')
              const isGroupStreaming = isStreaming && (streamingMessageId != null ? group.msgs.some(m => m.id === streamingMessageId) : !isUser)

              const actions = (
                <div className={`relative flex items-center gap-0.5 transition-opacity flex-shrink-0 mt-0.5 ${isGroupStreaming ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
                  {!isGroupStreaming && <CopyButton blocks={allBlocks} />}
                  {onQuoteMessage && !isGroupStreaming && (
                    <button
                      onClick={() => onQuoteMessage(firstMsg.id, isUser ? 'user' : 'assistant', msgTextContent, firstMsg.timestamp ?? Date.now())}
                      className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
                      title="Quote message"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                      </svg>
                    </button>
                  )}
                  {onForwardMessage && sessions && !isGroupStreaming && (
                    <button
                      onClick={() => setForwardingMessage({ id: firstMsg.id, role: isUser ? 'user' : 'assistant', content: msgTextContent })}
                      className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
                      title="Forward to session"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                      </svg>
                    </button>
                  )}
                  {isUser && captureEnabled && !isGroupStreaming && (
                    <button
                      onClick={() => handleInspect(firstMsg.id)}
                      className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
                      title="Inspect prompt"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                      </svg>
                    </button>
                  )}
                  {!isGroupStreaming && (
                  <button
                    onClick={() => handleForkClick(firstMsg.id, firstMsg.piEntryId)}
                    className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-150"
                    title="Fork from here"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 001.5 0zm-3 8.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" />
                    </svg>
                  </button>
                  )}
                  {!isGroupStreaming && forkInputMessageId === firstMsg.id && forkEntryId && (
                    <ForkNameInput
                      onForkAtEntry={onForkAtEntry}
                      onClose={() => { setForkInputMessageId(null); setForkEntryId(null) }}
                      defaultEntryId={forkEntryId}
                    />
      )}
    </div>
  )

              return isUser ? (
                <div
                  key={gi}
                  data-msg-id={firstMsg.id}
                  data-msg-role="user"
                  className="group flex items-center justify-end gap-2"
                >
                  {actions}
                  <div className="max-w-[85%] min-w-0 xi-bubble-user px-3 py-2">
                    <MergedBlocksRenderer
                      messages={group.msgs}
                      isStreaming={isStreaming}
                      streamingMessageId={streamingMessageId}
                      annotatingTarget={annotatingTarget}
                      onEnterAnnotation={handleEnterAnnotation}
                      onExitAnnotation={handleExitAnnotation}
                      onSendFeedback={handleSendFeedback}
                      onFileSelect={onFileSelect}
                      onSessionSelect={onSessionSelect}
                      sessionNames={sessionNames}
                      onForkAsk={handleForkAsk}
                    />
                    {msgForkPoints.length > 0 && (
                      <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                        {msgForkPoints.map((fp, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                            </svg>
                            forked: {fp.childName || '(unnamed)'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-blue-500">
                    You
                  </div>
                </div>
              ) : (
                <div
                  key={gi}
                  data-msg-id={firstMsg.id}
                  data-msg-role="assistant"
                  className="group"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm font-serif text-white bg-orange-500">
                      ξ
                    </div>
                    <div className="flex-1 min-w-0 xi-bubble px-3 py-2">
                      <MergedBlocksRenderer
                        messages={group.msgs}
                        isStreaming={isStreaming}
                        streamingMessageId={streamingMessageId}
                        annotatingTarget={annotatingTarget}
                        onEnterAnnotation={handleEnterAnnotation}
                        onExitAnnotation={handleExitAnnotation}
                        onSendFeedback={handleSendFeedback}
                        onFileSelect={onFileSelect}
                        onSessionSelect={onSessionSelect}
                        sessionNames={sessionNames}
                        onForkAsk={handleForkAsk}
                      />
                      {msgForkPoints.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {msgForkPoints.map((fp, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                              </svg>
                              forked: {fp.childName || '(unnamed)'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-6 h-6" />
                    <div>
                      {actions}
                    </div>
                  </div>
                </div>
              )
            })
          })()}
          <div ref={bottomRef} />
        </div>
      ) : viewMode === 'turn' ? (
        <div className="mx-auto max-w-2xl xl:max-w-4xl 2xl:max-w-5xl space-y-4">
          {turns.map((turn, idx) => (
            <TurnCard
              key={turn.id}
              turn={turn}
              isExpanded={expandedTurns.has(turn.id)}
              onToggleExpand={() => toggleTurn(turn.id)}
              annotatingTarget={annotatingTarget}
              onEnterAnnotation={handleEnterAnnotation}
              onExitAnnotation={handleExitAnnotation}
              onSendFeedback={handleSendFeedback}
              onForkClick={handleForkClick}
              forkInputMessageId={forkInputMessageId}
              forkEntryId={forkEntryId}
              onForkClose={handleForkClose}
              onForkAtEntry={onForkAtEntry}
              forkPoints={forkPoints}
              isStreaming={isStreaming}
              streamingMessageId={streamingMessageId}
              onFileSelect={onFileSelect}
              onSessionSelect={onSessionSelect}
              sessionNames={sessionNames}
              onQuoteMessage={onQuoteMessage}
              onForwardClick={(id, role, content) => setForwardingMessage({ id, role, content })}
              sessions={sessions}
              captureEnabled={captureEnabled}
              onInspect={(id) => { handleInspect(id) }}
              onForkAsk={handleForkAsk}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      ) : (
        <div className="mx-auto max-w-xl xl:max-w-3xl space-y-0">
          {turns.map((turn, idx) => (
            <OutlineRow
              key={turn.id}
              turn={turn}
              isExpanded={expandedTurns.has(turn.id)}
              onToggleExpand={() => toggleTurn(turn.id)}
              annotatingTarget={annotatingTarget}
              onEnterAnnotation={handleEnterAnnotation}
              onExitAnnotation={handleExitAnnotation}
              onSendFeedback={handleSendFeedback}
              onForkClick={handleForkClick}
              forkInputMessageId={forkInputMessageId}
              forkEntryId={forkEntryId}
              onForkClose={handleForkClose}
              onForkAtEntry={onForkAtEntry}
              forkPoints={forkPoints}
              isStreaming={isStreaming}
              streamingMessageId={streamingMessageId}
              onFileSelect={onFileSelect}
              onSessionSelect={onSessionSelect}
              sessionNames={sessionNames}
              onQuoteMessage={onQuoteMessage}
              onForwardClick={(id, role, content) => setForwardingMessage({ id, role, content })}
              sessions={sessions}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
      </div>
      {sessionSummary && onSetSessionSummary && messages.length > 0 && (
        <div className="absolute top-2 left-4 right-4 z-10 pointer-events-none">
          <div className="mx-auto max-w-2xl xl:max-w-4xl 2xl:max-w-5xl pointer-events-auto">
            <SessionSummaryCard summary={sessionSummary} onSave={onSetSessionSummary} sessionPath={currentSessionPathForSummary ?? null} isDark={isDark} />
          </div>
        </div>
      )}
      {showScrollToBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white shadow-lg border border-gray-200 p-2 text-gray-500 hover:text-gray-700 hover:shadow-xl transition-all cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
          </svg>
        </button>
      )}
      {forwardingMessage && onForwardMessage && sessions && (
        <SessionPickerModal
          sessions={sessions}
          currentSessionPath={currentSessionPath}
          onSelect={(sessionPath) => {
            onForwardMessage(forwardingMessage.id, forwardingMessage.role, forwardingMessage.content, sessionPath)
            setForwardingMessage(null)
          }}
          onClose={() => setForwardingMessage(null)}
        />
      )}
      {forkAskAnchor && onForkAskConfirm && (
        <ForkAskDialog
          anchor={forkAskAnchor}
          isDark={isDark}
          onConfirm={(sessionName, question) => {
            onForkAskConfirm(forkAskAnchor, sessionName, question)
            setForkAskAnchor(null)
          }}
          onClose={() => setForkAskAnchor(null)}
        />
      )}
      {contextMenu && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }}
          />
          <ChatContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            messageBlocks={contextMenu.messageBlocks}
            messageRole={contextMenu.messageRole}
            isStreaming={isStreaming && (streamingMessageId != null ? contextMenu.messageId === streamingMessageId : contextMenu.messageRole === 'assistant')}
            selectedText={contextMenu.selectedText}
            onQuote={(selectedText) => {
              if (!onQuoteMessage) return
              const textContent = selectedText ?? contextMenu.messageBlocks
                .filter((b): b is TextBlock => b.type === 'text' && !b.subtype)
                .map((b) => b.content)
                .join('\n')
              const msg = messages.find(m => m.id === contextMenu.messageId)
              onQuoteMessage(contextMenu.messageId, contextMenu.messageRole, textContent, msg?.timestamp ?? Date.now())
            }}
            onForward={(selectedText) => {
              const textContent = selectedText ?? contextMenu.messageBlocks
                .filter((b): b is TextBlock => b.type === 'text' && !b.subtype)
                .map((b) => b.content)
                .join('\n')
              setForwardingMessage({ id: contextMenu.messageId, role: contextMenu.messageRole, content: textContent })
            }}
            onFork={() => {
              const msg = messages.find(m => m.id === contextMenu.messageId)
              handleForkClick(contextMenu.messageId, msg?.piEntryId)
            }}
            onClose={() => setContextMenu(null)}
          />
        </>,
        document.body
      )}
      {inspectorMessageId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => { setInspectorMessageId(null); setInspectorSnapshot(null) }}
          />
          <InspectorErrorBoundary onClose={() => { setInspectorMessageId(null); setInspectorSnapshot(null) }}>
            <PromptInspector
              snapshot={inspectorSnapshot}
              loading={inspectorLoading}
              onClose={() => { setInspectorMessageId(null); setInspectorSnapshot(null) }}
            />
          </InspectorErrorBoundary>
        </>
      )}
    </div>
  )
}

export default ChatView

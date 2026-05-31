import { useState, useCallback, useEffect, useRef, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  ChatMessage,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolResultBlock,
  ImageBlock,
  HtmlBlock,
  Annotation,
} from '../types/message'
import type { ForkableMessage, ForkPoint } from '../types/session'
import { ImageAnnotator, annotationsToPrompt } from './ImageAnnotator'
import type { ImageAnnotatorHandle } from './ImageAnnotator'
import type { ViewMode } from '../utils/compact-view'
import { groupByTurns, getUserSummary, getAgentSummary } from '../utils/compact-view'
import type { ConversationTurn } from '../utils/compact-view'

// Slot constants — same as sidebar tree-line-fix for precise alignment
const SLOT_W = 16
const LINE_LEFT = 8
const GRAY = '#e5e7eb'
const BLUE = '#3b82f6'

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
      className="rounded px-2 py-0.5 text-xs text-gray-400 opacity-0 transition-opacity hover:text-gray-600 hover:bg-gray-100 group-hover:opacity-100"
      title="Copy text"
    >
      {copied ? '✓' : 'Copy'}
    </button>
  )
}

function TextBlockRenderer({ block, isStreaming }: { block: TextBlock; isStreaming?: boolean }): React.ReactElement {
  // Thinking content uses its own renderer
  if (block.subtype === 'thinking') {
    return <ThinkingBlockRenderer content={block.content} isStreaming={isStreaming} />
  }

  // During streaming, skip expensive ReactMarkdown parsing to reduce flicker.
  // Use lightweight <pre>-based rendering; switch to full markdown once stable.
  if (isStreaming) {
    return (
      <div className="prose prose-sm max-w-none whitespace-pre-wrap break-words text-sm leading-relaxed">
        {block.content}
        <span className="inline-block w-1.5 h-4 ml-0.5 bg-gray-400 animate-pulse align-text-bottom" />
      </div>
    )
  }
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
    </div>
  )
}

function ThinkingBlockRenderer({ content, isStreaming }: { content: string; isStreaming?: boolean }): React.ReactElement {
  const [collapsed, setCollapsed] = useState(true)
  const lineCount = content.split('\n').length
  const firstLine = content.split('\n')[0] || 'Thinking...'

  if (isStreaming) {
    return (
      <div className="py-2 border-l-3 border-purple-300 pl-3">
        <div className="flex items-center gap-2 text-xs font-medium text-purple-600">
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Thinking...
        </div>
        <div className="mt-1 whitespace-pre-wrap text-xs italic text-purple-500/80">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="py-2 border-l-3 border-purple-300 pl-3">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 text-left text-xs font-medium text-purple-600 hover:text-purple-800 transition-colors"
      >
        <svg
          className={`h-3 w-3 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span>Thinking</span>
        <span className="text-purple-400">({lineCount} line{lineCount !== 1 ? 's' : ''})</span>
      </button>
      {!collapsed && (
        <div className="whitespace-pre-wrap text-xs italic text-purple-700/70 leading-relaxed">
          {content}
        </div>
      )}
      {collapsed && (
        <div className="text-xs italic text-purple-400 truncate">
          {firstLine}
        </div>
      )}
    </div>
  )
}

const COLLAPSE_THRESHOLD = 15

const ToolCallRenderer = memo(function ToolCallRenderer({ block, result }: { block: ToolCallBlock; result?: ToolResultBlock }): React.ReactElement {
  // Always collapsed by default
  const [expanded, setExpanded] = useState(false)

  // Tool-specific header info
  const toolIcon: Record<string, string> = {
    bash: '▶',
    read: '📄',
    edit: '✏️',
    write: '📝',
  }
  const icon = toolIcon[block.toolName] ?? '🔧'

  // Build header summary based on tool type
  let headerSummary = ''
  switch (block.toolName) {
    case 'bash':
      headerSummary = block.args.command
        ? String(block.args.command).length > 80
          ? String(block.args.command).substring(0, 80) + '...'
          : String(block.args.command)
        : ''
      break
    case 'read':
      headerSummary = block.args.path ? String(block.args.path) : ''
      break
    case 'edit':
      headerSummary = block.args.path ? String(block.args.path) : ''
      break
    case 'write':
      headerSummary = block.args.path ? String(block.args.path) : ''
      break
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

  return (
    <div className="py-1 border-t border-gray-200/50 first:border-t-0">
      {/* Header line — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 py-1 text-left text-gray-600 hover:text-gray-900 transition-colors"
      >
        <span className="text-xs">{icon}</span>
        <span className="font-mono text-xs font-medium">{block.toolName}</span>
        {headerSummary && (
          <span className="flex-1 truncate font-mono text-xs text-gray-400">{headerSummary}</span>
        )}
        {!headerSummary && <span className="flex-1" />}
        {statusEl}
        <svg
          className={`h-3 w-3 text-gray-300 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </button>
      {/* Expandable details */}
      {expanded && (
        <div className="ml-4 border-l-2 border-gray-200 pl-3 py-1">
          {/* Args */}
          <pre className="overflow-x-auto text-xs text-gray-500">
            {JSON.stringify(block.args, null, 2)}
          </pre>
          {/* Output */}
          {resultText.trim().length > 0 && (
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
          )}
          {/* Non-text result content (images, html) */}
          {result && result.content.map((child, i) => {
            if (child.type === 'image') {
              return <ImageBlockRenderer key={`img-${i}`} block={child as ImageBlock} />
            }
            if (child.type === 'html') {
              return <HtmlBlockRenderer key={`html-${i}`} block={child as HtmlBlock} />
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
            className="rounded bg-gray-800/80 px-3 py-1 text-sm text-white hover:bg-gray-700"
          >
            +
          </button>
          <span className="rounded bg-gray-800/80 px-3 py-1 text-sm text-white">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setZoom((z) => Math.max(0.25, z - 0.25))
            }}
            className="rounded bg-gray-800/80 px-3 py-1 text-sm text-white hover:bg-gray-700"
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
}: {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
}): React.ReactElement {
  // Flatten all blocks, track which message each came from
  const allBlocks: { block: ContentBlock; msgId: string; blockIdx: number }[] = []
  for (const msg of messages) {
    msg.blocks.forEach((block, idx) => {
      allBlocks.push({ block, msgId: msg.id, blockIdx: idx })
    })
  }

  // Identify paired tool_result indices (right after their tool_call)
  const pairedResultIndices = new Set<number>()
  for (let j = 0; j < allBlocks.length; j++) {
    if (allBlocks[j].block.type === 'tool_call' && allBlocks[j + 1]?.block.type === 'tool_result') {
      pairedResultIndices.add(j + 1)
    }
  }

  // Render blocks in original order
  const elements: React.ReactElement[] = []

  for (let j = 0; j < allBlocks.length; j++) {
    const { block, msgId, blockIdx } = allBlocks[j]

    // Skip paired tool_result (will be rendered inside its tool_call)
    if (pairedResultIndices.has(j)) continue

    if (block.type === 'tool_call') {
      const result = allBlocks[j + 1]?.block.type === 'tool_result' ? allBlocks[j + 1].block as ToolResultBlock : undefined
      elements.push(
        <ToolCallRenderer key={`tc-${j}`} block={block} result={result} />
      )
      continue
    }

    if (block.type === 'tool_result') {
      // Orphan tool_result
      elements.push(
        <OrphanToolResultRenderer key={`tr-${j}`} block={block} />
      )
      continue
    }

    elements.push(
      <ContentBlockRenderer
        key={`cb-${j}`}
        block={block}
        messageId={msgId}
        blockIndex={blockIdx}
        isStreamingBlock={isStreaming && streamingMessageId === msgId && block.type === 'text'}
        annotatingTarget={annotatingTarget}
        onEnterAnnotation={onEnterAnnotation}
        onExitAnnotation={onExitAnnotation}
        onSendFeedback={onSendFeedback}
      />
    )
  }

  return <div className="space-y-3">{elements}</div>
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
}: {
  msg: ChatMessage
  isStreaming: boolean
  streamingMessageId: string | null
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
}): React.ReactElement {
  // Identify paired tool_result indices (right after their tool_call)
  const pairedResultIndices = new Set<number>()
  for (let j = 0; j < msg.blocks.length; j++) {
    if (msg.blocks[j].type === 'tool_call' && msg.blocks[j + 1]?.type === 'tool_result') {
      pairedResultIndices.add(j + 1)
    }
  }

  // Render blocks in original order
  const elements: React.ReactElement[] = []

  for (let j = 0; j < msg.blocks.length; j++) {
    const block = msg.blocks[j]

    // Skip paired tool_result (will be rendered inside its tool_call)
    if (pairedResultIndices.has(j)) continue

    if (block.type === 'tool_call') {
      const result = msg.blocks[j + 1]?.type === 'tool_result' ? msg.blocks[j + 1] as ToolResultBlock : undefined
      elements.push(
        <ToolCallRenderer key={`tc-${j}`} block={block} result={result} />
      )
      continue
    }

    if (block.type === 'tool_result') {
      // Orphan tool_result
      elements.push(
        <OrphanToolResultRenderer key={`tr-${j}`} block={block} />
      )
      continue
    }

    elements.push(
      <ContentBlockRenderer
        key={`cb-${j}`}
        block={block}
        messageId={msg.id}
        blockIndex={j}
        isStreamingBlock={isStreaming && streamingMessageId === msg.id && block.type === 'text'}
        annotatingTarget={annotatingTarget}
        onEnterAnnotation={onEnterAnnotation}
        onExitAnnotation={onExitAnnotation}
        onSendFeedback={onSendFeedback}
      />
    )
  }

  return <div className="space-y-3">{elements}</div>
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
}: {
  block: ContentBlock
  messageId: string
  blockIndex: number
  isStreamingBlock?: boolean
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
}): React.ReactElement | null {
  switch (block.type) {
    case 'text':
      return <TextBlockRenderer block={block} isStreaming={isStreamingBlock} />
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

function TurnDotSlot({ active, isFirst, isLast, isCollapsed, onClick }: {
  active: boolean
  isFirst: boolean
  isLast: boolean
  isCollapsed?: boolean
  onClick?: () => void
}) {
  const borderColor = active ? BLUE : GRAY
  return (
    <div
      className={`flex-shrink-0 relative${isCollapsed ? ' cursor-pointer' : ''}`}
      style={{ width: SLOT_W, alignSelf: 'stretch' }}
      onClick={isCollapsed ? onClick : undefined}
    >
      {/* Line above dot — from top to dot center (only if not first) */}
      {!isFirst && (
        <div
          className="absolute"
          style={{ left: LINE_LEFT, top: 0, height: 'calc(50% - 5px)', width: 1.5, backgroundColor: GRAY }}
        />
      )}
      {/* Dot */}
      <div
        className={isCollapsed ? 'transition-colors' : undefined}
        style={{
          left: LINE_LEFT - 5,
          top: 'calc(50% - 5px)',
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: active ? BLUE : 'white',
          border: `2px solid ${borderColor}`,
          position: 'absolute',
          ...(isCollapsed ? { cursor: 'pointer' } : {}),
        }}
        onMouseEnter={isCollapsed ? (e) => { (e.currentTarget as HTMLElement).style.borderColor = BLUE } : undefined}
        onMouseLeave={isCollapsed ? (e) => { (e.currentTarget as HTMLElement).style.borderColor = borderColor } : undefined}
      />
      {/* Line below dot — from dot center to bottom (only if not last) */}
      {!isLast && (
        <div
          className="absolute"
          style={{ left: LINE_LEFT, top: 'calc(50% + 5px)', bottom: 0, width: 1.5, backgroundColor: GRAY }}
        />
      )}
    </div>
  )
}

/**
 * Expanded content with a blue left border aligned to the dot center.
 * Uses a wrapper with padding-left=SLOT_W so the border at left=LINE_LEFT (8px)
 * visually aligns with the dot center in the gutter slot.
 */
function ExpandedContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex-1 min-w-0 overflow-visible">
      {/* Blue left border aligned to dot center at LINE_LEFT */}
      <div
        className="absolute"
        style={{
          left: LINE_LEFT - SLOT_W,
          top: 0,
          bottom: 0,
          width: 3,
          backgroundColor: BLUE,
          borderRadius: '2px 0 0 2px',
        }}
      />
      <div className="bg-blue-50/30 rounded-r-lg">
        {children}
      </div>
    </div>
  )
}

function TurnCard({
  turn,
  isFirst,
  isLast,
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
}): React.ReactElement {
  const userSummary = getUserSummary(turn.userMessage)
  const agentSummary = getAgentSummary(turn.assistantMessages)

  if (isExpanded) {
    const allMessages = [turn.userMessage, ...turn.assistantMessages]
    return (
      <div className="flex">
        <TurnDotSlot active={true} isFirst={isFirst} isLast={isLast} />
        <ExpandedContent>
          <div className="flex items-center justify-end px-3 py-1">
            <button
              onClick={onToggleExpand}
              className="rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Collapse
            </button>
          </div>
          <div className="space-y-4 px-4 pb-4">
            {allMessages.map((msg) => {
              const msgForkPoints = forkPoints.filter((fp) => fp.entryId === msg.piEntryId)
              return (
                <div
                  key={msg.id}
                  className={`group relative rounded-lg px-4 py-3 ${
                    msg.role === 'user' ? 'bg-blue-50' : 'bg-gray-50'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">
                      {msg.role === 'user' ? 'You' : 'Pi'}
                    </span>
                    <div className="relative">
                      <button
                        onClick={() => onForkClick(msg.id, msg.piEntryId)}
                        className="rounded px-2 py-0.5 text-xs text-gray-400 opacity-0 transition-opacity hover:text-gray-600 hover:bg-gray-100 group-hover:opacity-100"
                      >
                        Fork
                      </button>
                      {forkInputMessageId === msg.id && forkEntryId && (
                        <ForkNameInput
                          onForkAtEntry={onForkAtEntry}
                          onClose={onForkClose}
                          defaultEntryId={forkEntryId}
                        />
                      )}
                    </div>
                  </div>
                  <MessageBlocksRenderer
                    msg={msg}
                    isStreaming={isStreaming}
                    streamingMessageId={streamingMessageId}
                    annotatingTarget={annotatingTarget}
                    onEnterAnnotation={onEnterAnnotation}
                    onExitAnnotation={onExitAnnotation}
                    onSendFeedback={onSendFeedback}
                  />
                  {msgForkPoints.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-200/50 pt-2">
                      {msgForkPoints.map((fp, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] text-purple-700"
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
              )
            })}
          </div>
        </ExpandedContent>
      </div>
    )
  }

  return (
    <div className="flex">
      <TurnDotSlot active={false} isFirst={isFirst} isLast={isLast} isCollapsed onClick={onToggleExpand} />
      <div
        className="flex-1 cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2.5 hover:bg-gray-50 transition-colors ml-1"
        onClick={onToggleExpand}
      >
        <div className="text-sm text-gray-800">{userSummary}</div>
        <div className="mt-0.5 text-sm text-gray-500 pl-4">
          <span className="mr-1 text-gray-400">{'\u2192'}</span>
          {agentSummary || '...'}
        </div>
      </div>
    </div>
  )
}

function OutlineRow({
  turn,
  isFirst,
  isLast,
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
}): React.ReactElement {
  const userSummary = getUserSummary(turn.userMessage)

  if (isExpanded) {
    const allMessages = [turn.userMessage, ...turn.assistantMessages]
    return (
      <div className="flex">
        <TurnDotSlot active={true} isFirst={isFirst} isLast={isLast} />
        <ExpandedContent>
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-gray-400">#{turn.index}</span>
            <button
              onClick={onToggleExpand}
              className="rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Collapse
            </button>
          </div>
          <div className="space-y-4 px-4 pb-4">
            {allMessages.map((msg) => {
              const msgForkPoints = forkPoints.filter((fp) => fp.entryId === msg.piEntryId)
              return (
                <div
                  key={msg.id}
                  className={`group relative rounded-lg px-4 py-3 ${
                    msg.role === 'user' ? 'bg-blue-50' : 'bg-gray-50'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">
                      {msg.role === 'user' ? 'You' : 'Pi'}
                    </span>
                    <div className="relative">
                      <button
                        onClick={() => onForkClick(msg.id, msg.piEntryId)}
                        className="rounded px-2 py-0.5 text-xs text-gray-400 opacity-0 transition-opacity hover:text-gray-600 hover:bg-gray-100 group-hover:opacity-100"
                      >
                        Fork
                      </button>
                      {forkInputMessageId === msg.id && forkEntryId && (
                        <ForkNameInput
                          onForkAtEntry={onForkAtEntry}
                          onClose={onForkClose}
                          defaultEntryId={forkEntryId}
                        />
                      )}
                    </div>
                  </div>
                  <MessageBlocksRenderer
                    msg={msg}
                    isStreaming={isStreaming}
                    streamingMessageId={streamingMessageId}
                    annotatingTarget={annotatingTarget}
                    onEnterAnnotation={onEnterAnnotation}
                    onExitAnnotation={onExitAnnotation}
                    onSendFeedback={onSendFeedback}
                  />
                  {msgForkPoints.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-200/50 pt-2">
                      {msgForkPoints.map((fp, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] text-purple-700"
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
              )
            })}
          </div>
        </ExpandedContent>
      </div>
    )
  }

  return (
    <div className="flex">
      <TurnDotSlot active={false} isFirst={isFirst} isLast={isLast} isCollapsed onClick={onToggleExpand} />
      <div
        className="flex-1 cursor-pointer rounded px-3 py-1.5 hover:bg-gray-50 transition-colors ml-1"
        onClick={onToggleExpand}
      >
        <span className="text-xs text-gray-400 mr-2 font-mono">{turn.index}</span>
        <span className="text-sm text-gray-800">{userSummary}</span>
      </div>
    </div>
  )
}

function ChatView({ messages, isStreaming, streamingMessageId, onSendPrompt, pendingUiRequests, respondToUiRequest, onForkAtEntry, getForkMessages, forkPoints, viewMode }: ChatViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [annotatingTarget, setAnnotatingTarget] = useState<{
    messageId: string
    blockIndex: number
  } | null>(null)
  const [forkInputMessageId, setForkInputMessageId] = useState<string | null>(null)
  const [forkEntryId, setForkEntryId] = useState<string | null>(null)
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set())

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

  // Throttled scroll: only scroll on animation frames to avoid jank
  const scrollRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      bottomRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' })
    })
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [messages, isStreaming])

  const turns = viewMode !== 'normal' ? groupByTurns(messages) : []

  return (
    <div className="flex-1 overflow-y-auto bg-white px-4 py-6">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-400">Start a conversation with Pi</p>
            <p className="mt-2 text-sm text-gray-400">Type a message below or connect to Pi first</p>
          </div>
        </div>
      ) : viewMode === 'normal' ? (
        <div className="mx-auto max-w-3xl space-y-4">
          {(() => {
            // Merge consecutive assistant messages into one card
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
              // Use the first message's id for fork targeting
              const firstMsg = group.msgs[0]
              const msgForkPoints = forkPoints.filter((fp) => group.msgs.some((m) => m.piEntryId === fp.entryId))

              return (
                <div
                  key={gi}
                  className={`group relative rounded-lg px-4 py-3 ${
                    isUser ? 'bg-blue-50' : 'bg-gray-50'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">
                      {isUser ? 'You' : 'Pi'}
                    </span>
                    <div className="relative flex items-center gap-1">
                      <CopyButton blocks={allBlocks} />
                      <button
                        onClick={() => handleForkClick(firstMsg.id, firstMsg.piEntryId)}
                        className="rounded px-2 py-0.5 text-xs text-gray-400 opacity-0 transition-opacity hover:text-gray-600 hover:bg-gray-100 group-hover:opacity-100"
                      >
                        Fork
                      </button>
                      {forkInputMessageId === firstMsg.id && forkEntryId && (
                        <ForkNameInput
                          onForkAtEntry={onForkAtEntry}
                          onClose={() => { setForkInputMessageId(null); setForkEntryId(null) }}
                          defaultEntryId={forkEntryId}
                        />
                      )}
                    </div>
                  </div>
                  <MergedBlocksRenderer
                    messages={group.msgs}
                    isStreaming={isStreaming}
                    streamingMessageId={streamingMessageId}
                    annotatingTarget={annotatingTarget}
                    onEnterAnnotation={handleEnterAnnotation}
                    onExitAnnotation={handleExitAnnotation}
                    onSendFeedback={handleSendFeedback}
                  />
                  {msgForkPoints.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-200/50 pt-2">
                      {msgForkPoints.map((fp, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] text-purple-700"
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
              )
            })
          })()}
          <div ref={bottomRef} />
        </div>
      ) : viewMode === 'turn' ? (
        <div className="mx-auto max-w-3xl space-y-0">
          {turns.map((turn, idx) => (
            <TurnCard
              key={turn.id}
              turn={turn}
              isFirst={idx === 0}
              isLast={idx === turns.length - 1}
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
            />
          ))}
          <div ref={bottomRef} />
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-0">
          {turns.map((turn, idx) => (
            <OutlineRow
              key={turn.id}
              turn={turn}
              isFirst={idx === 0}
              isLast={idx === turns.length - 1}
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
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}

export default ChatView

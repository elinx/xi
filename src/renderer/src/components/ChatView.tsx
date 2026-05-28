import { useState, useCallback, useEffect, useRef } from 'react'
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
import type { ForkableMessage } from '../types/session'
import { ImageAnnotator, annotationsToPrompt } from './ImageAnnotator'
import type { ImageAnnotatorHandle } from './ImageAnnotator'

interface ChatViewProps {
  messages: ChatMessage[]
  onSendPrompt: (text: string, images?: { data: string; mimeType: string }[]) => void
  pendingUiRequests: Array<{ id: string; method: string; [key: string]: unknown }>
  respondToUiRequest: (requestId: string, response: Record<string, unknown>) => void
  onForkAtEntry: (entryId: string) => void
  getForkMessages: () => Promise<ForkableMessage[]>
}

function TextBlockRenderer({ block }: { block: TextBlock }): React.ReactElement {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
    </div>
  )
}

function ToolCallRenderer({ block }: { block: ToolCallBlock }): React.ReactElement {
  const statusColors: Record<ToolCallBlock['status'], string> = {
    pending: 'text-gray-400',
    running: 'text-yellow-400',
    completed: 'text-green-400',
    error: 'text-red-400',
  }

  const statusIcons: Record<ToolCallBlock['status'], string> = {
    pending: '\u25CB',
    running: '\u25D4',
    completed: '\u25CF',
    error: '\u2717',
  }

  return (
    <details className="rounded border border-gray-700 bg-gray-800/50">
      <summary className="cursor-pointer px-3 py-2 text-sm">
        <span className={statusColors[block.status]}>{statusIcons[block.status]}</span>
        {' '}
        <span className="font-mono text-xs text-gray-300">{block.toolName}</span>
        {block.toolName === 'bash' && block.args.command && (
          <span className="ml-2 font-mono text-xs text-gray-500">
            {String(block.args.command).substring(0, 60)}
            {String(block.args.command).length > 60 ? '...' : ''}
          </span>
        )}
      </summary>
      <div className="border-t border-gray-700 px-3 py-2">
        <pre className="overflow-x-auto text-xs text-gray-400">
          {JSON.stringify(block.args, null, 2)}
        </pre>
      </div>
    </details>
  )
}

function ToolResultRenderer({ block }: { block: ToolResultBlock }): React.ReactElement {
  return (
    <div className="space-y-2 rounded border border-gray-700 bg-gray-800/30 px-3 py-2">
      {block.content.map((child, i) => {
        if (child.type === 'text') {
          return (
            <pre key={i} className="overflow-x-auto whitespace-pre-wrap text-xs text-gray-400">
              {(child as TextBlock).content}
            </pre>
          )
        }
        if (child.type === 'image') {
          return <ImageBlockRenderer key={i} block={child as ImageBlock} />
        }
        if (child.type === 'html') {
          return <HtmlBlockRenderer key={i} block={child as HtmlBlock} />
        }
        return null
      })}
    </div>
  )
}

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
    <div className="my-2 overflow-hidden rounded border border-gray-700">
      <div className="flex items-center justify-between bg-gray-800/80 px-3 py-1.5">
        <span className="text-xs font-medium text-gray-400">
          {block.title ?? 'HTML Preview'}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-gray-300"
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
        <div className="flex items-center justify-between border-t border-blue-600 bg-gray-800/90 px-3 py-2">
          <span className="text-xs text-gray-400">
            {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onExitAnnotation}
              className="rounded bg-gray-700 px-3 py-1 text-xs font-medium text-gray-300 hover:bg-gray-600"
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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
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
    <div className="my-2 overflow-hidden rounded border border-gray-700">
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
        <div className="border-t border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-400">
          {block.alt}
        </div>
      )}
    </div>
  )
}

function ContentBlockRenderer({
  block,
  messageId,
  blockIndex,
  annotatingTarget,
  onEnterAnnotation,
  onExitAnnotation,
  onSendFeedback,
}: {
  block: ContentBlock
  messageId: string
  blockIndex: number
  annotatingTarget: { messageId: string; blockIndex: number } | null
  onEnterAnnotation: (messageId: string, blockIndex: number) => void
  onExitAnnotation: () => void
  onSendFeedback: (description: string, imageData: string) => void
}): React.ReactElement | null {
  switch (block.type) {
    case 'text':
      return <TextBlockRenderer block={block} />
    case 'tool_call':
      return <ToolCallRenderer block={block} />
    case 'tool_result':
      return <ToolResultRenderer block={block} />
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
      return <div className="text-xs text-yellow-400">[Action: {block.actionType}]</div>
    case 'html':
      return <HtmlBlockRenderer block={block} />
    default:
      return null
  }
}

function ForkPopover({
  forkMessages,
  onForkAtEntry,
  onClose,
}: {
  forkMessages: ForkableMessage[]
  onForkAtEntry: (entryId: string) => void
  onClose: () => void
}): React.ReactElement {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-8 z-30 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
    >
      <div className="border-b border-gray-800 px-3 py-2">
        <span className="text-xs font-medium text-gray-400">Fork from message</span>
      </div>
      <div className="max-h-60 overflow-y-auto py-1">
        {forkMessages.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-gray-600">
            No forkable messages
          </div>
        ) : (
          forkMessages.map((msg) => (
            <button
              key={msg.entryId}
              onClick={() => {
                onForkAtEntry(msg.entryId)
                onClose()
              }}
              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-800 transition-colors"
            >
              <svg className="mt-0.5 w-3 h-3 flex-shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
              </svg>
              <span className="text-xs text-gray-300 line-clamp-2">{msg.text || '(empty)'}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function ChatView({ messages, onSendPrompt, pendingUiRequests, respondToUiRequest, onForkAtEntry, getForkMessages }: ChatViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [annotatingTarget, setAnnotatingTarget] = useState<{
    messageId: string
    blockIndex: number
  } | null>(null)
  const [forkPopoverMessageId, setForkPopoverMessageId] = useState<string | null>(null)
  const [forkMessages, setForkMessages] = useState<ForkableMessage[]>([])

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

  const handleForkClick = useCallback(async (messageId: string) => {
    if (forkPopoverMessageId === messageId) {
      setForkPopoverMessageId(null)
      return
    }
    const msgs = await getForkMessages()
    setForkMessages(msgs)
    setForkPopoverMessageId(messageId)
  }, [forkPopoverMessageId, getForkMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto bg-gray-950 px-4 py-6">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-500">Start a conversation with Pi</p>
            <p className="mt-2 text-sm text-gray-600">Type a message below or connect to Pi first</p>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`group relative rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-gray-800 ml-8'
                  : 'bg-gray-900 mr-4'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-400">
                  {msg.role === 'user' ? 'You' : 'Pi'}
                </span>
                {msg.role === 'user' && (
                  <div className="relative">
                    <button
                      onClick={() => handleForkClick(msg.id)}
                      className="rounded px-2 py-0.5 text-xs text-gray-500 opacity-0 transition-opacity hover:text-gray-300 hover:bg-gray-700 group-hover:opacity-100"
                    >
                      Fork
                    </button>
                    {forkPopoverMessageId === msg.id && (
                      <ForkPopover
                        forkMessages={forkMessages}
                        onForkAtEntry={onForkAtEntry}
                        onClose={() => setForkPopoverMessageId(null)}
                      />
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {msg.blocks.map((block, i) => (
                  <ContentBlockRenderer
                    key={i}
                    block={block}
                    messageId={msg.id}
                    blockIndex={i}
                    annotatingTarget={annotatingTarget}
                    onEnterAnnotation={handleEnterAnnotation}
                    onExitAnnotation={handleExitAnnotation}
                    onSendFeedback={handleSendFeedback}
                  />
                ))}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}

export default ChatView

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
import type { ForkableMessage, ForkPoint } from '../types/session'
import { ImageAnnotator, annotationsToPrompt } from './ImageAnnotator'
import type { ImageAnnotatorHandle } from './ImageAnnotator'

interface ChatViewProps {
  messages: ChatMessage[]
  onSendPrompt: (text: string, images?: { data: string; mimeType: string }[]) => void
  pendingUiRequests: Array<{ id: string; method: string; [key: string]: unknown }>
  respondToUiRequest: (requestId: string, response: Record<string, unknown>) => void
  onForkAtEntry: (entryId: string, name: string) => void
  getForkMessages: () => Promise<ForkableMessage[]>
  forkPoints: ForkPoint[]
}

function TextBlockRenderer({ block }: { block: TextBlock }): React.ReactElement {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
    </div>
  )
}

function ToolCallRenderer({ block }: { block: ToolCallBlock }): React.ReactElement {
  const statusColors: Record<ToolCallBlock['status'], string> = {
    pending: 'text-gray-500',
    running: 'text-yellow-600',
    completed: 'text-green-600',
    error: 'text-red-500',
  }

  const statusIcons: Record<ToolCallBlock['status'], string> = {
    pending: '\u25CB',
    running: '\u25D4',
    completed: '\u25CF',
    error: '\u2717',
  }

  return (
    <details className="rounded border border-gray-200 bg-gray-50">
      <summary className="cursor-pointer px-3 py-2 text-sm">
        <span className={statusColors[block.status]}>{statusIcons[block.status]}</span>
        {' '}
        <span className="font-mono text-xs text-gray-700">{block.toolName}</span>
        {block.toolName === 'bash' && block.args.command && (
          <span className="ml-2 font-mono text-xs text-gray-400">
            {String(block.args.command).substring(0, 60)}
            {String(block.args.command).length > 60 ? '...' : ''}
          </span>
        )}
      </summary>
      <div className="border-t border-gray-200 px-3 py-2">
        <pre className="overflow-x-auto text-xs text-gray-600">
          {JSON.stringify(block.args, null, 2)}
        </pre>
      </div>
    </details>
  )
}

function ToolResultRenderer({ block }: { block: ToolResultBlock }): React.ReactElement {
  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50/50 px-3 py-2">
      {block.content.map((child, i) => {
        if (child.type === 'text') {
          return (
            <pre key={i} className="overflow-x-auto whitespace-pre-wrap text-xs text-gray-600">
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
      return <div className="text-xs text-yellow-600">[Action: {block.actionType}]</div>
    case 'html':
      return <HtmlBlockRenderer block={block} />
    default:
      return null
  }
}

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

function ChatView({ messages, onSendPrompt, pendingUiRequests, respondToUiRequest, onForkAtEntry, getForkMessages, forkPoints }: ChatViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [annotatingTarget, setAnnotatingTarget] = useState<{
    messageId: string
    blockIndex: number
  } | null>(null)
  const [forkInputMessageId, setForkInputMessageId] = useState<string | null>(null)
  const [forkEntryId, setForkEntryId] = useState<string | null>(null)

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto bg-white px-4 py-6">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-400">Start a conversation with Pi</p>
            <p className="mt-2 text-sm text-gray-400">Type a message below or connect to Pi first</p>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((msg) => {
            const msgForkPoints = forkPoints.filter((fp) => fp.entryId === msg.piEntryId)

            return (
              <div
                key={msg.id}
                className={`group relative rounded-lg px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-50 ml-8'
                    : 'bg-gray-50 mr-4'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    {msg.role === 'user' ? 'You' : 'Pi'}
                  </span>
                  {msg.role === 'user' && (
                    <div className="relative">
                      <button
                        onClick={() => handleForkClick(msg.id, msg.piEntryId)}
                        className="rounded px-2 py-0.5 text-xs text-gray-400 opacity-0 transition-opacity hover:text-gray-600 hover:bg-gray-100 group-hover:opacity-100"
                      >
                        Fork
                      </button>
                      {forkInputMessageId === msg.id && forkEntryId && (
                        <ForkNameInput
                          onForkAtEntry={onForkAtEntry}
                          onClose={() => { setForkInputMessageId(null); setForkEntryId(null) }}
                          defaultEntryId={forkEntryId}
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
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}

export default ChatView

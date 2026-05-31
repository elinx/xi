import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage, ContentBlock } from '../types/message'
import type {
  AgentSessionEvent,
  MessageUpdateEvent,
  ToolExecutionEndEvent,
  PiImageContent,
  PiUserMessage,
  PiAssistantMessage,
  PiToolResultMessage,
  PiContentBlock,
} from '../types/pi-events'
import type { ForkPoint } from '../types/session'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  totalCost: number
  contextWindowSize: number
}

function inferContextWindow(model: string): number {
  if (!model) return 200000
  const m = model.toLowerCase()
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 128000
  if (m.includes('claude')) return 200000
  return 200000
}

interface UsePiRpcReturn {
  messages: ChatMessage[]
  isConnected: boolean
  isStreaming: boolean
  streamingMessageId: string | null
  sendPrompt: (text: string, images?: { data: string; mimeType: string }[]) => void
  abort: () => void
  pendingUiRequests: Array<{ id: string; method: string; [key: string]: unknown }>
  respondToUiRequest: (requestId: string, response: Record<string, unknown>) => void
  clearMessages: () => void
  loadHistory: () => Promise<void>
  forkPoints: ForkPoint[]
  loadForkPoints: (sessionPath: string) => Promise<void>
  onAgentEnd: (() => void) | null
  setOnAgentEnd: (cb: (() => void) | null) => void
  tokenUsage: TokenUsage
}

export function usePiRpc(): UsePiRpcReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingUiRequests, setPendingUiRequests] = useState<Array<{ id: string; method: string; [key: string]: unknown }>>([])
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    contextWindowSize: 200000,
  })

  const currentAssistantId = useRef<string | null>(null)
  const currentContentBlocks = useRef<Map<number, ContentBlock>>(new Map())
  const toolCallArgsBuffer = useRef<Map<number, string>>(new Map())
  const pendingToolCallArgs = useRef<Map<string, Record<string, unknown>>>(new Map())
  const countedResponseIds = useRef<Set<string>>(new Set())

  const updateContentBlock = useCallback(
    (contentIndex: number, updater: (block: ContentBlock) => ContentBlock) => {
      const existing = currentContentBlocks.current.get(contentIndex)
      if (existing) {
        currentContentBlocks.current.set(contentIndex, updater(existing))
      }
    },
    [],
  )

  // RAF-throttled sync to avoid flickering on every text_delta
  const rafIdRef = useRef<number | null>(null)
  const syncContentBlocksToMessage = useCallback(() => {
    if (!currentAssistantId.current) return
    // Always schedule at most one RAF frame
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      if (!currentAssistantId.current) return
      const blocks = Array.from(currentContentBlocks.current.values())
      const assistantId = currentAssistantId.current
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantId) return msg
          return { ...msg, blocks: [...blocks] }
        }),
      )
    })
  }, [])

  // Force-flush any pending RAF sync (used at message/agent end)
  const flushSync = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (!currentAssistantId.current) return
    const blocks = Array.from(currentContentBlocks.current.values())
    const assistantId = currentAssistantId.current
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantId) return msg
        return { ...msg, blocks: [...blocks] }
      }),
    )
  }, [])

  const finalizeCurrentAssistant = useCallback(() => {
    if (!currentAssistantId.current) return
    flushSync()
  }, [flushSync])

  const handleEvent = useCallback(
    (event: AgentSessionEvent) => {
      switch (event.type) {
        case 'agent_start':
          setIsStreaming(true)
          break

        case 'agent_end':
          setIsStreaming(false)
          flushSync()
          currentAssistantId.current = null
          currentContentBlocks.current.clear()
          toolCallArgsBuffer.current.clear()
          onAgentEndRef.current?.()
          break

        case 'message_start': {
          const msg = event.message
          if (msg.role === 'user') {
            const userMsg = msg as PiUserMessage
            const userContent =
              typeof userMsg.content === 'string'
                ? userMsg.content
                : userMsg.content
                    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                    .map((c) => c.text)
                    .join('')

            const userChatMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'user',
              blocks: [{ type: 'text', content: userContent }],
              timestamp: userMsg.timestamp,
            }
            setMessages((prev) => [...prev, userChatMsg])
          } else if (msg.role === 'assistant') {
            const assistantMsg = msg as PiAssistantMessage
            const assistantId = crypto.randomUUID()
            currentAssistantId.current = assistantId
            currentContentBlocks.current.clear()
            toolCallArgsBuffer.current.clear()

            const chatMsg: ChatMessage = {
              id: assistantId,
              role: 'assistant',
              blocks: [],
              timestamp: assistantMsg.timestamp,
            }
            setMessages((prev) => [...prev, chatMsg])
          }
          break
        }

        case 'message_update': {
          const updateEvent = event as MessageUpdateEvent
          const ame = updateEvent.assistantMessageEvent

          if (!currentAssistantId.current) break

          switch (ame.type) {
            case 'text_start':
              currentContentBlocks.current.set(ame.contentIndex, { type: 'text', content: '' })
              break

            case 'text_delta':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: block.content + ame.delta }
                }
                return block
              })
              break

            case 'text_end':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: ame.content }
                }
                return block
              })
              break

            case 'thinking_start':
              currentContentBlocks.current.set(ame.contentIndex, { type: 'text', content: '💭 ' })
              break

            case 'thinking_delta':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: block.content + ame.delta }
                }
                return block
              })
              break

            case 'thinking_end':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: '💭 ' + ame.content }
                }
                return block
              })
              break

            case 'toolcall_start':
              currentContentBlocks.current.set(ame.contentIndex, {
                type: 'tool_call',
                toolName: '',
                args: {},
                status: 'running',
              })
              toolCallArgsBuffer.current.set(ame.contentIndex, '')
              break

            case 'toolcall_delta': {
              const existing = toolCallArgsBuffer.current.get(ame.contentIndex) ?? ''
              toolCallArgsBuffer.current.set(ame.contentIndex, existing + ame.delta)
              break
            }

            case 'toolcall_end': {
              const argsStr = toolCallArgsBuffer.current.get(ame.contentIndex) ?? '{}'
              let parsedArgs: Record<string, unknown>
              try {
                parsedArgs = JSON.parse(argsStr)
              } catch {
                parsedArgs = { _raw: argsStr }
              }
              currentContentBlocks.current.set(ame.contentIndex, {
                type: 'tool_call',
                toolName: ame.toolCall.name,
                args: parsedArgs,
                status: 'running',
              })
              pendingToolCallArgs.current.set(ame.toolCall.id, parsedArgs)
              toolCallArgsBuffer.current.delete(ame.contentIndex)
              // toolcall_end is an important structural change, flush immediately
              flushSync()
              break
            }

            case 'done': {
              const msg = ame.message
              if (msg.usage && msg.responseId && !countedResponseIds.current.has(msg.responseId)) {
                countedResponseIds.current.add(msg.responseId)
                setTokenUsage((prev) => ({
                  inputTokens: prev.inputTokens + msg.usage.input,
                  outputTokens: prev.outputTokens + msg.usage.output,
                  cacheReadTokens: prev.cacheReadTokens + msg.usage.cacheRead,
                  cacheWriteTokens: prev.cacheWriteTokens + msg.usage.cacheWrite,
                  totalTokens: msg.usage.totalTokens,
                  totalCost: prev.totalCost + msg.usage.cost.total,
                  contextWindowSize: inferContextWindow(msg.responseModel),
                }))
              } else if (msg.usage) {
                setTokenUsage((prev) => ({
                  ...prev,
                  contextWindowSize: inferContextWindow(msg.responseModel),
                }))
              }
              break
            }
            case 'error':
              break
          }

          if (ame.type !== 'toolcall_end') {
            syncContentBlocksToMessage()
          }
          break
        }

        case 'message_end': {
          const msg = event.message
          if (msg.role === 'toolResult') {
            const toolResultMsg = msg as PiToolResultMessage
            const extraBlocks: ContentBlock[] = []

            for (const content of toolResultMsg.content) {
              if (content.type === 'text') {
                extraBlocks.push({ type: 'text', content: content.text })
              } else if (content.type === 'image') {
                const img = content as PiImageContent
                extraBlocks.push({
                  type: 'image',
                  src: `data:${img.mimeType};base64,${img.data}`,
                  alt: 'Screenshot',
                })
              }
            }

            if (extraBlocks.length > 0 && currentAssistantId.current) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== currentAssistantId.current) return m
                  return { ...m, blocks: [...m.blocks, ...extraBlocks] }
                }),
              )
            }
          }
          if (msg.role === 'assistant') {
            const assistantMsg = msg as PiAssistantMessage
            if (assistantMsg.usage && assistantMsg.responseId && !countedResponseIds.current.has(assistantMsg.responseId)) {
              countedResponseIds.current.add(assistantMsg.responseId)
              setTokenUsage((prev) => ({
                inputTokens: prev.inputTokens + assistantMsg.usage.input,
                outputTokens: prev.outputTokens + assistantMsg.usage.output,
                cacheReadTokens: prev.cacheReadTokens + assistantMsg.usage.cacheRead,
                cacheWriteTokens: prev.cacheWriteTokens + assistantMsg.usage.cacheWrite,
                totalTokens: assistantMsg.usage.totalTokens,
                totalCost: prev.totalCost + assistantMsg.usage.cost.total,
                contextWindowSize: inferContextWindow(assistantMsg.responseModel),
              }))
            } else if (assistantMsg.usage) {
              setTokenUsage((prev) => ({
                ...prev,
                contextWindowSize: inferContextWindow(assistantMsg.responseModel),
              }))
            }
          }
          break
        }

        case 'tool_execution_start':
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== currentAssistantId.current) return msg
              return {
                ...msg,
                blocks: msg.blocks.map((block) => {
                  if (
                    block.type === 'tool_call' &&
                    block.toolName === event.toolName &&
                    block.status === 'pending'
                  ) {
                    return { ...block, status: 'running' as const }
                  }
                  return block
                }),
              }
            }),
          )
          break

        case 'tool_execution_end': {
          const toolEvent = event as ToolExecutionEndEvent
          const toolArgs = pendingToolCallArgs.current.get(toolEvent.toolCallId)
          pendingToolCallArgs.current.delete(toolEvent.toolCallId)

          const extraBlocks: ContentBlock[] = []

          const hasImageContent = toolEvent.result?.content?.some(
            (c: Record<string, unknown>) => c.type === 'image'
          )

          if (hasImageContent) {
            for (const c of toolEvent.result.content as Array<Record<string, unknown>>) {
              if (c.type === 'text' && typeof c.text === 'string') {
                extraBlocks.push({ type: 'text', content: c.text })
              } else if (c.type === 'image') {
                const img = c as unknown as PiImageContent
                extraBlocks.push({
                  type: 'image',
                  src: `data:${img.mimeType};base64,${img.data}`,
                  alt: `Result from ${toolEvent.toolName}`,
                })
              }
            }
          }

          if (
            toolEvent.toolName === 'write' &&
            toolArgs &&
            typeof toolArgs.path === 'string' &&
            toolArgs.path.endsWith('.html') &&
            typeof toolArgs.content === 'string'
          ) {
            extraBlocks.push({
              type: 'html',
              content: toolArgs.content,
              title: toolArgs.path.split('/').pop(),
            })
          }

          if (extraBlocks.length > 0) {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== currentAssistantId.current) return msg
                return {
                  ...msg,
                  blocks: [
                    ...msg.blocks.map((block) => {
                      if (block.type === 'tool_call' && block.status === 'running') {
                        return { ...block, status: 'completed' as const }
                      }
                      return block
                    }),
                    ...extraBlocks,
                  ],
                }
              }),
            )
          } else {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== currentAssistantId.current) return msg
                return {
                  ...msg,
                  blocks: msg.blocks.map((block) => {
                    if (block.type === 'tool_call' && block.status === 'running') {
                      return { ...block, status: 'completed' as const }
                    }
                    return block
                  }),
                }
              }),
            )
          }
          break
        }

        default:
          break
      }
    },
    [updateContentBlock, syncContentBlocksToMessage, finalizeCurrentAssistant],
  )

  useEffect(() => {
    const cleanup = window.api.onStateChanged((state) => {
      setIsConnected(state.connected)
    })

    window.api.getState().then((state) => {
      setIsConnected(state.connected)
    })

    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = window.api.onEvent((rawEvent) => {
      handleEvent(rawEvent as AgentSessionEvent)
    })
    return cleanup
  }, [handleEvent])

  useEffect(() => {
    const cleanup = window.api.onExtensionUiRequest((data) => {
      const req = data as { id: string; method: string; [key: string]: unknown }
      if (req.method === 'notify') {
        return
      }
      if (req.method === 'setStatus' || req.method === 'setWidget' || req.method === 'setTitle' || req.method === 'set_editor_text') {
        return
      }
      setPendingUiRequests(prev => [...prev, req])
    })
    return cleanup
  }, [])

  const respondToUiRequest = useCallback((requestId: string, response: Record<string, unknown>) => {
    window.api.sendExtensionUIResponse({ type: 'extension_ui_response', id: requestId, ...response })
    setPendingUiRequests(prev => prev.filter(r => r.id !== requestId))
  }, [])

  const sendPrompt = useCallback(
    (text: string, images?: { data: string; mimeType: string }[]) => {
      const command: Record<string, unknown> = {
        type: 'prompt',
        message: text,
        id: crypto.randomUUID(),
      }
      if (images && images.length > 0) {
        command.images = images.map((img) => ({
          type: 'image' as const,
          data: img.data,
          mimeType: img.mimeType,
        }))
      }
      window.api.sendCommand(command)
    },
    [],
  )

  const abort = useCallback(() => {
    window.api.sendCommand({ type: 'abort' })
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setForkPoints([])
    setTokenUsage({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      contextWindowSize: 200000,
    })
    currentAssistantId.current = null
    currentContentBlocks.current.clear()
    toolCallArgsBuffer.current.clear()
    pendingToolCallArgs.current.clear()
    countedResponseIds.current.clear()
  }, [])

  const [forkPoints, setForkPoints] = useState<ForkPoint[]>([])
  const onAgentEndRef = useRef<(() => void) | null>(null)

  const setOnAgentEnd = useCallback((cb: (() => void) | null) => {
    onAgentEndRef.current = cb
  }, [])

  const loadForkPoints = useCallback(async (sessionPath: string) => {
    type ExtendedApiWithForkPoints = typeof window.api & { getForkPoints: (path: string) => Promise<ForkPoint[]> }
    const apiWithFp = window.api as ExtendedApiWithForkPoints
    try {
      const points = await apiWithFp.getForkPoints(sessionPath)
      setForkPoints(points)
    } catch {
      setForkPoints([])
    }
  }, [])

  const loadHistory = useCallback(async () => {
    type ExtendedApiWithMessages = typeof window.api & { getMessages: () => Promise<unknown[]> }
    const api = window.api as ExtendedApiWithMessages

    let piMessages: unknown[]
    try {
      piMessages = await api.getMessages()
    } catch {
      return
    }

    if (!Array.isArray(piMessages) || piMessages.length === 0) {
      clearMessages()
      return
    }

    const chatMessages: ChatMessage[] = []

    for (const raw of piMessages) {
      const msg = raw as Record<string, unknown>
      const piEntryId = typeof msg.id === 'string' ? msg.id : undefined
      if (msg.role === 'user') {
        const content = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as PiContentBlock[])
                .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                .map((c) => c.text)
                .join('')
            : ''
        chatMessages.push({
          id: crypto.randomUUID(),
          role: 'user',
          blocks: [{ type: 'text', content }],
          timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
          piEntryId,
        })
      } else if (msg.role === 'assistant') {
        const blocks: ContentBlock[] = []
        const content = msg.content as PiContentBlock[]
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === 'text') {
              blocks.push({ type: 'text', content: c.text })
            } else if (c.type === 'thinking') {
              blocks.push({ type: 'text', content: '\u{1F4AD} ' + c.thinking })
            } else if (c.type === 'toolCall') {
              blocks.push({
                type: 'tool_call',
                toolName: c.name,
                args: c.arguments,
                status: 'completed',
              })
            }
          }
        }
        chatMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          blocks,
          timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
          piEntryId,
        })
      } else if (msg.role === 'toolResult') {
        const lastAssistant = chatMessages.findLast((m) => m.role === 'assistant')
        if (lastAssistant) {
          const content = msg.content as PiContentBlock[]
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === 'text') {
                lastAssistant.blocks.push({ type: 'text', content: c.text })
              } else if (c.type === 'image') {
                const img = c as PiImageContent
                lastAssistant.blocks.push({
                  type: 'image',
                  src: `data:${img.mimeType};base64,${img.data}`,
                  alt: `Result from ${msg.toolName as string}`,
                })
              }
            }
          }
        }
      }
    }

    // Sum usage across all assistant messages (per-message, not cumulative)
    let restoredUsage: TokenUsage | null = null
    let lastResponseModel = ''
    for (const raw of piMessages) {
      const msg = raw as Record<string, unknown>
      if (msg.role === 'assistant') {
        const usage = msg.usage as { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } } | undefined
        if (typeof msg.responseModel === 'string') {
          lastResponseModel = msg.responseModel
        }
        if (usage) {
          if (!restoredUsage) {
            restoredUsage = {
              inputTokens: usage.input,
              outputTokens: usage.output,
              cacheReadTokens: usage.cacheRead,
              cacheWriteTokens: usage.cacheWrite,
              totalTokens: usage.totalTokens,
              totalCost: usage.cost.total,
              contextWindowSize: inferContextWindow(lastResponseModel),
            }
          } else {
            const newInput = restoredUsage.inputTokens + usage.input
            const newOutput = restoredUsage.outputTokens + usage.output
            const newCacheRead = restoredUsage.cacheReadTokens + usage.cacheRead
            const newCacheWrite = restoredUsage.cacheWriteTokens + usage.cacheWrite
            restoredUsage = {
              inputTokens: newInput,
              outputTokens: newOutput,
              cacheReadTokens: newCacheRead,
              cacheWriteTokens: newCacheWrite,
              totalTokens: usage.totalTokens,
              totalCost: restoredUsage.totalCost + usage.cost.total,
              contextWindowSize: inferContextWindow(lastResponseModel),
            }
          }
        }
      }
    }

    clearMessages()
    setMessages(chatMessages)
    for (const raw of piMessages) {
      const msg = raw as Record<string, unknown>
      if (msg.role === 'assistant' && typeof msg.responseId === 'string') {
        countedResponseIds.current.add(msg.responseId)
      }
    }
    if (restoredUsage) {
      setTokenUsage(restoredUsage)
    }
  }, [clearMessages])

  const streamingMessageId = isStreaming ? currentAssistantId.current : null

  return { messages, isConnected, isStreaming, streamingMessageId, sendPrompt, abort, pendingUiRequests, respondToUiRequest, clearMessages, loadHistory, forkPoints, loadForkPoints, onAgentEnd: onAgentEndRef.current, setOnAgentEnd, tokenUsage }
}

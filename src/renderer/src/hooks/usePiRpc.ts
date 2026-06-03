import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage, ContentBlock, ToolCallBlock } from '../types/message'
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
import type { ForkPoint, PiModelInfo } from '../types/session'
import { convertPiMessagesToChatMessages, type TokenUsage } from '../utils/convert-messages'

export interface UsePiRpcOptions {
  onMessagesUpdate: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  onTokenUsageUpdate: (updater: (prev: TokenUsage) => TokenUsage) => void
  onStreamingChange: (isStreaming: boolean, streamingMessageId: string | null) => void
  onForkPointsUpdate: (forkPoints: ForkPoint[]) => void
  piConnectedSessionPath: string | null
}

interface UsePiRpcReturn {
  isConnected: boolean
  currentModel: PiModelInfo | null
  thinkingLevel: string | null
  sendPrompt: (text: string, images?: { data: string; mimeType: string }[], mentions?: Array<{ type: string; path: string; name: string }>) => void
  abort: () => Promise<void>
  pendingUiRequests: Array<{ id: string; method: string; [key: string]: unknown }>
  respondToUiRequest: (requestId: string, response: Record<string, unknown>) => void
  clearMessages: () => void
  loadHistory: () => Promise<void>
  loadForkPoints: (sessionPath: string) => Promise<void>
  onAgentEnd: (() => void) | null
  setOnAgentEnd: (cb: (() => void) | null) => void
  getAvailableModels: () => Promise<PiModelInfo[]>
  setModel: (modelId: string, provider?: string) => Promise<boolean>
  cycleModel: (direction?: 'forward' | 'backward') => Promise<boolean>
  getProviderAuthStatus: () => Promise<Record<string, { configured: boolean; source?: string }>>
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeAuth: (provider: string) => Promise<boolean>
  registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<boolean>
  testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>
  getProviderConfig: (provider: string) => Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }>
}

function inferContextWindow(model: string): number {
  if (!model) return 200000
  const m = model.toLowerCase()
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 128000
  if (m.includes('claude')) return 200000
  return 200000
}

export function usePiRpc(options: UsePiRpcOptions): UsePiRpcReturn {
  const { onMessagesUpdate, onTokenUsageUpdate, onStreamingChange, onForkPointsUpdate, piConnectedSessionPath } = options

  const [isConnected, setIsConnected] = useState(false)
  const [currentModel, setCurrentModel] = useState<PiModelInfo | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null)
  const [pendingUiRequests, setPendingUiRequests] = useState<Array<{ id: string; method: string; [key: string]: unknown }>>([])

  const isStreamingRef = useRef(false)
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

  const rafIdRef = useRef<number | null>(null)
  const syncContentBlocksToMessage = useCallback(() => {
    if (!currentAssistantId.current) return
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      if (!currentAssistantId.current) return
      const blocks = Array.from(currentContentBlocks.current.values())
      const assistantId = currentAssistantId.current
      onMessagesUpdate((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantId) return msg
          return { ...msg, blocks: [...blocks] }
        }),
      )
    })
  }, [onMessagesUpdate])

  const flushSync = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (!currentAssistantId.current) return
    const blocks = Array.from(currentContentBlocks.current.values())
    const assistantId = currentAssistantId.current
    onMessagesUpdate((prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantId) return msg
        return { ...msg, blocks: [...blocks] }
      }),
    )
  }, [onMessagesUpdate])

  const finalizeCurrentAssistant = useCallback(() => {
    if (!currentAssistantId.current) return
    flushSync()
  }, [flushSync])

  const handleEvent = useCallback(
    (event: AgentSessionEvent) => {
      switch (event.type) {
        case 'agent_start':
          isStreamingRef.current = true
          onStreamingChange(true, currentAssistantId.current)
          break

        case 'agent_end':
          isStreamingRef.current = false
          onStreamingChange(false, null)
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
            onMessagesUpdate((prev) => [...prev, userChatMsg])
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
            onMessagesUpdate((prev) => [...prev, chatMsg])
            if (isStreamingRef.current) {
              onStreamingChange(true, assistantId)
            }
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
              currentContentBlocks.current.set(ame.contentIndex, { type: 'text', content: '', subtype: 'thinking' })
              break

            case 'thinking_delta':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: block.content + ame.delta, subtype: block.subtype }
                }
                return block
              })
              break

            case 'thinking_end':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: ame.content, subtype: block.subtype }
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
              flushSync()
              break
            }

            case 'done': {
              const msg = ame.message
              if (msg.usage && msg.responseId && !countedResponseIds.current.has(msg.responseId)) {
                countedResponseIds.current.add(msg.responseId)
                onTokenUsageUpdate((prev) => ({
                  inputTokens: prev.inputTokens + msg.usage.input,
                  outputTokens: prev.outputTokens + msg.usage.output,
                  cacheReadTokens: prev.cacheReadTokens + msg.usage.cacheRead,
                  cacheWriteTokens: prev.cacheWriteTokens + msg.usage.cacheWrite,
                  totalTokens: msg.usage.totalTokens,
                  totalCost: prev.totalCost + msg.usage.cost.total,
                  contextWindowSize: inferContextWindow(msg.responseModel),
                }))
              } else if (msg.usage) {
                onTokenUsageUpdate((prev) => ({
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
          if (msg.role === 'assistant') {
            const assistantMsg = msg as PiAssistantMessage
            if (assistantMsg.usage && assistantMsg.responseId && !countedResponseIds.current.has(assistantMsg.responseId)) {
              countedResponseIds.current.add(assistantMsg.responseId)
              onTokenUsageUpdate((prev) => ({
                inputTokens: prev.inputTokens + assistantMsg.usage.input,
                outputTokens: prev.outputTokens + assistantMsg.usage.output,
                cacheReadTokens: prev.cacheReadTokens + assistantMsg.usage.cacheRead,
                cacheWriteTokens: prev.cacheWriteTokens + assistantMsg.usage.cacheWrite,
                totalTokens: assistantMsg.usage.totalTokens,
                totalCost: prev.totalCost + assistantMsg.usage.cost.total,
                contextWindowSize: inferContextWindow(assistantMsg.responseModel),
              }))
            } else if (assistantMsg.usage) {
              onTokenUsageUpdate((prev) => ({
                ...prev,
                contextWindowSize: inferContextWindow(assistantMsg.responseModel),
              }))
            }
          }
          break
        }

        case 'tool_execution_start':
          onMessagesUpdate((prev) =>
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

          const resultBlocks: ContentBlock[] = []

          if (toolEvent.result?.content) {
            for (const c of toolEvent.result.content as Array<Record<string, unknown>>) {
              if (c.type === 'text' && typeof c.text === 'string') {
                resultBlocks.push({ type: 'text', content: c.text })
              } else if (c.type === 'image') {
                const img = c as unknown as PiImageContent
                resultBlocks.push({
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
            resultBlocks.push({
              type: 'html',
              content: toolArgs.content,
              title: toolArgs.path.split('/').pop(),
            })
          }

          const toolResultBlock: ContentBlock | null = resultBlocks.length > 0
            ? { type: 'tool_result', toolCallId: toolEvent.toolCallId, content: resultBlocks }
            : null

          onMessagesUpdate((prev) =>
            prev.map((msg) => {
              if (msg.id !== currentAssistantId.current) return msg
              const updatedBlocks = [] as ContentBlock[]
              for (const block of msg.blocks) {
                if (block.type === 'tool_call' && block.status === 'running') {
                  updatedBlocks.push({ ...block, status: 'completed' as const })
                  if (toolResultBlock && (block as ToolCallBlock).toolName === toolEvent.toolName) {
                    updatedBlocks.push(toolResultBlock)
                  }
                } else {
                  updatedBlocks.push(block)
                }
              }
              return { ...msg, blocks: updatedBlocks }
            }),
          )
          break
        }

        case 'thinking_level_changed':
          setThinkingLevel(event.level)
          break

        default:
          break
      }
    },
    [updateContentBlock, syncContentBlocksToMessage, finalizeCurrentAssistant, onMessagesUpdate, onTokenUsageUpdate, onStreamingChange],
  )

  useEffect(() => {
    const cleanup = window.api.onStateChanged((state) => {
      setIsConnected(state.connected)
      if (!state.connected) {
        setCurrentModel(null)
        setThinkingLevel(null)
      }
    })

    window.api.getState().then((state) => {
      setIsConnected(state.connected)
    })

    return cleanup
  }, [])

  useEffect(() => {
    if (!isConnected) return
    type ApiWithModelInfo = typeof window.api & { getModelInfo: () => Promise<{ ok: boolean; data?: { model: PiModelInfo | null; thinkingLevel: string | null }; error?: string }> }
    ;(window.api as ApiWithModelInfo).getModelInfo().then((result) => {
      if (result.ok && result.data) {
        setCurrentModel(result.data.model)
        setThinkingLevel(result.data.thinkingLevel)
      }
    })
  }, [isConnected])

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
    (text: string, images?: { data: string; mimeType: string }[], mentions?: Array<{ type: string; path: string; name: string }>) => {
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
      // omit mentions: Pi SDK injects file content if present (bug)
      void mentions
      window.api.sendCommand(command)
    },
    [],
  )

  const abort = useCallback((): Promise<void> => {
    window.api.sendCommand({ type: 'abort' })
    return new Promise((resolve) => {
      const startTime = Date.now()
      const check = () => {
        if (!isStreamingRef.current || Date.now() - startTime > 5000) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      setTimeout(check, 50)
    })
  }, [])

  const clearMessages = useCallback(() => {
    onMessagesUpdate(() => [])
    onForkPointsUpdate([])
    onTokenUsageUpdate(() => ({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      contextWindowSize: 200000,
    }))
    currentAssistantId.current = null
    currentContentBlocks.current.clear()
    toolCallArgsBuffer.current.clear()
    pendingToolCallArgs.current.clear()
    countedResponseIds.current.clear()
  }, [onMessagesUpdate, onForkPointsUpdate, onTokenUsageUpdate])

  const onAgentEndRef = useRef<(() => void) | null>(null)

  const setOnAgentEnd = useCallback((cb: (() => void) | null) => {
    onAgentEndRef.current = cb
  }, [])

  const loadForkPoints = useCallback(async (sessionPath: string) => {
    type ExtendedApiWithForkPoints = typeof window.api & { getForkPoints: (path: string) => Promise<ForkPoint[]> }
    const apiWithFp = window.api as ExtendedApiWithForkPoints
    try {
      const points = await apiWithFp.getForkPoints(sessionPath)
      onForkPointsUpdate(points)
    } catch {
      onForkPointsUpdate([])
    }
  }, [onForkPointsUpdate])

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

    const result = convertPiMessagesToChatMessages(piMessages)

    clearMessages()
    onMessagesUpdate(() => result.messages)
    for (const rid of result.responseIds) {
      countedResponseIds.current.add(rid)
    }
    if (result.tokenUsage.totalCost > 0 || result.tokenUsage.totalTokens > 0) {
      onTokenUsageUpdate(() => result.tokenUsage)
    }
  }, [clearMessages, onMessagesUpdate, onTokenUsageUpdate])

  const getAvailableModels = useCallback(async (): Promise<PiModelInfo[]> => {
    type ApiWithModels = typeof window.api & { getAvailableModels: () => Promise<{ ok: boolean; data?: { models: PiModelInfo[] }; error?: string }> }
    const result = await (window.api as ApiWithModels).getAvailableModels()
    if (result.ok && result.data?.models) return result.data.models
    return []
  }, [])

  const setModel = useCallback(async (modelId: string, provider?: string): Promise<boolean> => {
    type ApiWithSetModel = typeof window.api & { setModel: (model: string, provider?: string) => Promise<{ ok: boolean; data?: PiModelInfo | null; error?: string }> }
    const result = await (window.api as ApiWithSetModel).setModel(modelId, provider)
    if (result.ok) {
      setCurrentModel(result.data ?? null)
      return true
    }
    return false
  }, [])

  const cycleModelFn = useCallback(async (direction?: 'forward' | 'backward'): Promise<boolean> => {
    type ApiWithCycle = typeof window.api & { cycleModel: (direction?: 'forward' | 'backward') => Promise<{ ok: boolean; data?: { model: PiModelInfo | null; thinkingLevel: string; isScoped: boolean }; error?: string }> }
    const result = await (window.api as ApiWithCycle).cycleModel(direction)
    if (result.ok && result.data) {
      setCurrentModel(result.data.model)
      setThinkingLevel(result.data.thinkingLevel)
      return true
    }
    return false
  }, [])

  const getProviderAuthStatus = useCallback(async (): Promise<Record<string, { configured: boolean; source?: string }>> => {
    type ApiWithAuthStatus = typeof window.api & { getProviderAuthStatus: () => Promise<{ ok: boolean; data?: Record<string, { configured: boolean; source?: string }>; error?: string }> }
    const result = await (window.api as ApiWithAuthStatus).getProviderAuthStatus()
    return result.ok && result.data ? result.data : {}
  }, [])

  const setApiKeyFn = useCallback(async (provider: string, apiKey: string): Promise<boolean> => {
    type ApiWithSetApiKey = typeof window.api & { setApiKey: (provider: string, apiKey: string) => Promise<{ ok: boolean; error?: string }> }
    const result = await (window.api as ApiWithSetApiKey).setApiKey(provider, apiKey)
    return result.ok
  }, [])

  const removeAuthFn = useCallback(async (provider: string): Promise<boolean> => {
    type ApiWithRemoveAuth = typeof window.api & { removeAuth: (provider: string) => Promise<{ ok: boolean; error?: string }> }
    const result = await (window.api as ApiWithRemoveAuth).removeAuth(provider)
    return result.ok
  }, [])

  const registerCustomProviderFn = useCallback(async (provider: string, config: Record<string, unknown>): Promise<boolean> => {
    type ApiWithRegister = typeof window.api & { registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }> }
    const result = await (window.api as ApiWithRegister).registerCustomProvider(provider, config)
    return result.ok
  }, [])

  const testProviderFn = useCallback(async (provider: string, overrides?: { baseUrl?: string; apiKey?: string }): Promise<{ ok: boolean; error?: string; latencyMs?: number }> => {
    type ApiWithTest = typeof window.api & { testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<{ ok: boolean; error?: string; latencyMs?: number }> }
    const result = await (window.api as ApiWithTest).testProvider(provider, overrides)
    return result
  }, [])

  const getProviderConfigFn = useCallback(async (provider: string): Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }> => {
    type ApiWithConfig = typeof window.api & { getProviderConfig: (provider: string) => Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }> }
    const result = await (window.api as ApiWithConfig).getProviderConfig(provider)
    return result
  }, [])

  return { isConnected, currentModel, thinkingLevel, sendPrompt, abort, pendingUiRequests, respondToUiRequest, clearMessages, loadHistory, loadForkPoints, onAgentEnd: onAgentEndRef.current, setOnAgentEnd, getAvailableModels, setModel, cycleModel: cycleModelFn, getProviderAuthStatus, setApiKey: setApiKeyFn, removeAuth: removeAuthFn, registerCustomProvider: registerCustomProviderFn, testProvider: testProviderFn, getProviderConfig: getProviderConfigFn }
}

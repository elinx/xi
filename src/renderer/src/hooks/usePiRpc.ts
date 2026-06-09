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
import { convertPiMessagesToChatMessages, splitUserContentIntoBlocks, type TokenUsage } from '../utils/convert-messages'
import type { SessionCache } from './useSessionCache'

export interface UsePiRpcOptions {
  onSessionMessagesUpdate: (sessionPath: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  onSessionTokenUsageUpdate: (sessionPath: string, updater: (prev: TokenUsage) => TokenUsage) => void
  onSessionStreamingChange: (sessionPath: string, isStreaming: boolean, streamingMessageId: string | null) => void
  onSessionForkPointsUpdate: (sessionPath: string, forkPoints: ForkPoint[]) => void
  onSessionModelChange: (sessionPath: string, model: PiModelInfo | null) => void
  onWorkerStatusChange: (sessionPath: string, status: string) => void
  onDisplaySession?: (sessionPath: string) => void
  displayedSessionPath: string | null
  getCache: (sessionPath: string) => SessionCache | undefined
  ensureCacheSync: (sessionPath: string) => SessionCache
  updateCache: (sessionPath: string, updater: (cache: SessionCache) => SessionCache) => void
}

interface UsePiRpcReturn {
  isConnected: boolean
  currentModel: PiModelInfo | null
  thinkingLevel: string | null
  sendPrompt: (sessionPath: string | null, text: string, images?: { data: string; mimeType: string }[], mentions?: Array<{ type: string; path: string; name: string }>) => void
  abort: (sessionPath: string | null) => Promise<void>
  pendingUiRequests: Array<{ id: string; method: string; [key: string]: unknown }>
  respondToUiRequest: (sessionPath: string | null, requestId: string, response: Record<string, unknown>) => void
  clearMessages: (sessionPath: string | null) => void
  loadHistory: (sessionPath: string | null) => Promise<void>
  loadForkPoints: (sessionPath: string) => Promise<void>
  onAgentEnd: (() => void) | null
  setOnAgentEnd: (cb: (() => void) | null) => void
  getAvailableModels: (sessionPath: string | null) => Promise<PiModelInfo[]>
  setModel: (sessionPath: string | null, modelId: string, provider?: string) => Promise<boolean>
  cycleModel: (sessionPath: string | null, direction?: 'forward' | 'backward') => Promise<boolean>
  getProviderAuthStatus: () => Promise<Record<string, { configured: boolean; source?: string }>>
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeAuth: (provider: string) => Promise<boolean>
  registerCustomProvider: (provider: string, config: Record<string, unknown>) => Promise<boolean>
  testProvider: (provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>
  getProviderConfig: (provider: string) => Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }>
  refreshModelInfo: () => void
}

function inferContextWindow(model: string): number {
  if (!model) return 200000
  const m = model.toLowerCase()
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 128000
  if (m.includes('claude')) return 200000
  if (m.includes('deepseek')) return 1000000
  if (m.includes('gemini')) return 1000000
  if (m.includes('gpt-5')) return 200000
  return 200000
}

export function usePiRpc(options: UsePiRpcOptions): UsePiRpcReturn {
  const {
    onSessionMessagesUpdate, onSessionTokenUsageUpdate, onSessionStreamingChange,
    onSessionForkPointsUpdate, onSessionModelChange, onWorkerStatusChange,
    onDisplaySession,
    displayedSessionPath, getCache, ensureCacheSync, updateCache,
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const [currentModel, setCurrentModel] = useState<PiModelInfo | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null)
  const [pendingUiRequests, setPendingUiRequests] = useState<Array<{ id: string; method: string; [key: string]: unknown }>>([])

  const currentModelRef = useRef<PiModelInfo | null>(null)
  const displayedSessionPathRef = useRef<string | null>(displayedSessionPath)

  useEffect(() => { currentModelRef.current = currentModel }, [currentModel])
  useEffect(() => { displayedSessionPathRef.current = displayedSessionPath }, [displayedSessionPath])

  const sessionIdToPathMap = useRef<Map<string, string>>(new Map())

  const resolveSessionPath = useCallback((event: AgentSessionEvent): string | null => {
    const obj = event as Record<string, unknown>
    const sessionPath = obj.sessionPath as string | undefined
    if (sessionPath) return sessionPath
    const sessionId = obj.sessionId as string | undefined
    if (sessionId) {
      const mapped = sessionIdToPathMap.current.get(sessionId)
      if (mapped) return mapped
    }
    return null
  }, [])

  const updateContentBlock = useCallback(
    (sessionPath: string, contentIndex: number, updater: (block: ContentBlock) => ContentBlock) => {
      const cache = getCache(sessionPath)
      if (!cache) return
      const existing = cache.currentContentBlocks.get(contentIndex)
      if (existing) {
        cache.currentContentBlocks.set(contentIndex, updater(existing))
      }
    },
    [getCache],
  )

  const rafIdMap = useRef<Map<string, number>>(new Map())

  const syncContentBlocksToMessage = useCallback((sessionPath: string) => {
    const cache = getCache(sessionPath)
    if (!cache || !cache.currentAssistantId) return
    if (rafIdMap.current.has(sessionPath)) return
    rafIdMap.current.set(sessionPath, requestAnimationFrame(() => {
      rafIdMap.current.delete(sessionPath)
      const c = getCache(sessionPath)
      if (!c || !c.currentAssistantId) return
      const blocks = Array.from(c.currentContentBlocks.values())
      const assistantId = c.currentAssistantId
      onSessionMessagesUpdate(sessionPath, (prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantId) return msg
          return { ...msg, blocks: [...blocks] }
        }),
      )
    }))
  }, [getCache, onSessionMessagesUpdate])

  const flushSync = useCallback((sessionPath: string) => {
    const pending = rafIdMap.current.get(sessionPath)
    if (pending !== undefined) {
      cancelAnimationFrame(pending)
      rafIdMap.current.delete(sessionPath)
    }
    const cache = getCache(sessionPath)
    if (!cache || !cache.currentAssistantId) return
    const blocks = Array.from(cache.currentContentBlocks.values())
    const assistantId = cache.currentAssistantId
    onSessionMessagesUpdate(sessionPath, (prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantId) return msg
        return { ...msg, blocks: [...blocks] }
      }),
    )
  }, [getCache, onSessionMessagesUpdate])

  const finalizeCurrentAssistant = useCallback((sessionPath: string) => {
    flushSync(sessionPath)
  }, [flushSync])

  const handleEvent = useCallback(
    (event: AgentSessionEvent) => {
      const sessionPath = resolveSessionPath(event)
      if (!sessionPath) return

      if (!getCache(sessionPath)) {
        ensureCacheSync(sessionPath)
      }

      if (sessionPath !== displayedSessionPathRef.current && !displayedSessionPathRef.current) {
        onDisplaySession?.(sessionPath)
      }

      switch (event.type) {
        case 'agent_start': {
          const cache = getCache(sessionPath)
          onSessionStreamingChange(sessionPath, true, cache?.currentAssistantId ?? null)
          break
        }

        case 'agent_end': {
          onSessionStreamingChange(sessionPath, false, null)
          flushSync(sessionPath)
          updateCache(sessionPath, (cache) => ({
            ...cache,
            currentAssistantId: null,
          }))
          const c = getCache(sessionPath)
          if (c) {
            c.currentContentBlocks.clear()
            c.toolCallArgsBuffer.clear()
          }
          onAgentEndRef.current?.()
          break
        }

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
              blocks: splitUserContentIntoBlocks(userContent),
              timestamp: userMsg.timestamp,
            }
            onSessionMessagesUpdate(sessionPath, (prev) => [...prev, userChatMsg])
          } else if (msg.role === 'assistant') {
            const assistantMsg = msg as PiAssistantMessage
            const assistantId = crypto.randomUUID()
            updateCache(sessionPath, (cache) => ({
              ...cache,
              currentAssistantId: assistantId,
            }))
            const c = getCache(sessionPath)
            if (c) {
              c.currentContentBlocks.clear()
              c.toolCallArgsBuffer.clear()
            }

            const chatMsg: ChatMessage = {
              id: assistantId,
              role: 'assistant',
              blocks: [],
              timestamp: assistantMsg.timestamp,
            }
            onSessionMessagesUpdate(sessionPath, (prev) => [...prev, chatMsg])
            onSessionStreamingChange(sessionPath, true, assistantId)
          }
          break
        }

        case 'message_update': {
          const updateEvent = event as MessageUpdateEvent
          const ame = updateEvent.assistantMessageEvent
          const cache = getCache(sessionPath)
          if (!cache?.currentAssistantId) break

          switch (ame.type) {
            case 'text_start':
              cache.currentContentBlocks.set(ame.contentIndex, { type: 'text', content: '' })
              break

            case 'text_delta':
              updateContentBlock(sessionPath, ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: block.content + ame.delta }
                }
                return block
              })
              break

            case 'text_end':
              updateContentBlock(sessionPath, ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: ame.content }
                }
                return block
              })
              break

            case 'thinking_start':
              cache.currentContentBlocks.set(ame.contentIndex, { type: 'text', content: '', subtype: 'thinking' })
              break

            case 'thinking_delta':
              updateContentBlock(sessionPath, ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: block.content + ame.delta, subtype: block.subtype }
                }
                return block
              })
              break

            case 'thinking_end':
              updateContentBlock(sessionPath, ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: ame.content, subtype: block.subtype }
                }
                return block
              })
              break

            case 'toolcall_start':
              cache.currentContentBlocks.set(ame.contentIndex, {
                type: 'tool_call',
                toolName: '',
                toolCallId: `pending-${ame.contentIndex}`,
                args: {},
                status: 'running',
              })
              cache.toolCallArgsBuffer.set(ame.contentIndex, '')
              break

            case 'toolcall_delta': {
              const existing = cache.toolCallArgsBuffer.get(ame.contentIndex) ?? ''
              cache.toolCallArgsBuffer.set(ame.contentIndex, existing + ame.delta)
              break
            }

            case 'toolcall_end': {
              const argsStr = cache.toolCallArgsBuffer.get(ame.contentIndex) ?? '{}'
              let parsedArgs: Record<string, unknown>
              try {
                parsedArgs = JSON.parse(argsStr)
              } catch {
                parsedArgs = { _raw: argsStr }
              }
              cache.currentContentBlocks.set(ame.contentIndex, {
                type: 'tool_call',
                toolName: ame.toolCall.name,
                toolCallId: ame.toolCall.id,
                args: parsedArgs,
                status: 'running',
              })
              cache.pendingToolCallArgs.set(ame.toolCall.id, parsedArgs)
              cache.toolCallArgsBuffer.delete(ame.contentIndex)
              flushSync(sessionPath)
              break
            }

            case 'done': {
              const msg = ame.message
              if (msg.usage && msg.responseId && !cache.countedResponseIds.has(msg.responseId)) {
                cache.countedResponseIds.add(msg.responseId)
                onSessionTokenUsageUpdate(sessionPath, (prev) => ({
                  inputTokens: prev.inputTokens + msg.usage.input,
                  outputTokens: prev.outputTokens + msg.usage.output,
                  cacheReadTokens: prev.cacheReadTokens + msg.usage.cacheRead,
                  cacheWriteTokens: prev.cacheWriteTokens + msg.usage.cacheWrite,
                  totalTokens: msg.usage.totalTokens,
                  totalCost: prev.totalCost + msg.usage.cost.total,
                  contextWindowSize: currentModelRef.current?.contextWindow ?? inferContextWindow(msg.responseModel),
                }))
              } else if (msg.usage) {
                onSessionTokenUsageUpdate(sessionPath, (prev) => ({
                  ...prev,
                  contextWindowSize: currentModelRef.current?.contextWindow ?? inferContextWindow(msg.responseModel),
                }))
              }
              break
            }
            case 'error':
              break
          }

          if (ame.type !== 'toolcall_end') {
            syncContentBlocksToMessage(sessionPath)
          }
          break
        }

        case 'message_end': {
          const msg = event.message
          if (msg.role === 'assistant') {
            const assistantMsg = msg as PiAssistantMessage
            const cache = getCache(sessionPath)
            if (assistantMsg.usage && assistantMsg.responseId && cache && !cache.countedResponseIds.has(assistantMsg.responseId)) {
              cache.countedResponseIds.add(assistantMsg.responseId)
              onSessionTokenUsageUpdate(sessionPath, (prev) => ({
                inputTokens: prev.inputTokens + assistantMsg.usage.input,
                outputTokens: prev.outputTokens + assistantMsg.usage.output,
                cacheReadTokens: prev.cacheReadTokens + assistantMsg.usage.cacheRead,
                cacheWriteTokens: prev.cacheWriteTokens + assistantMsg.usage.cacheWrite,
                totalTokens: assistantMsg.usage.totalTokens,
                totalCost: prev.totalCost + assistantMsg.usage.cost.total,
                contextWindowSize: currentModelRef.current?.contextWindow ?? inferContextWindow(assistantMsg.responseModel),
              }))
            } else if (assistantMsg.usage) {
              onSessionTokenUsageUpdate(sessionPath, (prev) => ({
                ...prev,
                contextWindowSize: currentModelRef.current?.contextWindow ?? inferContextWindow(assistantMsg.responseModel),
              }))
            }
          }
          break
        }

        case 'tool_execution_start': {
          const cache = getCache(sessionPath)
          const currentAssistantId = cache?.currentAssistantId
          if (!currentAssistantId) break
          onSessionMessagesUpdate(sessionPath, (prev) =>
            prev.map((msg) => {
              if (msg.id !== currentAssistantId) return msg
              return {
                ...msg,
                blocks: msg.blocks.map((block) => {
                  if (
                    block.type === 'tool_call' &&
                    (block as ToolCallBlock).toolCallId === event.toolCallId
                  ) {
                    return { ...block, status: 'running' as const }
                  }
                  return block
                }),
              }
            }),
          )
          break
        }

        case 'tool_execution_end': {
          const toolEvent = event as ToolExecutionEndEvent
          const cache = getCache(sessionPath)
          const currentAssistantId = cache?.currentAssistantId
          if (!currentAssistantId) break
          const toolArgs = cache?.pendingToolCallArgs.get(toolEvent.toolCallId)
          cache?.pendingToolCallArgs.delete(toolEvent.toolCallId)

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

          onSessionMessagesUpdate(sessionPath, (prev) =>
            prev.map((msg) => {
              if (msg.id !== currentAssistantId) return msg
              const updatedBlocks = [] as ContentBlock[]
              for (const block of msg.blocks) {
                if (block.type === 'tool_call' && (block as ToolCallBlock).toolCallId === toolEvent.toolCallId) {
                  updatedBlocks.push({ ...block, status: 'completed' as const })
                  if (toolResultBlock) {
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

        case 'connected': {
          const sessionId = (event as Record<string, unknown>).sessionId as string | undefined
          const sessionFile = (event as Record<string, unknown>).sessionFile as string | undefined
          if (sessionId && sessionFile) {
            sessionIdToPathMap.current.set(sessionId, sessionFile)
          }
          break
        }

        default:
          break
      }
    },
    [resolveSessionPath, getCache, ensureCacheSync, updateCache, updateContentBlock, syncContentBlocksToMessage, finalizeCurrentAssistant, flushSync, onSessionMessagesUpdate, onSessionTokenUsageUpdate, onSessionStreamingChange, onDisplaySession],
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

  const refreshModelInfo = useCallback(() => {
    type ApiWithModelInfo = typeof window.api & { getModelInfo: (sessionPath: string | null) => Promise<{ ok: boolean; data?: { model: PiModelInfo | null; thinkingLevel: string | null }; error?: string }> }
    type ApiWithModels = typeof window.api & { getAvailableModels: (sp: string | null) => Promise<{ ok: boolean; data?: { models: PiModelInfo[] }; error?: string }> }
    ;(window.api as ApiWithModelInfo).getModelInfo(null).then((result) => {
      if (result.ok && result.data) {
        const model = result.data.model as PiModelInfo | null
        const thinkingLevel = result.data.thinkingLevel as string | null
        if (model && model.provider === 'unknown' && model.id === 'unknown') {
          setCurrentModel(null)
        } else if (model && (!model.name || model.name === 'unknown')) {
          ;(window.api as ApiWithModels).getAvailableModels(null).then((modelsResult) => {
            const data = modelsResult.data as { models?: PiModelInfo[] } | undefined
            const models: PiModelInfo[] = (modelsResult.ok && data?.models) ? data.models : []
            const match = models.find((m: PiModelInfo) => m.provider === model.provider && m.id === model.id)
            setCurrentModel(match ? { ...model, name: match.name } : model)
          })
        } else {
          setCurrentModel(model)
        }
        setThinkingLevel(thinkingLevel)
      }
    })
  }, [])

  useEffect(() => {
    if (!isConnected) return
    refreshModelInfo()
    const timer = setTimeout(() => refreshModelInfo(), 2000)
    return () => clearTimeout(timer)
  }, [isConnected, refreshModelInfo])

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

  useEffect(() => {
    type WorkerStatusCallback = (data: { sessionPath: string; role: string; status: string; isStreaming: boolean }) => void
    const apiWithWorkerStatus = window.api as typeof window.api & { onWorkerStatus?: (callback: WorkerStatusCallback) => (() => void) }
    if (apiWithWorkerStatus.onWorkerStatus) {
      const cleanup = apiWithWorkerStatus.onWorkerStatus((data) => {
        onWorkerStatusChange(data.sessionPath, data.status)
      })
      return cleanup
    }
  }, [onWorkerStatusChange])

  const respondToUiRequest = useCallback((sessionPath: string | null, requestId: string, response: Record<string, unknown>) => {
    window.api.sendExtensionUIResponse(sessionPath, { type: 'extension_ui_response', id: requestId, ...response })
    setPendingUiRequests(prev => prev.filter(r => r.id !== requestId))
  }, [])

  const sendPrompt = useCallback(
    (sessionPath: string | null, text: string, images?: { data: string; mimeType: string }[], mentions?: Array<{ type: string; path: string; name: string }>) => {
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
      void mentions
      window.api.sendCommand(sessionPath, command)
    },
    [],
  )

  const abort = useCallback((sessionPath: string | null): Promise<void> => {
    window.api.sendCommand(sessionPath, { type: 'abort' })
    return new Promise((resolve) => {
      const startTime = Date.now()
      const check = () => {
        const stillStreaming = sessionPath ? (getCache(sessionPath)?.isStreaming ?? false) : false
        if (!stillStreaming || Date.now() - startTime > 5000) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      setTimeout(check, 50)
    })
  }, [getCache])

  const clearMessages = useCallback((sessionPath: string | null) => {
    if (!sessionPath) return
    onSessionMessagesUpdate(sessionPath, () => [])
    onSessionForkPointsUpdate(sessionPath, [])
    onSessionTokenUsageUpdate(sessionPath, () => ({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      contextWindowSize: currentModelRef.current?.contextWindow ?? 200000,
    }))
    updateCache(sessionPath, (cache) => ({
      ...cache,
      currentAssistantId: null,
    }))
    const cache = getCache(sessionPath)
    if (cache) {
      cache.currentContentBlocks.clear()
      cache.toolCallArgsBuffer.clear()
      cache.pendingToolCallArgs.clear()
      cache.countedResponseIds.clear()
    }
  }, [onSessionMessagesUpdate, onSessionForkPointsUpdate, onSessionTokenUsageUpdate, updateCache, getCache])

  const onAgentEndRef = useRef<(() => void) | null>(null)

  const setOnAgentEnd = useCallback((cb: (() => void) | null) => {
    onAgentEndRef.current = cb
  }, [])

  const loadForkPoints = useCallback(async (sessionPath: string) => {
    type ExtendedApiWithForkPoints = typeof window.api & { getForkPoints: (path: string) => Promise<ForkPoint[]> }
    const apiWithFp = window.api as ExtendedApiWithForkPoints
    try {
      const points = await apiWithFp.getForkPoints(sessionPath)
      onSessionForkPointsUpdate(sessionPath, points)
    } catch {
      onSessionForkPointsUpdate(sessionPath, [])
    }
  }, [onSessionForkPointsUpdate])

  const loadHistory = useCallback(async (sessionPath: string | null) => {
    type ExtendedApiWithMessages = typeof window.api & { getMessages: (sp: string | null) => Promise<unknown[]> }
    const api = window.api as ExtendedApiWithMessages

    let piMessages: unknown[]
    try {
      piMessages = await api.getMessages(sessionPath)
    } catch {
      return
    }

    if (!sessionPath) return
    if (!Array.isArray(piMessages) || piMessages.length === 0) {
      clearMessages(sessionPath)
      return
    }

    const result = convertPiMessagesToChatMessages(piMessages)

    clearMessages(sessionPath)
    onSessionMessagesUpdate(sessionPath, () => result.messages)
    const cache = getCache(sessionPath)
    if (cache) {
      for (const rid of result.responseIds) {
        cache.countedResponseIds.add(rid)
      }
    }
    if (result.tokenUsage.totalCost > 0 || result.tokenUsage.totalTokens > 0) {
      onSessionTokenUsageUpdate(sessionPath, () => result.tokenUsage)
    }
  }, [clearMessages, onSessionMessagesUpdate, onSessionTokenUsageUpdate, getCache])

  const getAvailableModels = useCallback(async (sessionPath: string | null): Promise<PiModelInfo[]> => {
    type ApiWithModels = typeof window.api & { getAvailableModels: (sp: string | null) => Promise<{ ok: boolean; data?: { models: PiModelInfo[] }; error?: string }> }
    const result = await (window.api as ApiWithModels).getAvailableModels(sessionPath)
    if (result.ok && result.data?.models) return result.data.models
    return []
  }, [])

  const setModel = useCallback(async (sessionPath: string | null, modelId: string, provider?: string): Promise<boolean> => {
    type ApiWithSetModel = typeof window.api & { setModel: (sp: string | null, model: string, provider?: string) => Promise<{ ok: boolean; data?: PiModelInfo | null; error?: string }> }
    const result = await (window.api as ApiWithSetModel).setModel(sessionPath, modelId, provider)
    if (result.ok) {
      setCurrentModel(result.data ?? null)
      return true
    }
    return false
  }, [])

  const cycleModelFn = useCallback(async (sessionPath: string | null, direction?: 'forward' | 'backward'): Promise<boolean> => {
    type ApiWithCycle = typeof window.api & { cycleModel: (sp: string | null, direction?: 'forward' | 'backward') => Promise<{ ok: boolean; data?: { model: PiModelInfo | null; thinkingLevel: string; isScoped: boolean }; error?: string }> }
    const result = await (window.api as ApiWithCycle).cycleModel(sessionPath, direction)
    if (result.ok && result.data) {
      setCurrentModel(result.data.model)
      setThinkingLevel(result.data.thinkingLevel)
      return true
    }
    return false
  }, [])

  const getProviderAuthStatus = useCallback(async (): Promise<Record<string, { configured: boolean; source?: string }>> => {
    type ApiWithAuthStatus = typeof window.api & { getProviderAuthStatus: (sp: string | null) => Promise<{ ok: boolean; data?: Record<string, { configured: boolean; source?: string }>; error?: string }> }
    const result = await (window.api as ApiWithAuthStatus).getProviderAuthStatus(null)
    return result.ok && result.data ? result.data : {}
  }, [])

  const tryAutoSelectModel = useCallback(async (provider: string) => {
    type ApiWithModels = typeof window.api & { getAvailableModels: (sp: string | null) => Promise<{ ok: boolean; data?: { models: PiModelInfo[] }; error?: string }> }
    type ApiWithSetModel = typeof window.api & { setModel: (sp: string | null, model: string, provider?: string) => Promise<{ ok: boolean; data?: PiModelInfo | null; error?: string }> }
    try {
      const modelsResult = await (window.api as ApiWithModels).getAvailableModels(null)
      const data = modelsResult.data as { models?: PiModelInfo[] } | undefined
      const models = modelsResult.ok && data?.models ? data.models : []
      if (models.length > 0) {
        const match = models.find((m: PiModelInfo) => m.provider === provider) ?? models[0]
        const setResult = await (window.api as ApiWithSetModel).setModel(null, match.id, match.provider)
        if (setResult.ok && setResult.data) {
          setCurrentModel(setResult.data as PiModelInfo | null)
        } else if (setResult.ok) {
          refreshModelInfo()
        }
      }
    } catch {}
  }, [refreshModelInfo])

  const setApiKeyFn = useCallback(async (provider: string, apiKey: string): Promise<boolean> => {
    type ApiWithSetApiKey = typeof window.api & { setApiKey: (sp: string | null, provider: string, apiKey: string) => Promise<{ ok: boolean; error?: string }> }
    const result = await (window.api as ApiWithSetApiKey).setApiKey(null, provider, apiKey)
    if (result.ok) {
      refreshModelInfo()
      if (!currentModelRef.current || (currentModelRef.current.provider === 'unknown' && currentModelRef.current.id === 'unknown')) {
        tryAutoSelectModel(provider)
      }
    }
    return result.ok
  }, [refreshModelInfo])

  const removeAuthFn = useCallback(async (provider: string): Promise<boolean> => {
    type ApiWithRemoveAuth = typeof window.api & { removeAuth: (sp: string | null, provider: string) => Promise<{ ok: boolean; error?: string }> }
    const result = await (window.api as ApiWithRemoveAuth).removeAuth(null, provider)
    return result.ok
  }, [])

  const registerCustomProviderFn = useCallback(async (provider: string, config: Record<string, unknown>): Promise<boolean> => {
    type ApiWithRegister = typeof window.api & { registerCustomProvider: (sp: string | null, provider: string, config: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }> }
    const result = await (window.api as ApiWithRegister).registerCustomProvider(null, provider, config)
    if (result.ok) {
      refreshModelInfo()
      if (!currentModelRef.current || (currentModelRef.current.provider === 'unknown' && currentModelRef.current.id === 'unknown')) {
        tryAutoSelectModel(provider)
      }
    }
    return result.ok
  }, [refreshModelInfo, tryAutoSelectModel])

  const testProviderFn = useCallback(async (provider: string, overrides?: { baseUrl?: string; apiKey?: string }): Promise<{ ok: boolean; error?: string; latencyMs?: number }> => {
    type ApiWithTest = typeof window.api & { testProvider: (sp: string | null, provider: string, overrides?: { baseUrl?: string; apiKey?: string }) => Promise<{ ok: boolean; error?: string; latencyMs?: number }> }
    const result = await (window.api as ApiWithTest).testProvider(null, provider, overrides)
    return result
  }, [])

  const getProviderConfigFn = useCallback(async (provider: string): Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }> => {
    type ApiWithConfig = typeof window.api & { getProviderConfig: (provider: string) => Promise<{ ok: boolean; config?: Record<string, unknown>; error?: string }> }
    const result = await (window.api as ApiWithConfig).getProviderConfig(provider)
    return result
  }, [])

  const listCustomProvidersFn = useCallback(async (): Promise<{ ok: boolean; providers: Record<string, { baseUrl: string; name?: string }> }> => {
    type ApiWithList = typeof window.api & { listCustomProviders: () => Promise<{ ok: boolean; providers: Record<string, { baseUrl: string; name?: string }> }> }
    const result = await (window.api as ApiWithList).listCustomProviders()
    return result
  }, [])

  return { isConnected, currentModel, thinkingLevel, sendPrompt, abort, pendingUiRequests, respondToUiRequest, clearMessages, loadHistory, loadForkPoints, onAgentEnd: onAgentEndRef.current, setOnAgentEnd, getAvailableModels, setModel, cycleModel: cycleModelFn, getProviderAuthStatus, setApiKey: setApiKeyFn, removeAuth: removeAuthFn, registerCustomProvider: registerCustomProviderFn, testProvider: testProviderFn, getProviderConfig: getProviderConfigFn, listCustomProviders: listCustomProvidersFn, refreshModelInfo }
}

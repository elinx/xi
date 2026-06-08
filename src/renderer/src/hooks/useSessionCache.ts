import { useState, useCallback, useRef } from 'react'
import type { ChatMessage, ContentBlock } from '../types/message'
import type { ForkPoint } from '../types/session'
import { convertPiMessagesToChatMessages, type TokenUsage } from '../utils/convert-messages'

export type WorkerStatus = 'none' | 'starting' | 'connected' | 'error'

export interface SessionCache {
  sessionPath: string
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  tokenUsage: TokenUsage
  forkPoints: ForkPoint[]
  loadedAt: number

  currentAssistantId: string | null
  currentContentBlocks: Map<number, ContentBlock>
  toolCallArgsBuffer: Map<number, string>
  pendingToolCallArgs: Map<string, Record<string, unknown>>
  countedResponseIds: Set<string>
}

interface UseSessionCacheReturn {
  displayedSessionPath: string | null
  displayedMessages: ChatMessage[]
  isDisplayedStreaming: boolean
  displayedTokenUsage: TokenUsage
  displayedForkPoints: ForkPoint[]
  displayedStreamingMessageId: string | null

  getCache: (sessionPath: string) => SessionCache | undefined
  ensureCacheSync: (sessionPath: string) => SessionCache
  getOrCreateCache: (sessionPath: string) => Promise<SessionCache>
  updateCache: (sessionPath: string, updater: (cache: SessionCache) => SessionCache) => void
  displaySession: (sessionPath: string) => Promise<void>
  clearCache: (sessionPath: string) => void
  setCacheStreaming: (sessionPath: string, isStreaming: boolean, streamingMessageId: string | null) => void
  refreshDisplayedMessages: () => void

  updateSessionMessages: (sessionPath: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  updateSessionTokenUsage: (sessionPath: string, updater: (prev: TokenUsage) => TokenUsage) => void
  setSessionStreaming: (sessionPath: string, isStreaming: boolean, streamingMessageId: string | null) => void
  updateSessionForkPoints: (sessionPath: string, forkPoints: ForkPoint[]) => void

  workerStatuses: Map<string, WorkerStatus>
  setWorkerStatus: (sessionPath: string, status: WorkerStatus) => void
  getWorkerStatus: (sessionPath: string) => WorkerStatus
}

const INITIAL_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  contextWindowSize: 200000,
}

function createEmptyCache(sessionPath: string): SessionCache {
  return {
    sessionPath,
    messages: [],
    isStreaming: false,
    streamingMessageId: null,
    tokenUsage: { ...INITIAL_TOKEN_USAGE },
    forkPoints: [],
    loadedAt: 0,
    currentAssistantId: null,
    currentContentBlocks: new Map(),
    toolCallArgsBuffer: new Map(),
    pendingToolCallArgs: new Map(),
    countedResponseIds: new Set(),
  }
}

export function useSessionCache(): UseSessionCacheReturn {
  const cacheMap = useRef<Map<string, SessionCache>>(new Map())

  const [displayedSessionPath, setDisplayedSessionPath] = useState<string | null>(null)
  const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([])
  const [displayedTokenUsage, setDisplayedTokenUsage] = useState<TokenUsage>({ ...INITIAL_TOKEN_USAGE })
  const [displayedForkPoints, setDisplayedForkPoints] = useState<ForkPoint[]>([])
  const [isDisplayedStreaming, setIsDisplayedStreaming] = useState(false)
  const [displayedStreamingMessageId, setDisplayedStreamingMessageId] = useState<string | null>(null)

  const displayedSessionPathRef = useRef<string | null>(null)

  const [workerStatuses, setWorkerStatuses] = useState<Map<string, WorkerStatus>>(new Map())
  const workerStatusesRef = useRef<Map<string, WorkerStatus>>(new Map())

  const syncDisplayedFromCache = useCallback((sessionPath: string | null) => {
    if (!sessionPath) {
      setDisplayedMessages([])
      setDisplayedTokenUsage({ ...INITIAL_TOKEN_USAGE })
      setDisplayedForkPoints([])
      setIsDisplayedStreaming(false)
      setDisplayedStreamingMessageId(null)
      return
    }
    const cache = cacheMap.current.get(sessionPath)
    if (cache) {
      setDisplayedMessages(cache.messages)
      setDisplayedTokenUsage(cache.tokenUsage)
      setDisplayedForkPoints(cache.forkPoints)
      setIsDisplayedStreaming(cache.isStreaming)
      setDisplayedStreamingMessageId(cache.streamingMessageId)
    }
  }, [])

  const getCache = useCallback((sessionPath: string): SessionCache | undefined => {
    return cacheMap.current.get(sessionPath)
  }, [])

  const ensureCacheSync = useCallback((sessionPath: string): SessionCache => {
    const existing = cacheMap.current.get(sessionPath)
    if (existing) return existing
    const cache = createEmptyCache(sessionPath)
    cacheMap.current.set(sessionPath, cache)
    return cache
  }, [])

  const getOrCreateCache = useCallback(async (sessionPath: string): Promise<SessionCache> => {
    const existing = cacheMap.current.get(sessionPath)
    if (existing) return existing

    let cache: SessionCache = createEmptyCache(sessionPath)
    try {
      type ApiWithGetMessagesForSession = typeof window.api & {
        getMessagesForSession: (path: string) => Promise<unknown[]>
      }
      const api = window.api as ApiWithGetMessagesForSession
      const piMessages = await api.getMessagesForSession(sessionPath)

      if (Array.isArray(piMessages) && piMessages.length > 0) {
        const result = convertPiMessagesToChatMessages(piMessages)
        cache = {
          ...cache,
          messages: result.messages,
          tokenUsage: result.tokenUsage,
          loadedAt: Date.now(),
          countedResponseIds: new Set(result.responseIds),
        }
      }
    } catch {
      // JSONL read failed — show empty state
    }

    cacheMap.current.set(sessionPath, cache)
    return cache
  }, [])

  const updateCache = useCallback((sessionPath: string, updater: (cache: SessionCache) => SessionCache) => {
    const existing = cacheMap.current.get(sessionPath)
    if (!existing) return
    const updated = updater(existing)
    cacheMap.current.set(sessionPath, updated)

    if (sessionPath === displayedSessionPathRef.current) {
      setDisplayedMessages(updated.messages)
      setDisplayedTokenUsage(updated.tokenUsage)
      setDisplayedForkPoints(updated.forkPoints)
      setIsDisplayedStreaming(updated.isStreaming)
      setDisplayedStreamingMessageId(updated.streamingMessageId)
    }
  }, [])

  const displaySession = useCallback(async (sessionPath: string) => {
    displayedSessionPathRef.current = sessionPath
    setDisplayedSessionPath(sessionPath)
    const cache = await getOrCreateCache(sessionPath)
    if (displayedSessionPathRef.current !== sessionPath) return
    syncDisplayedFromCache(sessionPath)

    try {
      type ApiWithForkPoints = typeof window.api & {
        getForkPoints: (path: string) => Promise<ForkPoint[]>
      }
      const api = window.api as ApiWithForkPoints
      const points = await api.getForkPoints(sessionPath)
      if (displayedSessionPathRef.current !== sessionPath) return
      const updated: SessionCache = { ...cache, forkPoints: points }
      cacheMap.current.set(sessionPath, updated)
      if (sessionPath === displayedSessionPathRef.current) {
        setDisplayedForkPoints(points)
      }
    } catch {
      // ignore
    }
  }, [getOrCreateCache, syncDisplayedFromCache])

  const clearCache = useCallback((sessionPath: string) => {
    cacheMap.current.delete(sessionPath)
    if (sessionPath === displayedSessionPathRef.current) {
      syncDisplayedFromCache(displayedSessionPathRef.current)
    }
  }, [syncDisplayedFromCache])

  const setCacheStreaming = useCallback((sessionPath: string, isStreaming: boolean, streamingMessageId: string | null) => {
    const cache = cacheMap.current.get(sessionPath)
    if (!cache) return
    const updated = { ...cache, isStreaming, streamingMessageId }
    cacheMap.current.set(sessionPath, updated)
    if (sessionPath === displayedSessionPathRef.current) {
      setIsDisplayedStreaming(isStreaming)
      setDisplayedStreamingMessageId(streamingMessageId)
    }
  }, [])

  const refreshDisplayedMessages = useCallback(() => {
    syncDisplayedFromCache(displayedSessionPathRef.current)
  }, [syncDisplayedFromCache])

  const updateSessionMessages = useCallback((sessionPath: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    const cache = cacheMap.current.get(sessionPath)
    if (!cache) return
    const updatedMessages = updater(cache.messages)
    const updated = { ...cache, messages: updatedMessages }
    cacheMap.current.set(sessionPath, updated)

    if (sessionPath === displayedSessionPathRef.current) {
      setDisplayedMessages(updatedMessages)
    }
  }, [])

  const updateSessionTokenUsage = useCallback((sessionPath: string, updater: (prev: TokenUsage) => TokenUsage) => {
    const cache = cacheMap.current.get(sessionPath)
    if (!cache) return
    const updatedTokenUsage = updater(cache.tokenUsage)
    const updated = { ...cache, tokenUsage: updatedTokenUsage }
    cacheMap.current.set(sessionPath, updated)

    if (sessionPath === displayedSessionPathRef.current) {
      setDisplayedTokenUsage(updatedTokenUsage)
    }
  }, [])

  const setSessionStreaming = useCallback((sessionPath: string, isStreaming: boolean, streamingMessageId: string | null) => {
    const cache = cacheMap.current.get(sessionPath)
    if (!cache) return
    const updated = { ...cache, isStreaming, streamingMessageId }
    cacheMap.current.set(sessionPath, updated)

    if (sessionPath === displayedSessionPathRef.current) {
      setIsDisplayedStreaming(isStreaming)
      setDisplayedStreamingMessageId(streamingMessageId)
    }
  }, [])

  const updateSessionForkPoints = useCallback((sessionPath: string, forkPoints: ForkPoint[]) => {
    const cache = cacheMap.current.get(sessionPath)
    if (!cache) return
    const updated = { ...cache, forkPoints }
    cacheMap.current.set(sessionPath, updated)

    if (sessionPath === displayedSessionPathRef.current) {
      setDisplayedForkPoints(forkPoints)
    }
  }, [])

  const setWorkerStatus = useCallback((sessionPath: string, status: WorkerStatus) => {
    workerStatusesRef.current.set(sessionPath, status)
    setWorkerStatuses(new Map(workerStatusesRef.current))
  }, [])

  const getWorkerStatus = useCallback((sessionPath: string): WorkerStatus => {
    return workerStatusesRef.current.get(sessionPath) ?? 'none'
  }, [])

  return {
    displayedSessionPath,
    displayedMessages,
    isDisplayedStreaming,
    displayedTokenUsage,
    displayedForkPoints,
    displayedStreamingMessageId,
    getCache,
ensureCacheSync,
getOrCreateCache,
    updateCache,
    displaySession,
    clearCache,
    setCacheStreaming,
    refreshDisplayedMessages,
    updateSessionMessages,
    updateSessionTokenUsage,
    setSessionStreaming,
    updateSessionForkPoints,
    workerStatuses,
    setWorkerStatus,
    getWorkerStatus,
  }
}

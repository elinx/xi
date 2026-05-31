/**
 * useSessionCache — Manages per-session message caching for Lazy Session Switch.
 *
 * Decouples the "displayed session" (what the user sees) from the
 * "Pi-connected session" (which session the Pi worker is on).
 * When they differ, the displayed session is in read-only mode.
 *
 * Pi events are always written to the Pi-connected session's cache.
 * The UI is only refreshed when the displayed session matches the
 * Pi-connected session (or when the user explicitly switches).
 */
import { useState, useCallback, useRef } from 'react'
import type { ChatMessage, ContentBlock } from '../types/message'
import type { ForkPoint } from '../types/session'
import { convertPiMessagesToChatMessages, type TokenUsage } from '../utils/convert-messages'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionCache {
  sessionPath: string
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  tokenUsage: TokenUsage
  forkPoints: ForkPoint[]
  loadedAt: number

  // Pi streaming intermediate state — needed to resume receiving deltas
  // after switching away and back to a streaming session
  currentAssistantId: string | null
  currentContentBlocks: Map<number, ContentBlock>
  toolCallArgsBuffer: Map<number, string>
  pendingToolCallArgs: Map<string, Record<string, unknown>>
  countedResponseIds: Set<string>
}

interface UseSessionCacheReturn {
  // What the user is looking at
  displayedSessionPath: string | null
  // Messages for the displayed session
  displayedMessages: ChatMessage[]
  // Whether the displayed session is streaming
  isDisplayedStreaming: boolean
  // Token usage for the displayed session
  displayedTokenUsage: TokenUsage
  // Fork points for the displayed session
  displayedForkPoints: ForkPoint[]
  // Streaming message ID for the displayed session
  displayedStreamingMessageId: string | null

  // Get cache for a specific session
  getCache: (sessionPath: string) => SessionCache | undefined
  // Get or create cache for a session (loads from JSONL if not cached)
  getOrCreateCache: (sessionPath: string) => Promise<SessionCache>
  // Update a session's cache (used by usePiRpc to write streaming events)
  updateCache: (sessionPath: string, updater: (cache: SessionCache) => SessionCache) => void
  // Switch the displayed session (does NOT switch Pi connection)
  displaySession: (sessionPath: string) => Promise<void>
  // Clear a session's cache
  clearCache: (sessionPath: string) => void
  // Mark a session as streaming / not streaming
  setCacheStreaming: (sessionPath: string, isStreaming: boolean, streamingMessageId: string | null) => void
  // Refresh displayed messages from cache (after cache updates)
  refreshDisplayedMessages: () => void

  updatePiConnectedMessages: (piConnectedPath: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  updatePiConnectedTokenUsage: (piConnectedPath: string, updater: (prev: TokenUsage) => TokenUsage) => void
  setPiConnectedStreaming: (piConnectedPath: string, isStreaming: boolean, streamingMessageId: string | null) => void
  updatePiConnectedForkPoints: (piConnectedPath: string, forkPoints: ForkPoint[]) => void
}

// ---------------------------------------------------------------------------
// Initial values
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionCache(): UseSessionCacheReturn {
  const cacheMap = useRef<Map<string, SessionCache>>(new Map())

  const [displayedSessionPath, setDisplayedSessionPath] = useState<string | null>(null)
  const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([])
  const [displayedTokenUsage, setDisplayedTokenUsage] = useState<TokenUsage>({ ...INITIAL_TOKEN_USAGE })
  const [displayedForkPoints, setDisplayedForkPoints] = useState<ForkPoint[]>([])
  const [isDisplayedStreaming, setIsDisplayedStreaming] = useState(false)
  const [displayedStreamingMessageId, setDisplayedStreamingMessageId] = useState<string | null>(null)

  // Use a ref for displayedSessionPath to avoid circular dep chains
  // (callbacks that read displayedSessionPath also set it via setDisplayedSessionPath)
  const displayedSessionPathRef = useRef<string | null>(null)

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

  const getOrCreateCache = useCallback(async (sessionPath: string): Promise<SessionCache> => {
    const existing = cacheMap.current.get(sessionPath)
    if (existing) return existing

    // Load from JSONL via IPC
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

    // If this is the displayed session, sync UI
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

  const updatePiConnectedMessages = useCallback((piConnectedPath: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    const cache = cacheMap.current.get(piConnectedPath)
    if (!cache) return
    const updatedMessages = updater(cache.messages)
    const updated = { ...cache, messages: updatedMessages }
    cacheMap.current.set(piConnectedPath, updated)

    if (piConnectedPath === displayedSessionPathRef.current) {
      setDisplayedMessages(updatedMessages)
    }
  }, [])

  const updatePiConnectedTokenUsage = useCallback((piConnectedPath: string, updater: (prev: TokenUsage) => TokenUsage) => {
    const cache = cacheMap.current.get(piConnectedPath)
    if (!cache) return
    const updatedTokenUsage = updater(cache.tokenUsage)
    const updated = { ...cache, tokenUsage: updatedTokenUsage }
    cacheMap.current.set(piConnectedPath, updated)

    if (piConnectedPath === displayedSessionPathRef.current) {
      setDisplayedTokenUsage(updatedTokenUsage)
    }
  }, [])

  const setPiConnectedStreaming = useCallback((piConnectedPath: string, isStreaming: boolean, streamingMessageId: string | null) => {
    const cache = cacheMap.current.get(piConnectedPath)
    if (!cache) return
    const updated = { ...cache, isStreaming, streamingMessageId }
    cacheMap.current.set(piConnectedPath, updated)

    if (piConnectedPath === displayedSessionPathRef.current) {
      setIsDisplayedStreaming(isStreaming)
      setDisplayedStreamingMessageId(streamingMessageId)
    }
  }, [])

  const updatePiConnectedForkPoints = useCallback((piConnectedPath: string, forkPoints: ForkPoint[]) => {
    const cache = cacheMap.current.get(piConnectedPath)
    if (!cache) return
    const updated = { ...cache, forkPoints }
    cacheMap.current.set(piConnectedPath, updated)

    if (piConnectedPath === displayedSessionPathRef.current) {
      setDisplayedForkPoints(forkPoints)
    }
  }, [])

  return {
    displayedSessionPath,
    displayedMessages,
    isDisplayedStreaming,
    displayedTokenUsage,
    displayedForkPoints,
    displayedStreamingMessageId,
    getCache,
    getOrCreateCache,
    updateCache,
    displaySession,
    clearCache,
    setCacheStreaming,
    refreshDisplayedMessages,
    updatePiConnectedMessages,
    updatePiConnectedTokenUsage,
    setPiConnectedStreaming,
    updatePiConnectedForkPoints,
  }
}

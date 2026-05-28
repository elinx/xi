import { useState, useCallback, useEffect } from 'react'
import type { SessionListResult, SessionInfo, ForkableMessage, SessionIpcApi } from '../types/session'

type ExtendedApi = typeof window.api & SessionIpcApi
const api = window.api as ExtendedApi

interface UseSessionManagerReturn {
  sessions: SessionListResult | null
  currentSession: SessionInfo | null
  forkMessages: ForkableMessage[]
  loadSessions: () => Promise<void>
  forkAtEntry: (entryId: string) => Promise<void>
  switchSession: (sessionPath: string) => Promise<void>
  newSession: (name: string, parentSessionPath?: string) => Promise<boolean>
  renameSession: (name: string) => Promise<void>
  refresh: () => Promise<void>
  getForkMessages: () => Promise<ForkableMessage[]>
}

export function useSessionManager(isConnected: boolean): UseSessionManagerReturn {
  const [sessions, setSessions] = useState<SessionListResult | null>(null)
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null)
  const [forkMessages, setForkMessages] = useState<ForkableMessage[]>([])

  const loadSessions = useCallback(async () => {
    try {
      const result = await api.listSessions()
      setSessions(result)
    } catch {
      setSessions(null)
    }
  }, [])

  const loadCurrentSession = useCallback(async () => {
    try {
      const info = await api.getCurrentSession()
      setCurrentSession(info)
    } catch {
      setCurrentSession(null)
    }
  }, [])

  const getForkMessages = useCallback(async (): Promise<ForkableMessage[]> => {
    try {
      const msgs = await api.getForkMessages()
      setForkMessages(msgs)
      return msgs
    } catch {
      setForkMessages([])
      return []
    }
  }, [])

  const forkAtEntry = useCallback(async (entryId: string) => {
    const result = await api.forkAtEntry(entryId)
    if (result.success) {
      await loadSessions()
      await loadCurrentSession()
    }
  }, [loadSessions, loadCurrentSession])

  const switchSession = useCallback(async (sessionPath: string) => {
    const result = await api.switchSession(sessionPath)
    if (result.success) {
      await loadSessions()
      await loadCurrentSession()
    }
  }, [loadSessions, loadCurrentSession])

  const newSession = useCallback(async (name: string, parentSessionPath?: string): Promise<boolean> => {
    const result = await api.newSession(parentSessionPath)
    if (result.success) {
      await api.renameSession(name)
      await loadSessions()
      await loadCurrentSession()
      return true
    }
    return false
  }, [loadSessions, loadCurrentSession])

  const renameSession = useCallback(async (name: string) => {
    const result = await api.renameSession(name)
    if (result.success) {
      await loadCurrentSession()
      await loadSessions()
    }
  }, [loadCurrentSession, loadSessions])

  const refresh = useCallback(async () => {
    await Promise.all([loadSessions(), loadCurrentSession()])
  }, [loadSessions, loadCurrentSession])

  useEffect(() => {
    if (isConnected) {
      loadSessions()
      loadCurrentSession()
    }
  }, [isConnected])

  // Also refresh when Pi reconnects (state change events)
  useEffect(() => {
    const cleanup = window.api.onStateChanged((state) => {
      if (state.connected) {
        loadSessions()
        loadCurrentSession()
      }
    })
    return cleanup
  }, [loadSessions, loadCurrentSession])

  return {
    sessions,
    currentSession,
    forkMessages,
    loadSessions,
    forkAtEntry,
    switchSession,
    newSession,
    renameSession,
    refresh,
    getForkMessages,
  }
}

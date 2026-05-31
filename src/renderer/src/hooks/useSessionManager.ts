import { useState, useCallback, useEffect } from 'react'
import type { SessionListResult, SessionInfo, ForkableMessage, ForkPoint, SessionIpcApi } from '../types/session'

type ExtendedApi = typeof window.api & SessionIpcApi
const api = window.api as ExtendedApi

interface UseSessionManagerReturn {
  sessions: SessionListResult | null
  currentSession: SessionInfo | null
  forkMessages: ForkableMessage[]
  loadSessions: () => Promise<void>
  forkAtEntry: (entryId: string, name: string) => Promise<void>
  switchSession: (sessionPath: string) => Promise<{ success: boolean; error?: string }>
  newSession: (name: string, parentSessionPath?: string) => Promise<boolean>
  renameSession: (name: string) => Promise<void>
  deleteSession: (sessionPath: string) => Promise<boolean>
  setSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<boolean>
  getForkPoints: (sessionPath: string) => Promise<ForkPoint[]>
  refresh: () => Promise<void>
  getForkMessages: () => Promise<ForkableMessage[]>
  clearSession: () => Promise<boolean>
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

  const forkAtEntry = useCallback(async (entryId: string, name: string) => {
    const result = await api.forkAtEntry(entryId, name)
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
    return result
  }, [loadSessions, loadCurrentSession])

  const newSession = useCallback(async (name: string, parentSessionPath?: string): Promise<boolean> => {
    const result = await api.newSession(name, parentSessionPath)
    if (result.success) {
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

  const deleteSession = useCallback(async (sessionPath: string): Promise<boolean> => {
    const result = await api.deleteSession(sessionPath)
    if (result.success) {
      await loadSessions()
      return true
    }
    return false
  }, [loadSessions])

  const getForkPoints = useCallback(async (sessionPath: string): Promise<ForkPoint[]> => {
    try {
      return await api.getForkPoints(sessionPath)
    } catch {
      return []
    }
  }, [])

  const setSessionStatus = useCallback(async (sessionPath: string, status: 'active' | 'completed'): Promise<boolean> => {
    const result = await api.setSessionStatus(sessionPath, status)
    if (result.success) {
      await loadSessions()
      return true
    }
    return false
  }, [loadSessions])

  const clearSession = useCallback(async (): Promise<boolean> => {
    try {
      const result = await api.clearSession()
      if (result.success) {
        await loadSessions()
        await loadCurrentSession()
        return true
      }
      return false
    } catch {
      return false
    }
  }, [loadSessions, loadCurrentSession])

  useEffect(() => {
    loadSessions()
    if (isConnected) {
      loadCurrentSession()
    }
  }, [isConnected, loadSessions, loadCurrentSession])

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
    deleteSession,
    setSessionStatus,
    getForkPoints,
    refresh,
    getForkMessages,
    clearSession,
  }
}

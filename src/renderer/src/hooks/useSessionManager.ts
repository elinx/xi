import { useState, useCallback, useEffect } from 'react'
import type { SessionListResult, SessionInfo, ForkableMessage, ForkPoint, SessionIpcApi } from '../types/session'

type ExtendedApi = typeof window.api & SessionIpcApi & {
  workerEnsureReady: (sessionPath: string) => Promise<{ ok: boolean; status?: string; error?: string }>
  newSession: (sessionPath: string | null, name: string, parentSessionPath?: string) => Promise<{ success: boolean; error?: string }>
  forkAtEntry: (sessionPath: string | null, entryId: string, name?: string) => Promise<{ success: boolean; text?: string; error?: string }>
  renameSession: (sessionPath: string | null, name: string) => Promise<{ success: boolean; error?: string }>
  clearSession: (sessionPath: string | null) => Promise<{ success: boolean; error?: string }>
  getForkMessages: (sessionPath: string | null) => Promise<ForkableMessage[]>
}
const api = window.api as ExtendedApi

interface UseSessionManagerReturn {
  sessions: SessionListResult | null
  currentSession: SessionInfo | null
  forkMessages: ForkableMessage[]
  loadSessions: () => Promise<void>
  forkAtEntry: (sessionPath: string | null, entryId: string, name: string) => Promise<string | null>
  switchSession: (sessionPath: string) => Promise<{ success: boolean; error?: string }>
  newSession: (sessionPath: string | null, name: string, parentSessionPath?: string) => Promise<string | null>
  renameSession: (sessionPath: string | null, name: string) => Promise<void>
  deleteSession: (sessionPath: string) => Promise<boolean>
  setSessionStatus: (sessionPath: string, status: 'active' | 'completed') => Promise<boolean>
  reparentSession: (sessionPath: string, newParentPath: string | null) => Promise<boolean>
  getForkPoints: (sessionPath: string) => Promise<ForkPoint[]>
  refresh: () => Promise<void>
  getForkMessages: (sessionPath: string | null) => Promise<ForkableMessage[]>
  clearSession: (sessionPath: string | null) => Promise<string | null>
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

  const getForkMessages = useCallback(async (sessionPath: string | null): Promise<ForkableMessage[]> => {
    try {
      const msgs = await api.getForkMessages(sessionPath)
      setForkMessages(msgs)
      return msgs
    } catch {
      setForkMessages([])
      return []
    }
  }, [])

  const forkAtEntry = useCallback(async (sessionPath: string | null, entryId: string, name: string) => {
    const result = await api.forkAtEntry(sessionPath, entryId, name)
    if (result.success) {
      await loadSessions()
      await loadCurrentSession()
      return result.sessionPath ?? null
    }
    return null
  }, [loadSessions, loadCurrentSession])

  const switchSession = useCallback(async (sessionPath: string) => {
    await api.workerEnsureReady(sessionPath)
    await loadSessions()
    await loadCurrentSession()
    return { success: true }
  }, [loadSessions, loadCurrentSession])

  const newSession = useCallback(async (sessionPath: string | null, name: string, parentSessionPath?: string): Promise<string | null> => {
    const result = await api.newSession(sessionPath, name, parentSessionPath)
    if (result.success) {
      await loadSessions()
      await loadCurrentSession()
      return result.sessionPath ?? null
    }
    return null
  }, [loadSessions, loadCurrentSession])

  const renameSession = useCallback(async (sessionPath: string | null, name: string) => {
    const result = await api.renameSession(sessionPath, name)
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

  const reparentSession = useCallback(async (sessionPath: string, newParentPath: string | null): Promise<boolean> => {
    const result = await api.reparentSession(sessionPath, newParentPath)
    if (result.success) {
      await loadSessions()
      return true
    }
    return false
  }, [loadSessions])

  const clearSession = useCallback(async (sessionPath: string | null): Promise<string | null> => {
    try {
      const result = await api.clearSession(sessionPath)
      if (result.success) {
        await loadSessions()
        await loadCurrentSession()
        return result.sessionPath ?? null
      }
      return null
    } catch {
      return null
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
    reparentSession,
    getForkPoints,
    refresh,
    getForkMessages,
    clearSession,
  }
}

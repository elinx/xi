import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { usePiRpc, type UsePiRpcOptions } from './hooks/usePiRpc'
import { useSessionManager } from './hooks/useSessionManager'
import { useSessionCache, type WorkerStatus } from './hooks/useSessionCache'
import { useLayoutStore } from './hooks/useLayoutStore'
import { useTabStore, SESSION_TAB_ID, SETTINGS_TAB_ID, type TabType } from './hooks/useTabStore'
import { useFileIndex } from './hooks/useFileIndex'
import { useCommandRegistry } from './hooks/useCommandRegistry'
import ChatView from './components/ChatView'
import InputBar from './components/InputBar'
import LeftPanel from './components/LeftPanel'
import TabBar from './components/TabBar'
import RightPanel from './components/RightPanel'
import FileViewer from './components/FileViewer'
import DiffViewer from './components/DiffViewer'
import TerminalPane from './components/TerminalPane'
import { TokenUsageRing } from './components/TokenUsageRing'
import WelcomeDialog from './components/WelcomeDialog'
import SettingsPanel from './components/SettingsPanel'
import CommandPalette from './components/CommandPalette'
import type { ViewMode } from './utils/compact-view'
import type { ChatMessage, TextBlock } from './types/message'
import type { ForkPoint } from './types/session'
import type { TokenUsage } from './utils/convert-messages'
import type { QuotedMessage } from './components/QuoteCard'
import { getSessionDisplayName } from './utils/session-utils'

function App(): React.ReactElement {
  const sessionCache = useSessionCache()
  const {
    displaySession, getCache, ensureCacheSync, clearCache, getOrCreateCache,
    updateSessionMessages, updateSessionTokenUsage,
    setSessionStreaming, updateSessionForkPoints,
    setWorkerStatus, getWorkerStatus,
  } = sessionCache

  const getCacheRef = useRef(getCache)
  getCacheRef.current = getCache
  const getOrCreateCacheRef = useRef(getOrCreateCache)
  getOrCreateCacheRef.current = getOrCreateCache
  const displaySessionRef = useRef(displaySession)
  displaySessionRef.current = displaySession

  const userSwitchingRef = useRef(false)

  const displayedSessionPathRef = useRef(sessionCache.displayedSessionPath)
  displayedSessionPathRef.current = sessionCache.displayedSessionPath
  const isDisplayedStreamingRef = useRef(sessionCache.isDisplayedStreaming)
  isDisplayedStreamingRef.current = sessionCache.isDisplayedStreaming

  const piRpcOptions: UsePiRpcOptions = useMemo(() => ({
    onSessionMessagesUpdate: (sessionPath: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      updateSessionMessages(sessionPath, updater)
    },
    onSessionTokenUsageUpdate: (sessionPath: string, updater: (prev: TokenUsage) => TokenUsage) => {
      updateSessionTokenUsage(sessionPath, updater)
    },
    onSessionStreamingChange: (sessionPath: string, isStreaming: boolean, streamingMessageId: string | null) => {
      setSessionStreaming(sessionPath, isStreaming, streamingMessageId)
    },
    onSessionForkPointsUpdate: (sessionPath: string, forkPoints: ForkPoint[]) => {
      updateSessionForkPoints(sessionPath, forkPoints)
    },
    onSessionModelChange: (_sessionPath: string, _model: unknown) => {},
    onWorkerStatusChange: (sessionPath: string, status: string) => {
      setWorkerStatus(sessionPath, status as WorkerStatus)
    },
    onDisplaySession: (sessionPath: string) => {
      sessionCache.displaySession(sessionPath)
    },
    displayedSessionPath: sessionCache.displayedSessionPath,
    getCache,
    ensureCacheSync,
    updateCache: sessionCache.updateCache,
  }), [updateSessionMessages, updateSessionTokenUsage, setSessionStreaming, updateSessionForkPoints, setWorkerStatus, sessionCache.displayedSessionPath, getCache, ensureCacheSync, sessionCache.updateCache])

  const { isConnected, currentModel, thinkingLevel, sendPrompt, abort, pendingUiRequests, respondToUiRequest, clearMessages, loadHistory, loadForkPoints, setOnAgentEnd, getAvailableModels, setModel, cycleModel: cycleModelFn, getProviderAuthStatus, setApiKey, removeAuth, registerCustomProvider, testProvider, getProviderConfig, listCustomProviders, refreshModelInfo } = usePiRpc(piRpcOptions)
  const { sessions, currentSession, forkAtEntry, switchSession, newSession, renameSession, deleteSession, setSessionStatus, getForkMessages, clearSession, refresh } = useSessionManager(isConnected)

  const displayedMessages = sessionCache.displayedMessages
  const displayedTokenUsage = sessionCache.displayedTokenUsage
  const displayedForkPoints = sessionCache.displayedForkPoints
  const displayedStreaming = sessionCache.isDisplayedStreaming
  const displayedStreamingId = sessionCache.displayedStreamingMessageId
  const activeSessionPath = sessionCache.displayedSessionPath ?? currentSession?.filePath ?? null
  const displayedWorkerStatus = activeSessionPath ? getWorkerStatus(activeSessionPath) : 'none'

  const sentMessages = useMemo(() => {
    return displayedMessages
      .filter(msg => msg.role === 'user')
      .map(msg => {
        return msg.blocks
          .filter((b): b is import('./types/message').TextBlock => b.type === 'text' && !('subtype' in b && b.subtype))
          .map(b => b.content)
          .join('\n')
      })
      .filter(text => text.trim().length > 0)
      .reverse()
  }, [displayedMessages])

  const [error, setError] = useState<string | null>(null)
  const [showWelcome, setShowWelcome] = useState(false)
  const [recentProjects, setRecentProjects] = useState<Array<{ path: string; name: string; lastOpened: string }>>([])
  const [showRecentProjects, setShowRecentProjects] = useState(false)
  const recentProjectsRef = useRef<HTMLDivElement>(null)
  const welcomeCheckDone = useRef(false)

  const leftPanelView = useLayoutStore(s => s.leftPanelView)
  const leftPanelCollapsed = useLayoutStore(s => s.leftPanelCollapsed)
  const leftPanelWidth = useLayoutStore(s => s.leftPanelWidth)
  const setLeftPanelView = useLayoutStore(s => s.setLeftPanelView)
  const toggleLeftPanel = useLayoutStore(s => s.toggleLeftPanel)
  const setLeftPanelCollapsed = useLayoutStore(s => s.setLeftPanelCollapsed)
  const setLeftPanelWidth = useLayoutStore(s => s.setLeftPanelWidth)

  const rightPanelView = useLayoutStore(s => s.rightPanelView)
  const rightPanelCollapsed = useLayoutStore(s => s.rightPanelCollapsed)
  const rightPanelWidth = useLayoutStore(s => s.rightPanelWidth)
  const setRightPanelView = useLayoutStore(s => s.setRightPanelView)
  const toggleRightPanel = useLayoutStore(s => s.toggleRightPanel)
  const setRightPanelWidth = useLayoutStore(s => s.setRightPanelWidth)

  const tabs = useTabStore(s => s.tabs)
  const activeTabId = useTabStore(s => s.activeTabId)
  const setActiveTab = useTabStore(s => s.setActiveTab)
  const closeTab = useTabStore(s => s.closeTab)
  const updateTab = useTabStore(s => s.updateTab)
  const addTab = useTabStore(s => s.addTab)
  const resetTabs = useTabStore(s => s.resetTabs)
  const activeTab = tabs.find(t => t.id === activeTabId)
  const isSessionTabActive = activeTab?.type === 'session'

  const [isLeftResizing, setIsLeftResizing] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const leftResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const leftWidthRef = useRef(leftPanelWidth)
  leftWidthRef.current = leftPanelWidth

  useEffect(() => {
    if (!isLeftResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!leftResizeStartRef.current) return
      const delta = e.clientX - leftResizeStartRef.current.startX
      setLeftPanelWidth(leftResizeStartRef.current.startWidth + delta)
    }
    const handleMouseUp = () => {
      setIsLeftResizing(false)
      leftResizeStartRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isLeftResizing, setLeftPanelWidth])

  const { files: indexedFiles, loading: filesLoading, refresh: refreshFileIndex } = useFileIndex()
  const commands = useCommandRegistry()

  const handleLeftResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsLeftResizing(true)
    leftResizeStartRef.current = { startX: e.clientX, startWidth: leftPanelWidth }
  }, [leftPanelWidth])

  const [isRightResizing, setIsRightResizing] = useState(false)
  const rightResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const rightWidthRef = useRef(rightPanelWidth)
  rightWidthRef.current = rightPanelWidth

  useEffect(() => {
    if (!isRightResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!rightResizeStartRef.current) return
      const delta = rightResizeStartRef.current.startX - e.clientX
      setRightPanelWidth(rightResizeStartRef.current.startWidth + delta)
    }
    const handleMouseUp = () => {
      setIsRightResizing(false)
      rightResizeStartRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isRightResizing, setRightPanelWidth])

  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsRightResizing(true)
    rightResizeStartRef.current = { startX: e.clientX, startWidth: rightPanelWidth }
  }, [rightPanelWidth])

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('xi-settings-view-mode') as ViewMode) || 'normal'
  })
  const [quotes, setQuotes] = useState<QuotedMessage[]>([])
  const [pendingForwards, setPendingForwards] = useState<Map<string, QuotedMessage[]>>(new Map())
  const [commitMessageFromAI, setCommitMessageFromAI] = useState<string | undefined>(undefined)
  const pendingCommitGenerationRef = useRef(false)

  const currentForwards = activeSessionPath ? (pendingForwards.get(activeSessionPath) ?? []) : []
  const mergedQuotes = [...quotes, ...currentForwards]

  const handleRemoveQuote = useCallback((messageId: string) => {
    setQuotes(prev => prev.filter(q => q.messageId !== messageId))
    setPendingForwards(prev => {
      if (!activeSessionPath) return prev
      const existing = prev.get(activeSessionPath)
      if (!existing) return prev
      const filtered = existing.filter(q => q.messageId !== messageId)
      if (filtered.length === existing.length) return prev
      const next = new Map(prev)
      if (filtered.length === 0) {
        next.delete(activeSessionPath)
      } else {
        next.set(activeSessionPath, filtered)
      }
      return next
    })
  }, [activeSessionPath])

  const handleClearQuotes = useCallback(() => {
    setQuotes([])
    setPendingForwards(prev => {
      if (!activeSessionPath || !prev.has(activeSessionPath)) return prev
      const next = new Map(prev)
      next.delete(activeSessionPath)
      return next
    })
  }, [activeSessionPath])

  const activeSession = activeSessionPath
    ? sessions?.projects?.flatMap(p => p.allSessions).find(s => s.filePath === activeSessionPath)
    : currentSession

  const activeSessionName = activeSession ? getSessionDisplayName(activeSession) : null

  useEffect(() => {
    const sessionTab = tabs.find(t => t.id === SESSION_TAB_ID)
    if (sessionTab && activeSessionName && sessionTab.title !== activeSessionName) {
      updateTab(SESSION_TAB_ID, { title: activeSessionName, meta: { sessionPath: activeSessionPath } })
    }
  }, [activeSessionName, activeSessionPath, tabs, updateTab])

  async function handleConnect(): Promise<void> {
    setError(null)
    const result = await window.api.start()
    if (!result.ok && result.error) {
      setError(result.error)
    }
    refresh()
  }

  async function handleOpenDirectory(): Promise<void> {
    const result = await window.api.openDirectory()
    if (!result.ok) return
    sessionCache.clearAllCaches()
    resetTabs()
    await refresh()
    refreshFileIndex(true)
    const fsApi = window.api as typeof window.api & { watchStop?: () => Promise<{ ok: boolean }>; watchStart?: () => Promise<{ ok: boolean }> }
    try { await fsApi.watchStop?.() } catch {}
    try { await fsApi.watchStart?.() } catch {}
  }

  useEffect(() => {
    handleConnect()
  }, [])

  useEffect(() => {
    const api = window.api as typeof window.api & { getRecentProjects?: () => Promise<Array<{ path: string; name: string; lastOpened: string }>> }
    api.getRecentProjects?.().then(setRecentProjects).catch(() => {})
  }, [])

  useEffect(() => {
    if (!showRecentProjects) return
    const handleClick = (e: MouseEvent) => {
      if (recentProjectsRef.current && !recentProjectsRef.current.contains(e.target as Node)) {
        setShowRecentProjects(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showRecentProjects])

  const isPiStreaming = useCallback((): boolean => {
    const path = displayedSessionPathRef.current
    if (!path) return false
    return getCacheRef.current(path)?.isStreaming ?? false
  }, [])

  const handleSwitchSession = useCallback(async (sessionPath: string) => {
    setQuotes([])
    setActiveTab(SESSION_TAB_ID)
    userSwitchingRef.current = sessionPath
    await displaySessionRef.current(sessionPath)
    await switchSession(sessionPath)
    const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
    if (apiWithWorker.workerEnsureReady) {
      await apiWithWorker.workerEnsureReady(sessionPath)
    }
    window.api.saveLastSession(sessionPath)
    userSwitchingRef.current = null
  }, [switchSession, setActiveTab])

  const currentSessionRef = useRef(currentSession)
  currentSessionRef.current = currentSession

  const handleNewSession = useCallback(async (name: string, parentSessionPath: string) => {
    const currentPath = displayedSessionPathRef.current
    if (isPiStreaming()) {
      await abort(currentPath)
    }
    const newPath = await newSession(currentPath, name, parentSessionPath)
    if (newPath) {
      await refresh()
      await displaySessionRef.current(newPath)
      const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
      if (apiWithWorker.workerEnsureReady) {
        await apiWithWorker.workerEnsureReady(newPath)
      }
      window.api.saveLastSession(newPath)
    }
  }, [abort, newSession, refresh, isPiStreaming])

  const handleForkAtEntry = useCallback(async (entryId: string, name: string) => {
    const currentPath = displayedSessionPathRef.current
    if (isPiStreaming()) {
      await abort(currentPath)
    }
    const newPath = await forkAtEntry(currentPath, entryId, name)
    if (newPath) {
      await refresh()
      await displaySessionRef.current(newPath)
      const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
      if (apiWithWorker.workerEnsureReady) {
        await apiWithWorker.workerEnsureReady(newPath)
      }
      window.api.saveLastSession(newPath)
    }
  }, [abort, forkAtEntry, refresh, isPiStreaming])

  const handleForkFromEnd = useCallback(async (sessionPath: string, name: string) => {
    const currentPath = displayedSessionPathRef.current
    if (isPiStreaming()) {
      await abort(currentPath)
    }
    const msgs = await getForkMessages(currentPath)
    const lastEntry = msgs[msgs.length - 1]
    if (!lastEntry?.entryId) {
      const newPath = await newSession(currentPath, name, sessionPath)
      if (newPath) {
        await refresh()
        await displaySessionRef.current(newPath)
        const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
        if (apiWithWorker.workerEnsureReady) {
          await apiWithWorker.workerEnsureReady(newPath)
        }
        window.api.saveLastSession(newPath)
      }
      return
    }
    const newPath = await forkAtEntry(currentPath, lastEntry.entryId, name)
    if (newPath) {
      await refresh()
      await displaySessionRef.current(newPath)
      const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
      if (apiWithWorker.workerEnsureReady) {
        await apiWithWorker.workerEnsureReady(newPath)
      }
      window.api.saveLastSession(newPath)
    }
  }, [abort, getForkMessages, forkAtEntry, newSession, refresh, isPiStreaming])

  const handleClearSession = useCallback(async () => {
    const currentPath = displayedSessionPathRef.current
    if (isPiStreaming()) {
      await abort(currentPath)
    }
    const newPath = await clearSession(currentPath)
    if (newPath) {
      clearMessages(currentPath)
      await refresh()
      await displaySessionRef.current(newPath)
      window.api.saveLastSession(newPath)
    }
  }, [abort, clearMessages, clearSession, refresh, isPiStreaming])

  const handleQuoteMessage = useCallback((messageId: string, role: 'user' | 'assistant', content: string, timestamp: number) => {
    setQuotes(prev => {
      if (prev.some(q => q.messageId === messageId)) return prev
      return [...prev, { messageId, role, content, timestamp }]
    })
  }, [])

  const handleForwardMessage = useCallback((_messageId: string, role: 'user' | 'assistant', content: string, targetSessionPath: string) => {
    const sourceSession = sessions?.projects?.flatMap(p => p.allSessions).find(s => s.filePath === displayedSessionPathRef.current)
    const sourceSessionName = sourceSession ? getSessionDisplayName(sourceSession) : 'Unknown'
    const truncatedContent = content.length > 200 ? content.slice(0, 200) + '…' : content
    const forward: QuotedMessage = {
      messageId: `fwd-${_messageId}-${Date.now()}`,
      role,
      content: truncatedContent,
      timestamp: Date.now(),
      sourceSessionPath: targetSessionPath,
      sourceSessionName,
    }
    setPendingForwards(prev => {
      const next = new Map(prev)
      const existing = next.get(targetSessionPath) ?? []
      next.set(targetSessionPath, [...existing, forward])
      return next
    })
  }, [sessions])

  const handleSendPrompt = useCallback(async (text: string, images?: { data: string; mimeType: string }[], mentions?: Array<{ type: string; path: string; name: string }>, quotes?: QuotedMessage[]) => {
    if (isPiStreaming()) return

    let finalText = text
    if (quotes && quotes.length > 0) {
      const quotedText = quotes.map(q => {
        if (q.sourceSessionName) {
          return `> [Forwarded ${q.role} message from "${q.sourceSessionName}"]:\n> ${q.content.replace(/\n/g, '\n> ')}`
        }
        return `> [Quoted ${q.role} message]:\n> ${q.content.replace(/\n/g, '\n> ')}`
      }).join('\n\n')
      finalText = quotedText + '\n\n' + text
    }

    const sessionPath = displayedSessionPathRef.current
    const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
    if (sessionPath && apiWithWorker.workerEnsureReady) {
      await apiWithWorker.workerEnsureReady(sessionPath)
    }

    sendPrompt(sessionPath, finalText, images, mentions)
    setPendingForwards(prev => {
      const activePath = displayedSessionPathRef.current
      if (!activePath || !prev.has(activePath)) return prev
      const next = new Map(prev)
      next.delete(activePath)
      return next
    })
  }, [sendPrompt, isPiStreaming])

  const handleRequestCommitMessage = useCallback((diff: string) => {
    pendingCommitGenerationRef.current = true
    setCommitMessageFromAI(undefined)
    const prompt = `Generate a concise git commit message for the following staged diff. Only output the commit message, nothing else:\n\n${diff}`
    sendPrompt(null, prompt)
  }, [sendPrompt])

  const handleStop = useCallback(async () => {
    const sessionPath = displayedSessionPathRef.current
    if (sessionPath) {
      await abort(sessionPath)
    }
  }, [abort])

  useEffect(() => {
    if (isConnected) {
      const path = currentSessionRef.current?.filePath ?? null
      if (path && !displayedSessionPathRef.current) {
        displayedSessionPathRef.current = path
        getOrCreateCacheRef.current(path).then(() => {
          if (displayedSessionPathRef.current !== path) return
          displaySessionRef.current(path).then(() => {
            loadHistory(path)
            const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
            if (apiWithWorker.workerEnsureReady) {
              apiWithWorker.workerEnsureReady(path)
            }
          })
        })
      } else if (!path) {
        loadHistory(null)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, loadHistory])

  useEffect(() => {
    if (!isConnected || !currentSession?.filePath) return
    if (userSwitchingRef.current) return
    if (displayedSessionPathRef.current === currentSession.filePath) return
    if (displayedSessionPathRef.current !== null) return
    getOrCreateCacheRef.current(currentSession.filePath).then(() => {
      if (userSwitchingRef.current) return
      if (displayedSessionPathRef.current !== null && displayedSessionPathRef.current !== currentSession.filePath) return
      displaySessionRef.current(currentSession.filePath).then(() => {
        loadHistory(currentSession.filePath)
        const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
        if (apiWithWorker.workerEnsureReady) {
          apiWithWorker.workerEnsureReady(currentSession.filePath)
        }
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, currentSession?.filePath])

  const startupRestoredRef = useRef(false)
  useEffect(() => {
    if (startupRestoredRef.current) return
    if (!isConnected || !currentSession?.filePath) return
    startupRestoredRef.current = true
    const startupPref = localStorage.getItem('xi-settings-startup-session') || 'last'
    if (startupPref !== 'last') return
    window.api.getLastSession().then(async (lastPath) => {
      if (!lastPath || currentSession.filePath === lastPath) return
      userSwitchingRef.current = lastPath
      await displaySessionRef.current(lastPath)
      const apiWithWorker = window.api as typeof window.api & { workerEnsureReady?: (sp: string) => Promise<{ ok: boolean; status?: string; error?: string }> }
      if (apiWithWorker.workerEnsureReady) {
        await apiWithWorker.workerEnsureReady(lastPath)
      }
      userSwitchingRef.current = null
      await refresh()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, currentSession?.filePath])

  useEffect(() => {
    if (isConnected && currentSession?.filePath) {
      loadForkPoints(currentSession.filePath)
    }
  }, [isConnected, currentSession?.filePath, loadForkPoints])

  useEffect(() => {
    if (isConnected && !welcomeCheckDone.current) {
      welcomeCheckDone.current = true
      getProviderAuthStatus().then((status) => {
        const hasAnyAuth = Object.values(status).some(s => s.configured)
        if (!hasAnyAuth) {
          setShowWelcome(true)
        }
      })
    }
  }, [isConnected, getProviderAuthStatus])

  useEffect(() => {
    if (!displayedStreaming && pendingCommitGenerationRef.current) {
      pendingCommitGenerationRef.current = false
      const msgs = sessionCache.displayedMessages
      const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant')
      if (lastAssistant) {
        const text = lastAssistant.blocks
          .filter((b): b is TextBlock => b.type === 'text' && !b.subtype)
          .map(b => b.content)
          .join('\n')
          .trim()
        if (text) {
          setCommitMessageFromAI(text)
        }
      }
    }
  }, [displayedStreaming, sessionCache.displayedMessages])

  useEffect(() => {
    setOnAgentEnd(() => () => {
      refresh()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setOnAgentEnd, refresh])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (paletteOpen) return
      if (e.key === 'Escape') {
        if (isPiStreaming()) abort(displayedSessionPathRef.current)
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === '\\') {
        e.preventDefault()
        if (e.shiftKey) {
          toggleRightPanel()
        } else {
          toggleLeftPanel()
        }
      }
      if (mod && e.key === '`') {
        e.preventDefault()
        addTab({ type: 'terminal', title: 'Terminal', closable: true, meta: {} })
      }
      if (mod && e.key === 'p') {
        e.preventDefault()
        refreshFileIndex()
        setPaletteOpen(true)
      }
      if (mod && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setRightPanelView('search')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [abort, isPiStreaming, toggleLeftPanel, toggleRightPanel, addTab, paletteOpen, refreshFileIndex])

  useEffect(() => {
    const api = window.api as typeof window.api & { watchStart?: () => Promise<{ ok: boolean }>; watchStop?: () => Promise<{ ok: boolean }> }
    if (api.watchStart) {
      api.watchStart()
    }
    return () => {
      if (api.watchStop) api.watchStop()
    }
  }, [])

  useEffect(() => {
    const cleanup = window.api.onEvent((rawEvent) => {
      const evt = rawEvent as { type: string; error?: string; errorMessage?: string }
      if (evt.type === 'extension_error' && evt.error) {
        setError(`Extension error: ${evt.error}`)
      }
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (activeTab?.type === 'diff') {
      setRightPanelView('git')
    }
  }, [activeTab?.type, setRightPanelView])

  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  const projects = sessions?.projects ?? []
  const projectPath = projects[0]?.projectPath
  const projectName = projectPath?.split(/[/\\]/).pop() ?? 'Sessions'

  const handleFileSelect = useCallback((filePath: string, scrollToLine?: number) => {
    addTab({ type: 'file', title: filePath.split(/[/\\]/).pop() ?? filePath, closable: true, meta: { filePath, scrollToLine } })
  }, [addTab])

  const handleDiffSelect = useCallback((filePath: string, commitHash?: string) => {
    const name = filePath.split(/[/\\]/).pop() ?? filePath
    addTab({ type: 'diff', title: commitHash ? `${commitHash.slice(0, 7)}: ${name}` : `diff: ${name}`, closable: true, meta: { filePath, commitHash } })
    setRightPanelView('git')
  }, [addTab, setRightPanelView])

  const handleAddTab = useCallback((type: TabType) => {
    if (type === 'terminal') {
      addTab({ type: 'terminal', title: 'Terminal', closable: true, meta: {} })
    } else if (type === 'settings') {
      const existing = tabs.find(t => t.id === SETTINGS_TAB_ID)
      if (existing) {
        setActiveTab(SETTINGS_TAB_ID)
      } else {
        addTab({ id: SETTINGS_TAB_ID, type: 'settings', title: 'Settings', closable: true, meta: {} })
      }
    }
  }, [addTab, tabs, setActiveTab])

  const statusDotClass = displayedWorkerStatus === 'connected' && !displayedStreaming
    ? 'bg-green-500'
    : displayedStreaming
      ? 'bg-blue-500 animate-pulse'
      : displayedWorkerStatus === 'starting'
        ? 'bg-amber-500 animate-pulse'
        : 'bg-gray-400'

   return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-gray-900">
          <div className="flex border-b border-gray-200 bg-gray-50 h-16 flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
            {!leftPanelCollapsed && (
             <div
               className="flex items-center justify-between px-3 flex-shrink-0 border-r border-gray-200 h-full"
               style={{ width: leftPanelWidth, paddingTop: isMac ? '28px' : '0' }}
              >
                <div className="relative flex items-center gap-1 min-w-0" ref={recentProjectsRef}>
                  <button
                    onClick={() => setShowRecentProjects(prev => !prev)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors truncate"
                    title={projects[0]?.projectPath ?? undefined}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  >
                    {projectName}
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showRecentProjects && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-0.5 min-w-[220px] max-h-[300px] overflow-y-auto">
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Recent Projects</div>
                      {recentProjects.map((p) => (
                        <button
                          key={p.path}
                          onClick={async () => {
                            setShowRecentProjects(false)
                            if (p.path === (projects[0]?.projectPath)) return
                            const result = await window.api.openDirectory()
                            sessionCache.clearAllCaches()
                            resetTabs()
                            await refresh()
                            refreshFileIndex(true)
                          }}
                          className={`w-full px-3 py-1.5 text-xs text-left hover:bg-gray-100 transition-colors ${p.path === (projects[0]?.projectPath) ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
                          title={p.path}
                        >
                          <span className="font-medium">{p.name}</span>
                          <span className="text-gray-400 ml-1 text-[10px]">{p.path}</span>
                        </button>
                      ))}
                      {recentProjects.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400">No recent projects</div>
                      )}
                      <div className="border-t border-gray-100 mt-0.5">
                        <button
                          onClick={handleOpenDirectory}
                          className="w-full px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 text-left flex items-center gap-1.5 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                          </svg>
                          Open Project...
                        </button>
                        <button
                          onClick={async () => {
                            const api = window.api as typeof window.api & { clearRecentProjects?: () => Promise<void> }
                            await api.clearRecentProjects?.()
                            setRecentProjects([])
                            setShowRecentProjects(false)
                          }}
                          className="w-full px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 text-left transition-colors"
                        >
                          Clear Recent Items
                        </button>
                      </div>
                    </div>
                  )}
                </div>
             </div>
           )}
             <div className="flex items-center flex-1 px-4 min-w-0 gap-3 h-full" style={{ paddingTop: isMac ? '28px' : '0', paddingLeft: isMac && leftPanelCollapsed ? '76px' : undefined, WebkitAppRegion: 'drag' } as React.CSSProperties}>
             {activeSessionName && isSessionTabActive && (
               <>
                 <span
                   className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${statusDotClass}`}
                 />
                 <span className="text-xs text-gray-700 font-medium truncate">
                   {activeSessionName}
                 </span>
                 <button
                   onClick={handleClearSession}
                   className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 transition-colors"
                   title="Clear conversation"
                >
                   <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                     <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                   </svg>
                 </button>
               </>
             )}
              {error && (
                <span className="text-xs text-red-500" title={error}>Error</span>
              )}
              <div className="flex items-center gap-2 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
               <div className="flex items-center rounded-md border border-gray-200 bg-gray-100 p-0.5">
                  <button
                     onClick={() => {
                       const existing = tabs.find(t => t.id === SETTINGS_TAB_ID)
                       if (existing) {
                         setActiveTab(SETTINGS_TAB_ID)
                       } else {
                         addTab({ id: SETTINGS_TAB_ID, type: 'settings', title: 'Settings', closable: true, meta: {} })
                       }
                     }}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors text-gray-500 hover:text-gray-700`}
                    title="Settings"
                  >
                   <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                     <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                     <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                   </svg>
                 </button>
                 {!isConnected && (
                   <button
                     onClick={handleConnect}
                     className="rounded px-2 py-0.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
                     title="Connect to Xi"
                  >
                     Connect
                   </button>
                 )}
                </div>
                {isSessionTabActive && (
                  <div className="flex items-center rounded-md border border-gray-200 bg-gray-100 p-0.5">
                    <button
                      onClick={() => { localStorage.setItem('xi-view-mode', 'normal'); setViewMode('normal') }}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${viewMode === 'normal' ? 'bg-gray-200 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      title="Full view"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M3 8h18M3 12h18M3 16h18M3 20h18" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { localStorage.setItem('xi-view-mode', 'turn'); setViewMode('turn') }}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${viewMode === 'turn' ? 'bg-gray-200 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      title="Turn view"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 9h12M3 13h18M6 17h12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { localStorage.setItem('xi-view-mode', 'outline'); setViewMode('outline') }}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${viewMode === 'outline' ? 'bg-gray-200 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      title="Outline view"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
                      </svg>
                    </button>
                  </div>
                )}
                <div className="flex items-center rounded-md border border-gray-200 bg-gray-100 p-0.5">
                    <button
                      onClick={() => toggleLeftPanel()}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${leftPanelCollapsed ? 'text-gray-500 hover:text-gray-700' : 'bg-gray-200 text-gray-900 shadow-sm'}`}
                      title="Toggle left panel"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16" />
                      </svg>
                    </button>
                    <button
                      onClick={() => toggleRightPanel()}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${rightPanelCollapsed ? 'text-gray-500 hover:text-gray-700' : 'bg-gray-200 text-gray-900 shadow-sm'}`}
                      title="Toggle right panel"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M12 12h8m-16 6h16" />
                      </svg>
                    </button>
                  </div>
                </div>
               {isSessionTabActive && (
                 <div className="flex-shrink-0 ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                   <TokenUsageRing
                    usedTokens={displayedTokenUsage.totalTokens}
                    contextWindowSize={displayedTokenUsage.contextWindowSize}
                    inputTokens={displayedTokenUsage.inputTokens}
                    outputTokens={displayedTokenUsage.outputTokens}
                    cacheReadTokens={displayedTokenUsage.cacheReadTokens}
                    totalCost={displayedTokenUsage.totalCost}
                  />
                 </div>
               )}
           </div>
         </div>

          <div className="flex flex-1 overflow-hidden">
           <LeftPanel
             view={leftPanelView}
             onViewChange={setLeftPanelView}
             collapsed={leftPanelCollapsed}
             onToggleCollapse={() => toggleLeftPanel()}
             width={leftPanelWidth}
             onResizeStart={handleLeftResizeStart}
             projectName={projectName}
             projectPath={projects[0]?.projectPath ?? undefined}
             onOpenDirectory={handleOpenDirectory}
             sessions={sessions}
             currentSession={currentSession}
             displayedSessionPath={sessionCache.displayedSessionPath}
             workerStatuses={sessionCache.workerStatuses}
             onSwitchSession={handleSwitchSession}
             onNewSession={handleNewSession}
             onRenameSession={renameSession}
            onDeleteSession={deleteSession}
            onSetSessionStatus={setSessionStatus}
            onForkFromEnd={handleForkFromEnd}
          />

        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={setActiveTab}
            onTabClose={closeTab}
            onAddTab={handleAddTab}
          />

          <div className="flex-1 overflow-y-auto relative">
            <div className={activeTab?.type === 'session' ? 'h-full' : 'hidden'}>
              <ChatView
                messages={displayedMessages}
                isStreaming={displayedStreaming}
                streamingMessageId={displayedStreamingId}
                pendingUiRequests={pendingUiRequests}
                respondToUiRequest={(requestId, response) => respondToUiRequest(activeSessionPath, requestId, response)}
                onSendPrompt={handleSendPrompt}
                onForkAtEntry={handleForkAtEntry}
                getForkMessages={() => getForkMessages(activeSessionPath)}
                forkPoints={displayedForkPoints}
                viewMode={viewMode}
                onFileSelect={(p) => handleFileSelect(p)}
                onQuoteMessage={handleQuoteMessage}
                onForwardMessage={handleForwardMessage}
                currentSessionPath={activeSessionPath}
                sessions={sessions?.projects?.flatMap(p => p.allSessions).map(s => ({ filePath: s.filePath, name: s.name, isMain: s.isMain }))}
              />
            </div>
            {activeTab?.type === 'file' && (
              <FileViewer filePath={activeTab.meta.filePath as string} scrollToLine={activeTab.meta.scrollToLine as number | undefined} />
            )}
            {activeTab?.type === 'diff' && (
              <DiffViewer filePath={activeTab.meta.filePath as string} commitHash={activeTab.meta.commitHash as string | undefined} />
            )}
            {tabs.filter(t => t.type === 'terminal').map(t => (
              <div key={t.id} className={activeTab?.id === t.id ? 'h-full' : 'hidden'}>
                <TerminalPane ptyId={t.id} />
              </div>
            ))}
            {activeTab?.type === 'settings' && (
              <SettingsPanel
                onOpenConfigDir={() => window.api.openConfigDir()}
                getProviderAuthStatus={getProviderAuthStatus}
                setApiKey={setApiKey}
                removeAuth={removeAuth}
                registerCustomProvider={registerCustomProvider}
                testProvider={testProvider}
                getProviderConfig={getProviderConfig}
                listCustomProviders={listCustomProviders}
                getAvailableModels={() => getAvailableModels(activeSessionPath)}
                onSetModel={(modelId, provider) => setModel(activeSessionPath, modelId, provider)}
                onAuthChange={() => { getAvailableModels(null); refreshModelInfo() }}
                currentModel={currentModel}
              />
            )}
          </div>

          {isSessionTabActive && (
            <InputBar
              onSend={handleSendPrompt}
              disabled={!isConnected}
              isConnected={isConnected}
              isStreaming={displayedStreaming}
              onStop={handleStop}
              workerStatus={displayedWorkerStatus}
              currentModel={currentModel}
              onSetModel={(modelId, provider) => setModel(activeSessionPath, modelId, provider)}
              getAvailableModels={() => getAvailableModels(activeSessionPath)}
              files={indexedFiles}
              sentMessages={sentMessages}
              quotes={mergedQuotes}
              onRemoveQuote={handleRemoveQuote}
              onClearQuotes={handleClearQuotes}
            />
          )}
        </div>

        <RightPanel
          view={rightPanelView}
          onViewChange={setRightPanelView}
          collapsed={rightPanelCollapsed}
          onToggleCollapse={() => toggleRightPanel()}
          width={rightPanelWidth}
          onResizeStart={handleRightResizeStart}
          onFileSelect={handleFileSelect}
          onDiffSelect={handleDiffSelect}
          onRequestCommitMessage={handleRequestCommitMessage}
          commitMessageFromAI={commitMessageFromAI}
          projectPath={projectPath}
        />
      </div>

       {showWelcome && (
           <WelcomeDialog
             getProviderAuthStatus={getProviderAuthStatus}
             setApiKey={setApiKey}
             removeAuth={removeAuth}
              registerCustomProvider={registerCustomProvider}
               testProvider={testProvider}
               getProviderConfig={getProviderConfig}
               listCustomProviders={listCustomProviders}
               getAvailableModels={() => getAvailableModels(null)}
               onSetModel={(modelId, provider) => setModel(null, modelId, provider)}
               onAuthChange={() => {
                getAvailableModels(null)
                refreshModelInfo()
              }}
              currentModel={currentModel}
              onSkip={() => setShowWelcome(false)}
           />
       )}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        files={indexedFiles}
        filesLoading={filesLoading}
        sessions={(sessions?.projects?.flatMap(p => p.allSessions) ?? []).map(s => ({
          name: s.name || '',
          filePath: s.filePath,
          isCurrent: s.filePath === currentSession?.filePath,
        }))}
        commands={commands}
        onFileSelect={(filePath) => addTab({ type: 'file', title: filePath.split(/[/\\]/).pop() ?? filePath, closable: true, meta: { filePath } })}
        onSessionSelect={(sessionPath) => handleSwitchSession(sessionPath)}
      />
    </div>
  )
}

export default App

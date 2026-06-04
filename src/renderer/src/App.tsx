import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { usePiRpc, type UsePiRpcOptions } from './hooks/usePiRpc'
import { useSessionManager } from './hooks/useSessionManager'
import { useSessionCache } from './hooks/useSessionCache'
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
import type { ChatMessage } from './types/message'
import type { ForkPoint } from './types/session'
import type { TokenUsage } from './utils/convert-messages'

function getDisplayName(session: { name: string | null; createdAt: string }): string {
  if (session.name) return session.name
  const d = new Date(session.createdAt)
  const month = d.toLocaleString('en', { month: 'short' })
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${month} ${day} ${hh}:${mm}`
}

function App(): React.ReactElement {
  const [piConnectedPath, setPiConnectedPathState] = useState<string | null>(null)
  const piConnectedPathRef = useRef<string | null>(null)

  const setPiConnectedPath = useCallback((path: string | null) => {
    piConnectedPathRef.current = path
    setPiConnectedPathState(path)
  }, [])

  const [isAgentEnding, setIsAgentEnding] = useState(false)
  const sessionCache = useSessionCache()
  const {
    displaySession, getCache, clearCache, getOrCreateCache,
    updatePiConnectedMessages, updatePiConnectedTokenUsage,
    setPiConnectedStreaming, updatePiConnectedForkPoints,
  } = sessionCache

  const getCacheRef = useRef(getCache)
  getCacheRef.current = getCache
  const getOrCreateCacheRef = useRef(getOrCreateCache)
  getOrCreateCacheRef.current = getOrCreateCache
  const displaySessionRef = useRef(displaySession)
  displaySessionRef.current = displaySession

  const displayedSessionPathRef = useRef(sessionCache.displayedSessionPath)
  displayedSessionPathRef.current = sessionCache.displayedSessionPath
  const isDisplayedStreamingRef = useRef(sessionCache.isDisplayedStreaming)
  isDisplayedStreamingRef.current = sessionCache.isDisplayedStreaming

  const piRpcOptions: UsePiRpcOptions = useMemo(() => ({
    onMessagesUpdate: (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      const path = piConnectedPathRef.current
      if (path) updatePiConnectedMessages(path, updater)
    },
    onTokenUsageUpdate: (updater: (prev: TokenUsage) => TokenUsage) => {
      const path = piConnectedPathRef.current
      if (path) updatePiConnectedTokenUsage(path, updater)
    },
    onStreamingChange: (isStreaming: boolean, streamingMessageId: string | null) => {
      const path = piConnectedPathRef.current
      if (path) setPiConnectedStreaming(path, isStreaming, streamingMessageId)
    },
    onForkPointsUpdate: (forkPoints: ForkPoint[]) => {
      const path = piConnectedPathRef.current
      if (path) updatePiConnectedForkPoints(path, forkPoints)
    },
    piConnectedSessionPath: piConnectedPath,
  }), [updatePiConnectedMessages, updatePiConnectedTokenUsage, setPiConnectedStreaming, updatePiConnectedForkPoints, piConnectedPath])

  const { isConnected, currentModel, thinkingLevel, sendPrompt, abort, pendingUiRequests, respondToUiRequest, clearMessages, loadHistory, loadForkPoints, setOnAgentEnd, getAvailableModels, setModel, cycleModel: cycleModelFn, getProviderAuthStatus, setApiKey, removeAuth, registerCustomProvider, testProvider, getProviderConfig } = usePiRpc(piRpcOptions)
  const { sessions, currentSession, forkAtEntry, switchSession, newSession, renameSession, deleteSession, setSessionStatus, getForkMessages, clearSession, refresh } = useSessionManager(isConnected)

  const isLazySwitched = sessionCache.displayedSessionPath !== null && sessionCache.displayedSessionPath !== piConnectedPath
  const displayedMessages = sessionCache.displayedMessages
  const displayedTokenUsage = sessionCache.displayedTokenUsage
  const displayedForkPoints = sessionCache.displayedForkPoints
  const displayedStreaming = sessionCache.isDisplayedStreaming
  const displayedStreamingId = sessionCache.displayedStreamingMessageId

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
      .reverse()  // newest first
  }, [displayedMessages])

  const [error, setError] = useState<string | null>(null)
  const [showWelcome, setShowWelcome] = useState(false)
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
    const saved = localStorage.getItem('xi-view-mode') as ViewMode
    return saved === 'normal' || saved === 'turn' || saved === 'outline' ? saved : 'normal'
  })

  const activeSessionPath = isLazySwitched ? sessionCache.displayedSessionPath : (currentSession?.filePath ?? null)
  const activeSession = activeSessionPath
    ? sessions?.projects?.flatMap(p => p.allSessions).find(s => s.filePath === activeSessionPath)
    : currentSession

  const activeSessionName = activeSession ? getDisplayName(activeSession) : null

  const backgroundSessionName = (() => {
    if (!isLazySwitched || !piConnectedPath) return null
    const bgSession = sessions?.projects?.flatMap(p => p.allSessions).find(s => s.filePath === piConnectedPath)
    return bgSession ? getDisplayName(bgSession) : null
  })()

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
    clearMessages()
    await refresh()
  }

  useEffect(() => {
    handleConnect()
  }, [])

  const isPiStreaming = useCallback((): boolean => {
    const path = piConnectedPathRef.current
    if (!path) return false
    return getCacheRef.current(path)?.isStreaming ?? false
  }, [])

  const handleSwitchSession = useCallback(async (sessionPath: string) => {
    const piStreaming = isPiStreaming() || isDisplayedStreamingRef.current
    if (piStreaming && piConnectedPathRef.current !== sessionPath) {
      await displaySessionRef.current(sessionPath)
      return
    }

    if (piConnectedPathRef.current === sessionPath) {
      if (displayedSessionPathRef.current !== sessionPath) {
        await displaySessionRef.current(sessionPath)
      }
      return
    }

    const result = await switchSession(sessionPath)
    if (result.success) {
      setPiConnectedPath(sessionPath)
      await displaySessionRef.current(sessionPath)
      clearMessages()
      await loadHistory()
      await loadForkPoints(sessionPath)
      await refresh()
      window.api.saveLastSession(sessionPath)
    } else {
      await displaySessionRef.current(sessionPath)
    }
  }, [switchSession, clearMessages, loadHistory, loadForkPoints, refresh, isPiStreaming, setPiConnectedPath])

  const currentSessionRef = useRef(currentSession)
  currentSessionRef.current = currentSession

  const handleNewSession = useCallback(async (name: string, parentSessionPath: string) => {
    if (isPiStreaming()) {
      await abort()
    }
    clearMessages()
    const result = await newSession(name, parentSessionPath)
    if (result) {
      await refresh()
      setPiConnectedPath(currentSessionRef.current?.filePath ?? null)
      const path = currentSessionRef.current?.filePath
      if (path) window.api.saveLastSession(path)
    }
  }, [abort, clearMessages, newSession, refresh, isPiStreaming, setPiConnectedPath])

  const handleForkAtEntry = useCallback(async (entryId: string, name: string) => {
    if (isPiStreaming()) {
      await abort()
    }
    clearMessages()
    await forkAtEntry(entryId, name)
    await loadHistory()
    await refresh()
    setPiConnectedPath(currentSessionRef.current?.filePath ?? null)
    const path = currentSessionRef.current?.filePath
    if (path) window.api.saveLastSession(path)
  }, [abort, clearMessages, forkAtEntry, loadHistory, refresh, isPiStreaming, setPiConnectedPath])

  const handleForkFromEnd = useCallback(async (sessionPath: string, name: string) => {
    if (isPiStreaming()) {
      await abort()
    }
    const msgs = await getForkMessages()
    const lastEntry = msgs[msgs.length - 1]
    if (!lastEntry?.entryId) return
    clearMessages()
    await forkAtEntry(lastEntry.entryId, name)
    await loadHistory()
    await refresh()
    setPiConnectedPath(currentSessionRef.current?.filePath ?? null)
    const path = currentSessionRef.current?.filePath
    if (path) window.api.saveLastSession(path)
  }, [abort, getForkMessages, clearMessages, forkAtEntry, loadHistory, refresh, isPiStreaming, setPiConnectedPath])

  const handleClearSession = useCallback(async () => {
    if (isPiStreaming()) {
      await abort()
    }
    clearMessages()
    const ok = await clearSession()
    if (ok) {
      clearMessages()
      await loadHistory()
      await refresh()
      setPiConnectedPath(currentSessionRef.current?.filePath ?? null)
      const path = currentSessionRef.current?.filePath
      if (path) window.api.saveLastSession(path)
    }
  }, [abort, clearMessages, clearSession, loadHistory, refresh, isPiStreaming, setPiConnectedPath])

  const isLazySwitchedRef = useRef(isLazySwitched)
  isLazySwitchedRef.current = isLazySwitched

  const handleSendPrompt = useCallback(async (text: string, images?: { data: string; mimeType: string }[], mentions?: Array<{ type: string; path: string; name: string }>) => {
    if (!isLazySwitchedRef.current && isPiStreaming()) return

    const doSend = () => {
      sendPrompt(text, images, mentions)
    }

    if (isLazySwitchedRef.current) {
      const targetPath = displayedSessionPathRef.current
      if (!targetPath) return
      if (isPiStreaming()) await abort()
      const result = await switchSession(targetPath)
      if (result.success) {
        setPiConnectedPath(targetPath)
        clearMessages()
        await loadHistory()
        await loadForkPoints(targetPath)
        await refresh()
        doSend()
      }
    } else {
      doSend()
    }
  }, [abort, switchSession, clearMessages, loadHistory, loadForkPoints, refresh, sendPrompt, isPiStreaming, setPiConnectedPath])

  const handleStop = useCallback(async () => {
    if (isLazySwitchedRef.current) {
      await abort()
      const targetPath = displayedSessionPathRef.current
      if (targetPath) {
        const result = await switchSession(targetPath)
        if (result.success) {
          setPiConnectedPath(targetPath)
          clearMessages()
          await loadHistory()
          await loadForkPoints(targetPath)
          await refresh()
        }
      }
    } else {
      await abort()
    }
  }, [abort, switchSession, clearMessages, loadHistory, loadForkPoints, refresh, setPiConnectedPath])

  useEffect(() => {
    if (isConnected) {
      const path = currentSessionRef.current?.filePath ?? null
      setPiConnectedPath(path)
      if (path) {
        getOrCreateCacheRef.current(path).then(() => {
          displaySessionRef.current(path).then(() => {
            loadHistory()
          })
        })
      } else {
        loadHistory()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, loadHistory])

  useEffect(() => {
    if (!isConnected || !currentSession?.filePath) return
    if (piConnectedPathRef.current === currentSession.filePath) return
    setPiConnectedPath(currentSession.filePath)
    getOrCreateCacheRef.current(currentSession.filePath).then(() => {
      displaySessionRef.current(currentSession.filePath).then(() => {
        loadHistory()
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
      const result = await switchSession(lastPath)
      if (result.success) {
        setPiConnectedPath(lastPath)
        clearMessages()
        await loadHistory()
        await loadForkPoints(lastPath)
        await refresh()
      }
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
    setOnAgentEnd(() => () => {
      refresh()
      setIsAgentEnding(true)
      const displayed = displayedSessionPathRef.current
      const currentPiConnected = piConnectedPathRef.current
      if (displayed && displayed !== currentPiConnected) {
        switchSession(displayed).then((result) => {
          if (result.success) {
            setPiConnectedPath(displayed)
            clearMessages()
            loadHistory().then(() => {
              loadForkPoints(displayed)
            })
          }
          setIsAgentEnding(false)
        })
      } else {
        setIsAgentEnding(false)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setOnAgentEnd, refresh, switchSession, clearMessages, loadHistory, loadForkPoints, setPiConnectedPath])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (paletteOpen) return
      if (e.key === 'Escape') {
        if (isPiStreaming()) abort()
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
  const projectName = projects[0]?.projectPath.split(/[/\\]/).pop() ?? 'Sessions'

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

   return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-gray-900">
          <div className="flex border-b border-gray-200 bg-gray-50 h-16 flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
            {!leftPanelCollapsed && (
             <div
               className="flex items-center justify-between px-3 flex-shrink-0 border-r border-gray-200 h-full"
               style={{ width: leftPanelWidth, paddingTop: isMac ? '28px' : '0' }}
             >
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 truncate" title={projects[0]?.projectPath ?? undefined}>{projectName}</span>
              <button
                onClick={handleOpenDirectory}
                className="rounded p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                title="Open project directory"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                </svg>
              </button>
            </div>
          )}
             <div className="flex items-center flex-1 px-4 min-w-0 gap-3 h-full" style={{ paddingTop: isMac ? '28px' : '0', paddingLeft: isMac && leftPanelCollapsed ? '76px' : undefined, WebkitAppRegion: 'drag' } as React.CSSProperties}>
             {activeSessionName && isSessionTabActive && (
               <>
                 <span
                   className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
                     isLazySwitched
                       ? isAgentEnding
                         ? 'bg-blue-500 animate-pulse'
                         : 'bg-amber-500'
                       : displayedStreaming
                         ? 'bg-blue-500 animate-pulse'
                         : 'bg-green-500'
                   }`}
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
                     title="Connect to Pi"
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
                respondToUiRequest={respondToUiRequest}
                onSendPrompt={handleSendPrompt}
                onForkAtEntry={handleForkAtEntry}
                getForkMessages={getForkMessages}
                forkPoints={displayedForkPoints}
                viewMode={viewMode}
                onFileSelect={(p) => handleFileSelect(p)}
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
                onAuthChange={() => { getAvailableModels() }}
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
              isLazySwitched={isLazySwitched}
              backgroundSessionName={backgroundSessionName}
              isBackgroundStreaming={isLazySwitched && isPiStreaming()}
              isAgentEnding={isAgentEnding}
              currentModel={currentModel}
              onSetModel={setModel}
              getAvailableModels={getAvailableModels}
              files={indexedFiles}
              sentMessages={sentMessages}
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
             onAuthChange={() => {
              getAvailableModels()
            }}
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
        onSessionSelect={(sessionPath) => switchSession(sessionPath)}
      />
    </div>
  )
}

export default App

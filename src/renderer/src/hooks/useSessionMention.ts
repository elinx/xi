import { useState, useCallback, useRef } from 'react'
import type { SessionInfo } from '../types/session'
import type { SessionMentionData } from './useFileMention'

interface SessionMentionState {
  open: boolean
  query: string
  triggerStart: number
  filteredSessions: SessionInfo[]
  selectedIndex: number
}

const MAX_RESULTS = 15

function filterSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  const named = sessions.filter(s => s.name)
  if (!query) return named.slice(0, MAX_RESULTS)
  const q = query.toLowerCase()
  return named
    .filter(s =>
      s.name!.toLowerCase().includes(q)
    )
    .slice(0, MAX_RESULTS)
}

export function useSessionMention(sessions: SessionInfo[]) {
  const [state, setState] = useState<SessionMentionState>({
    open: false,
    query: '',
    triggerStart: -1,
    filteredSessions: [],
    selectedIndex: 0,
  })
  const [sessionMentions, setSessionMentions] = useState<SessionMentionData[]>([])
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const stateRef = useRef(state)
  stateRef.current = state

  const close = useCallback(() => {
    setState({ open: false, query: '', triggerStart: -1, filteredSessions: [], selectedIndex: 0 })
  }, [])

  const onTextInput = useCallback((value: string, cursorPos: number) => {
    const textBeforeCursor = value.substring(0, cursorPos)
    const dollarPos = textBeforeCursor.lastIndexOf('$')
    if (dollarPos === -1) { close(); return }

    if (dollarPos > 0 && /\w/.test(value[dollarPos - 1])) { close(); return }

    const query = textBeforeCursor.substring(dollarPos + 1)
    if (query.includes(' ')) { close(); return }

    const filtered = filterSessions(sessionsRef.current, query)
    setState({
      open: true,
      query,
      triggerStart: dollarPos,
      filteredSessions: filtered,
      selectedIndex: 0,
    })
  }, [close])

  const onKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    const s = stateRef.current
    if (!s.open) return false

    switch (e.key) {
      case 'ArrowUp': {
        e.preventDefault()
        setState(prev => ({ ...prev, selectedIndex: Math.max(0, prev.selectedIndex - 1) }))
        return true
      }
      case 'ArrowDown': {
        e.preventDefault()
        setState(prev => ({ ...prev, selectedIndex: Math.min(prev.filteredSessions.length - 1, prev.selectedIndex + 1) }))
        return true
      }
      case 'Enter':
      case 'Tab': {
        if (s.filteredSessions.length > 0) {
          e.preventDefault()
          const session = s.filteredSessions[s.selectedIndex]
          setSessionMentions(m => [...m, { type: 'session', sessionId: session.sessionId, name: session.name!, filePath: session.filePath }])
        }
        setState({ open: false, query: '', triggerStart: -1, filteredSessions: [], selectedIndex: 0 })
        return true
      }
      case 'Escape': {
        e.preventDefault()
        setState({ open: false, query: '', triggerStart: -1, filteredSessions: [], selectedIndex: 0 })
        return true
      }
    }
    return false
  }, [])

  const selectItem = useCallback((session: SessionInfo) => {
    setSessionMentions(m => [...m, { type: 'session', sessionId: session.sessionId, name: session.name!, filePath: session.filePath }])
    setState({ open: false, query: '', triggerStart: -1, filteredSessions: [], selectedIndex: 0 })
  }, [])

  const clearMentions = useCallback(() => setSessionMentions([]), [])

  return {
    ...state,
    onTextInput,
    onKeyDown,
    selectItem,
    close,
    sessionMentions,
    clearMentions,
  }
}

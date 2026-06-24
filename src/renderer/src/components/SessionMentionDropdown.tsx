import { useRef, useEffect } from 'react'
import type { SessionInfo } from '../types/session'

interface SessionMentionDropdownProps {
  sessions: SessionInfo[]
  selectedIndex: number
  onSelect: (session: SessionInfo) => void
  visible: boolean
}

export default function SessionMentionDropdown({ sessions, selectedIndex, onSelect, visible }: SessionMentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!listRef.current || !visible) return
    const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, visible])

  if (!visible || sessions.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 mb-1 w-full max-h-[240px] overflow-y-auto xi-glass rounded-lg z-50 py-1">
      {sessions.map((session, i) => (
        <button
          key={session.filePath}
          ref={i === selectedIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors duration-150 ${
            i === selectedIndex
              ? 'bg-purple-50 text-purple-900'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
          onClick={() => onSelect(session)}
          onMouseEnter={() => {}}
        >
          <svg className="w-3.5 h-3.5 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="truncate font-medium">{session.name}</span>
          {session.messageCount > 0 && (
            <span className="text-[10px] text-gray-400 shrink-0">{session.messageCount} msgs</span>
          )}
        </button>
      ))}
    </div>
  )
}

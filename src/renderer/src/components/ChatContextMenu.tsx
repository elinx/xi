import { useEffect, useRef, useCallback } from 'react'
import type { ContentBlock, TextBlock } from '../types/message'

interface ChatContextMenuProps {
  x: number
  y: number
  messageBlocks: ContentBlock[]
  messageRole: 'user' | 'assistant'
  isStreaming: boolean
  onQuote: () => void
  onForward: () => void
  onFork: () => void
  onClose: () => void
}

function ChatContextMenu({
  x,
  y,
  messageBlocks,
  isStreaming,
  onQuote,
  onForward,
  onFork,
  onClose,
}: ChatContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null)

  const handleCopy = useCallback(() => {
    const textParts: string[] = []
    for (const block of messageBlocks) {
      if (block.type === 'text' && !block.subtype) {
        textParts.push((block as TextBlock).content)
      }
    }
    navigator.clipboard.writeText(textParts.join('\n\n'))
    onClose()
  }, [messageBlocks, onClose])

  // Viewport boundary adjustment
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const adjustedX = Math.min(x, window.innerWidth - rect.width - 8)
    const adjustedY = Math.min(y, window.innerHeight - rect.height - 8)
    if (adjustedX !== x || adjustedY !== y) {
      menuRef.current.style.left = `${Math.max(8, adjustedX)}px`
      menuRef.current.style.top = `${Math.max(8, adjustedY)}px`
    }
  }, [x, y])

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const disabled = isStreaming

  return (
    <div
      ref={menuRef}
      className="fixed bg-white border border-gray-200 rounded-md shadow-lg py-0.5 min-w-[180px]"
      style={{ left: x, top: y, zIndex: 9999 }}
    >
      <button
        onClick={handleCopy}
        disabled={disabled}
        className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
        Copy Text
      </button>
      <div className="border-t border-gray-100 my-0.5" />
      <button
        onClick={() => { onQuote(); onClose() }}
        disabled={disabled}
        className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
        Quote
      </button>
      <button
        onClick={() => { onForward(); onClose() }}
        disabled={disabled}
        className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
        Forward...
      </button>
      <div className="border-t border-gray-100 my-0.5" />
      <button
        onClick={() => { onFork(); onClose() }}
        disabled={disabled}
        className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 text-left transition-colors flex items-center gap-2 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75v-.878a2.25 2.25 0 111.5 0v.878a2.25 2.25 0 01-2.25 2.25h-1.5v2.128a2.251 2.251 0 11-1.5 0V8.5h-1.5A2.25 2.25 0 013.5 6.25v-.878a2.25 2.25 0 111.5 0zM5 3.25a.75.75 0 10-1.5 0 .75.75 0 001.5 0zm6.75.75a.75.75 0 100-1.5.75.75 0 000 1.5zm-3 8.75a.75.75 0 10-1.5 0 .75.75 0 001.5 0z" />
        </svg>
        Fork from Here
      </button>
    </div>
  )
}

export default ChatContextMenu

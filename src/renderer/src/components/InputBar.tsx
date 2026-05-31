import { useState, useRef, useCallback } from 'react'

interface InputBarProps {
  onSend: (text: string, images?: { data: string; mimeType: string }[]) => void
  disabled: boolean
  isStreaming?: boolean
  onStop?: () => void
}

function InputBar({ onSend, disabled, isStreaming, onStop }: InputBarProps): React.ReactElement {
  const [text, setText] = useState('')
  const [pastedImages, setPastedImages] = useState<{ data: string; mimeType: string }[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback((): void => {
    const trimmed = text.trim()
    if (!trimmed && pastedImages.length === 0) return
    if (disabled) return
    onSend(trimmed, pastedImages.length > 0 ? pastedImages : undefined)
    setText('')
    setPastedImages([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, pastedImages, disabled, onSend])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 96) + 'px'
  }

  function handlePaste(e: React.ClipboardEvent): void {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const match = result.match(/^data:(image\/\w+);base64,(.+)$/)
          if (match) {
            setPastedImages((prev) => [...prev, { mimeType: match[1], data: match[2] }])
          }
        }
        reader.readAsDataURL(blob)
      }
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      {isStreaming && (
        <div className="mb-2 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            Pi is thinking… press <kbd className="rounded border border-gray-200 bg-gray-100 px-1 py-px font-mono text-[10px] leading-none text-gray-500">Esc</kbd> to interrupt
          </span>
        </div>
      )}
      {pastedImages.length > 0 && (
        <div className="mb-2 flex gap-2">
          {pastedImages.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt="pasted"
                className="h-16 rounded border border-gray-200"
              />
              <button
                onClick={() => setPastedImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? 'Pi not connected...' : 'Type a message... (paste images with Ctrl+V)'}
          className="flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={disabled || (!text.trim() && pastedImages.length === 0)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}

export default InputBar

import { useState, useRef, useCallback } from 'react'
import type { PiModelInfo } from '../types/session'
import type { FileEntry } from '../hooks/useFileIndex'
import { useFileMention, type MentionItem } from '../hooks/useFileMention'
import ModelSelector from './ModelSelector'
import FileMentionDropdown from './FileMentionDropdown'

interface InputBarProps {
  onSend: (text: string, images?: { data: string; mimeType: string }[], mentions?: MentionItem[]) => void
  disabled: boolean
  isConnected: boolean
  isStreaming?: boolean
  onStop?: () => void
  isLazySwitched?: boolean
  backgroundSessionName?: string | null
  isBackgroundStreaming?: boolean
  isAgentEnding?: boolean
  currentModel?: PiModelInfo | null
  onSetModel?: (modelId: string, provider?: string) => Promise<boolean>
  getAvailableModels?: () => Promise<PiModelInfo[]>
  files: FileEntry[]
}

function InputBar({ onSend, disabled, isConnected, isStreaming, onStop, isLazySwitched, backgroundSessionName, isBackgroundStreaming, isAgentEnding, currentModel, onSetModel, getAvailableModels, files }: InputBarProps): React.ReactElement {
  const [text, setText] = useState('')
  const [pastedImages, setPastedImages] = useState<{ data: string; mimeType: string }[]>([])
  const [showModelSelector, setShowModelSelector] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const mention = useFileMention(files)

  const showStop = isStreaming || isBackgroundStreaming
  const noModel = isConnected && !currentModel

  const handleSubmit = useCallback((): void => {
    const trimmed = text.trim()
    if (!trimmed && pastedImages.length === 0) return
    if (disabled) return
    onSend(trimmed, pastedImages.length > 0 ? pastedImages : undefined, mention.mentions.length > 0 ? mention.mentions : undefined)
    setText('')
    setPastedImages([])
    mention.clearMentions()
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, pastedImages, disabled, onSend, mention])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mention.onKeyDown(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const value = e.target.value
    setText(value)
    mention.onTextInput(value, e.target.selectionStart ?? value.length)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 96) + 'px'
  }

  const handleMentionSelect = useCallback((file: FileEntry) => {
    const before = text.substring(0, mention.triggerStart)
    const after = text.substring(mention.triggerStart + 1 + mention.query.length)
    const mentionText = `@${file.name} `
    setText(before + mentionText + after)
    mention.selectItem(file)
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = before.length + mentionText.length
        textareaRef.current.setSelectionRange(newPos, newPos)
        textareaRef.current.focus()
      }
    }, 0)
  }, [text, mention])

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

  let statusDot: React.ReactNode
  let statusText: React.ReactNode

  if (isAgentEnding) {
    statusDot = <svg className="h-1.5 w-1.5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
    statusText = <span className="text-blue-600">Switching back…</span>
  } else if (isBackgroundStreaming && backgroundSessionName) {
    statusDot = (
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
      </span>
    )
    statusText = (
      <span className="text-amber-600">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium">{backgroundSessionName}</span> is running… press <kbd className="rounded border border-amber-200 bg-amber-100 px-1 py-px font-mono text-[10px] leading-none text-amber-600">Esc</kbd> to interrupt
      </span>
    )
  } else if (isStreaming) {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
    statusText = <>Pi is thinking… press <kbd className="rounded border border-gray-200 bg-gray-100 px-1 py-px font-mono text-[10px] leading-none text-gray-500">Esc</kbd> to interrupt</>
  } else if (noModel) {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
    statusText = (
      <span className="text-amber-600">
        Pi Connected · <button onClick={() => setShowModelSelector(true)} className="underline decoration-amber-300 underline-offset-2 hover:decoration-amber-500 transition-colors">No model configured</button>
      </span>
    )
  } else if (isConnected && currentModel) {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
    statusText = (
      <span className="text-gray-500">
        Pi Connected · <button onClick={() => setShowModelSelector(true)} className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700 hover:bg-gray-200 transition-colors">{currentModel.name}</button>
      </span>
    )
  } else {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
    statusText = 'Pi Disconnected'
  }

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3 relative">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
        {statusDot}
        {statusText}
      </div>
      {noModel && (
        <div className="mb-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700">
          No model configured — <button onClick={() => setShowModelSelector(true)} className="underline font-medium hover:text-amber-900 transition-colors">select a model</button> to start chatting
        </div>
      )}
      {showModelSelector && onSetModel && getAvailableModels && (
        <ModelSelector
          currentModel={currentModel ?? null}
          onSetModel={onSetModel}
          getAvailableModels={getAvailableModels}
          onClose={() => setShowModelSelector(false)}
        />
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
      <div className="flex items-end gap-2 relative">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled || noModel}
            rows={1}
            placeholder={noModel ? 'Select a model to start chatting...' : disabled ? 'Pi not connected...' : 'Type a message... (@ to mention files)'}
            className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:opacity-50"
          />
          <FileMentionDropdown
            files={mention.filteredFiles}
            selectedIndex={mention.selectedIndex}
            onSelect={handleMentionSelect}
            visible={mention.open}
          />
        </div>
        {showStop ? (
          <button
            onClick={onStop}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 active:scale-95"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={disabled || noModel || (!text.trim() && pastedImages.length === 0)}
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

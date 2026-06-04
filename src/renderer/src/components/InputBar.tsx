import { useState, useRef, useCallback, useEffect } from 'react'
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
  const [pastedImages, setPastedImages] = useState<{ data: string; mimeType: string }[]>([])
  const [showModelSelector, setShowModelSelector] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  const mention = useFileMention(files)

  const showStop = isStreaming || isBackgroundStreaming
  const noModel = isConnected && !currentModel

  const getPlainText = useCallback((): string => {
    if (!editorRef.current) return ''
    let text = ''
    for (const node of editorRef.current.childNodes) {
      if (node instanceof HTMLElement && node.dataset.mentionPath) {
        text += '@' + node.dataset.mentionPath
      } else {
        text += node.textContent ?? ''
      }
    }
    return text
  }, [])

  const isEmpty = useCallback((): boolean => {
    if (!editorRef.current) return true
    return !editorRef.current.textContent?.trim()
  }, [])

  const handleSubmit = useCallback((): void => {
    const text = getPlainText().trim()
    if (!text && pastedImages.length === 0) return
    if (disabled) return
    onSend(text, pastedImages.length > 0 ? pastedImages : undefined, mention.mentions.length > 0 ? mention.mentions : undefined)
    if (editorRef.current) {
      editorRef.current.innerHTML = ''
    }
    setPastedImages([])
    mention.clearMentions()
  }, [getPlainText, pastedImages, disabled, onSend, mention])

  useEffect(() => {
    if (!editorRef.current) return
    const el = editorRef.current
    const observer = new MutationObserver(() => {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 96) + 'px'
    })
    observer.observe(el, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (mention.open) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        mention.onKeyDown(e)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const file = mention.filteredFiles[mention.selectedIndex]
        if (file) handleMentionSelect(file)
        else mention.close()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        mention.close()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const suppressMentionRef = useRef(false)

  function handleEditorInput(): void {
    if (suppressMentionRef.current) return
    if (!editorRef.current) return
    const sel = window.getSelection()
    const cursorPos = sel?.focusOffset ?? 0
    const textBeforeCursor = getPlainTextUpToCursor()
    mention.onTextInput(getPlainText(), cursorPos)
  }

  function getPlainTextUpToCursor(): string {
    const sel = window.getSelection()
    if (!sel || !sel.focusNode || !editorRef.current) return ''
    let text = ''
    let reachedFocus = false
    for (const node of editorRef.current.childNodes) {
      if (node === sel.focusNode || (sel.focusNode && node.contains(sel.focusNode))) {
        if (node instanceof HTMLElement && node.dataset.mentionPath) {
          text += '@' + node.dataset.mentionPath
        } else {
          const nodeText = node.textContent ?? ''
          text += nodeText.substring(0, sel.focusOffset)
        }
        reachedFocus = true
        break
      }
      if (node instanceof HTMLElement && node.dataset.mentionPath) {
        text += '@' + node.dataset.mentionPath
      } else {
        text += node.textContent ?? ''
      }
    }
    return text
  }

  const handleMentionSelect = useCallback((file: FileEntry) => {
    if (!editorRef.current) return
    const sel = window.getSelection()
    if (!sel || !sel.focusNode) return

    suppressMentionRef.current = true

    const textNode = sel.focusNode.nodeType === Node.TEXT_NODE ? sel.focusNode as Text : null
    const textContent = textNode?.textContent ?? ''
    const cursorOffset = sel.focusOffset

    const textBeforeCursor = textContent.substring(0, cursorOffset)
    const atPos = textBeforeCursor.lastIndexOf('@')
    if (atPos === -1) return

    const before = textContent.substring(0, atPos)
    const after = textContent.substring(cursorOffset)

    const pill = document.createElement('span')
    pill.contentEditable = 'false'
    pill.dataset.mentionPath = file.relativePath
    pill.className = 'inline-flex items-center gap-0.5 px-1.5 py-px mx-0.5 rounded-md bg-blue-100 text-blue-700 text-[13px] leading-5 align-baseline select-none cursor-default'
    pill.innerHTML = `<svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>${file.relativePath}`

    if (textNode && textNode.parentNode) {
      const parent = textNode.parentNode
      const afterNode = after.length > 0 ? document.createTextNode(after + '\u00A0') : document.createTextNode('\u00A0')

      if (before.length > 0) {
        parent.insertBefore(document.createTextNode(before), textNode)
      }
      parent.insertBefore(pill, textNode)
      parent.insertBefore(afterNode, textNode)
      parent.removeChild(textNode)

      const range = document.createRange()
      range.setStart(afterNode, after.length > 0 ? after.length + 1 : 1)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }

    mention.selectItem(file)
    setTimeout(() => { suppressMentionRef.current = false }, 100)
  }, [mention])

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>): void {
    const items = e.clipboardData.items
    let hasImage = false
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        hasImage = true
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
    if (!hasImage) {
      e.preventDefault()
      const text = e.clipboardData.getData('text/plain')
      document.execCommand('insertText', false, text)
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
          <div
            ref={editorRef}
            contentEditable
            onKeyDown={handleKeyDown}
            onInput={handleEditorInput}
            onPaste={handlePaste}
            data-placeholder={noModel ? 'Select a model to start chatting...' : disabled ? 'Pi not connected...' : 'Type a message... (@ to mention files)'}
            className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:opacity-50 min-h-[36px] max-h-[96px] overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 empty:before:pointer-events-none"
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
            disabled={disabled || noModel || (isEmpty() && pastedImages.length === 0)}
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

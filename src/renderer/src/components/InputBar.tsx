import { useState, useRef, useCallback, useEffect } from 'react'
import type { PiModelInfo, SessionInfo } from '../types/session'
import type { FileEntry } from '../hooks/useFileIndex'
import { useFileMention, type MentionItem } from '../hooks/useFileMention'
import { useSessionMention } from '../hooks/useSessionMention'
import { useSkillMention } from '../hooks/useSkillMention'
import type { SkillInfo } from '../hooks/useSkillStore'
import type { WorkerStatus } from '../hooks/useSessionCache'
import { getInputDraft, setInputDraft, clearInputDraft } from '../hooks/useInputDraft'
import ModelSelector from './ModelSelector'
import FileMentionDropdown from './FileMentionDropdown'
import SessionMentionDropdown from './SessionMentionDropdown'
import SkillMentionDropdown from './SkillMentionDropdown'
import QuoteCard, { type QuotedMessage } from './QuoteCard'
import { TokenUsageRing } from './TokenUsageRing'
import { getSummaryPrompt } from '../../../shared/summary-prompt'

interface InputBarProps {
  onSend: (text: string, images?: { data: string; mimeType: string }[], mentions?: MentionItem[], quotes?: QuotedMessage[], isSummaryCommand?: boolean) => void
  disabled: boolean
  isConnected: boolean
  sessionPath?: string | null
  isStreaming?: boolean
  onStop?: () => void
  workerStatus?: WorkerStatus
  currentModel?: PiModelInfo | null
  onSetModel?: (modelId: string, provider?: string) => Promise<{ success: boolean; error?: string }>
  getAvailableModels?: () => Promise<PiModelInfo[]>
  files: FileEntry[]
  sessions: SessionInfo[]
  sentMessages: string[]
  quotes: QuotedMessage[]
  onRemoveQuote: (messageId: string) => void
  onClearQuotes: () => void
  tokenUsage?: { totalTokens: number; contextWindowSize: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; totalCost: number }
  queueCount?: number
  queueMessages?: { text: string }[]
  onClearQueue?: () => void
  onRemoveQueuedAt?: (index: number) => void
  onSendQueued?: (index: number) => void
  skills?: SkillInfo[]
}

function InputBar({ onSend, disabled, isConnected, sessionPath, isStreaming, onStop, workerStatus = 'none', currentModel, onSetModel, getAvailableModels, files, sessions, sentMessages, quotes, onRemoveQuote, onClearQuotes, tokenUsage, queueCount = 0, queueMessages = [], onClearQueue, onRemoveQueuedAt, onSendQueued, skills = [] }: InputBarProps): React.ReactElement {
  const [pastedImages, setPastedImages] = useState<{ data: string; mimeType: string }[]>([])
  const [showModelSelector, setShowModelSelector] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftRef = useRef('')
  const draftMentionsRef = useRef<MentionItem[]>([])
  const suppressMentionRef = useRef(false)

  const mention = useFileMention(files)
  const sessionMention = useSessionMention(sessions)
  const skillMention = useSkillMention(skills)

  // Listen for skill invocation events from SkillsPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const { name } = (e as CustomEvent).detail as { name: string }
      const command = `/skill:${name} `
      setEditorText(command)
      setTimeout(() => {
        if (editorRef.current) {
          const range = document.createRange()
          range.selectNodeContents(editorRef.current)
          range.collapse(false)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
          editorRef.current.focus()
        }
      }, 0)
    }
    window.addEventListener('xi:invoke-skill', handler)
    return () => window.removeEventListener('xi:invoke-skill', handler)
  }, [])

  // --- Draft persistence: save on unmount / restore on mount ---
  const sessionPathRef = useRef(sessionPath)
  sessionPathRef.current = sessionPath

  // Restore draft when mounting or switching sessions
  useEffect(() => {
    if (!sessionPath || !editorRef.current) return
    const draft = getInputDraft(sessionPath)
    if (!draft) return
    // Only restore if the editor is currently empty
    if (editorRef.current.textContent?.trim()) return
    suppressMentionRef.current = true
    editorRef.current.innerHTML = draft.innerHTML
    // Move cursor to end
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(editorRef.current)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    // Restore mention state
    if (draft.mentions.length > 0) {
      mention.setMentions(draft.mentions)
    }
    // Restore pasted images
    if (draft.pastedImages.length > 0) {
      setPastedImages(draft.pastedImages)
    }
    mention.close()
    setTimeout(() => { suppressMentionRef.current = false }, 100)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPath])

  // Save draft on unmount
  useEffect(() => {
    return () => {
      const sp = sessionPathRef.current
      if (!sp || !editorRef.current) return
      const hasContent = editorRef.current.textContent?.trim()
      const hasImages = pastedImagesRef.current.length > 0
      if (hasContent || hasImages) {
        setInputDraft(sp, {
          innerHTML: editorRef.current.innerHTML,
          mentions: [...mentionRef.current.mentions, ...sessionMentionRef.current.sessionMentions],
          pastedImages: pastedImagesRef.current,
        })
      } else {
        clearInputDraft(sp)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save draft on every input change (debounced)
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveDraft = useCallback(() => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = setTimeout(() => {
      const sp = sessionPathRef.current
      if (!sp || !editorRef.current) return
      const hasContent = editorRef.current.textContent?.trim()
      const hasImages = pastedImagesRef.current.length > 0
      if (hasContent || hasImages) {
        setInputDraft(sp, {
          innerHTML: editorRef.current.innerHTML,
          mentions: [...mentionRef.current.mentions, ...sessionMentionRef.current.sessionMentions],
          pastedImages: pastedImagesRef.current,
        })
      } else {
        clearInputDraft(sp)
      }
    }, 500)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ref for pastedImages to avoid stale closure in debounced saveDraft
  const pastedImagesRef = useRef(pastedImages)
  pastedImagesRef.current = pastedImages

  // Refs for mention state to avoid stale closure in debounced saveDraft
  const mentionRef = useRef(mention)
  mentionRef.current = mention
  const sessionMentionRef = useRef(sessionMention)
  sessionMentionRef.current = sessionMention

  // Save draft when pastedImages changes (since setPastedImages is async)
  useEffect(() => {
    if (!sessionPath) return
    // Skip the initial mount restore
    if (!editorRef.current) return
    saveDraft()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastedImages])

  const showStop = isStreaming
  const noModel = isConnected && (!currentModel || (currentModel.id === 'unknown' && currentModel.provider === 'unknown'))

  const getPlainText = useCallback((): string => {
    if (!editorRef.current) return ''
    let text = ''
    for (const node of editorRef.current.childNodes) {
      if (node instanceof HTMLElement && node.dataset.mentionPath) {
        text += '@' + node.dataset.mentionPath
      } else if (node instanceof HTMLElement && node.dataset.sessionId) {
        text += '$' + (node.dataset.sessionName ?? '')
      } else if (node instanceof HTMLBRElement) {
        text += '\n'
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

  const setEditorText = useCallback((text: string): void => {
    if (!editorRef.current) return
    // Suppress mention detection during programmatic text replacement
    suppressMentionRef.current = true
    editorRef.current.innerHTML = ''
    if (text) {
      // Convert newlines to <br> elements for proper rendering in contentEditable
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) editorRef.current.appendChild(document.createElement('br'))
        editorRef.current.appendChild(document.createTextNode(lines[i]))
      }
    }
    // Move cursor to end
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(editorRef.current)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    // Close any open mention dropdown
    mention.close()
    setTimeout(() => { suppressMentionRef.current = false }, 100)
  }, [mention])

  const restoreDraft = useCallback((): void => {
    if (!editorRef.current) return
    suppressMentionRef.current = true
    editorRef.current.innerHTML = draftRef.current
    // Move cursor to end
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(editorRef.current)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    // Restore mention state to match the restored DOM
    mention.setMentions(draftMentionsRef.current)
    mention.close()
    setTimeout(() => { suppressMentionRef.current = false }, 100)
  }, [mention])

  const navigateHistory = useCallback((direction: 'up' | 'down'): void => {
    if (sentMessages.length === 0) return

    // First ↑: save draft as innerHTML + mentions to preserve mention pills
    if (historyIndex === -1 && direction === 'up') {
      draftRef.current = editorRef.current?.innerHTML ?? ''
      draftMentionsRef.current = [...mention.mentions]
    }

    let newIndex: number
    if (direction === 'up') {
      newIndex = historyIndex === -1 ? 0 : Math.min(historyIndex + 1, sentMessages.length - 1)
    } else {
      if (historyIndex === -1) return
      newIndex = historyIndex - 1
    }

    setHistoryIndex(newIndex)
    if (newIndex === -1) {
      // Restoring draft — use innerHTML to preserve mention pills
      restoreDraft()
    } else {
      // History message — plain text, clear any mention state from draft
      mention.clearMentions()
      setEditorText(sentMessages[newIndex])
    }
  }, [historyIndex, sentMessages, setEditorText, restoreDraft])

  const resetHistory = useCallback((): void => {
    setHistoryIndex(-1)
    draftRef.current = ''
    draftMentionsRef.current = []
  }, [])

  // Reset history navigation when sent messages change (e.g., user sends a new message).
  // NOTE: We intentionally do NOT modify the editor content here. The editor is already
  // cleared by handleSubmit when sending, and session-switch draft restoration is handled
  // by the [sessionPath] effect above. Previously this effect also restored/cleared the
  // editor, which caused input loss during streaming because `sentMessages` gets a new
  // reference on every displayedMessages update (even when only assistant content changes).
  useEffect(() => {
    setHistoryIndex(-1)
    draftRef.current = ''
    draftMentionsRef.current = []
  }, [sentMessages])

  const handleSubmit = useCallback((): void => {
    const text = getPlainText().trim()
    if (!text && pastedImages.length === 0) return
    if (disabled) return
    const allMentions = [...mention.mentions, ...sessionMention.sessionMentions]
   
    let finalText = text
    let isSummaryCommand = false
    if (text === '/summary') {
      finalText = getSummaryPrompt()
      isSummaryCommand = true
    }
    
    onSend(finalText, pastedImages.length > 0 ? pastedImages : undefined, allMentions.length > 0 ? allMentions : undefined, quotes.length > 0 ? quotes : undefined, isSummaryCommand)
    if (quotes.length > 0) onClearQuotes()
    if (editorRef.current) {
      editorRef.current.innerHTML = ''
    }
    setPastedImages([])
    mention.clearMentions()
    sessionMention.clearMentions()
    setHistoryIndex(-1)
    draftRef.current = ''
    draftMentionsRef.current = []
    // Clear persisted draft after sending
    if (sessionPathRef.current) {
      clearInputDraft(sessionPathRef.current)
    }
  }, [getPlainText, pastedImages, disabled, onSend, mention, sessionMention])

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
    if (sessionMention.open) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        sessionMention.onKeyDown(e)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const session = sessionMention.filteredSessions[sessionMention.selectedIndex]
        if (session) handleSessionMentionSelect(session)
        else sessionMention.close()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        sessionMention.close()
        return
      }
    }
    // Skill mention (/skill:)
    if (skillMention.visible) {
      const skillResult = skillMention.onKeyDown(e)
      if (skillResult) {
        if (typeof skillResult === 'string') {
          // Replace /skill:query with /skill:name
          const text = getPlainText()
          const newText = text.replace(/\/skill:[a-z0-9-]*$/, `/skill:${skillResult} `)
          setEditorText(newText)
          // Move cursor to end
          setTimeout(() => {
            if (editorRef.current) {
              const range = document.createRange()
              range.selectNodeContents(editorRef.current)
              range.collapse(false)
              const sel = window.getSelection()
              sel?.removeAllRanges()
              sel?.addRange(range)
            }
          }, 0)
        }
        return
      }
    }
    // History navigation
    if (sentMessages.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        navigateHistory('up')
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        navigateHistory('down')
        return
      }
      // Escape while browsing history: restore draft and reset
      if (e.key === 'Escape' && historyIndex !== -1) {
        e.preventDefault()
        restoreDraft()
        setHistoryIndex(-1)
        draftRef.current = ''
        draftMentionsRef.current = []
        return
      }
    }
    // Reset history pointer on any other key (except modifiers and Enter)
    // Enter is handled by handleSubmit which does its own reset
    if (historyIndex !== -1 && !['Shift', 'Meta', 'Control', 'Alt', 'Enter'].includes(e.key)) {
      resetHistory()
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleEditorInput(): void {
    if (suppressMentionRef.current) return
    if (!editorRef.current) return
    const sel = window.getSelection()
    if (!sel || !sel.focusNode) return

    // Only detect @ mentions in the text node where the cursor is,
    // never from pill nodes (data-mention-path)
    let cursorText = ''
    let cursorOffset = 0
    if (sel.focusNode.nodeType === Node.TEXT_NODE) {
      cursorText = sel.focusNode.textContent ?? ''
      cursorOffset = sel.focusOffset
      // Walk previous siblings to build the full line text before cursor
      let node = sel.focusNode.previousSibling
      while (node) {
        if (node instanceof HTMLElement && node.dataset.mentionPath) {
          cursorText = '\u00A0' + cursorText
          cursorOffset += 1
        } else {
          const t = node.textContent ?? ''
          cursorText = t + cursorText
          cursorOffset += t.length
        }
        node = node.previousSibling
      }
    }
    mention.onTextInput(cursorText, cursorOffset)
    sessionMention.onTextInput(cursorText, cursorOffset)

    // Skill mention detection (/skill:)
    const fullText = getPlainText()
    // Calculate cursor position in full text
    // For simplicity, use the full text length for cursor position approximation
    skillMention.handleTextChange(fullText, fullText.length)

    // Save draft (debounced)
    saveDraft()
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
    saveDraft()
    setTimeout(() => { suppressMentionRef.current = false }, 100)
  }, [mention, saveDraft])

  const handleSessionMentionSelect = useCallback((session: SessionInfo) => {
    if (!editorRef.current) return
    const sel = window.getSelection()
    if (!sel || !sel.focusNode) return

    suppressMentionRef.current = true

    const textNode = sel.focusNode.nodeType === Node.TEXT_NODE ? sel.focusNode as Text : null
    const textContent = textNode?.textContent ?? ''
    const cursorOffset = sel.focusOffset

    const textBeforeCursor = textContent.substring(0, cursorOffset)
    const dollarPos = textBeforeCursor.lastIndexOf('$')
    if (dollarPos === -1) return

    const before = textContent.substring(0, dollarPos)
    const after = textContent.substring(cursorOffset)

    const pill = document.createElement('span')
    pill.contentEditable = 'false'
    pill.dataset.sessionId = session.sessionId
    pill.dataset.sessionName = session.name ?? ''
    pill.className = 'inline-flex items-center gap-0.5 px-1.5 py-px mx-0.5 rounded-md bg-purple-100 text-purple-700 text-[13px] leading-5 align-baseline select-none cursor-default'
    pill.innerHTML = `<svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>${session.name}`

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

    sessionMention.selectItem(session)
    saveDraft()
    setTimeout(() => { suppressMentionRef.current = false }, 100)
  }, [sessionMention, saveDraft])

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

  if (isStreaming) {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
  } else if (workerStatus === 'starting') {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
  } else if (noModel) {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
  } else if (isConnected && currentModel) {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
  } else {
    statusDot = <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
  }

  return (
    <div className="relative">
      <QuoteCard
        quotes={quotes}
        onRemove={onRemoveQuote}
        onClear={onClearQuotes}
        queue={queueMessages}
        onSendQueue={onSendQueued}
        onRemoveQueue={onRemoveQueuedAt}
        onClearQueue={onClearQueue}
      />
      <div className="px-4 pb-3 pt-1">
        <div className="mx-auto max-w-2xl xl:max-w-4xl 2xl:max-w-5xl">
          {noModel && (
            <div className="mb-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700">
              No model configured — <button onClick={() => setShowModelSelector(true)} className="underline font-medium hover:text-amber-900 transition-colors duration-150">select a model</button> to start chatting
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
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            {pastedImages.length > 0 && (
              <div className="flex gap-2 px-3 pt-3">
                {pastedImages.map((img, i) => (
                  <div key={i} className="relative">
                    <img
                      src={`data:${img.mimeType};base64,${img.data}`}
                      alt="pasted"
                      className="h-14 rounded-lg border border-gray-200"
                    />
                    <button
                      onClick={() => setPastedImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] text-white opacity-0 transition-opacity hover:bg-gray-700 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative">
              <div
                ref={editorRef}
                contentEditable
                onKeyDown={handleKeyDown}
                onInput={handleEditorInput}
                onPaste={handlePaste}
                data-placeholder={noModel ? 'Select a model to start chatting...' : disabled ? 'Xi not connected...' : workerStatus === 'starting' ? 'Connecting...' : workerStatus === 'none' || workerStatus === 'error' ? 'Worker not ready...' : 'Message Xi…'}
                className="w-full resize-none px-3.5 pt-3 pb-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none min-h-[36px] max-h-[96px] overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 empty:before:pointer-events-none"
              />
              <FileMentionDropdown
                files={mention.filteredFiles}
                selectedIndex={mention.selectedIndex}
                onSelect={handleMentionSelect}
                visible={mention.open}
              />
              <SessionMentionDropdown
                sessions={sessionMention.filteredSessions}
                selectedIndex={sessionMention.selectedIndex}
                onSelect={handleSessionMentionSelect}
                visible={sessionMention.open}
              />
              <SkillMentionDropdown
                items={skillMention.items}
                selectedIndex={skillMention.selectedIndex}
                onSelect={(item) => {
                  const text = getPlainText()
                  const newText = text.replace(/\/skill:[a-z0-9-]*$/, `/skill:${item.name} `)
                  setEditorText(newText)
                  skillMention.close()
                  setTimeout(() => {
                    if (editorRef.current) {
                      const range = document.createRange()
                      range.selectNodeContents(editorRef.current)
                      range.collapse(false)
                      const sel = window.getSelection()
                      sel?.removeAllRanges()
                      sel?.addRange(range)
                    }
                  }, 0)
                }}
                visible={skillMention.visible}
              />
            </div>
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                {statusDot}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                <span><kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500">@</kbd> files</span>
                <span><kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500">$</kbd> sessions</span>
                <span><kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500">/</kbd> skills</span>
                <span className="text-gray-300">·</span>
                <span><kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500">⇧↵</kbd> newline</span>
              </div>
              <div className="flex-1" />
              {tokenUsage && isConnected && (
                <TokenUsageRing size={15} showPercent={false} tooltipPosition="top"
                  usedTokens={tokenUsage.totalTokens}
                  contextWindowSize={tokenUsage.contextWindowSize}
                  inputTokens={tokenUsage.inputTokens}
                  outputTokens={tokenUsage.outputTokens}
                  cacheReadTokens={tokenUsage.cacheReadTokens}
                  totalCost={tokenUsage.totalCost}
                />
              )}
              <button
                onClick={() => setShowModelSelector(true)}
                className="text-[11.5px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 transition-colors duration-150"
                title="Select model"
              >
                {currentModel && currentModel.name && currentModel.name !== 'unknown' ? currentModel.name : currentModel?.id ?? 'No model'}
              </button>
              {showStop ? (
                <button
                  onClick={onStop}
                  className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-red-600 active:scale-95"
                >
                  <span className="h-2.5 w-2.5 rounded-sm bg-white" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={disabled || noModel || (isEmpty() && pastedImages.length === 0)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-white transition-all duration-150 hover:bg-black disabled:bg-gray-300 disabled:cursor-not-allowed active:scale-90"
                  title="Send (Enter)"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default InputBar

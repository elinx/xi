import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { QuestionOption } from '../types/message'

interface QuestionDialogProps {
  question: string
  options: QuestionOption[]
  multiSelect?: boolean
  onAnswer: (answer: string | string[] | null, wasCustom: boolean) => void
}

export default function QuestionDialog({
  question,
  options,
  multiSelect = false,
  onAnswer,
}: QuestionDialogProps): React.ReactElement {
  const [isDark, setIsDark] = useState(() => !document.documentElement.classList.contains('light'))
  const [mode, setMode] = useState<'options' | 'text'>('options')
  const [customText, setCustomText] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState<number>(-1)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(!document.documentElement.classList.contains('light'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    firstOptionRef.current?.focus()
  }, [])

  useEffect(() => {
    if (mode === 'text') {
      textAreaRef.current?.focus()
    }
  }, [mode])

  const c = isDark ? {
    overlayBg: '#1e2026',
    titleColor: '#e5e7eb',
    labelColor: '#9ca3af',
    borderColor: 'rgba(255,255,255,0.08)',
    inputBg: '#16181d',
    inputBorder: 'rgba(255,255,255,0.15)',
    inputText: '#e5e7eb',
    btnCancelBg: '#252830',
    btnCancelText: '#9ca3af',
    btnPrimaryBg: '#2563eb',
    btnPrimaryText: '#ffffff',
    selectedBg: 'rgba(54, 211, 153, 0.12)',
    descColor: '#6b7280',
    checkColor: '#36d399',
  } : {
    overlayBg: '#ffffff',
    titleColor: '#111827',
    labelColor: '#6b7280',
    borderColor: '#e5e7eb',
    inputBg: '#f9fafb',
    inputBorder: '#d1d5db',
    inputText: '#111827',
    btnCancelBg: '#f3f4f6',
    btnCancelText: '#4b5563',
    btnPrimaryBg: '#2563eb',
    btnPrimaryText: '#ffffff',
    selectedBg: 'rgba(59, 130, 246, 0.08)',
    descColor: '#9ca3af',
    checkColor: '#2563eb',
  }

  const handleCancel = useCallback(() => {
    onAnswer(null, false)
  }, [onAnswer])

  const handleSelectSingle = useCallback((label: string) => {
    onAnswer(label, false)
  }, [onAnswer])

  const handleToggleMulti = useCallback((idx: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }, [])

  const handleConfirmMulti = useCallback(() => {
    const selected = options
      .map((opt, idx) => ({ opt, idx }))
      .filter(({ idx }) => selectedIndices.has(idx))
      .map(({ opt }) => opt.label)
    if (selected.length > 0) {
      onAnswer(selected, false)
    }
  }, [options, selectedIndices, onAnswer])

  const handleSwitchToText = useCallback(() => {
    setMode('text')
    setHoveredIndex(-1)
  }, [])

  const handleBackToOptions = useCallback(() => {
    setMode('options')
    setCustomText('')
  }, [])

  const handleSubmitCustom = useCallback(() => {
    const trimmed = customText.trim()
    if (trimmed) {
      onAnswer(trimmed, true)
    }
  }, [customText, onAnswer])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mode === 'options') {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmitCustom()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleBackToOptions()
      }
    }
  }, [mode, handleCancel, handleSubmitCustom, handleBackToOptions])

  const selectedCount = selectedIndices.size

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg p-4 shadow-2xl"
        style={{ backgroundColor: c.overlayBg }}
        onKeyDown={handleKeyDown}
      >
        <h2 className="mb-3 flex items-start gap-1.5 text-sm font-semibold" style={{ color: c.titleColor }}>
          <span className="shrink-0">❓</span>
          <span>{question}</span>
        </h2>

        {mode === 'options' ? (
          <>
            <div className="mb-3 space-y-1.5">
              {options.map((opt, idx) => {
                const isSelected = multiSelect && selectedIndices.has(idx)
                return (
                  <button
                    key={idx}
                    ref={idx === 0 ? firstOptionRef : undefined}
                    onClick={() => multiSelect ? handleToggleMulti(idx) : handleSelectSingle(opt.label)}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(-1)}
                    className="w-full rounded-md border px-3 py-2 text-left transition-colors"
                    style={{
                      borderColor: isSelected || hoveredIndex === idx ? c.inputBorder : c.borderColor,
                      backgroundColor: isSelected ? c.selectedBg : hoveredIndex === idx ? c.selectedBg : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {multiSelect && (
                        <span className="shrink-0 w-4 h-4 rounded border flex items-center justify-center" style={{ borderColor: isSelected ? c.checkColor : c.inputBorder, backgroundColor: isSelected ? c.checkColor : 'transparent' }}>
                          {isSelected && (
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium" style={{ color: c.titleColor }}>
                          {opt.label}
                        </div>
                        {opt.description && (
                          <div className="mt-0.5 text-xs" style={{ color: c.descColor }}>
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}

              <button
                onClick={handleSwitchToText}
                onMouseEnter={() => setHoveredIndex(options.length)}
                onMouseLeave={() => setHoveredIndex(-1)}
                className="w-full rounded-md border px-3 py-2 text-left transition-colors"
                style={{
                  borderColor: hoveredIndex === options.length ? c.inputBorder : c.borderColor,
                  backgroundColor: hoveredIndex === options.length ? c.selectedBg : 'transparent',
                }}
              >
                <div className="flex items-center gap-1.5 text-xs" style={{ color: c.labelColor }}>
                  <span>✎</span>
                  <span>Type something...</span>
                </div>
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: c.labelColor }}>
                {multiSelect ? (selectedCount > 0 ? `${selectedCount} selected` : 'Select options') : ''}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ backgroundColor: c.btnCancelBg, color: c.btnCancelText }}
                >
                  Cancel
                </button>
                {multiSelect && (
                  <button
                    onClick={handleConfirmMulti}
                    disabled={selectedCount === 0}
                    className="rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ backgroundColor: c.btnPrimaryBg, color: c.btnPrimaryText }}
                  >
                    Confirm{selectedCount > 0 ? ` (${selectedCount})` : ''}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3">
              <textarea
                ref={textAreaRef}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={3}
                placeholder="Type your answer..."
                className="w-full resize-none rounded border px-2 py-1.5 font-mono text-[11px] outline-none focus:border-blue-500"
                style={{
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBg,
                  color: c.inputText,
                }}
              />
              <p className="mt-1 text-xs" style={{ color: c.labelColor }}>
                Enter to submit · Esc to go back
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={handleBackToOptions}
                className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ backgroundColor: c.btnCancelBg, color: c.btnCancelText }}
              >
                Back
              </button>
              <button
                onClick={handleSubmitCustom}
                disabled={!customText.trim()}
                className="rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: c.btnPrimaryBg, color: c.btnPrimaryText }}
              >
                Confirm
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

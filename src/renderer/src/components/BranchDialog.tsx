import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { BranchDirection } from '../types/session'

interface BranchDialogProps {
  trigger: 'auto' | 'manual'
  tokenUsage: { totalTokens: number; contextWindowSize: number }
  directions: BranchDirection[]
  loading: boolean
  creating: boolean
  onSelectDirection: (direction: BranchDirection) => void
  onDeleteDirection: (index: number) => void
  onEditDirection: (index: number, direction: BranchDirection) => void
  onAddDirection: (direction: BranchDirection) => void
  onRegenerateSuggestions: () => void
  onDismiss: () => void
}

export default function BranchDialog({
  trigger,
  tokenUsage,
  directions,
  loading,
  creating,
  onSelectDirection,
  onDeleteDirection,
  onEditDirection,
  onAddDirection,
  onRegenerateSuggestions,
  onDismiss,
}: BranchDialogProps): React.ReactElement {
  const [isDark, setIsDark] = useState(() => !document.documentElement.classList.contains('light'))
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPurpose, setEditPurpose] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPurpose, setNewPurpose] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(!document.documentElement.classList.contains('light'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const c = isDark ? {
    overlayBg: '#1e2026',
    titleColor: '#e5e7eb',
    labelColor: '#9ca3af',
    descColor: '#6b7280',
    borderColor: 'rgba(255,255,255,0.08)',
    inputBg: '#16181d',
    inputBorder: 'rgba(255,255,255,0.15)',
    inputText: '#e5e7eb',
    btnCancelBg: '#252830',
    btnCancelText: '#9ca3af',
    btnPrimaryBg: '#2563eb',
    btnPrimaryText: '#ffffff',
    btnDangerBg: 'rgba(248,81,73,0.12)',
    btnDangerText: '#f87171',
    cardBg: 'rgba(255,255,255,0.03)',
    cardHoverBg: 'rgba(255,255,255,0.06)',
    spinnerBorder: 'rgba(255,255,255,0.2)',
    spinnerTop: '#36d399',
    badgeAiBg: 'rgba(54,211,153,0.12)',
    badgeAiText: '#36d399',
    badgeUserBg: 'rgba(96,165,250,0.12)',
    badgeUserText: '#60a5fa',
  } : {
    overlayBg: '#ffffff',
    titleColor: '#111827',
    labelColor: '#6b7280',
    descColor: '#9ca3af',
    borderColor: '#e5e7eb',
    inputBg: '#f9fafb',
    inputBorder: '#d1d5db',
    inputText: '#111827',
    btnCancelBg: '#f3f4f6',
    btnCancelText: '#4b5563',
    btnPrimaryBg: '#2563eb',
    btnPrimaryText: '#ffffff',
    btnDangerBg: 'rgba(248,81,73,0.08)',
    btnDangerText: '#dc2626',
    cardBg: '#f9fafb',
    cardHoverBg: '#f3f4f6',
    spinnerBorder: 'rgba(0,0,0,0.1)',
    spinnerTop: '#2563eb',
    badgeAiBg: 'rgba(16,185,129,0.1)',
    badgeAiText: '#059669',
    badgeUserBg: 'rgba(59,130,246,0.1)',
    badgeUserText: '#2563eb',
  }

  const tokenPercent = tokenUsage.contextWindowSize > 0
    ? Math.round((tokenUsage.totalTokens / tokenUsage.contextWindowSize) * 100)
    : 0

  const handleStartEdit = useCallback((index: number, dir: BranchDirection) => {
    setEditingIndex(index)
    setEditTitle(dir.title)
    setEditDescription(dir.description)
    setEditPurpose(dir.purpose)
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (editingIndex === null) return
    const trimmedTitle = editTitle.trim()
    const trimmedDescription = editDescription.trim()
    const trimmedPurpose = editPurpose.trim()
    if (!trimmedTitle) return
    const original = directions[editingIndex]
    onEditDirection(editingIndex, {
      title: trimmedTitle,
      description: trimmedDescription,
      purpose: trimmedPurpose,
      source: original.source,
    })
    setEditingIndex(null)
  }, [editingIndex, editTitle, editDescription, editPurpose, directions, onEditDirection])

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null)
  }, [])

  const handleDeleteDirection = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    onDeleteDirection(index)
  }, [onDeleteDirection])

  const handleStartEditClick = useCallback((index: number, dir: BranchDirection, e: React.MouseEvent) => {
    e.stopPropagation()
    handleStartEdit(index, dir)
  }, [handleStartEdit])

  const handleAddDirection = useCallback(() => {
    const trimmedTitle = newTitle.trim()
    const trimmedDescription = newDescription.trim()
    const trimmedPurpose = newPurpose.trim()
    if (!trimmedTitle) return
    onAddDirection({
      title: trimmedTitle,
      description: trimmedDescription,
      purpose: trimmedPurpose,
      source: 'user',
    })
    setNewTitle('')
    setNewDescription('')
    setNewPurpose('')
    setShowAddForm(false)
  }, [newTitle, newDescription, newPurpose, onAddDirection])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (editingIndex !== null) {
        handleCancelEdit()
      } else if (showAddForm) {
        setShowAddForm(false)
      } else {
        onDismiss()
      }
    }
  }, [editingIndex, showAddForm, handleCancelEdit, onDismiss])

  const inputClass = 'w-full rounded border px-2 py-1.5 text-xs outline-none focus:border-blue-500'

  const renderSpinner = (text: string) => (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2"
        style={{ borderColor: c.spinnerBorder, borderTopColor: c.spinnerTop }}
      />
      <p className="text-xs" style={{ color: c.labelColor }}>{text}</p>
    </div>
  )

  if (creating) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
    <div
      className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg p-4 shadow-2xl"
      style={{ backgroundColor: c.overlayBg }}
    >
          {renderSpinner('Creating branch...')}
        </div>
      </div>,
      document.body,
    )
  }

  const title = trigger === 'auto' ? '🌿 Context is getting full' : '🌿 Branch Session'

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg p-4 shadow-2xl"
        style={{ backgroundColor: c.overlayBg }}
        onKeyDown={handleKeyDown}
      >
        <h2 className="mb-1 text-sm font-semibold" style={{ color: c.titleColor }}>
          {title}
        </h2>
        {trigger === 'auto' && (
          <p className="mb-3 text-xs" style={{ color: c.labelColor }}>
            {tokenPercent}% of context used ({tokenUsage.totalTokens.toLocaleString()} / {tokenUsage.contextWindowSize.toLocaleString()} tokens). Branch to keep things flowing.
          </p>
        )}
        {trigger === 'manual' && (
          <p className="mb-3 text-xs" style={{ color: c.labelColor }}>
            Choose a direction to fork this conversation into a new session.
          </p>
        )}

        {loading ? (
          renderSpinner('Analyzing conversation...')
        ) : (
          <>
            <div className="mb-3 space-y-2">
              {directions.map((dir, idx) => {
                const isEditing = editingIndex === idx
                return (
                  <div
                    key={idx}
                    className="rounded-lg border transition-colors"
                    style={{ borderColor: c.borderColor, backgroundColor: hoveredIndex === idx ? c.cardHoverBg : c.cardBg }}
                  >
                    {isEditing ? (
                      <div className="space-y-2 p-3">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Title"
                          autoFocus
                          className={inputClass}
                          style={{ borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.inputText }}
                        />
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description"
                          className={inputClass}
                          style={{ borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.inputText }}
                        />
                        <textarea
                          value={editPurpose}
                          onChange={(e) => setEditPurpose(e.target.value)}
                          rows={2}
                          placeholder="Purpose"
                          className={`${inputClass} resize-none`}
                          style={{ borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.inputText }}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={handleCancelEdit}
                            className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
                            style={{ backgroundColor: c.btnCancelBg, color: c.btnCancelText }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={!editTitle.trim()}
                            className="rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            style={{ backgroundColor: c.btnPrimaryBg, color: c.btnPrimaryText }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => onSelectDirection(dir)}
                        className="cursor-pointer rounded-lg p-3 transition-colors"
                        onMouseEnter={() => setHoveredIndex(idx)}
                        onMouseLeave={() => setHoveredIndex(null)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold" style={{ color: c.titleColor }}>
                                {dir.title}
                              </span>
                              <span
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: dir.source === 'ai' ? c.badgeAiBg : c.badgeUserBg,
                                  color: dir.source === 'ai' ? c.badgeAiText : c.badgeUserText,
                                }}
                              >
                                {dir.source === 'ai' ? 'AI' : 'You'}
                              </span>
                            </div>
                            {dir.description && (
                              <p className="mt-1 text-xs" style={{ color: c.descColor }}>
                                {dir.description}
                              </p>
                            )}
                            {dir.purpose && (
                              <p className="mt-1 text-[11px] italic" style={{ color: c.labelColor }}>
                                {dir.purpose}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              onClick={(e) => handleStartEditClick(idx, dir, e)}
                              className="flex h-6 w-6 items-center justify-center rounded text-xs transition-colors"
                              style={{ backgroundColor: c.btnCancelBg, color: c.btnCancelText }}
                              title="Edit"
                            >
                              ✎
                            </button>
                            <button
                              onClick={(e) => handleDeleteDirection(idx, e)}
                              className="flex h-6 w-6 items-center justify-center rounded text-xs transition-colors"
                              style={{ backgroundColor: c.btnDangerBg, color: c.btnDangerText }}
                              title="Delete"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {showAddForm ? (
              <div
                className="mb-3 space-y-2 rounded-lg border p-3"
                style={{ borderColor: c.borderColor, backgroundColor: c.cardBg }}
              >
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Title"
                  autoFocus
                  className={inputClass}
                  style={{ borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.inputText }}
                />
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Description"
                  className={inputClass}
                  style={{ borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.inputText }}
                />
                <textarea
                  value={newPurpose}
                  onChange={(e) => setNewPurpose(e.target.value)}
                  rows={2}
                  placeholder="Purpose"
                  className={`${inputClass} resize-none`}
                  style={{ borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.inputText }}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowAddForm(false); setNewTitle(''); setNewDescription(''); setNewPurpose('') }}
                    className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ backgroundColor: c.btnCancelBg, color: c.btnCancelText }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddDirection}
                    disabled={!newTitle.trim()}
                    className="rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ backgroundColor: c.btnPrimaryBg, color: c.btnPrimaryText }}
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="mb-3 w-full rounded-lg border border-dashed py-2 text-xs font-medium transition-colors"
                style={{ borderColor: c.borderColor, color: c.labelColor }}
              >
                + Add custom direction
              </button>
            )}

            <button
              onClick={onRegenerateSuggestions}
              disabled={loading}
              className="mb-4 w-full rounded-lg border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: c.borderColor, color: c.labelColor }}
            >
              Regenerate suggestions
            </button>

            <div className="flex justify-end">
              <button
                onClick={onDismiss}
                className="rounded px-4 py-1.5 text-xs font-medium transition-colors"
                style={{ backgroundColor: c.btnCancelBg, color: c.btnCancelText }}
              >
                {trigger === 'auto' ? 'Continue in current session' : 'Cancel'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

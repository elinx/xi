import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import type { ChangeAnchor } from '../types/message'

export default function ForkAskDialog({
  anchor,
  isDark,
  onConfirm,
  onClose,
}: {
  anchor: ChangeAnchor
  isDark: boolean
  onConfirm: (sessionName: string, question: string) => void
  onClose: () => void
}): React.ReactElement {
  const questionRef = useRef<HTMLTextAreaElement>(null)

  const fileName = anchor.filePath.split('/').pop() ?? anchor.filePath
  const defaultSessionName = `追问: ${fileName}`

  const [sessionName, setSessionName] = useState(defaultSessionName)
  const [question, setQuestion] = useState('')

  const diffBg = isDark ? 'rgba(0, 0, 0, 0.22)' : 'rgba(0, 0, 0, 0.03)'
  const diffFg = isDark ? '#adbac7' : '#57606a'
  const diffAddedBg = isDark ? 'rgba(46, 160, 67, 0.16)' : 'rgba(26, 127, 55, 0.12)'
  const diffAddedFg = isDark ? '#7ee787' : '#1a7f37'
  const diffRemovedBg = isDark ? 'rgba(248, 81, 73, 0.16)' : 'rgba(207, 34, 46, 0.12)'
  const diffRemovedFg = isDark ? '#ffa198' : '#cf222e'
  const diffWordAddedBg = isDark ? 'rgba(46, 160, 67, 0.45)' : 'rgba(26, 127, 55, 0.35)'
  const diffWordRemovedBg = isDark ? 'rgba(248, 81, 73, 0.45)' : 'rgba(207, 34, 46, 0.35)'

  const c = isDark ? {
    overlayBg: '#1e2026',
    titleColor: '#e5e7eb',
    labelColor: '#9ca3af',
    anchorColor: '#d1d5db',
    filePathColor: '#6b7280',
    borderColor: 'rgba(255,255,255,0.08)',
    borderSepColor: 'rgba(255,255,255,0.06)',
    inputBg: '#16181d',
    inputBorder: 'rgba(255,255,255,0.15)',
    inputText: '#e5e7eb',
    btnCancelBg: '#252830',
    btnCancelText: '#9ca3af',
    btnPrimaryBg: '#2563eb',
    btnPrimaryText: '#ffffff',
    previewBg: 'rgba(0,0,0,0.3)',
    previewText: '#d1d5db',
  } : {
    overlayBg: '#ffffff',
    titleColor: '#111827',
    labelColor: '#6b7280',
    anchorColor: '#374151',
    filePathColor: '#9ca3af',
    borderColor: '#e5e7eb',
    borderSepColor: '#f3f4f6',
    inputBg: '#f9fafb',
    inputBorder: '#d1d5db',
    inputText: '#111827',
    btnCancelBg: '#f3f4f6',
    btnCancelText: '#4b5563',
    btnPrimaryBg: '#2563eb',
    btnPrimaryText: '#ffffff',
    previewBg: '#f9fafb',
    previewText: '#4b5563',
  }

  const handleConfirm = useCallback(() => {
    const trimmed = sessionName.trim()
    if (trimmed) {
      onConfirm(trimmed, question.trim())
    }
  }, [sessionName, question, onConfirm])

  const handleSessionNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        questionRef.current?.focus()
      }
    },
    [],
  )

  const handleQuestionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleConfirm()
      }
    },
    [handleConfirm],
  )

  const isWrite = anchor.toolName === 'write' || (!anchor.edits && anchor.oldText == null)
  const previewText = anchor.newText.slice(0, 300)
  const diffPairs = isWrite ? null : (anchor.edits ?? [{ oldText: String(anchor.oldText ?? ''), newText: String(anchor.newText) }])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg p-4 shadow-2xl"
        style={{ backgroundColor: c.overlayBg }}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      >
        <h2 className="mb-3 text-sm font-semibold" style={{ color: c.titleColor }}>追问修改</h2>

        <div className="mb-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs" style={{ color: c.labelColor }}>
            <span>📎</span>
            <span>锚定修改:</span>
            <span className="flex items-center gap-1 font-medium" style={{ color: c.anchorColor }}>
              {isWrite ? (
                <>
                  <span>📄</span>
                  <span>新建/重写文件</span>
                </>
              ) : (
                <>
                  <span>✏️</span>
                  <span>edit</span>
                </>
              )}
              <span className="ml-1" style={{ color: c.filePathColor }}>{anchor.filePath}</span>
            </span>
          </div>

          {isWrite ? (
            <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded border px-2 py-1 font-mono text-xs" style={{ borderColor: c.borderColor, backgroundColor: c.previewBg, color: c.previewText }}>
              {previewText}
              {anchor.newText.length > 300 ? '\n…' : ''}
            </pre>
          ) : (
            <div className="max-h-[200px] overflow-auto rounded border" style={{ borderColor: c.borderColor }}>
              {diffPairs?.map((pair, idx) => (
                <div key={idx}>
                  {idx > 0 && <div style={{ borderTop: `1px solid ${c.borderSepColor}` }} />}
                  <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                  <ReactDiffViewer
                    oldValue={pair.oldText}
                    newValue={pair.newText}
                    splitView={false}
                    compareMethod={DiffMethod.WORDS}
                    useDarkTheme={isDark}
                    hideLineNumbers
                    hideSummary
                    styles={{
                      variables: isDark ? {
                        dark: {
                          diffViewerBackground: diffBg,
                          diffViewerColor: diffFg,
                          addedBackground: diffAddedBg,
                          addedColor: diffAddedFg,
                          removedBackground: diffRemovedBg,
                          removedColor: diffRemovedFg,
                          wordAddedBackground: diffWordAddedBg,
                          wordRemovedBackground: diffWordRemovedBg,
                          addedGutterBackground: diffBg,
                          removedGutterBackground: diffBg,
                          gutterBackground: diffBg,
                          gutterBackgroundDark: diffBg,
                          codeFoldBackground: 'rgba(0, 0, 0, 0.15)',
                          codeFoldGutterBackground: 'rgba(0, 0, 0, 0.15)',
                          emptyLineBackground: diffBg,
                        },
                      } : {
                        light: {
                          diffViewerBackground: diffBg,
                          diffViewerColor: diffFg,
                          addedBackground: diffAddedBg,
                          addedColor: diffAddedFg,
                          removedBackground: diffRemovedBg,
                          removedColor: diffRemovedFg,
                          wordAddedBackground: diffWordAddedBg,
                          wordRemovedBackground: diffWordRemovedBg,
                          addedGutterBackground: diffBg,
                          removedGutterBackground: diffBg,
                          gutterBackground: diffBg,
                          codeFoldBackground: 'rgba(0, 0, 0, 0.03)',
                          codeFoldGutterBackground: 'rgba(0, 0, 0, 0.03)',
                          emptyLineBackground: diffBg,
                        },
                      },
                      contentText: { color: diffFg, fontFamily: 'ui-monospace, monospace', fontSize: '12px', wordBreak: 'break-word' },
                      line: { padding: '0 8px' },
                    }}
                  />
                  </div>
                </div>
              ))}
            </div>
          )}

          {anchor.explanation && (
            <p className="mt-1.5 text-xs italic" style={{ color: c.labelColor }}>
              <span className="mr-1">💬</span>
              {anchor.explanation}
            </p>
          )}
        </div>

        <div className="space-y-2.5">
          <div>
            <label className="mb-1 block text-xs" style={{ color: c.labelColor }}>Session 名称:</label>
            <input
              autoFocus
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              onKeyDown={handleSessionNameKeyDown}
              className="w-full rounded border px-2 py-1.5 text-xs outline-none focus:border-blue-500"
              style={{ borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.inputText }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs" style={{ color: c.labelColor }}>你的问题:</label>
            <textarea
              ref={questionRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleQuestionKeyDown}
              rows={3}
              placeholder="你想了解什么？"
              className="w-full resize-none rounded border px-2 py-1.5 text-xs outline-none focus:border-blue-500"
              style={{ borderColor: c.inputBorder, backgroundColor: c.inputBg, color: c.inputText }}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ backgroundColor: c.btnCancelBg, color: c.btnCancelText }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!sessionName.trim()}
            className="rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: c.btnPrimaryBg, color: c.btnPrimaryText }}
          >
            Fork
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

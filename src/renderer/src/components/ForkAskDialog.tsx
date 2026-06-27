import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ChangeAnchor } from '../types/message'

export default function ForkAskDialog({
  anchor,
  onConfirm,
  onClose,
}: {
  anchor: ChangeAnchor
  onConfirm: (sessionName: string, question: string) => void
  onClose: () => void
}): React.ReactElement {
  const questionRef = useRef<HTMLTextAreaElement>(null)

  const fileName = anchor.filePath.split('/').pop() ?? anchor.filePath
  const defaultSessionName = `追问: ${fileName}`

  const [sessionName, setSessionName] = useState(defaultSessionName)
  const [question, setQuestion] = useState('')

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

  const isWrite = anchor.toolName === 'write' || anchor.oldText == null
  const previewText = anchor.newText.slice(0, 300)

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-gray-800 p-4 shadow-2xl"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      >
        <h2 className="mb-3 text-sm font-semibold text-gray-200">追问修改</h2>

        <div className="mb-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-gray-400">
            <span>📎</span>
            <span>锚定修改:</span>
            <span className="flex items-center gap-1 font-medium text-gray-300">
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
              <span className="ml-1 text-gray-500">{anchor.filePath}</span>
            </span>
          </div>

          {isWrite ? (
            <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded border border-gray-700/50 bg-gray-900/60 px-2 py-1 font-mono text-xs text-gray-300">
              {previewText}
              {anchor.newText.length > 300 ? '\n…' : ''}
            </pre>
          ) : (
            <div className="max-h-[200px] overflow-auto">
              <pre className="mb-1 overflow-x-auto whitespace-pre-wrap rounded border border-red-800/40 bg-red-950/40 px-2 py-1 font-mono text-xs text-red-300">
                {String(anchor.oldText ?? '')}
              </pre>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-green-800/40 bg-green-950/40 px-2 py-1 font-mono text-xs text-green-300">
                {String(anchor.newText)}
              </pre>
            </div>
          )}

          {anchor.explanation && (
            <p className="mt-1.5 text-xs italic text-gray-400">
              <span className="mr-1">💬</span>
              {anchor.explanation}
            </p>
          )}
        </div>

        <div className="space-y-2.5">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Session 名称:</label>
            <input
              autoFocus
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              onKeyDown={handleSessionNameKeyDown}
              className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">你的问题:</label>
            <textarea
              ref={questionRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleQuestionKeyDown}
              rows={3}
              placeholder="你想了解什么？"
              className="w-full resize-none rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!sessionName.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Fork
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

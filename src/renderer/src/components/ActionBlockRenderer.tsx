import { useState } from 'react'
import type { ActionBlock } from '../types/message'

interface ActionBlockRendererProps {
  block: ActionBlock
  onRespond: (response: Record<string, unknown>) => void
}

export function ActionBlockRenderer({ block, onRespond }: ActionBlockRendererProps) {
  switch (block.actionType) {
    case 'select':
      return <SelectAction block={block} onRespond={onRespond} />
    case 'confirm':
      return <ConfirmAction block={block} onRespond={onRespond} />
    case 'input':
      return <InputAction block={block} onRespond={onRespond} />
  }
}

function SelectAction({ block, onRespond }: ActionBlockRendererProps) {
  const [selected, setSelected] = useState<string | null>(null)

  if (!block.options || block.options.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="mb-2 text-sm font-medium text-amber-800">{block.label}</div>
      <div className="flex flex-wrap gap-2">
        {block.options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => {
              setSelected(opt.id)
              onRespond({ value: opt.label })
            }}
            className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
              selected === opt.id
                ? 'border-amber-500 bg-amber-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
            }`}
          >
            {opt.label}
            {opt.description && (
              <span className="ml-1 text-xs opacity-60">- {opt.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function ConfirmAction({ block, onRespond }: ActionBlockRendererProps) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="mb-2 text-sm font-medium text-amber-800">{block.label}</div>
      <div className="flex gap-2">
        <button
          onClick={() => onRespond({ confirmed: true })}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          Confirm
        </button>
        <button
          onClick={() => onRespond({ cancelled: true as const })}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function InputAction({ block, onRespond }: ActionBlockRendererProps) {
  const [value, setValue] = useState('')

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="mb-2 text-sm font-medium text-amber-800">{block.label}</div>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              onRespond({ value: value.trim() })
            }
          }}
          placeholder="Type your response..."
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        <button
          onClick={() => {
            if (value.trim()) onRespond({ value: value.trim() })
          }}
          disabled={!value.trim()}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { formatTokens, getFillColor } from './TokenUsageRing'

interface TokenUsageBarProps {
  usedTokens: number
  contextWindowSize: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalCost: number
}

export function TokenUsageBar({
  usedTokens,
  contextWindowSize,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  totalCost,
}: TokenUsageBarProps) {
  const [hovered, setHovered] = useState(false)

  const rawPct = contextWindowSize > 0 ? usedTokens / contextWindowSize : 0
  const pct = Math.max(0, Math.min(1, rawPct))
  const percent = Math.round(pct * 100)

  const fillColor = getFillColor(pct)
  const isCritical = pct >= 0.9

  const remaining = contextWindowSize - usedTokens

  const tooltipRows: Array<{ label: string; value: string } | 'divider'> = [
    { label: 'Input:', value: formatTokens(inputTokens) },
    { label: 'Output:', value: formatTokens(outputTokens) },
    { label: 'Cache Read:', value: formatTokens(cacheReadTokens) },
    'divider',
    { label: 'Used:', value: formatTokens(usedTokens) },
    { label: 'Window:', value: formatTokens(contextWindowSize) },
    { label: 'Remaining:', value: formatTokens(remaining) },
    { label: 'Cost:', value: `$${totalCost.toFixed(2)}` },
  ]

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium transition-colors cursor-default ${isCritical ? 'animate-pulse' : ''}`}
        title={`${percent}% used`}
      >
        <div className="w-10 h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${percent}%`, backgroundColor: fillColor }}
          />
        </div>
        <span className="text-gray-500 tabular-nums">{percent}%</span>
      </div>
      {hovered && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 rounded-md p-2 text-xs text-white whitespace-nowrap z-50"
          style={{ background: '#1a1a2e' }}
        >
          {tooltipRows.map((row, i) =>
            row === 'divider' ? (
              <div key={i} className="border-t border-white/15 my-1" />
            ) : (
              <div key={i} className="flex justify-between gap-3">
                <span className="text-gray-400">{row.label}</span>
                <span>{row.value}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

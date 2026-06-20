import { useState } from 'react'

interface TokenUsageRingProps {
  usedTokens: number
  contextWindowSize: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalCost: number
  tooltipPosition?: 'top' | 'bottom'
  size?: number
  showPercent?: boolean
}

export function interpolateColor(hex1: string, hex2: string, t: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16)
  const g1 = parseInt(hex1.slice(3, 5), 16)
  const b1 = parseInt(hex1.slice(5, 7), 16)
  const r2 = parseInt(hex2.slice(1, 3), 16)
  const g2 = parseInt(hex2.slice(3, 5), 16)
  const b2 = parseInt(hex2.slice(5, 7), 16)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`
  }
  return String(n)
}

export function getFillColor(pct: number): string {
  if (pct < 0.5) {
    return '#22c55e'
  }
  if (pct < 0.75) {
    const t = (pct - 0.5) / 0.25
    return interpolateColor('#22c55e', '#eab308', t)
  }
  if (pct < 0.9) {
    const t = (pct - 0.75) / 0.15
    return interpolateColor('#eab308', '#f97316', t)
  }
  const t = Math.min(1, (pct - 0.9) / 0.1)
  return interpolateColor('#f97316', '#ef4444', t)
}

export function TokenUsageRing({
  usedTokens,
  contextWindowSize,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  totalCost,
  tooltipPosition = 'bottom',
  size = 36,
  showPercent = true,
}: TokenUsageRingProps) {
  const [hovered, setHovered] = useState(false)

  const rawPct = contextWindowSize > 0 ? usedTokens / contextWindowSize : 0
  const pct = Math.max(0, Math.min(1, rawPct))
  const percent = Math.round(pct * 100)

  const strokeWidth = size <= 20 ? 3 : 4
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - pct)

  const fillColor = getFillColor(pct)
  const isCritical = pct >= 0.9

  const remaining = contextWindowSize - usedTokens

  const tooltipRows: Array<{ label: string; value: string } | 'divider'> = [
    { label: 'Input:', value: formatTokens(inputTokens) },
    { label: 'Output:', value: formatTokens(outputTokens) },
    { label: 'Cache Read:', value: formatTokens(cacheReadTokens) },
    'divider',
    { label: 'Used:', value: formatTokens(usedTokens) },
    { label: '% Used:', value: `${percent}%` },
    { label: 'Window:', value: formatTokens(contextWindowSize) },
    { label: 'Remaining:', value: formatTokens(remaining) },
    { label: 'Cost:', value: `$${totalCost.toFixed(2)}` },
  ]

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <style>{`
        @keyframes pulse-critical {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-gray-300"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            ...(isCritical ? { animation: 'pulse-critical 1s ease-in-out infinite' } : {}),
          }}
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size <= 20 ? 6 : 9}
          fontWeight={600}
          className="fill-gray-500"
        >
          {showPercent ? percent : ''}
        </text>
      </svg>
      <div
        data-tooltip
        style={{
          position: 'absolute',
          [tooltipPosition === 'top' ? 'bottom' : 'top']: '100%',
          left: 0,
          [tooltipPosition === 'top' ? 'marginBottom' : 'marginTop']: 6,
          background: 'var(--color-gray-100)',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 11,
          color: '#fff',
          whiteSpace: 'nowrap',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s',
          pointerEvents: 'none',
          zIndex: 50,
        }}
      >
        {tooltipRows.map((row, i) =>
          row === 'divider' ? (
            <div
              key={i}
              style={{
                borderTop: '1px solid rgba(255,255,255,0.15)',
                margin: '4px 0',
              }}
            />
          ) : (
            <div
              key={i}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
            >
              <span style={{ color: '#aaa' }}>{row.label}</span>
              <span>{row.value}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

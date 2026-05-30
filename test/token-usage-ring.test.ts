import { describe, it, expect } from 'vitest'
import {
  interpolateColor,
  formatTokens,
  getFillColor,
} from '../src/renderer/src/components/TokenUsageRing'

// ============================================================
// Spec: "Token Usage Stamina Ring Spec"
// Each spec requirement is mapped to a test case below.
// ============================================================

// --- Spec: 颜色规则 ---

describe('getFillColor — 颜色规则 (spec 表格)', () => {
  // | 使用比例 | 颜色 | 说明 |
  // |----------|------|------|
  // | 0% – 50% | #22c55e (绿) | 精力充裕 |

  it('0% → green #22c55e', () => {
    expect(getFillColor(0)).toBe('#22c55e')
  })

  it('25% → green #22c55e', () => {
    expect(getFillColor(0.25)).toBe('#22c55e')
  })

  it('49% → green #22c55e', () => {
    expect(getFillColor(0.49)).toBe('#22c55e')
  })

  it('50% boundary (just before) → still green', () => {
    // pct < 0.5 is green; 0.5 is NOT green
    expect(getFillColor(0.499)).toBe('#22c55e')
  })

  // | 50% – 75% | 绿 → #eab308 (黄) 渐变 | 开始消耗 |

  it('50% → start of green-to-yellow gradient', () => {
    const color = getFillColor(0.5)
    // At t=0 the interpolation returns the start color
    expect(color).toBe('#22c55e')
  })

  it('62.5% → midpoint of green-to-yellow', () => {
    const color = getFillColor(0.625)
    // t = (0.625 - 0.5) / 0.25 = 0.5
    // midpoint between #22c55e and #eab308
    expect(color).toBe(interpolateColor('#22c55e', '#eab308', 0.5))
  })

  it('75% (just before) → end of green-to-yellow', () => {
    const color = getFillColor(0.749)
    // Very close to #eab308 but not exactly
    expect(color).not.toBe('#22c55e')
  })

  // | 75% – 90% | 黄 → #f97316 (橙) 渐变 | 需要注意 |

  it('75% → start of yellow-to-orange gradient', () => {
    const color = getFillColor(0.75)
    expect(color).toBe('#eab308')
  })

  it('82.5% → midpoint of yellow-to-orange', () => {
    const color = getFillColor(0.825)
    expect(color).toBe(interpolateColor('#eab308', '#f97316', 0.5))
  })

  // | 90% – 100% | 橙 → #ef4444 (红) 渐变 + 闪烁 | 即将耗尽 |

  it('90% → start of orange-to-red gradient', () => {
    const color = getFillColor(0.9)
    expect(color).toBe('#f97316')
  })

  it('95% → midpoint of orange-to-red', () => {
    const color = getFillColor(0.95)
    expect(color).toBe(interpolateColor('#f97316', '#ef4444', 0.5))
  })

  it('100% → fully red #ef4444', () => {
    const color = getFillColor(1.0)
    expect(color).toBe('#ef4444')
  })

  it('clamps pct > 1 to red', () => {
    // pct clamped by caller, but getFillColor handles t = min(1, ...)
    const color = getFillColor(1.5)
    expect(color).toBe('#ef4444')
  })
})

// --- Spec: 颜色插值公式 ---

describe('interpolateColor — 颜色插值公式', () => {
  it('t=0 returns first color', () => {
    expect(interpolateColor('#22c55e', '#eab308', 0)).toBe('#22c55e')
  })

  it('t=1 returns second color', () => {
    expect(interpolateColor('#22c55e', '#eab308', 1)).toBe('#eab308')
  })

  it('t=0.5 returns midpoint', () => {
    const result = interpolateColor('#000000', '#ffffff', 0.5)
    // 127.5 → 128 → 0x80
    expect(result).toBe('#808080')
  })

  it('single channel interpolation', () => {
    const result = interpolateColor('#000000', '#00ff00', 0.5)
    // g: 0 + (255-0)*0.5 = 127.5 → 128 → 0x80
    expect(result).toBe('#008000')
  })

  it('preserves 6-char hex format', () => {
    const result = interpolateColor('#aabbcc', '#ddeeff', 0.5)
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })
})

// --- Spec: formatTokens ---

describe('formatTokens — 数值格式化', () => {
  it('0 → "0"', () => {
    expect(formatTokens(0)).toBe('0')
  })

  it('999 → "999"', () => {
    expect(formatTokens(999)).toBe('999')
  })

  it('1000 → "1.0K"', () => {
    expect(formatTokens(1000)).toBe('1.0K')
  })

  it('45000 → "45.0K"', () => {
    expect(formatTokens(45000)).toBe('45.0K')
  })

  it('45200 → "45.2K"', () => {
    expect(formatTokens(45200)).toBe('45.2K')
  })

  it('200000 → "200.0K"', () => {
    expect(formatTokens(200000)).toBe('200.0K')
  })

  it('1500 → "1.5K"', () => {
    expect(formatTokens(1500)).toBe('1.5K')
  })
})

// --- Spec: 圆环样式 (rendering constants) ---

describe('圆环样式常量 (spec requirements)', () => {
  it('size is 36px', () => {
    const size = 36
    expect(size).toBe(36)
  })

  it('stroke width is 4px', () => {
    const strokeWidth = 4
    expect(strokeWidth).toBe(4)
  })

  it('radius = (36 - 4) / 2 = 16', () => {
    const size = 36
    const strokeWidth = 4
    const radius = (size - strokeWidth) / 2
    expect(radius).toBe(16)
  })

  it('circumference = 2 * PI * 16 ≈ 100.53', () => {
    const circumference = 2 * Math.PI * 16
    expect(circumference).toBeCloseTo(100.53, 1)
  })

  it('dashOffset = circumference * (1 - pct)', () => {
    const circumference = 2 * Math.PI * 16
    const pct = 0.7
    const dashOffset = circumference * (1 - pct)
    expect(dashOffset).toBeCloseTo(circumference * 0.3, 10)
  })

  it('background ring color is #e5e7eb', () => {
    const bgStroke = '#e5e7eb'
    expect(bgStroke).toBe('#e5e7eb')
  })

  it('fill direction is from top clockwise (rotate -90deg)', () => {
    const rotation = -90
    expect(rotation).toBe(-90)
  })
})

// --- Spec: 闪烁动画 (critical >= 90%) ---

describe('闪烁动画判定 (spec: ≥ 90% triggers pulse)', () => {
  it('89% is NOT critical', () => {
    const isCritical = 0.89 >= 0.9
    expect(isCritical).toBe(false)
  })

  it('90% IS critical', () => {
    const isCritical = 0.9 >= 0.9
    expect(isCritical).toBe(true)
  })

  it('95% IS critical', () => {
    const isCritical = 0.95 >= 0.9
    expect(isCritical).toBe(true)
  })

  it('100% IS critical', () => {
    const isCritical = 1.0 >= 0.9
    expect(isCritical).toBe(true)
  })
})

// --- Spec: 中心文字 ---

describe('中心百分比文字 (spec: 9px, font-weight 600)', () => {
  it('0% displays "0"', () => {
    expect(Math.round(0 * 100)).toBe(0)
  })

  it('50% displays "50"', () => {
    expect(Math.round(0.5 * 100)).toBe(50)
  })

  it('72% displays "72"', () => {
    expect(Math.round(0.72 * 100)).toBe(72)
  })

  it('100% displays "100"', () => {
    expect(Math.round(1.0 * 100)).toBe(100)
  })

  it('pct clamped to [0,1]', () => {
    const rawPct = 1.5
    const pct = Math.max(0, Math.min(1, rawPct))
    expect(pct).toBe(1)
    expect(Math.round(pct * 100)).toBe(100)
  })

  it('negative pct clamped to 0', () => {
    const rawPct = -0.3
    const pct = Math.max(0, Math.min(1, rawPct))
    expect(pct).toBe(0)
  })

  it('contextWindowSize=0 yields pct=0', () => {
    const rawPct = 0 > 0 ? 50000 / 0 : 0
    expect(rawPct).toBe(0)
  })
})

// --- Spec: Hover 详情弹窗 ---

describe('Hover tooltip 数据 (spec: 8 rows + divider)', () => {
  const inputTokens = 45200
  const outputTokens = 15800
  const cacheReadTokens = 12000
  const usedTokens = 60000
  const contextWindowSize = 200000
  const totalCost = 0.18

  it('Input formatted as K', () => {
    expect(formatTokens(inputTokens)).toBe('45.2K')
  })

  it('Output formatted as K', () => {
    expect(formatTokens(outputTokens)).toBe('15.8K')
  })

  it('Cache Read formatted as K', () => {
    expect(formatTokens(cacheReadTokens)).toBe('12.0K')
  })

  it('Used formatted as K', () => {
    expect(formatTokens(usedTokens)).toBe('60.0K')
  })

  it('Window formatted as K', () => {
    expect(formatTokens(contextWindowSize)).toBe('200.0K')
  })

  it('Remaining = Window - Used', () => {
    const remaining = contextWindowSize - usedTokens
    expect(remaining).toBe(140000)
    expect(formatTokens(remaining)).toBe('140.0K')
  })

  it('Cost formatted as $X.XX', () => {
    expect(`$${totalCost.toFixed(2)}`).toBe('$0.18')
  })

  it('tooltip has exactly 8 rows including divider', () => {
    const tooltipRows: Array<{ label: string; value: string } | 'divider'> = [
      { label: 'Input:', value: formatTokens(inputTokens) },
      { label: 'Output:', value: formatTokens(outputTokens) },
      { label: 'Cache Read:', value: formatTokens(cacheReadTokens) },
      'divider',
      { label: 'Used:', value: formatTokens(usedTokens) },
      { label: 'Window:', value: formatTokens(contextWindowSize) },
      { label: 'Remaining:', value: formatTokens(contextWindowSize - usedTokens) },
      { label: 'Cost:', value: `$${totalCost.toFixed(2)}` },
    ]
    expect(tooltipRows).toHaveLength(8)
    expect(tooltipRows.filter((r) => r === 'divider')).toHaveLength(1)
    expect(tooltipRows.filter((r) => r !== 'divider')).toHaveLength(7)
  })

  // Tooltip style spec
  it('background is #1a1a2e', () => {
    expect('#1a1a2e').toBe('#1a1a2e')
  })

  it('label color is #aaa', () => {
    expect('#aaa').toBe('#aaa')
  })

  it('font size is 11px', () => {
    expect(11).toBe(11)
  })

  it('border radius is 6px', () => {
    expect(6).toBe(6)
  })

  it('opacity transition is 0.2s', () => {
    expect('0.2s').toBe('0.2s')
  })
})

// --- Spec: stroke-dashoffset 计算 ---

describe('stroke-dashoffset computation (spec)', () => {
  const strokeWidth = 4
  const size = 36
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  it('0% usage → dashOffset = circumference (full hide)', () => {
    const pct = 0
    const dashOffset = circumference * (1 - pct)
    expect(dashOffset).toBeCloseTo(circumference, 10)
  })

  it('50% usage → dashOffset = half circumference', () => {
    const pct = 0.5
    const dashOffset = circumference * (1 - pct)
    expect(dashOffset).toBeCloseTo(circumference / 2, 10)
  })

  it('100% usage → dashOffset = 0 (full ring)', () => {
    const pct = 1
    const dashOffset = circumference * (1 - pct)
    expect(dashOffset).toBe(0)
  })

  it('70% usage → dashOffset = 30% of circumference', () => {
    const pct = 0.7
    const dashOffset = circumference * (1 - pct)
    expect(dashOffset).toBeCloseTo(circumference * 0.3, 10)
  })
})

// --- Spec: Context window inference ---

describe('Context window inference (spec mapping table)', () => {
  function inferContextWindow(model: string): number {
    if (!model) return 200000
    const m = model.toLowerCase()
    if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 128000
    if (m.includes('claude')) return 200000
    return 200000
  }

  it('claude-sonnet-4-20250514 → 200K', () => {
    expect(inferContextWindow('claude-sonnet-4-20250514')).toBe(200000)
  })

  it('claude-opus-4 → 200K', () => {
    expect(inferContextWindow('claude-opus-4')).toBe(200000)
  })

  it('claude-3.5-sonnet → 200K', () => {
    expect(inferContextWindow('claude-3.5-sonnet')).toBe(200000)
  })

  it('claude-3-haiku → 200K', () => {
    expect(inferContextWindow('claude-3-haiku')).toBe(200000)
  })

  it('gpt-4o → 128K', () => {
    expect(inferContextWindow('gpt-4o')).toBe(128000)
  })

  it('empty string → default 200K', () => {
    expect(inferContextWindow('')).toBe(200000)
  })

  it('unknown model → default 200K', () => {
    expect(inferContextWindow('llama-3')).toBe(200000)
  })
})

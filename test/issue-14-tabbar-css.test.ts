import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Issue #14: TabBar CSS fixes source verification', () => {
  const tabBarPath = join(__dirname, '../src/renderer/src/components/TabBar.tsx')
  const src = readFileSync(tabBarPath, 'utf-8')

  it('has overflow-y-hidden to prevent vertical scrollbar', () => {
    expect(src).toContain('overflow-y-hidden')
  })

  it('uses min-w-0 instead of shrink-0 on tab buttons', () => {
    expect(src).toContain('min-w-0')
    expect(src).not.toMatch(/shrink-0 h-9/)
  })

  it('increased max-width to 200px for tab titles', () => {
    expect(src).toContain('max-w-[200px]')
    expect(src).not.toContain('max-w-[120px]')
  })
})

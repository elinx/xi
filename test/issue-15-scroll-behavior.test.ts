import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Issue #15: chat scroll behavior source verification', () => {
  const chatViewPath = join(__dirname, '../src/renderer/src/components/ChatView.tsx')
  const src = readFileSync(chatViewPath, 'utf-8')

  it('has userScrolledUpRef to track manual scroll-up', () => {
    expect(src).toContain('userScrolledUpRef')
  })

  it('auto-scroll skips when userScrolledUpRef is true', () => {
    expect(src).toContain('if (userScrolledUpRef.current) return')
  })

  it('uses scrollTop instead of scrollIntoView for auto-scroll', () => {
    expect(src).toContain('el.scrollTop = el.scrollHeight')
  })

  it('clears userScrolledUpRef on scrollToBottom', () => {
    const scrollToBottomBlock = src.substring(
      src.indexOf('const scrollToBottom'),
      src.indexOf('const scrollToBottom') + 200,
    )
    expect(scrollToBottomBlock).toContain('userScrolledUpRef.current = false')
  })

  it('has wheel event listener to detect upward scroll during streaming', () => {
    expect(src).toContain("addEventListener('wheel'")
    expect(src).toContain('deltaY < 0')
  })

  it('clears userScrolledUpRef when user scrolls back to bottom', () => {
    const src = readFileSync(chatViewPath, 'utf-8')
    const idx = src.indexOf('const handleScroll')
    const handleScrollBlock = src.substring(idx, idx + 500)
    expect(handleScrollBlock).toContain('if (nearBottom)')
    expect(handleScrollBlock).toContain('userScrolledUpRef.current = false')
  })
})

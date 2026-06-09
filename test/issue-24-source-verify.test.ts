import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Issue #24: inferContextWindow source code verification', () => {
  const usePiRpcPath = join(__dirname, '../src/renderer/src/hooks/usePiRpc.ts')
  const convertMessagesPath = join(__dirname, '../src/renderer/src/utils/convert-messages.ts')

  it('usePiRpc.ts has deepseek case returning 1000000', () => {
    const src = readFileSync(usePiRpcPath, 'utf-8')
    expect(src).toContain("m.includes('deepseek')")
    expect(src).toContain('1000000')
  })

  it('convert-messages.ts has deepseek case returning 1000000', () => {
    const src = readFileSync(convertMessagesPath, 'utf-8')
    expect(src).toContain("m.includes('deepseek')")
    expect(src).toContain('1000000')
  })

  it('usePiRpc.ts prefers contextWindow from model registry in streaming', () => {
    const src = readFileSync(usePiRpcPath, 'utf-8')
    expect(src).toContain('currentModelRef.current?.contextWindow ?? inferContextWindow')
  })

  it('usePiRpc.ts uses contextWindow in clearMessages default', () => {
    const src = readFileSync(usePiRpcPath, 'utf-8')
    const idx = src.indexOf('const clearMessages')
    const clearMessagesBlock = src.substring(idx, idx + 800)
    expect(clearMessagesBlock).toContain('currentModelRef.current?.contextWindow ?? 200000')
  })
})

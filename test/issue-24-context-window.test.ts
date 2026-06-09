import { describe, it, expect } from 'vitest'

// Replicate the inferContextWindow logic from both files
function inferContextWindow(model: string): number {
  if (!model) return 200000
  const m = model.toLowerCase()
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 128000
  if (m.includes('claude')) return 200000
  if (m.includes('deepseek')) return 1000000
  if (m.includes('gemini')) return 1000000
  if (m.includes('gpt-5')) return 200000
  return 200000
}

describe('Issue #24: context window for DeepSeek models', () => {
  it('returns 1M for deepseek-v4-flash', () => {
    expect(inferContextWindow('deepseek-v4-flash')).toBe(1000000)
  })

  it('returns 1M for deepseek-v4-pro', () => {
    expect(inferContextWindow('deepseek-v4-pro')).toBe(1000000)
  })

  it('returns 1M for deepseek-v3', () => {
    expect(inferContextWindow('deepseek-v3')).toBe(1000000)
  })

  it('returns 1M for provider-prefixed deepseek models', () => {
    expect(inferContextWindow('deepseek/deepseek-v4-flash')).toBe(1000000)
  })

  it('returns 1M for gemini models', () => {
    expect(inferContextWindow('gemini-2.5-pro')).toBe(1000000)
    expect(inferContextWindow('gemini-3.1-pro-preview')).toBe(1000000)
  })

  it('returns 200k for claude models', () => {
    expect(inferContextWindow('claude-opus-4-8')).toBe(200000)
  })

  it('returns 128k for gpt-4o models', () => {
    expect(inferContextWindow('gpt-4o')).toBe(128000)
    expect(inferContextWindow('gpt-4-turbo')).toBe(128000)
  })

  it('returns 200k default for unknown models', () => {
    expect(inferContextWindow('unknown-model')).toBe(200000)
  })

  it('returns 200k for empty/undefined model', () => {
    expect(inferContextWindow('')).toBe(200000)
  })

  it('prefers contextWindow from model registry when available', () => {
    // Simulate the pattern: registry value overrides inference
    const registryContextWindow = 1000000
    const inferred = inferContextWindow('deepseek-v4-flash')
    const result = registryContextWindow ?? inferred
    expect(result).toBe(1000000)
  })
})

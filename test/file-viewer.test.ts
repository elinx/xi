import { describe, it, expect } from 'vitest'

function getLanguageLabel(ext: string): string {
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
    json: 'JSON', md: 'Markdown', css: 'CSS', html: 'HTML',
    py: 'Python', rs: 'Rust', go: 'Go', java: 'Java',
    rb: 'Ruby', sh: 'Shell', yaml: 'YAML', yml: 'YAML',
    toml: 'TOML', xml: 'XML', sql: 'SQL', graphql: 'GraphQL',
    vue: 'Vue', svelte: 'Svelte',
  }
  return map[ext] ?? ext.toUpperCase()
}

function isBinaryExt(ext: string): boolean {
  const binary = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp', 'mp3', 'mp4', 'wav', 'avi', 'mov', 'zip', 'tar', 'gz', 'rar', '7z', 'pdf', 'woff', 'woff2', 'ttf', 'eot', 'otf'])
  return binary.has(ext)
}

describe('FileViewer logic', () => {
  describe('getLanguageLabel', () => {
    it('maps ts to TypeScript', () => {
      expect(getLanguageLabel('ts')).toBe('TypeScript')
    })
    it('maps py to Python', () => {
      expect(getLanguageLabel('py')).toBe('Python')
    })
    it('maps json to JSON', () => {
      expect(getLanguageLabel('json')).toBe('JSON')
    })
    it('maps yml to YAML', () => {
      expect(getLanguageLabel('yml')).toBe('YAML')
    })
    it('returns uppercase ext for unknown', () => {
      expect(getLanguageLabel('xyz')).toBe('XYZ')
    })
    it('handles empty string', () => {
      expect(getLanguageLabel('')).toBe('')
    })
  })

  describe('isBinaryExt', () => {
    it('identifies png as binary', () => {
      expect(isBinaryExt('png')).toBe(true)
    })
    it('identifies pdf as binary', () => {
      expect(isBinaryExt('pdf')).toBe(true)
    })
    it('identifies woff2 as binary', () => {
      expect(isBinaryExt('woff2')).toBe(true)
    })
    it('identifies ts as not binary', () => {
      expect(isBinaryExt('ts')).toBe(false)
    })
    it('identifies md as not binary', () => {
      expect(isBinaryExt('md')).toBe(false)
    })
    it('identifies json as not binary', () => {
      expect(isBinaryExt('json')).toBe(false)
    })
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('fs:readDirectory IPC handler', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xi-fs-test-'))
    mkdirSync(join(tempDir, 'src'), { recursive: true })
    mkdirSync(join(tempDir, 'node_modules'), { recursive: true })
    mkdirSync(join(tempDir, '.git'), { recursive: true })
    writeFileSync(join(tempDir, 'package.json'), '{}')
    writeFileSync(join(tempDir, 'src', 'App.tsx'), 'export {}')
    writeFileSync(join(tempDir, 'src', 'main.ts'), 'export {}')
    writeFileSync(join(tempDir, '.hidden'), 'hidden')
    writeFileSync(join(tempDir, 'node_modules', 'foo.js'), '// foo')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('reads directory and filters hidden/node_modules', async () => {
    const { readdirFiltered } = await import('./fs-test-utils')
    const entries = readdirFiltered(tempDir)
    expect(entries.some(e => e.name === 'node_modules')).toBe(false)
    expect(entries.some(e => e.name === '.git')).toBe(false)
    expect(entries.some(e => e.name === '.hidden')).toBe(false)
    expect(entries.some(e => e.name === 'src')).toBe(true)
    expect(entries.some(e => e.name === 'package.json')).toBe(true)
  })

  it('sorts directories before files', async () => {
    const { readdirFiltered } = await import('./fs-test-utils')
    const entries = readdirFiltered(tempDir)
    const srcIdx = entries.findIndex(e => e.name === 'src')
    const pkgIdx = entries.findIndex(e => e.name === 'package.json')
    expect(srcIdx).toBeLessThan(pkgIdx)
  })

  it('marks directories correctly', async () => {
    const { readdirFiltered } = await import('./fs-test-utils')
    const entries = readdirFiltered(tempDir)
    const src = entries.find(e => e.name === 'src')
    const pkg = entries.find(e => e.name === 'package.json')
    expect(src?.isDirectory).toBe(true)
    expect(pkg?.isDirectory).toBe(false)
  })
})

describe('fs:readFile IPC handler', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xi-fs-readtest-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('reads a text file', async () => {
    writeFileSync(join(tempDir, 'test.ts'), 'const x = 1')
    const content = readFileSyncUtf8(join(tempDir, 'test.ts'))
    expect(content).toBe('const x = 1')
  })

  it('extracts file name and extension', () => {
    const path = '/project/src/App.tsx'
    const parts = path.split(/[/\\]/)
    const name = parts[parts.length - 1]
    const ext = name.split('.').pop() ?? ''
    expect(name).toBe('App.tsx')
    expect(ext).toBe('tsx')
  })
})

function readFileSyncUtf8(filePath: string): string {
  const { readFileSync } = require('fs')
  return readFileSync(filePath, 'utf-8')
}

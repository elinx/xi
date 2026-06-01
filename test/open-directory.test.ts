import { describe, it, expect, vi } from 'vitest'

describe('IPC: project:openDirectory', () => {
  it('returns ok:false when user cancels dialog', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })

    async function handleOpenDirectory() {
      const result = await showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false }
      }
      return { ok: true }
    }

    const result = await handleOpenDirectory()
    expect(result.ok).toBe(false)
  })

  it('returns ok:true with selected path', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/Users/test/project'] })

    async function handleOpenDirectory() {
      const result = await showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false }
      }
      return { ok: true, path: result.filePaths[0] }
    }

    const result = await handleOpenDirectory()
    expect(result.ok).toBe(true)
    expect(result.path).toBe('/Users/test/project')
  })
})

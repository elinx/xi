import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const MOCK_INJECT = `<script>
window.api = new Proxy({}, {
  get(target, prop) {
    if (prop === 'onEvent' || prop === 'onStateChanged' || prop === 'onResponse' || prop === 'onExtensionUiRequest') return () => () => {};
    if (prop === 'openConfigDir') return () => {};
    return async (...args) => {
      if (prop === 'listSessions' || prop === 'refreshSessions') return { projects: [] };
      if (prop === 'getForkMessages' || prop === 'getMessages' || prop === 'getMessagesForSession' || prop === 'getForkPoints') return [];
      if (prop === 'getCurrentSession') return null;
      if (prop === 'getState') return { connected: false };
      if (prop === 'getAvailableModels') return { ok: true, data: { models: [] } };
      if (prop === 'getProviderAuthStatus') return { ok: true, data: {} };
      if (prop === 'readDirectory') return { ok: true, entries: [] };
      if (prop === 'readFile') return { ok: false, error: 'Not available' };
      return { ok: true, success: true, data: {} };
    };
  }
});
</script>`

function startServer(dir: string): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url?.split('?')[0] || '/'
      const filePath = join(dir, urlPath === '/' ? 'index.html' : urlPath)
      if (!existsSync(filePath)) { res.writeHead(404); res.end(); return }
      const content = readFileSync(filePath)
      const ext = extname(filePath)
      if (ext === '.html') {
        const html = content.toString('utf-8').replace('<head>', '<head>' + MOCK_INJECT)
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      } else {
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
        res.end(content)
      }
    })
    server.listen(0, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
}

describe('Layout integration test', () => {
  let browser: Browser
  let context: BrowserContext
  let page: import('playwright').Page
  let port: number

  beforeAll(async () => {
    const rendererDir = join(__dirname, '../out/renderer')
    port = await startServer(rendererDir)
    browser = await chromium.launch()
    context = await browser.newContext()
    page = await context.newPage()
    await page.goto(`http://localhost:${port}/`)
    await page.waitForTimeout(2000)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('renders the LeftPanel toggle row with 4 view buttons', async () => {
    const buttons = await page.$$('[title="Sessions"], [title="Skills"], [title="MCP"], [title="Settings"]')
    expect(buttons.length).toBe(4)
  })

  it('renders the LeftPanel collapse button', async () => {
    const collapseBtn = await page.$('[title="Collapse panel"]')
    expect(collapseBtn).not.toBeNull()
  })

  it('renders the LeftPanel with session content', async () => {
    const text = await page.textContent('#root')
    expect(text).toContain('No sessions found')
  })

  it('renders the TabBar with Session tab', async () => {
    const sessionTabText = await page.textContent('#root')
    expect(sessionTabText).toContain('Session')
  })

  it('renders the InputBar', async () => {
    const textarea = await page.$('textarea')
    expect(textarea).not.toBeNull()
  })

  it('switches left panel view to settings', async () => {
    const settingsButton = await page.$('[title="Settings"]')
    expect(settingsButton).not.toBeNull()
    await settingsButton!.click()
    await page.waitForTimeout(500)
    const text = await page.textContent('#root')
    expect(text).toContain('Settings')
  })

  it('switches left panel view to skills', async () => {
    const skillsButton = await page.$('[title="Skills"]')
    expect(skillsButton).not.toBeNull()
    await skillsButton!.click()
    await page.waitForTimeout(500)
    const text = await page.textContent('#root')
    expect(text).toContain('coming soon')
  })

  it('switches back to sessions view', async () => {
    const sessionsButton = await page.$('[title="Sessions"]')
    expect(sessionsButton).not.toBeNull()
    await sessionsButton!.click()
    await page.waitForTimeout(500)
    const text = await page.textContent('#root')
    expect(text).toContain('No sessions found')
  })

  it('clicking active Sessions button collapses left panel', async () => {
    const sessionsButton = await page.$('[title="Sessions"]')
    expect(sessionsButton).not.toBeNull()
    await sessionsButton!.click()
    await page.waitForTimeout(500)
    const expandBtn = await page.$('[title="Show sessions"]')
    expect(expandBtn).not.toBeNull()
  })

  it('can expand LeftPanel via expand button', async () => {
    const expandBtn = await page.$('[title="Show sessions"]')
    expect(expandBtn).not.toBeNull()
    await expandBtn!.click()
    await page.waitForTimeout(500)
    const toggleButtons = await page.$$('[title="Sessions"], [title="Skills"], [title="MCP"], [title="Settings"]')
    expect(toggleButtons.length).toBe(4)
    const text = await page.textContent('#root')
    expect(text).toContain('No sessions found')
  })

  it('can toggle RightPanel open via header button', async () => {
    const expandButton = await page.$('[title="Show file explorer"]')
    expect(expandButton).not.toBeNull()
    await expandButton!.click()
    await page.waitForTimeout(500)
    const text = await page.textContent('#root')
    expect(text).toContain('No files found')
  })

  it('RightPanel has collapse button when open', async () => {
    const collapseBtns = await page.$$('[title="Collapse panel"]')
    expect(collapseBtns.length).toBeGreaterThanOrEqual(1)
  })
})

import { chromium, type Browser } from 'playwright'

export interface ScreenshotOptions {
  url: string
  selector?: string
  fullPage?: boolean
  width?: number
  height?: number
}

export interface ScreenshotResult {
  image: string // base64 encoded PNG
  mimeType: 'image/png'
  width: number
  height: number
}

export class ScreenshotServer {
  private browser: Browser | null = null
  private launching: Promise<Browser> | null = null

  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser
    }
    if (this.launching) {
      return this.launching
    }
    this.launching = chromium.launch({ headless: true }).then((browser) => {
      this.browser = browser
      this.launching = null
      return browser
    })
    return this.launching
  }

  async capture(options: ScreenshotOptions): Promise<ScreenshotResult> {
    const browser = await this.getBrowser()
    const context = await browser.newContext({
      viewport: { width: options.width ?? 1280, height: options.height ?? 800 }
    })
    const page = await context.newPage()

    try {
      await page.goto(options.url, { waitUntil: 'networkidle', timeout: 15000 })

      // Wait a bit for any lazy-loaded content
      await page.waitForTimeout(500)

      const target = options.selector
        ? page.locator(options.selector).first()
        : page

      const screenshotBuffer = await target.screenshot({
        fullPage: options.fullPage ?? false,
        type: 'png'
      })

      const size = await target.boundingBox()

      return {
        image: screenshotBuffer.toString('base64'),
        mimeType: 'image/png',
        width: size?.width ?? options.width ?? 1280,
        height: size?.height ?? options.height ?? 800
      }
    } finally {
      await context.close()
    }
  }

  async captureLocalFile(
    filePath: string,
    options?: Omit<ScreenshotOptions, 'url'>
  ): Promise<ScreenshotResult> {
    const absolutePath = filePath.startsWith('/') ? filePath : `${process.cwd()}/${filePath}`
    const fileUrl = `file://${absolutePath}`
    return this.capture({ url: fileUrl, ...options })
  }

  async dispose(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}

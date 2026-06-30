import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { useTheme } from '../hooks/useTheme'

interface FileViewerProps {
  filePath: string
  scrollToLine?: number
}

interface FileData {
  content: string
  name: string
  ext: string
  path: string
}

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  json: 'json', md: 'markdown', css: 'css', html: 'html',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  rb: 'ruby', sh: 'bash', bash: 'bash', yaml: 'yaml', yml: 'yaml',
  toml: 'toml', xml: 'xml', sql: 'sql', graphql: 'graphql',
  vue: 'vue', svelte: 'svelte', c: 'c', cpp: 'cpp', h: 'c',
  hpp: 'cpp', cs: 'csharp', swift: 'swift', kt: 'kotlin',
  scala: 'scala', r: 'r', lua: 'lua', dart: 'dart',
  dockerfile: 'docker', makefile: 'makefile',
}

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx'])

const scrollPositions = new Map<string, number>()

function getShikiLang(ext: string): string | undefined {
  return LANG_MAP[ext.toLowerCase()]
}

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

export default function FileViewer({ filePath, scrollToLine }: FileViewerProps) {
  const [fileData, setFileData] = useState<FileData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()

  const loadFile = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    setFileData(null)
    setHighlightedHtml(null)
    setShowSource(false)
    try {
      const result = await window.api.readFile(path)
      if (result.ok && result.data) {
        setFileData(result.data)
      } else {
        setError(result.error ?? 'Failed to read file')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFile(filePath)
  }, [filePath, loadFile])

  useEffect(() => {
    if (!fileData) return
    if (isBinaryExt(fileData.ext ?? '') || MARKDOWN_EXTS.has(fileData.ext ?? '')) return

    const lang = getShikiLang(fileData.ext ?? '')
    let cancelled = false;

    (async () => {
      try {
        const { codeToHtml } = await import('shiki')
        if (cancelled) return
        const html = await codeToHtml(fileData.content, {
          lang: lang ?? 'plaintext',
          theme: resolvedTheme === 'dark' ? 'github-dark' : 'github-light',
          transformers: [
            {
              name: 'line-numbers',
              line(node, line) {
                node.properties = node.properties || {}
                node.properties['data-line'] = line
              },
            },
          ],
        })
        if (!cancelled) {
          setHighlightedHtml(html)
        }
      } catch (err) {
        console.warn('shiki highlight failed:', err)
        if (!cancelled) {
          setHighlightedHtml(null)
        }
      }
    })()

    return () => { cancelled = true }
  }, [fileData, resolvedTheme])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const saved = scrollPositions.get(filePath)
    if (saved != null) {
      el.scrollTop = saved
    }
    const handleScroll = () => {
      scrollPositions.set(filePath, el.scrollTop)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [filePath, highlightedHtml, fileData])

  useEffect(() => {
    if (scrollToLine == null || !containerRef.current) return
    let attempts = 0
    const maxAttempts = 10
    function tryScroll() {
      if (!containerRef.current) return
      const el = containerRef.current.querySelector(`[data-line="${scrollToLine}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('line-flash')
        setTimeout(() => el.classList.remove('line-flash'), 2000)
      } else if (attempts < maxAttempts) {
        attempts++
        requestAnimationFrame(tryScroll)
      }
    }
    const raf = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(raf)
  }, [scrollToLine, highlightedHtml, fileData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        {error}
      </div>
    )
  }

  if (!fileData) return null

  if (isBinaryExt(fileData.ext)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span>Binary file — cannot display</span>
      </div>
    )
  }

  const isMarkdown = MARKDOWN_EXTS.has(fileData.ext)
  const lines = fileData.content.split('\n')
  const lineCount = lines.length

  return (
    <div className="flex flex-col h-full">
      {isMarkdown && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-gray-50">
          <span className="text-xs text-gray-500">Markdown</span>
          <button
            onClick={() => setShowSource(!showSource)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
            title={showSource ? 'Switch to preview' : 'View raw source'}
          >
            {showSource ? 'Preview' : '</> Source'}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto" ref={containerRef}>
        {isMarkdown ? (
          showSource ? (
            <pre className="text-xs leading-5 font-mono p-4 whitespace-pre overflow-x-auto">{fileData.content}</pre>
          ) : (
            <div className="prose prose-sm max-w-none p-4 [&_img]:max-w-full [&_img]:rounded">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{ a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); if (href) window.api.openExternal(href) }}
              >
                {children}
              </a>
            ) }}>{fileData.content}</ReactMarkdown>
            </div>
          )
        ) : highlightedHtml ? (
          <div
            className="shiki-highlight"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="text-xs leading-5 font-mono">
            <code>
              {lines.map((line, i) => (
                <div key={i} className="flex hover:bg-gray-50" data-line={i + 1}>
                  <span
                    className="flex-shrink-0 text-right text-gray-300 select-none pr-4 pl-4 sticky left-0 bg-gray-50"
                    style={{ minWidth: `${String(lineCount).length + 2}ch` }}
                  >
                    {i + 1}
                  </span>
                  <span className="whitespace-pre text-gray-800">{line}</span>
                </div>
              ))}
            </code>
          </pre>
        )}
      </div>
    </div>
  )
}

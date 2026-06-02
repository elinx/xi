import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

interface FileViewerProps {
  filePath: string
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

export default function FileViewer({ filePath }: FileViewerProps) {
  const [fileData, setFileData] = useState<FileData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  const loadFile = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    setFileData(null)
    setHighlightedHtml(null)
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
          theme: 'github-light',
          transformers: [
            {
              name: 'line-numbers',
              line(node, line) {
                node.properties = node.properties || {}
                node.properties.style = `counter-increment: line;`
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
  }, [fileData])

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
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{fileData.name}</span>
        <span className="text-gray-400">{getLanguageLabel(fileData.ext)}</span>
        {!isMarkdown && <span className="text-gray-400">{lineCount} lines</span>}
        <span className="text-gray-300 truncate ml-2" title={fileData.path}>{fileData.path}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {isMarkdown ? (
          <div className="prose prose-sm max-w-none p-4 [&_img]:max-w-full [&_img]:rounded">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{fileData.content}</ReactMarkdown>
          </div>
        ) : highlightedHtml ? (
          <div
            className="shiki-highlight"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="text-xs leading-5 font-mono">
            <code>
              {lines.map((line, i) => (
                <div key={i} className="flex hover:bg-gray-50">
                  <span
                    className="flex-shrink-0 text-right text-gray-300 select-none pr-4 pl-4 sticky left-0 bg-white"
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

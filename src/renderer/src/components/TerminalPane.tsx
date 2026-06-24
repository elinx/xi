import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '../hooks/useTheme'

const ptyInstances = new Set<string>()

const darkXtermTheme = {
  background: '#1e2026',
  foreground: '#e5e7eb',
  cursor: '#36d399',
  cursorAccent: '#1e2026',
  selectionBackground: 'rgba(54, 211, 153, 0.25)',
  selectionForeground: '#e5e7eb',
  black: '#1e2026',
  red: '#e06c75',
  green: '#36d399',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#36d399',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
}

const lightXtermTheme = {
  background: '#ffffff',
  foreground: '#374151',
  cursor: '#3b82f6',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(59, 130, 246, 0.15)',
  black: '#374151',
  red: '#dc2626',
  green: '#059669',
  yellow: '#d97706',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#f9fafb',
  brightBlack: '#6b7280',
  brightRed: '#ef4444',
  brightGreen: '#10b981',
  brightYellow: '#f59e0b',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#111827',
}

interface TerminalPaneProps {
  ptyId: string
}

export default function TerminalPane({ ptyId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const { resolvedTheme } = useTheme()

  const handleResize = useCallback(() => {
    if (fitAddonRef.current && termRef.current) {
      try {
        fitAddonRef.current.fit()
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims) {
          window.api.terminalResize(ptyId, dims.cols, dims.rows)
        }
      } catch {}
    }
  }, [ptyId])

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: resolvedTheme === 'dark' ? darkXtermTheme : lightXtermTheme,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    if (!ptyInstances.has(ptyId)) {
      ptyInstances.add(ptyId)
      window.api.terminalCreate(ptyId)
    }

    const dims = fitAddon.proposeDimensions()
    if (dims) {
      window.api.terminalResize(ptyId, dims.cols, dims.rows)
    }

    const unsubData = window.api.onTerminalData((id, data) => {
      if (id === ptyId) {
        term.write(data)
      }
    })

    const unsubExit = window.api.onTerminalExit((id) => {
      if (id === ptyId) {
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
      }
    })

    const disposable = term.onData((data) => {
      window.api.terminalWrite(ptyId, data)
    })

    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(container)

    return () => {
      disposable.dispose()
      unsubData()
      unsubExit()
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [ptyId, handleResize])

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = resolvedTheme === 'dark' ? darkXtermTheme : lightXtermTheme
    }
  }, [resolvedTheme])

  return (
    <div ref={containerRef} className={`h-full w-full ${resolvedTheme === 'dark' ? 'bg-[#1e2026]' : 'bg-white'}`} />
  )
}

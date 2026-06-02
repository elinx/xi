import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalPaneProps {
  ptyId: string
}

export default function TerminalPane({ ptyId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

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
      theme: {
        background: '#f8f8f8',
        foreground: '#383a42',
        cursor: '#526eff',
        cursorAccent: '#f8f8f8',
        selectionBackground: '#add6ff',
        selectionForeground: '#383a42',
        black: '#383a42',
        red: '#e45649',
        green: '#50a14f',
        yellow: '#c18401',
        blue: '#4078f2',
        magenta: '#a626a4',
        cyan: '#0184bc',
        white: '#a0a1a7',
        brightBlack: '#4f525e',
        brightRed: '#e06c75',
        brightGreen: '#98c379',
        brightYellow: '#e5c07b',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#ffffff',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    window.api.terminalCreate(ptyId)

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
      window.api.terminalKill(ptyId)
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [ptyId, handleResize])

  return (
    <div ref={containerRef} className="h-full w-full bg-[#f8f8f8]" />
  )
}

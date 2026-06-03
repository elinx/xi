import { useState, useCallback, useRef } from 'react'
import type { FileEntry } from './useFileIndex'

export interface MentionItem {
  type: 'file'
  path: string
  name: string
}

interface FileMentionState {
  open: boolean
  query: string
  triggerStart: number
  filteredFiles: FileEntry[]
  selectedIndex: number
}

const MAX_RESULTS = 20

function filterFiles(files: FileEntry[], query: string): FileEntry[] {
  if (!query) return files.filter(f => !f.isDirectory).slice(0, MAX_RESULTS)
  const q = query.toLowerCase()
  return files
    .filter(f => !f.isDirectory)
    .filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.relativePath.toLowerCase().includes(q)
    )
    .slice(0, MAX_RESULTS)
}

export function useFileMention(files: FileEntry[]) {
  const [state, setState] = useState<FileMentionState>({
    open: false,
    query: '',
    triggerStart: -1,
    filteredFiles: [],
    selectedIndex: 0,
  })
  const [mentions, setMentions] = useState<MentionItem[]>([])
  const filesRef = useRef(files)
  filesRef.current = files
  const stateRef = useRef(state)
  stateRef.current = state

  const close = useCallback(() => {
    setState({ open: false, query: '', triggerStart: -1, filteredFiles: [], selectedIndex: 0 })
  }, [])

  const onTextInput = useCallback((value: string, cursorPos: number) => {
    const textBeforeCursor = value.substring(0, cursorPos)
    const atPos = textBeforeCursor.lastIndexOf('@')
    if (atPos === -1) { close(); return }

    if (atPos > 0 && /\w/.test(value[atPos - 1])) { close(); return }

    const query = textBeforeCursor.substring(atPos + 1)
    if (query.includes(' ')) { close(); return }

    const filtered = filterFiles(filesRef.current, query)
    setState({
      open: true,
      query,
      triggerStart: atPos,
      filteredFiles: filtered,
      selectedIndex: 0,
    })
  }, [close])

  const onKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    const s = stateRef.current
    if (!s.open) return false

    switch (e.key) {
      case 'ArrowUp': {
        e.preventDefault()
        setState(prev => ({ ...prev, selectedIndex: Math.max(0, prev.selectedIndex - 1) }))
        return true
      }
      case 'ArrowDown': {
        e.preventDefault()
        setState(prev => ({ ...prev, selectedIndex: Math.min(prev.filteredFiles.length - 1, prev.selectedIndex + 1) }))
        return true
      }
      case 'Enter':
      case 'Tab': {
        if (s.filteredFiles.length > 0) {
          e.preventDefault()
          const file = s.filteredFiles[s.selectedIndex]
          setMentions(m => [...m, { type: 'file', path: file.path, name: file.name }])
        }
        setState({ open: false, query: '', triggerStart: -1, filteredFiles: [], selectedIndex: 0 })
        return true
      }
      case 'Escape': {
        e.preventDefault()
        setState({ open: false, query: '', triggerStart: -1, filteredFiles: [], selectedIndex: 0 })
        return true
      }
    }
    return false
  }, [])

  const selectItem = useCallback((file: FileEntry) => {
    setMentions(m => [...m, { type: 'file', path: file.path, name: file.name }])
    setState({ open: false, query: '', triggerStart: -1, filteredFiles: [], selectedIndex: 0 })
  }, [])

  const popMention = useCallback(() => {
    setMentions(m => m.slice(0, -1))
  }, [])

  const clearMentions = useCallback(() => setMentions([]), [])

  return {
    ...state,
    onTextInput,
    onKeyDown,
    selectItem,
    close,
    mentions,
    popMention,
    clearMentions,
  }
}

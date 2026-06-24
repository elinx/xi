import { useRef, useEffect } from 'react'
import type { FileEntry } from '../hooks/useFileIndex'

interface FileMentionDropdownProps {
  files: FileEntry[]
  selectedIndex: number
  onSelect: (file: FileEntry) => void
  visible: boolean
}

export default function FileMentionDropdown({ files, selectedIndex, onSelect, visible }: FileMentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!listRef.current || !visible) return
    const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, visible])

  if (!visible || files.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 mb-1 w-full max-h-[240px] overflow-y-auto xi-glass rounded-lg z-50 py-1">
      {files.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-400">No files found</div>
      ) : (
        files.map((file, i) => (
          <button
            key={file.path}
            ref={i === selectedIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors duration-150 ${
              i === selectedIndex
                ? 'bg-blue-50 text-blue-900'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => onSelect(file)}
            onMouseEnter={() => {}}
          >
            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span className="truncate">{file.relativePath}</span>
          </button>
        ))
      )}
    </div>
  )
}

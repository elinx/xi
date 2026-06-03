import { useState, useEffect, useCallback, useMemo } from 'react'
import { Command } from 'cmdk'
import type { FileEntry } from '../hooks/useFileIndex'
import type { CommandItem } from '../hooks/useCommandRegistry'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: FileEntry[]
  filesLoading: boolean
  sessions: Array<{ name: string; filePath: string; isCurrent: boolean }>
  commands: CommandItem[]
  onFileSelect: (filePath: string) => void
  onSessionSelect: (sessionPath: string) => void
}

const HIDDEN_DIRS = new Set(['node_modules', '.git', '.pi', 'out', 'dist', '.DS_Store'])

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
    </svg>
  )
}

function SessionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  )
}

function CommandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  )
}

export default function CommandPalette({
  open,
  onOpenChange,
  files,
  filesLoading,
  sessions,
  commands,
  onFileSelect,
  onSessionSelect,
}: CommandPaletteProps) {
  const [search, setSearch] = useState('')

  const isCommandMode = search.startsWith('>')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const handleFileSelect = useCallback((filePath: string) => {
    onFileSelect(filePath)
    onOpenChange(false)
  }, [onFileSelect, onOpenChange])

  const handleSessionSelect = useCallback((sessionPath: string) => {
    onSessionSelect(sessionPath)
    onOpenChange(false)
  }, [onSessionSelect, onOpenChange])

  const handleCommandSelect = useCallback((commandId: string) => {
    const cmd = commands.find(c => c.id === commandId)
    if (cmd) cmd.action()
    onOpenChange(false)
  }, [commands, onOpenChange])

  const fileItems = useMemo(() => {
    if (isCommandMode) return []
    return files.filter(f => !f.isDirectory && !HIDDEN_DIRS.has(f.name))
  }, [files, isCommandMode])

  const dirItems = useMemo(() => {
    if (isCommandMode) return []
    return files.filter(f => f.isDirectory && !HIDDEN_DIRS.has(f.name))
  }, [files, isCommandMode])

  const sortedSessions = useMemo(() => {
    if (isCommandMode) return []
    return [...sessions].sort((a, b) => {
      if (a.isCurrent) return -1
      if (b.isCurrent) return 1
      return 0
    })
  }, [sessions, isCommandMode])

  const commandGroups = useMemo(() => {
    if (!isCommandMode) return []
    const groups: Record<string, CommandItem[]> = {}
    for (const cmd of commands) {
      if (!groups[cmd.group]) groups[cmd.group] = []
      groups[cmd.group].push(cmd)
    }
    return Object.entries(groups).map(([group, items]) => ({ group, items }))
  }, [commands, isCommandMode])

  const commandSearch = isCommandMode ? search.slice(1).trim() : search

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command Palette"
      filter={(value, search) => {
        const s = search.toLowerCase()
        const v = value.toLowerCase()
        if (v.includes(s)) return 1
        return 0
      }}
      loop
      className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh]"
    >
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative w-[560px] max-h-[min(480px,60vh)] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
        <div className="flex items-center border-b border-gray-200 px-4">
          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder={isCommandMode ? 'Type a command...' : 'Search files, sessions, or type > for commands...'}
            className="flex-1 px-3 py-3 text-sm text-gray-900 placeholder-gray-400 bg-transparent outline-none"
          />
        </div>

        <Command.List className="flex-1 overflow-y-auto py-1">
          <Command.Empty className="px-4 py-8 text-center text-sm text-gray-400">
            {filesLoading ? 'Loading files...' : 'No results found'}
          </Command.Empty>

          {!isCommandMode && sortedSessions.length > 0 && (
            <Command.Group heading="Sessions" className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-gray-400 [&_[cmdk-group-heading]]:tracking-wider">
              {sortedSessions.map((s) => (
                <Command.Item
                  key={s.filePath}
                  value={`session:${s.name}:${s.filePath}`}
                  onSelect={() => handleSessionSelect(s.filePath)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 cursor-pointer data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-900"
                >
                  <SessionIcon className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="truncate flex-1">{s.name || 'Untitled'}</span>
                  {s.isCurrent && <span className="text-[10px] text-blue-500 font-medium shrink-0">current</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {!isCommandMode && dirItems.length > 0 && (
            <Command.Group heading="Folders" className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-gray-400 [&_[cmdk-group-heading]]:tracking-wider">
              {dirItems.slice(0, 10).map((f) => (
                <Command.Item
                  key={f.path}
                  value={`folder:${f.relativePath}`}
                  keywords={[f.name, f.relativePath]}
                  onSelect={() => {}}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 cursor-pointer data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-900"
                >
                  <FolderIcon className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="truncate flex-1">{f.relativePath}</span>
                  <span className="text-gray-300 shrink-0">→</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {!isCommandMode && fileItems.length > 0 && (
            <Command.Group heading="Files" className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-gray-400 [&_[cmdk-group-heading]]:tracking-wider">
              {fileItems.slice(0, 30).map((f) => (
                <Command.Item
                  key={f.path}
                  value={`file:${f.relativePath}`}
                  keywords={[f.name, f.relativePath]}
                  onSelect={() => handleFileSelect(f.path)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 cursor-pointer data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-900"
                >
                  <FileIcon className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="truncate flex-1">{f.relativePath}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {isCommandMode && commandGroups.map(({ group, items }) => (
            <Command.Group
              key={group}
              heading={group}
              className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-gray-400 [&_[cmdk-group-heading]]:tracking-wider"
            >
              {items.map((cmd) => (
                <Command.Item
                  key={cmd.id}
                  value={`cmd:${cmd.label}:${cmd.id}`}
                  keywords={cmd.keywords}
                  onSelect={() => handleCommandSelect(cmd.id)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 cursor-pointer data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-900"
                >
                  <CommandIcon className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="truncate flex-1">{cmd.label}</span>
                  {cmd.shortcut && (
                    <kbd className="text-[10px] text-gray-400 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 font-mono shrink-0">
                      {cmd.shortcut}
                    </kbd>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>

        <div className="border-t border-gray-100 px-4 py-1.5 text-[11px] text-gray-400 flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          {!isCommandMode && <span>{'>'} commands</span>}
        </div>
      </div>
    </Command.Dialog>
  )
}

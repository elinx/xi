import FileTree from './FileTree'

interface RightPanelProps {
  view: 'files' | 'git'
  onViewChange: (view: 'files' | 'git') => void
  collapsed: boolean
  onToggleCollapse: () => void
  width: number
  onResizeStart: (e: React.MouseEvent) => void
  onFileSelect: (filePath: string) => void
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-16.5 0h16.5m-16.5 0A2.25 2.25 0 003 15v3.75A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V15a2.25 2.25 0 00-1.5-2.25m-16.5 0V6A2.25 2.25 0 015.25 3.75h5.379a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18.75A2.25 2.25 0 0121 9v.75" />
    </svg>
  )
}

function GitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path strokeLinecap="round" d="M12 8v8" />
      <path strokeLinecap="round" d="M16.5 12H14" />
    </svg>
  )
}

function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

export default function RightPanel({
  view,
  onViewChange,
  collapsed,
  onToggleCollapse,
  width,
  onResizeStart,
  onFileSelect,
}: RightPanelProps) {
  if (collapsed) return null

  return (
    <div
      className="relative border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden"
      style={{ width: `${width}px` }}
    >
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:w-1.5 hover:bg-blue-500/30 transition-all z-10"
        onMouseDown={onResizeStart}
      />

      <div className="h-8 flex items-center px-2 border-b border-gray-200 gap-1">
        <button
          onClick={() => onViewChange('files')}
          className={view === 'files' ? 'bg-gray-200 text-gray-900 rounded p-1' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded p-1'}
          title="Files"
        >
          <FolderIcon className="w-4 h-4" />
        </button>
        <button
          onClick={() => onViewChange('git')}
          className={view === 'git' ? 'bg-gray-200 text-gray-900 rounded p-1' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded p-1'}
          title="Git"
        >
          <GitIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {view === 'files' ? (
          <FileTree onFileSelect={onFileSelect} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            Git status — coming soon
          </div>
        )}
      </div>
    </div>
  )
}

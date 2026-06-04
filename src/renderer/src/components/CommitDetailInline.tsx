import type { CommitDetail, FileChange } from '../types/git'

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'M': return 'bg-amber-50 text-amber-600'
    case 'A': return 'bg-green-50 text-green-600'
    case 'D': return 'bg-red-50 text-red-600'
    case 'R': return 'bg-blue-50 text-blue-600'
    case 'C': return 'bg-purple-50 text-purple-600'
    default: return 'bg-gray-50 text-gray-500'
  }
}

function statusBadgeLabel(status: string): string {
  switch (status) {
    case 'M': return 'M'
    case 'A': return 'A'
    case 'D': return 'D'
    case 'R': return 'R'
    case 'C': return 'C'
    default: return status
  }
}

function FileChangeItem({
  file,
  onFileSelect,
}: {
  file: FileChange
  onFileSelect: (filePath: string) => void
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-0.5 px-2 hover:bg-gray-50 cursor-pointer rounded group"
      onClick={() => onFileSelect(file.path)}
      title={file.path}
    >
      <span className={`px-1 py-0 rounded text-[10px] font-mono font-semibold ${statusBadgeColor(file.status)}`}>
        {statusBadgeLabel(file.status)}
      </span>
      <span className="flex-1 truncate text-gray-600 group-hover:text-gray-900 transition-colors">
        {file.path}
      </span>
      <span className="text-[10px] text-gray-300 flex-shrink-0">
        {file.additions > 0 && <span className="text-green-500">+{file.additions}</span>}
        {file.additions > 0 && file.deletions > 0 && <span className="text-gray-300">/</span>}
        {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
      </span>
      <svg
        className="w-3 h-3 text-gray-300 group-hover:text-gray-500 flex-shrink-0 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </div>
  )
}

export default function CommitDetailInline({
  hash,
  detail,
  loading,
  onFileSelect,
  onClose,
}: {
  hash: string
  detail: CommitDetail | null
  loading: boolean
  onFileSelect: (filePath: string) => void
  onClose: () => void
}) {
  return (
    <div className="border-t border-b border-gray-200 bg-gray-50/50">
      {/* Header with close button */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="font-mono text-[10px] text-gray-400">{hash}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
          title="Close"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loading && (
        <div className="px-3 pb-2 text-gray-400 text-[10px]">Loading details...</div>
      )}

      {!loading && detail && (
        <div className="px-3 pb-2">
          {/* Full message */}
          {detail.body && (
            <div className="text-gray-500 text-[11px] mt-0.5 mb-1 whitespace-pre-wrap">
              {detail.body}
            </div>
          )}

          {/* Author & date */}
          <div className="text-[10px] text-gray-400 flex items-center gap-2 mb-2">
            <span>{detail.author_name}</span>
            {detail.author_email && (
              <span className="text-gray-300">&lt;{detail.author_email}&gt;</span>
            )}
            <span>·</span>
            <span>{new Date(detail.date).toLocaleString()}</span>
          </div>

          {/* Changed files */}
          {detail.files.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 font-medium mb-1">
                Changed files ({detail.files.length})
              </div>
              <div className="space-y-0.5">
                {detail.files.map((file) => (
                  <FileChangeItem
                    key={file.path}
                    file={file}
                    onFileSelect={onFileSelect}
                  />
                ))}
              </div>
            </div>
          )}

          {detail.files.length === 0 && (
            <div className="text-[10px] text-gray-400">No file changes in this commit</div>
          )}
        </div>
      )}

      {!loading && !detail && (
        <div className="px-3 pb-2 text-gray-400 text-[10px]">Failed to load commit details</div>
      )}
    </div>
  )
}

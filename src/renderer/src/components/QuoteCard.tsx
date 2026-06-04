export interface QuotedMessage {
  messageId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface QuoteCardProps {
  quotes: QuotedMessage[]
  onRemove: (messageId: string) => void
  onClear: () => void
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

export default function QuoteCard({ quotes, onRemove, onClear }: QuoteCardProps) {
  if (quotes.length === 0) return null

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 pt-2 pb-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
          {quotes.length} quoted {quotes.length === 1 ? 'message' : 'messages'}
        </span>
        <button
          onClick={onClear}
          className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
        >
          Clear all
        </button>
      </div>
      <div className="space-y-1">
        {quotes.map((q) => (
          <div
            key={q.messageId}
            className="flex items-start gap-2 rounded-md bg-white border border-gray-200 px-2 py-1.5 text-xs"
          >
            <svg className="w-3 h-3 text-gray-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] text-gray-400">
                {q.role === 'user' ? 'You' : 'Pi'} · {relativeTime(q.timestamp)}
              </span>
              <p className="text-gray-600 line-clamp-2 leading-4 mt-0.5">{q.content}</p>
            </div>
            <button
              onClick={() => onRemove(q.messageId)}
              className="text-gray-300 hover:text-gray-500 transition-colors cursor-pointer shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

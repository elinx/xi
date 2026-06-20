import { useState } from 'react'

interface SkillBlockProps {
  name: string
  location: string
  content: string
  userMessage?: string
}

export default function SkillBlockRenderer({ name, location, content, userMessage }: SkillBlockProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-1 rounded border-l-2 border-amber-400 bg-amber-50 overflow-hidden">
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-amber-400 hover:bg-amber-100 transition-colors duration-150"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="font-medium">skill:{name}</span>
        <span className="text-amber-500 text-[10px] truncate">{location}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs">
          <pre className="whitespace-pre-wrap text-amber-300 leading-relaxed font-mono text-[11px] max-h-[300px] overflow-y-auto">
            {content}
          </pre>
          {userMessage && (
            <div className="mt-2 pt-2 border-t border-amber-200 text-amber-400">
              <span className="text-[10px] font-medium text-amber-500">Args:</span> {userMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

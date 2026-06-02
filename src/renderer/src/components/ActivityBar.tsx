import type { ReactNode } from 'react'
import type { LeftPanelView } from '../hooks/useLayoutStore'

interface ActivityBarProps {
  activeView: LeftPanelView
  onViewChange: (view: LeftPanelView) => void
}

type ActivityView = Extract<LeftPanelView, 'sessions' | 'skills' | 'mcp' | 'settings'>

const views: { id: ActivityView; title: string; icon: ReactNode }[] = [
  {
    id: 'sessions',
    title: 'Sessions',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18v14H7l-4 4V4z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h7" />
      </svg>
    ),
  },
  {
    id: 'skills',
    title: 'Skills',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    id: 'mcp',
    title: 'MCP',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
]

const settingsView: { id: ActivityView; title: string; icon: ReactNode } = {
  id: 'settings',
  title: 'Settings',
  icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
}

function IconButton({
  view,
  activeView,
  onViewChange,
  className = '',
}: {
  view: { id: ActivityView; title: string; icon: ReactNode }
  activeView: ActivityView
  onViewChange: (view: ActivityView) => void
  className?: string
}) {
  const isActive = activeView === view.id
  return (
    <button
      title={view.title}
      onClick={() => onViewChange(view.id)}
      className={`p-3 ${isActive ? 'bg-gray-200 text-gray-900 rounded-lg' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg'} ${className}`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {view.icon}
    </button>
  )
}

export default function ActivityBar({ activeView, onViewChange }: ActivityBarProps) {
  return (
    <div className="w-12 h-full bg-gray-50 border-r border-gray-200 flex flex-col">
      <div className="flex flex-col pt-8">
        {views.map((v, i) => (
          <IconButton
            key={v.id}
            view={v}
            activeView={activeView}
            onViewChange={onViewChange}
          />
        ))}
      </div>
      <div className="mt-auto">
        <IconButton
          view={settingsView}
          activeView={activeView}
          onViewChange={onViewChange}
        />
      </div>
    </div>
  )
}

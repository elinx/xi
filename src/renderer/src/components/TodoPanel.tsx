import type { ChatMessage, TodoItem } from '../types/message'

interface TodoPanelProps {
  messages: ChatMessage[]
}

function extractLatestTodos(messages: ChatMessage[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    for (let j = msg.blocks.length - 1; j >= 0; j--) {
      const block = msg.blocks[j]
      if (block.type === 'tool_result' && block.details?.todos && block.details.todos.length > 0) {
        return block.details.todos
      }
    }
  }
  return null
}

function TodoStatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return (
      <svg className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-px" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-30" />
        <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (status === 'in_progress') {
    return (
      <svg className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-px animate-spin" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25" />
        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )
  }
  return (
    <svg className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-px" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-40" />
    </svg>
  )
}

const priorityDot: Record<TodoItem['priority'], string> = {
  high: 'bg-red-400',
  medium: 'bg-yellow-400',
  low: 'bg-gray-400',
}

const priorityLabel: Record<TodoItem['priority'], string> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
}

export default function TodoPanel({ messages }: TodoPanelProps) {
  const todos = extractLatestTodos(messages)

  if (!todos) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 text-xs gap-2 px-4">
        <span className="text-2xl opacity-40">📋</span>
        <span>No active tasks</span>
        <span className="text-[10px] text-gray-500">Tasks created by the agent will appear here</span>
      </div>
    )
  }

  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length
  const allDone = completed === total
  const progressPct = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${allDone ? 'text-blue-500' : 'text-gray-500'}`}>
            {completed}/{total} {allDone ? '✓ done' : 'tasks'}
          </span>
          <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 bg-blue-500`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {todos.map((todo, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 px-2 py-1.5 rounded text-[11px] font-mono ${
              todo.status === 'in_progress' ? 'bg-blue-50' : ''
            }`}
          >
            <TodoStatusIcon status={todo.status} />
            <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${priorityDot[todo.priority]}`} />
            <span className={
              todo.status === 'completed' ? 'text-gray-400 line-through'
              : todo.status === 'in_progress' ? 'text-blue-500'
              : 'text-gray-600'
            }>{todo.content}</span>
            <span className="ml-auto text-[9px] text-gray-400 mt-px shrink-0">{priorityLabel[todo.priority]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

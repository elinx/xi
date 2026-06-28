import { describe, it, expect } from 'vitest'
import type { TodoItem } from '../src/renderer/src/types/message'

// ── todowrite tool logic (mirrors pi-worker.ts implementation) ──

interface TodoResult {
  content: { type: 'text'; text: string }[]
  details?: { todos: TodoItem[] }
}

function executeTodowrite(params: { todos: TodoItem[] }): TodoResult {
  const todos = params.todos ?? []

  const validStatuses = new Set(['pending', 'in_progress', 'completed'])
  const validPriorities = new Set(['high', 'medium', 'low'])

  for (const t of todos) {
    if (!validStatuses.has(t.status)) {
      return { content: [{ type: 'text', text: `Error: invalid status "${t.status}"` }] }
    }
    if (!validPriorities.has(t.priority)) {
      return { content: [{ type: 'text', text: `Error: invalid priority "${t.priority}"` }] }
    }
  }

  const inProgressCount = todos.filter(t => t.status === 'in_progress').length
  if (inProgressCount > 1) {
    return { content: [{ type: 'text', text: 'Error: at most one todo can be in_progress at a time' }] }
  }

  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length
  const summary = inProgressCount > 0
    ? `Todos updated: ${completed}/${total} completed, 1 in progress`
    : `Todos updated: ${completed}/${total} completed`

  return {
    content: [{ type: 'text', text: summary }],
    details: { todos },
  }
}

// ── convert-messages details extraction (mirrors convert-messages.ts) ──

interface ToolResultBlock {
  type: 'tool_result'
  toolCallId: string
  content: unknown[]
  details?: { todos: TodoItem[] }
}

function extractDetails(toolName: string, details: unknown): ToolResultBlock['details'] {
  return toolName === 'todowrite' && details
    ? { todos: (details as { todos?: TodoItem[] }).todos ?? [] }
    : undefined
}

describe('todowrite tool: validation', () => {
  it('accepts a valid todo list', () => {
    const result = executeTodowrite({
      todos: [
        { content: 'Read file', status: 'pending', priority: 'high' },
        { content: 'Edit file', status: 'in_progress', priority: 'high' },
        { content: 'Run tests', status: 'completed', priority: 'medium' },
      ],
    })

    expect(result.details).toBeDefined()
    expect(result.details!.todos).toHaveLength(3)
    expect(result.content[0].text).toBe('Todos updated: 1/3 completed, 1 in progress')
  })

  it('accepts empty todo list', () => {
    const result = executeTodowrite({ todos: [] })

    expect(result.details).toBeDefined()
    expect(result.details!.todos).toHaveLength(0)
    expect(result.content[0].text).toBe('Todos updated: 0/0 completed')
  })

  it('accepts all completed with no in_progress', () => {
    const result = executeTodowrite({
      todos: [
        { content: 'Step 1', status: 'completed', priority: 'high' },
        { content: 'Step 2', status: 'completed', priority: 'low' },
      ],
    })

    expect(result.details!.todos).toHaveLength(2)
    expect(result.content[0].text).toBe('Todos updated: 2/2 completed')
  })

  it('rejects invalid status', () => {
    const result = executeTodowrite({
      todos: [
        { content: 'Task', status: 'done' as TodoItem['status'], priority: 'high' },
      ],
    })

    expect(result.details).toBeUndefined()
    expect(result.content[0].text).toBe('Error: invalid status "done"')
  })

  it('rejects invalid priority', () => {
    const result = executeTodowrite({
      todos: [
        { content: 'Task', status: 'pending', priority: 'urgent' as TodoItem['priority'] },
      ],
    })

    expect(result.details).toBeUndefined()
    expect(result.content[0].text).toBe('Error: invalid priority "urgent"')
  })

  it('rejects multiple in_progress items', () => {
    const result = executeTodowrite({
      todos: [
        { content: 'Task A', status: 'in_progress', priority: 'high' },
        { content: 'Task B', status: 'in_progress', priority: 'high' },
      ],
    })

    expect(result.details).toBeUndefined()
    expect(result.content[0].text).toBe('Error: at most one todo can be in_progress at a time')
  })

  it('accepts exactly one in_progress', () => {
    const result = executeTodowrite({
      todos: [
        { content: 'Task A', status: 'completed', priority: 'high' },
        { content: 'Task B', status: 'in_progress', priority: 'medium' },
        { content: 'Task C', status: 'pending', priority: 'low' },
      ],
    })

    expect(result.details).toBeDefined()
    expect(result.content[0].text).toContain('1 in progress')
  })

  it('preserves todo order in details', () => {
    const input = [
      { content: 'First', status: 'completed' as const, priority: 'high' as const },
      { content: 'Second', status: 'in_progress' as const, priority: 'medium' as const },
      { content: 'Third', status: 'pending' as const, priority: 'low' as const },
    ]

    const result = executeTodowrite({ todos: input })

    expect(result.details!.todos.map(t => t.content)).toEqual(['First', 'Second', 'Third'])
  })

  it('full replacement — does not merge with previous state', () => {
    const first = executeTodowrite({
      todos: [
        { content: 'Old task', status: 'pending', priority: 'high' },
      ],
    })

    const second = executeTodowrite({
      todos: [
        { content: 'New task', status: 'in_progress', priority: 'high' },
      ],
    })

    expect(second.details!.todos).toHaveLength(1)
    expect(second.details!.todos[0].content).toBe('New task')
    expect(first.details!.todos[0].content).toBe('Old task')
  })
})

describe('todowrite: details extraction from tool results', () => {
  it('extracts todos from todowrite tool result details', () => {
    const todos: TodoItem[] = [
      { content: 'Task 1', status: 'completed', priority: 'high' },
      { content: 'Task 2', status: 'pending', priority: 'low' },
    ]

    const details = extractDetails('todowrite', { todos })

    expect(details).toBeDefined()
    expect(details!.todos).toEqual(todos)
  })

  it('returns undefined for non-todowrite tools', () => {
    const details = extractDetails('bash', { todos: [] })
    expect(details).toBeUndefined()
  })

  it('returns undefined when details is null', () => {
    const details = extractDetails('todowrite', null)
    expect(details).toBeUndefined()
  })

  it('returns undefined when details is undefined', () => {
    const details = extractDetails('todowrite', undefined)
    expect(details).toBeUndefined()
  })

  it('handles missing todos array in details', () => {
    const details = extractDetails('todowrite', { somethingElse: true })
    expect(details).toBeDefined()
    expect(details!.todos).toEqual([])
  })

  it('preserves all status types through extraction', () => {
    const todos: TodoItem[] = [
      { content: 'A', status: 'pending', priority: 'low' },
      { content: 'B', status: 'in_progress', priority: 'medium' },
      { content: 'C', status: 'completed', priority: 'high' },
    ]

    const details = extractDetails('todowrite', { todos })

    expect(details!.todos[0].status).toBe('pending')
    expect(details!.todos[1].status).toBe('in_progress')
    expect(details!.todos[2].status).toBe('completed')
  })

  it('preserves all priority types through extraction', () => {
    const todos: TodoItem[] = [
      { content: 'A', status: 'pending', priority: 'high' },
      { content: 'B', status: 'pending', priority: 'medium' },
      { content: 'C', status: 'pending', priority: 'low' },
    ]

    const details = extractDetails('todowrite', { todos })

    expect(details!.todos.map(t => t.priority)).toEqual(['high', 'medium', 'low'])
  })
})

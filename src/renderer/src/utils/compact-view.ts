import type { ChatMessage, ContentBlock, TextBlock, ImageBlock, HtmlBlock, ToolCallBlock } from '../types/message'

export type ViewMode = 'normal' | 'turn' | 'outline'

export interface ConversationTurn {
  id: string
  index: number
  userMessage: ChatMessage
  assistantMessages: ChatMessage[]
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen - 1) + '\u2026'
}

function firstLine(text: string): string {
  const idx = text.indexOf('\n')
  return idx === -1 ? text : text.substring(0, idx)
}

function textBlockSummary(block: TextBlock): string {
  return firstLine(block.content)
}

function imageBlockSummary(_block: ImageBlock): string {
  void _block
  return '[image]'
}

function htmlBlockSummary(block: HtmlBlock): string {
  return block.title ? `[HTML: ${block.title}]` : '[HTML]'
}

function getUserBlockSummary(block: ContentBlock): string | null {
  switch (block.type) {
    case 'text':
      return textBlockSummary(block)
    case 'image':
      return imageBlockSummary(block)
    case 'html':
      return htmlBlockSummary(block)
    default:
      return null
  }
}

export function getUserSummary(msg: ChatMessage): string {
  const parts: string[] = []
  for (const block of msg.blocks) {
    const s = getUserBlockSummary(block)
    if (s !== null) parts.push(s)
  }
  return truncate(parts.join(' \u00B7 '), 80)
}

export function getAgentSummary(messages: ChatMessage[]): string {
  const toolCounts: Record<string, number> = {}
  let textSummary: string | null = null
  let imageCount = 0
  let htmlCount = 0

  for (const msg of messages) {
    for (const block of msg.blocks) {
      switch (block.type) {
        case 'tool_call': {
          const name = (block as ToolCallBlock).toolName
          toolCounts[name] = (toolCounts[name] || 0) + 1
          break
        }
        case 'text': {
          if (textSummary === null) {
            textSummary = firstLine((block as TextBlock).content)
          }
          break
        }
        case 'image': {
          imageCount++
          break
        }
        case 'html': {
          htmlCount++
          break
        }
        default:
          break
      }
    }
  }

  const parts: string[] = []

  const toolParts = Object.entries(toolCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => count > 1 ? `${name} x${count}` : name)
  if (toolParts.length > 0) {
    parts.push(toolParts.join(', '))
  }

  if (textSummary !== null) {
    parts.push(truncate(textSummary, 80))
  }

  if (imageCount > 0) {
    parts.push(`[${imageCount} image${imageCount > 1 ? 's' : ''}]`)
  }
  if (htmlCount > 0) {
    parts.push(`[${htmlCount} HTML${htmlCount > 1 ? 's' : ''}]`)
  }

  return parts.join(' \u00B7 ')
}

export function groupByTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentUser: ChatMessage | null = null
  let assistantMessages: ChatMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') continue

    if (msg.role === 'user') {
      if (currentUser !== null) {
        turns.push({
          id: currentUser.id,
          index: turns.length + 1,
          userMessage: currentUser,
          assistantMessages,
        })
      }
      currentUser = msg
      assistantMessages = []
    } else if (msg.role === 'assistant') {
      assistantMessages.push(msg)
    }
  }

  if (currentUser !== null) {
    turns.push({
      id: currentUser.id,
      index: turns.length + 1,
      userMessage: currentUser,
      assistantMessages,
    })
  }

  return turns
}

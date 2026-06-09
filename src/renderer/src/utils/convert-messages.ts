/**
 * Shared message conversion utilities.
 *
 * Converts Pi's raw message format (from get_messages RPC or JSONL file parsing)
 * into the renderer's ChatMessage format. Used by both loadHistory() and
 * lazy-switch JSONL loading.
 */
import type {
  ChatMessage,
  ContentBlock,
} from '../types/message'
import type {
  PiContentBlock,
  PiImageContent,
} from '../types/pi-events'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  totalCost: number
  contextWindowSize: number
}

export function inferContextWindow(model: string): number {
  if (!model) return 200000
  const m = model.toLowerCase()
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 128000
  if (m.includes('claude')) return 200000
  if (m.includes('deepseek')) return 1000000
  if (m.includes('gemini')) return 1000000
  if (m.includes('gpt-5')) return 200000
  return 200000
}

const INITIAL_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  contextWindowSize: 200000,
}

export interface ConvertResult {
  messages: ChatMessage[]
  tokenUsage: TokenUsage
  responseIds: string[]
}

/**
 * Convert Pi raw messages (from get_messages RPC or parseSessionMessages)
 * to ChatMessage[] + token usage + response IDs.
 *
 * This is the shared conversion logic extracted from usePiRpc's loadHistory().
 */
export function splitUserContentIntoBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const quoteRe = /^> \[(Quoted|Forwarded) (user|assistant) message(?: from "([^"]*)")?\]:\n((?:> .*\n)*> .*$|(?:> .*\n)*)/gm
  let quoteMatch: RegExpExecArray | null
  let lastEnd = 0
  while ((quoteMatch = quoteRe.exec(content)) !== null) {
    if (quoteMatch.index > lastEnd) {
      const between = content.slice(lastEnd, quoteMatch.index).trim()
      if (between) blocks.push({ type: 'text', content: between })
    }
    const quoteRole = quoteMatch[2] as 'user' | 'assistant'
    const sourceSessionName = quoteMatch[3] || undefined
    const quoteContent = quoteMatch[4].replace(/^> ?/gm, '').trim()
    blocks.push({ type: 'quote', role: quoteRole, content: quoteContent, sourceSessionName })
    lastEnd = quoteMatch.index + quoteMatch[0].length
  }
  const remaining = content.slice(lastEnd).trim()
  if (remaining) {
    blocks.push({ type: 'text', content: remaining })
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'text', content })
  }
  return blocks
}

export function convertPiMessagesToChatMessages(piMessages: unknown[]): ConvertResult {
  const chatMessages: ChatMessage[] = []

  for (const raw of piMessages) {
    const msg = raw as Record<string, unknown>
    const piEntryId = typeof msg.id === 'string' ? msg.id : undefined

    if (msg.role === 'user') {
      const content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content as PiContentBlock[])
              .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
              .map((c) => c.text)
              .join('')
          : ''
      chatMessages.push({
        id: crypto.randomUUID(),
        role: 'user',
        blocks: splitUserContentIntoBlocks(content),
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        piEntryId,
      })
    } else if (msg.role === 'assistant') {
      const blocks: ContentBlock[] = []
      const content = msg.content as PiContentBlock[]
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === 'text') {
            blocks.push({ type: 'text', content: c.text })
          } else if (c.type === 'thinking') {
            blocks.push({ type: 'text', content: c.thinking, subtype: 'thinking' })
          } else if (c.type === 'toolCall') {
            blocks.push({
              type: 'tool_call',
              toolName: c.name,
              toolCallId: c.id,
              args: c.arguments,
              status: 'completed',
            })
          }
        }
      }
      chatMessages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        blocks,
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        piEntryId,
      })
    } else if (msg.role === 'toolResult') {
      const lastAssistant = chatMessages.findLast((m) => m.role === 'assistant')
      if (lastAssistant) {
        const content = msg.content as PiContentBlock[]
        const resultBlocks: ContentBlock[] = []
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === 'text') {
              resultBlocks.push({ type: 'text', content: c.text })
            } else if (c.type === 'image') {
              const img = c as PiImageContent
              resultBlocks.push({
                type: 'image',
                src: `data:${img.mimeType};base64,${img.data}`,
                alt: `Result from ${msg.toolName as string}`,
              })
            }
          }
        }
        if (resultBlocks.length > 0) {
          lastAssistant.blocks.push({
            type: 'tool_result',
            toolCallId: msg.toolCallId as string || '',
            content: resultBlocks,
          })
        }
      }
    }
  }

  // Sum usage across all assistant messages (per-message, not cumulative)
  let restoredUsage: TokenUsage | null = null
  let lastResponseModel = ''
  const responseIds: string[] = []

  for (const raw of piMessages) {
    const msg = raw as Record<string, unknown>
    if (msg.role === 'assistant') {
      const usage = msg.usage as {
        input: number
        output: number
        cacheRead: number
        cacheWrite: number
        totalTokens: number
        cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
      } | undefined
      if (typeof msg.responseModel === 'string') {
        lastResponseModel = msg.responseModel
      }
      if (usage) {
        if (!restoredUsage) {
          restoredUsage = {
            inputTokens: usage.input,
            outputTokens: usage.output,
            cacheReadTokens: usage.cacheRead,
            cacheWriteTokens: usage.cacheWrite,
            totalTokens: usage.totalTokens,
            totalCost: usage.cost.total,
            contextWindowSize: inferContextWindow(lastResponseModel),
          }
        } else {
          const newInput = restoredUsage.inputTokens + usage.input
          const newOutput = restoredUsage.outputTokens + usage.output
          const newCacheRead = restoredUsage.cacheReadTokens + usage.cacheRead
          const newCacheWrite = restoredUsage.cacheWriteTokens + usage.cacheWrite
          restoredUsage = {
            inputTokens: newInput,
            outputTokens: newOutput,
            cacheReadTokens: newCacheRead,
            cacheWriteTokens: newCacheWrite,
            totalTokens: usage.totalTokens,
            totalCost: restoredUsage.totalCost + usage.cost.total,
            contextWindowSize: inferContextWindow(lastResponseModel),
          }
        }
      }
      if (typeof msg.responseId === 'string') {
        responseIds.push(msg.responseId)
      }
    }
  }

  return {
    messages: chatMessages,
    tokenUsage: restoredUsage ?? { ...INITIAL_TOKEN_USAGE },
    responseIds,
  }
}

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
  TodoDetails,
  TodoItem,
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

  // First, detect <skill> XML blocks
  const skillBlockRe = /<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/gm
  let skillMatch: RegExpExecArray | null
  const skillRegions: Array<{ start: number; end: number; block: ContentBlock }> = []
  while ((skillMatch = skillBlockRe.exec(content)) !== null) {
    skillRegions.push({
      start: skillMatch.index,
      end: skillMatch.index + skillMatch[0].length,
      block: {
        type: 'skill',
        name: skillMatch[1],
        location: skillMatch[2],
        content: skillMatch[3],
        userMessage: skillMatch[4]?.trim() || undefined,
      },
    })
  }

  // Build blocks from non-skill regions, then insert skill blocks in order
  const allRegions: Array<{ start: number; end: number; block: ContentBlock | null }> = []
  for (const sr of skillRegions) {
    allRegions.push({ start: sr.start, end: sr.end, block: sr.block })
  }
  allRegions.sort((a, b) => a.start - b.start)

  let pos = 0
  for (const region of allRegions) {
    if (region.start > pos) {
      const between = content.slice(pos, region.start).trim()
      if (between) {
        // Process this text region for quotes
        const subBlocks = splitTextWithQuotes(between)
        blocks.push(...subBlocks)
      }
    }
    if (region.block) {
      blocks.push(region.block)
    }
    pos = region.end
  }
  // Remaining text after last skill region
  if (pos < content.length) {
    const remaining = content.slice(pos).trim()
    if (remaining) {
      const subBlocks = splitTextWithQuotes(remaining)
      blocks.push(...subBlocks)
    }
  }

  // If no skill blocks found, fall through to original quote logic
  if (skillRegions.length === 0) {
    return splitTextWithQuotes(content)
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'text', content })
  }
  return blocks
}

function splitTextWithQuotes(content: string): ContentBlock[] {
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
  let prevContentWasToolCall = false

  for (const raw of piMessages) {
    const msg = raw as Record<string, unknown>
    const piEntryId = typeof msg.id === 'string' ? msg.id : undefined

    if (msg.role === 'user') {
      prevContentWasToolCall = false
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
        for (let i = 0; i < content.length; i++) {
          const c = content[i]
          if (c.type === 'text') {
            const isExplanation = prevContentWasToolCall || (i > 0 && content[i - 1]?.type === 'toolCall')
            blocks.push({ type: 'text', content: c.text, ...(isExplanation ? { subtype: 'explanation' as const } : {}) })
            prevContentWasToolCall = false
          } else if (c.type === 'thinking') {
            blocks.push({ type: 'text', content: c.thinking, subtype: 'thinking' })
            prevContentWasToolCall = false
          } else if (c.type === 'toolCall') {
            blocks.push({
              type: 'tool_call',
              toolName: c.name,
              toolCallId: c.id,
              args: c.arguments,
              status: 'completed',
            })
            prevContentWasToolCall = true
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
      prevContentWasToolCall = true
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
            } else if (c.type === 'html') {
              resultBlocks.push({
                type: 'html',
                content: c.content,
                title: c.title ?? `${msg.toolName as string} result`,
              })
            }
          }
        }
        // Also detect HTML from write tool calls (same logic as streaming path in usePiRpc)
        const matchingToolCall = lastAssistant.blocks.find(
          (b) => b.type === 'tool_call' && (b as { toolCallId: string }).toolCallId === (msg.toolCallId as string)
        )
        if (
          matchingToolCall &&
          matchingToolCall.type === 'tool_call' &&
          msg.toolName === 'write' &&
          matchingToolCall.args &&
          typeof (matchingToolCall.args as Record<string, unknown>).path === 'string' &&
          ((matchingToolCall.args as Record<string, unknown>).path as string).endsWith('.html') &&
          typeof (matchingToolCall.args as Record<string, unknown>).content === 'string'
        ) {
          const args = matchingToolCall.args as Record<string, unknown>
          resultBlocks.push({
            type: 'html',
            content: args.content as string,
            title: (args.path as string).split('/').pop(),
          })
        }
        if (resultBlocks.length > 0) {
          const todoDetails: TodoDetails | undefined =
            msg.toolName === 'todowrite' && msg.details
              ? { todos: ((msg.details as { todos?: TodoItem[] }).todos ?? []) }
              : undefined
          lastAssistant.blocks.push({
            type: 'tool_result',
            toolCallId: msg.toolCallId as string || '',
            content: resultBlocks,
            ...(todoDetails ? { details: todoDetails } : {}),
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

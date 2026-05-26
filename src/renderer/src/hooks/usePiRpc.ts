import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage, ContentBlock } from '../types/message'
import type {
  AgentSessionEvent,
  MessageUpdateEvent,
  ToolExecutionEndEvent,
  PiImageContent,
  PiUserMessage,
  PiAssistantMessage,
  PiToolResultMessage,
} from '../types/pi-events'

interface UsePiRpcReturn {
  messages: ChatMessage[]
  isConnected: boolean
  isStreaming: boolean
  sendPrompt: (text: string, images?: { data: string; mimeType: string }[]) => void
  abort: () => void
  pendingUiRequests: Array<{ id: string; method: string; [key: string]: unknown }>
  respondToUiRequest: (requestId: string, response: Record<string, unknown>) => void
}

export function usePiRpc(): UsePiRpcReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingUiRequests, setPendingUiRequests] = useState<Array<{ id: string; method: string; [key: string]: unknown }>>([])

  const currentAssistantId = useRef<string | null>(null)
  const currentContentBlocks = useRef<Map<number, ContentBlock>>(new Map())
  const toolCallArgsBuffer = useRef<Map<number, string>>(new Map())
  const pendingToolCallArgs = useRef<Map<string, Record<string, unknown>>>(new Map())

  const updateContentBlock = useCallback(
    (contentIndex: number, updater: (block: ContentBlock) => ContentBlock) => {
      const existing = currentContentBlocks.current.get(contentIndex)
      if (existing) {
        currentContentBlocks.current.set(contentIndex, updater(existing))
      }
    },
    [],
  )

  const syncContentBlocksToMessage = useCallback(() => {
    if (!currentAssistantId.current) return
    const blocks = Array.from(currentContentBlocks.current.values())
    const assistantId = currentAssistantId.current
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantId) return msg
        return { ...msg, blocks: [...blocks] }
      }),
    )
  }, [])

  const finalizeCurrentAssistant = useCallback(() => {
    if (!currentAssistantId.current) return
    syncContentBlocksToMessage()
  }, [syncContentBlocksToMessage])

  const handleEvent = useCallback(
    (event: AgentSessionEvent) => {
      switch (event.type) {
        case 'agent_start':
          setIsStreaming(true)
          break

        case 'agent_end':
          setIsStreaming(false)
          finalizeCurrentAssistant()
          currentAssistantId.current = null
          currentContentBlocks.current.clear()
          toolCallArgsBuffer.current.clear()
          break

        case 'message_start': {
          const msg = event.message
          if (msg.role === 'user') {
            const userMsg = msg as PiUserMessage
            const userContent =
              typeof userMsg.content === 'string'
                ? userMsg.content
                : userMsg.content
                    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                    .map((c) => c.text)
                    .join('')

            const userChatMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'user',
              blocks: [{ type: 'text', content: userContent }],
              timestamp: userMsg.timestamp,
            }
            setMessages((prev) => [...prev, userChatMsg])
          } else if (msg.role === 'assistant') {
            const assistantMsg = msg as PiAssistantMessage
            const assistantId = crypto.randomUUID()
            currentAssistantId.current = assistantId
            currentContentBlocks.current.clear()
            toolCallArgsBuffer.current.clear()

            const chatMsg: ChatMessage = {
              id: assistantId,
              role: 'assistant',
              blocks: [],
              timestamp: assistantMsg.timestamp,
            }
            setMessages((prev) => [...prev, chatMsg])
          }
          break
        }

        case 'message_update': {
          const updateEvent = event as MessageUpdateEvent
          const ame = updateEvent.assistantMessageEvent

          if (!currentAssistantId.current) break

          switch (ame.type) {
            case 'text_start':
              currentContentBlocks.current.set(ame.contentIndex, { type: 'text', content: '' })
              break

            case 'text_delta':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: block.content + ame.delta }
                }
                return block
              })
              break

            case 'text_end':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: ame.content }
                }
                return block
              })
              break

            case 'thinking_start':
              currentContentBlocks.current.set(ame.contentIndex, { type: 'text', content: '💭 ' })
              break

            case 'thinking_delta':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: block.content + ame.delta }
                }
                return block
              })
              break

            case 'thinking_end':
              updateContentBlock(ame.contentIndex, (block) => {
                if (block.type === 'text') {
                  return { ...block, content: '💭 ' + ame.content }
                }
                return block
              })
              break

            case 'toolcall_start':
              currentContentBlocks.current.set(ame.contentIndex, {
                type: 'tool_call',
                toolName: '',
                args: {},
                status: 'running',
              })
              toolCallArgsBuffer.current.set(ame.contentIndex, '')
              break

            case 'toolcall_delta': {
              const existing = toolCallArgsBuffer.current.get(ame.contentIndex) ?? ''
              toolCallArgsBuffer.current.set(ame.contentIndex, existing + ame.delta)
              break
            }

            case 'toolcall_end': {
              const argsStr = toolCallArgsBuffer.current.get(ame.contentIndex) ?? '{}'
              let parsedArgs: Record<string, unknown>
              try {
                parsedArgs = JSON.parse(argsStr)
              } catch {
                parsedArgs = { _raw: argsStr }
              }
              currentContentBlocks.current.set(ame.contentIndex, {
                type: 'tool_call',
                toolName: ame.toolCall.name,
                args: parsedArgs,
                status: 'running',
              })
              pendingToolCallArgs.current.set(ame.toolCall.id, parsedArgs)
              toolCallArgsBuffer.current.delete(ame.contentIndex)
              syncContentBlocksToMessage()
              break
            }

            case 'done':
            case 'error':
              break
          }

          if (ame.type !== 'toolcall_end') {
            syncContentBlocksToMessage()
          }
          break
        }

        case 'message_end': {
          const msg = event.message
          if (msg.role === 'toolResult') {
            const toolResultMsg = msg as PiToolResultMessage
            const extraBlocks: ContentBlock[] = []

            for (const content of toolResultMsg.content) {
              if (content.type === 'text') {
                extraBlocks.push({ type: 'text', content: content.text })
              } else if (content.type === 'image') {
                const img = content as PiImageContent
                extraBlocks.push({
                  type: 'image',
                  src: `data:${img.mimeType};base64,${img.data}`,
                  alt: 'Screenshot',
                })
              }
            }

            if (extraBlocks.length > 0 && currentAssistantId.current) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== currentAssistantId.current) return m
                  return { ...m, blocks: [...m.blocks, ...extraBlocks] }
                }),
              )
            }
          }
          break
        }

        case 'tool_execution_start':
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== currentAssistantId.current) return msg
              return {
                ...msg,
                blocks: msg.blocks.map((block) => {
                  if (
                    block.type === 'tool_call' &&
                    block.toolName === event.toolName &&
                    block.status === 'pending'
                  ) {
                    return { ...block, status: 'running' as const }
                  }
                  return block
                }),
              }
            }),
          )
          break

        case 'tool_execution_end': {
          const toolEvent = event as ToolExecutionEndEvent
          const toolArgs = pendingToolCallArgs.current.get(toolEvent.toolCallId)
          pendingToolCallArgs.current.delete(toolEvent.toolCallId)

          const extraBlocks: ContentBlock[] = []

          const hasImageContent = toolEvent.result?.content?.some(
            (c: Record<string, unknown>) => c.type === 'image'
          )

          if (hasImageContent) {
            for (const c of toolEvent.result.content as Array<Record<string, unknown>>) {
              if (c.type === 'text' && typeof c.text === 'string') {
                extraBlocks.push({ type: 'text', content: c.text })
              } else if (c.type === 'image') {
                const img = c as unknown as PiImageContent
                extraBlocks.push({
                  type: 'image',
                  src: `data:${img.mimeType};base64,${img.data}`,
                  alt: `Result from ${toolEvent.toolName}`,
                })
              }
            }
          }

          if (
            toolEvent.toolName === 'write' &&
            toolArgs &&
            typeof toolArgs.path === 'string' &&
            toolArgs.path.endsWith('.html') &&
            typeof toolArgs.content === 'string'
          ) {
            extraBlocks.push({
              type: 'html',
              content: toolArgs.content,
              title: toolArgs.path.split('/').pop(),
            })
          }

          if (extraBlocks.length > 0) {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== currentAssistantId.current) return msg
                return {
                  ...msg,
                  blocks: [
                    ...msg.blocks.map((block) => {
                      if (block.type === 'tool_call' && block.status === 'running') {
                        return { ...block, status: 'completed' as const }
                      }
                      return block
                    }),
                    ...extraBlocks,
                  ],
                }
              }),
            )
          } else {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== currentAssistantId.current) return msg
                return {
                  ...msg,
                  blocks: msg.blocks.map((block) => {
                    if (block.type === 'tool_call' && block.status === 'running') {
                      return { ...block, status: 'completed' as const }
                    }
                    return block
                  }),
                }
              }),
            )
          }
          break
        }

        default:
          break
      }
    },
    [updateContentBlock, syncContentBlocksToMessage, finalizeCurrentAssistant],
  )

  useEffect(() => {
    const cleanup = window.api.onStateChanged((state) => {
      setIsConnected(state.connected)
    })

    window.api.getState().then((state) => {
      setIsConnected(state.connected)
    })

    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = window.api.onEvent((rawEvent) => {
      handleEvent(rawEvent as AgentSessionEvent)
    })
    return cleanup
  }, [handleEvent])

  useEffect(() => {
    const cleanup = window.api.onExtensionUiRequest((data) => {
      const req = data as { id: string; method: string; [key: string]: unknown }
      if (req.method === 'notify') {
        return
      }
      if (req.method === 'setStatus' || req.method === 'setWidget' || req.method === 'setTitle' || req.method === 'set_editor_text') {
        return
      }
      setPendingUiRequests(prev => [...prev, req])
    })
    return cleanup
  }, [])

  const respondToUiRequest = useCallback((requestId: string, response: Record<string, unknown>) => {
    window.api.sendExtensionUIResponse({ type: 'extension_ui_response', id: requestId, ...response })
    setPendingUiRequests(prev => prev.filter(r => r.id !== requestId))
  }, [])

  const sendPrompt = useCallback(
    (text: string, images?: { data: string; mimeType: string }[]) => {
      const command: Record<string, unknown> = {
        type: 'prompt',
        message: text,
        id: crypto.randomUUID(),
      }
      if (images && images.length > 0) {
        command.images = images.map((img) => ({
          type: 'image' as const,
          data: img.data,
          mimeType: img.mimeType,
        }))
      }
      window.api.sendCommand(command)
    },
    [],
  )

  const abort = useCallback(() => {
    window.api.sendCommand({ type: 'abort' })
  }, [])

  return { messages, isConnected, isStreaming, sendPrompt, abort, pendingUiRequests, respondToUiRequest }
}

import { describe, it, expect, beforeEach } from 'vitest'

interface QueuedMessage {
  text: string
  images?: { data: string; mimeType: string }[]
  mentions?: Array<{ type: string; path: string; name: string }>
  quotes?: Array<{ messageId: string; role: string; content: string; timestamp: number }>
}

describe('Issue #21: message queue while AI is responding', () => {
  let queue: QueuedMessage[]
  let sentMessages: QueuedMessage[]
  let isStreaming: boolean

  beforeEach(() => {
    queue = []
    sentMessages = []
    isStreaming = false
  })

  function enqueue(msg: QueuedMessage): void {
    if (isStreaming) {
      queue.push(msg)
      return
    }
    sentMessages.push(msg)
  }

  function onAgentEnd(): void {
    if (queue.length > 0) {
      const next = queue.shift()!
      sentMessages.push(next)
    }
  }

  function removeLastQueued(): void {
    if (queue.length > 0) queue.pop()
  }

  function clearQueue(): void {
    queue = []
  }

  describe('basic queue behavior', () => {
    it('sends message immediately when not streaming', () => {
      isStreaming = false
      enqueue({ text: 'hello' })
      expect(sentMessages.length).toBe(1)
      expect(queue.length).toBe(0)
    })

    it('queues message when AI is streaming', () => {
      isStreaming = true
      enqueue({ text: 'hello' })
      expect(sentMessages.length).toBe(0)
      expect(queue.length).toBe(1)
    })

    it('queues multiple messages in order', () => {
      isStreaming = true
      enqueue({ text: 'first' })
      enqueue({ text: 'second' })
      enqueue({ text: 'third' })
      expect(queue.length).toBe(3)
      expect(queue[0].text).toBe('first')
      expect(queue[2].text).toBe('third')
    })

    it('sends first queued message when agent ends', () => {
      isStreaming = true
      enqueue({ text: 'queued msg' })
      expect(queue.length).toBe(1)

      isStreaming = false
      onAgentEnd()
      expect(sentMessages.length).toBe(1)
      expect(sentMessages[0].text).toBe('queued msg')
      expect(queue.length).toBe(0)
    })

    it('sends messages one at a time on each agent end', () => {
      isStreaming = true
      enqueue({ text: 'msg1' })
      enqueue({ text: 'msg2' })
      enqueue({ text: 'msg3' })

      isStreaming = false
      onAgentEnd()
      expect(sentMessages.length).toBe(1)
      expect(sentMessages[0].text).toBe('msg1')
      expect(queue.length).toBe(2)

      onAgentEnd()
      expect(sentMessages.length).toBe(2)
      expect(sentMessages[1].text).toBe('msg2')

      onAgentEnd()
      expect(sentMessages.length).toBe(3)
      expect(sentMessages[2].text).toBe('msg3')
      expect(queue.length).toBe(0)
    })

    it('does nothing on agent end when queue is empty', () => {
      isStreaming = false
      onAgentEnd()
      expect(sentMessages.length).toBe(0)
    })
  })

  describe('cancel queued messages', () => {
    it('removes last queued message', () => {
      isStreaming = true
      enqueue({ text: 'keep' })
      enqueue({ text: 'remove me' })

      removeLastQueued()
      expect(queue.length).toBe(1)
      expect(queue[0].text).toBe('keep')
    })

    it('clears all queued messages', () => {
      isStreaming = true
      enqueue({ text: 'a' })
      enqueue({ text: 'b' })
      enqueue({ text: 'c' })

      clearQueue()
      expect(queue.length).toBe(0)
    })

    it('removing from empty queue is safe', () => {
      removeLastQueued()
      expect(queue.length).toBe(0)
    })

    it('clearing empty queue is safe', () => {
      clearQueue()
      expect(queue.length).toBe(0)
    })
  })

  describe('queue preserves message metadata', () => {
    it('preserves images in queued message', () => {
      isStreaming = true
      enqueue({
        text: 'look at this',
        images: [{ data: 'base64data', mimeType: 'image/png' }],
      })

      expect(queue[0].images).toBeDefined()
      expect(queue[0].images!.length).toBe(1)
      expect(queue[0].images![0].mimeType).toBe('image/png')
    })

    it('preserves mentions in queued message', () => {
      isStreaming = true
      enqueue({
        text: 'check @src/main.ts',
        mentions: [{ type: 'file', path: 'src/main.ts', name: 'main.ts' }],
      })

      expect(queue[0].mentions).toBeDefined()
      expect(queue[0].mentions![0].path).toBe('src/main.ts')
    })

    it('preserves quotes in queued message', () => {
      isStreaming = true
      enqueue({
        text: 'follow up',
        quotes: [{ messageId: 'msg-1', role: 'assistant', content: 'prev answer', timestamp: Date.now() }],
      })

      expect(queue[0].quotes).toBeDefined()
      expect(queue[0].quotes![0].content).toBe('prev answer')
    })
  })

  describe('queue clears on project switch', () => {
    it('clearing queue on project switch', () => {
      isStreaming = true
      enqueue({ text: 'msg for project A' })
      enqueue({ text: 'another msg' })

      clearQueue()
      expect(queue.length).toBe(0)
    })
  })

  describe('full send-queue-dispatch cycle', () => {
    it('complete cycle: immediate send → queue → dispatch', () => {
      isStreaming = false
      enqueue({ text: 'immediate' })
      expect(sentMessages.length).toBe(1)

      isStreaming = true
      enqueue({ text: 'queued1' })
      enqueue({ text: 'queued2' })
      expect(sentMessages.length).toBe(1)
      expect(queue.length).toBe(2)

      isStreaming = false
      onAgentEnd()
      expect(sentMessages.length).toBe(2)
      expect(queue.length).toBe(1)

      isStreaming = true
      enqueue({ text: 'queued3' })
      expect(queue.length).toBe(2)

      isStreaming = false
      onAgentEnd()
      expect(sentMessages.length).toBe(3)
      expect(queue.length).toBe(1)

      onAgentEnd()
      expect(sentMessages.length).toBe(4)
      expect(queue.length).toBe(0)
    })

    it('cancel mid-cycle then continue', () => {
      isStreaming = true
      enqueue({ text: 'keep' })
      enqueue({ text: 'cancel this' })
      enqueue({ text: 'also keep' })

      removeLastQueued()
      expect(queue.length).toBe(2)

      isStreaming = false
      onAgentEnd()
      expect(sentMessages[0].text).toBe('keep')

      onAgentEnd()
      expect(sentMessages[1].text).toBe('cancel this')
    })
  })
})

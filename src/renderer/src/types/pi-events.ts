// === Pi RPC Event Types ===
// These are the events emitted on stdout by `pi --mode rpc`

// === Non-event stdout objects ===

export interface SessionHeader {
  type: 'session'
  version: number
  id: string
  timestamp: string
  cwd: string
}

export interface RpcResponse {
  id?: string
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: string
}

export interface ExtensionUIRequest {
  type: 'extension_ui_request'
  id: string
  method: 'select' | 'confirm' | 'input' | 'editor' | 'notify' | 'setStatus' | 'setWidget' | 'setTitle' | 'set_editor_text'
  [key: string]: unknown
}

export interface ExtensionUIResponse {
  type: 'extension_ui_response'
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: true
}

export interface ExtensionError {
  type: 'extension_error'
  extensionPath: string
  event: string
  error: string
}

// === Agent Lifecycle Events ===

export interface AgentStartEvent {
  type: 'agent_start'
}

export interface AgentEndEvent {
  type: 'agent_end'
  messages: unknown[]
  willRetry: boolean
}

// === Turn Events ===

export interface TurnStartEvent {
  type: 'turn_start'
}

export interface TurnEndEvent {
  type: 'turn_end'
  message: unknown
  toolResults: unknown[]
}

// === Message Events ===

export interface MessageStartEvent {
  type: 'message_start'
  message: PiMessage
}

export interface MessageUpdateEvent {
  type: 'message_update'
  message: PiAssistantMessage
  assistantMessageEvent: AssistantMessageEvent
}

export interface MessageEndEvent {
  type: 'message_end'
  message: PiMessage
}

// === Assistant Message Streaming Events ===

export type AssistantMessageEvent =
  | { type: 'start'; partial: PiAssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: PiAssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: PiAssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: PiAssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: PiAssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: PiAssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: PiAssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: PiAssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: PiAssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: PiToolCall; partial: PiAssistantMessage }
  | { type: 'done'; reason: 'stop' | 'length' | 'toolUse'; message: PiAssistantMessage }
  | { type: 'error'; reason: 'aborted' | 'error'; error: PiAssistantMessage }

// === Tool Execution Events ===

export interface ToolExecutionStartEvent {
  type: 'tool_execution_start'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export interface ToolExecutionUpdateEvent {
  type: 'tool_execution_update'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  partialResult: { content: PiContentBlock[]; details: unknown }
}

export interface ToolExecutionEndEvent {
  type: 'tool_execution_end'
  toolCallId: string
  toolName: string
  result: { content: PiContentBlock[]; details: unknown }
  isError: boolean
}

// === Session Events ===

export interface QueueUpdateEvent {
  type: 'queue_update'
  steering: string[]
  followUp: string[]
}

export interface CompactionStartEvent {
  type: 'compaction_start'
  reason: 'manual' | 'threshold' | 'overflow'
}

export interface CompactionEndEvent {
  type: 'compaction_end'
  reason: 'manual' | 'threshold' | 'overflow'
  result: unknown
  aborted: boolean
  willRetry: boolean
  errorMessage?: string
}

export interface SessionInfoChangedEvent {
  type: 'session_info_changed'
  name: string
}

export interface ThinkingLevelChangedEvent {
  type: 'thinking_level_changed'
  level: string
}

export interface AutoRetryStartEvent {
  type: 'auto_retry_start'
  attempt: number
  maxAttempts: number
  delayMs: number
  errorMessage: string
}

export interface AutoRetryEndEvent {
  type: 'auto_retry_end'
  success: boolean
  attempt: number
  finalError?: string
}

// === Union of ALL AgentSessionEvents ===

export type AgentSessionEvent =
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | QueueUpdateEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | SessionInfoChangedEvent
  | ThinkingLevelChangedEvent
  | AutoRetryStartEvent
  | AutoRetryEndEvent
  | ExtensionError

// === Pi Content Block Types ===

export interface PiTextContent {
  type: 'text'
  text: string
}

export interface PiImageContent {
  type: 'image'
  data: string // base64
  mimeType: string
}

export interface PiThinkingContent {
  type: 'thinking'
  thinking: string
  thinkingSignature: string
  redacted: boolean
}

export interface PiToolCall {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type PiContentBlock = PiTextContent | PiImageContent | PiThinkingContent | PiToolCall

// === Pi Message Types ===

export interface PiUserMessage {
  role: 'user'
  content: string | PiContentBlock[]
  timestamp: number
}

export interface PiAssistantMessage {
  role: 'assistant'
  content: PiContentBlock[]
  api: string
  provider: string
  model: string
  responseModel: string
  responseId: string
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    totalTokens: number
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  }
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
  timestamp: number
}

export interface PiToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: PiContentBlock[]
  details: unknown
  isError: boolean
  timestamp: number
}

export type PiMessage = PiUserMessage | PiAssistantMessage | PiToolResultMessage

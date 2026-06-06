export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  blocks: ContentBlock[];
  timestamp: number;
  piEntryId?: string;
}

export type ContentBlock =
  | TextBlock
  | QuoteBlock
  | ImageBlock
  | HtmlBlock
  | ToolCallBlock
  | ToolResultBlock
  | ActionBlock;

export interface TextBlock {
  type: 'text';
  content: string;
  subtype?: 'thinking';
}

export interface QuoteBlock {
  type: 'quote';
  role: 'user' | 'assistant';
  content: string;
  sourceSessionName?: string;
}

export interface ImageBlock {
  type: 'image';
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  annotations?: Annotation[];
}

export interface HtmlBlock {
  type: 'html';
  content: string;
  title?: string;
}

export interface ToolCallBlock {
  type: 'tool_call';
  toolName: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolCallId: string;
  content: ContentBlock[];
}

export interface ActionBlock {
  type: 'action';
  actionType: 'select' | 'confirm' | 'input';
  label: string;
  options?: { id: string; label: string; description?: string }[];
}

export interface Annotation {
  id: string;
  type: 'rect' | 'circle' | 'arrow' | 'text';
  coords: number[];
  label?: string;
  color?: string;
}

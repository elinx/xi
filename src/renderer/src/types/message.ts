export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  blocks: ContentBlock[];
  timestamp: number;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolCallBlock
  | ToolResultBlock
  | ActionBlock;

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface ImageBlock {
  type: 'image';
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  annotations?: Annotation[];
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

export type MessageType = 'text' | 'image' | 'audio';

export type Sender = 'user' | 'ai';

export interface Message {
  id: string;
  type: MessageType;
  content: string; // Text content or Base64 image data
  sender: Sender;
  timestamp: number;
  options?: string[]; // For clickable options
  selectedOptions?: string[]; // To highlight selected options
  isLocked?: boolean; // If true, options are disabled
  multiSelectLimit?: number; // Max number of selectable options
  visionSummary?: string; // Store vision analysis for history context
}

export type AppMode = 'consultant' | 'design'; // 智能顧問 | 智能設計

export type MessageType = 'text' | 'image' | 'audio';

export type Sender = 'user' | 'ai';

export interface Message {
  id: string;
  type: MessageType;
  content: string; // Text content or Base64 image data
  sender: Sender;
  timestamp: number;
  isStreaming?: boolean; // True while AI stream is in progress
  options?: string[]; // For clickable options
  meta?: {
    uploadId?: string; // Bind actions to a specific uploaded image
    kind?: 'upload' | 'analysis' | 'generated' | 'render_flow' | 'space_pick' | 'guardrail' | 'quick_render';
    stage?: 'hall' | 'layout' | 'dimensions' | 'target_use' | 'style_tone' | 'fast_confirm' | 'style' | 'color' | 'focus' | 'bed' | 'storage' | 'vibe' | 'decor' | 'priority' | 'intensity' | 'confirm' | 'distortion' | 'picks';
    loading?: boolean; // show spinner while executing
    loadingType?: 'analyzing' | 'generating' | 'classifying';
  };
  selectedOptions?: string[]; // To highlight selected options
  isLocked?: boolean; // If true, options are disabled
  multiSelectLimit?: number; // Max number of selectable options
  visionSummary?: string; // Store vision analysis for history context
}

export type AppMode = 'consultant' | 'design'; // 智能顧問 | 智能設計

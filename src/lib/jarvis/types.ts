// Shared types for the local JARVIS engine (no cloud, no API keys).

export type VoiceState = "offline" | "listening" | "thinking" | "speaking";

export type ChatRole = "user" | "jarvis" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  intent?: string;
  tool?: string;
  ok?: boolean;
}

export interface LoadedProgress {
  file: string;
  progress: number;
}

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface EngineLoadState {
  tts: EngineStatus;
  stt: EngineStatus;
  progress: LoadedProgress | null;
  error: string | null;
}

export interface FsEntryView {
  name: string;
  kind: "file" | "directory";
  size: number | null;
  modified: number | null;
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  enabled: boolean;
}

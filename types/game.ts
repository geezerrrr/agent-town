// --- Studio domain types ---

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "auth_failed"
  | "unreachable"
  | "rate_limited"
  | "protocol_mismatch";

export type SeatFacing = "right" | "up" | "left" | "down";

export type SeatStatus = "empty" | "returning" | "running" | "done" | "failed";

export type SeatType = "worker" | "agent";

/** Identity info read from an OpenClaw agent's IDENTITY.md / config. */
export interface AgentIdentity {
  name?: string;
  emoji?: string;
  avatar?: string;
}

/** Configuration snapshot for an OpenClaw independent agent. */
export interface AgentConfig {
  agentId: string;
  workspace?: string;
  model?: string;
  identity?: AgentIdentity;
  soul?: string;
}

export interface SeatState {
  seatId: string;
  label: string;
  /** "worker" = tool-slot for main agent; "agent" = independent OpenClaw agent. */
  seatType: SeatType;
  roleTitle?: string;
  assigned?: boolean;
  spriteKey?: string;
  spritePath?: string;
  spawnX?: number;
  spawnY?: number;
  spawnFacing?: SeatFacing;
  status: SeatStatus;
  taskSnippet?: string;
  runId?: string;
  startedAt?: string;
  /** Present only when seatType === "agent". */
  agentConfig?: AgentConfig;
}

export type TaskStatus =
  | "submitted"
  | "queued"
  | "returning"
  | "running"
  | "stopped"
  | "completed"
  | "failed"
  | "interrupted";

export interface TaskItem {
  taskId: string;
  message: string;
  status: TaskStatus;
  runId?: string;
  seatId?: string;
  sessionKey: string;
  actorName?: string;
  result?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ChatMessageBase {
  id: string;
  runId: string;
  timestamp: string;
  sessionKey: string;
  actorName?: string;
}

interface TextChatMessage extends ChatMessageBase {
  role: "user" | "assistant" | "system";
  content: string;
  /** true while assistant message is still receiving streaming deltas */
  streaming?: boolean;
}

export interface ToolChatMessage extends ChatMessageBase {
  role: "tool";
  content: string;
  toolName: string;
  toolInput?: string;
  toolOutput?: string;
}

export type ChatMessage = TextChatMessage | ToolChatMessage;

export type AgentProvider = "openclaw" | "auggie";

export interface GatewayConfig {
  url: string;
  token: string;
  provider?: AgentProvider;
}

export interface SessionMetrics {
  usedTokens?: number;
  maxContextTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  fresh: boolean;
  model?: string;
  provider?: string;
  updatedAt?: string;
}

export interface SessionRecord {
  key: string;
  label?: string;
  createdAt: string;
}

export interface StudioSnapshot {
  connection: ConnectionStatus;
  seats: SeatState[];
  tasks: TaskItem[];
  chatMessages: ChatMessage[];
  activeSessionKey?: string;
  sessionMetrics: SessionMetrics;
  sessions: SessionRecord[];
}

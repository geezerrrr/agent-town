import type { ConnectionStatus } from "@/types/game";

// ── Game canvas ──────────────────────────────────────────
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

// ── Interaction distances (pixels) ───────────────────────
export const INTERACT_DISTANCE = 48;
export const BOSS_INTERACT_DISTANCE = 34;

// ── Pathfinder ───────────────────────────────────────────
export const PF_CELL_SIZE = 16;
export const PF_PADDING = 8;
export const PF_MAX_ITER = 20000;

// ── Worker wandering ─────────────────────────────────────
export const WANDER_MIN_DELAY = 3000;
export const WANDER_MAX_DELAY = 10000;
export const WANDER_STAGGER_MS = 1800;
export const WANDER_INITIAL_MIN = 500;
export const WANDER_INITIAL_MAX = 4000;

// ── Worker movement ──────────────────────────────────────
export const ARRIVE_THRESHOLD = 8;
export const WORKER_SPEED_FACTOR = 0.55;
export const STUCK_FRAME_LIMIT = 120;
export const TASK_RESULT_HOLD_MS = 4500;
export const TASK_BUBBLE_MS = 4000;
export const TASK_THINK_DELAY_MS = 4200;

export const POI_WANDER_CHANCE = 0.35;
export const POI_STAY_MIN = 3000;
export const POI_STAY_MAX = 6000;
export const STAGGER_EXTRA_MIN = 250;
export const STAGGER_EXTRA_MAX = 1200;

export const EMOTE_Y_OFFSET = 0.55;
export const BUBBLE_Y_OFFSET = 0.45;
export const PROMPT_Y_OFFSET = 0.5;

export const BODY_SIZE_RATIO_W = 0.5;
export const BODY_SIZE_RATIO_H = 0.2;
export const BODY_OFFSET_RATIO_X = 0.25;
export const BODY_OFFSET_RATIO_Y = 0.75;

export const STUCK_MOVE_THRESHOLD = 0.5;

// ── UI labels ────────────────────────────────────────────
export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  disconnected: "Offline",
  connecting: "Connecting",
  connected: "Online",
  error: "Error",
  auth_failed: "Offline",
  unreachable: "Offline",
  rate_limited: "Offline",
};

// ── Persistence keys ─────────────────────────────────────
export const LS_CONFIG = "agent-town:gateway-config";
export const LS_TASKS = "agent-town:tasks";
export const LS_CHAT = "agent-town:chat";
export const LS_SESSIONS = "agent-town:sessions";
export const LS_ACTIVE_KEY = "agent-town:active-session-key";
export const LS_SEAT_CONFIG = "agent-town:seat-config";
export const LS_BGM_VOLUME = "agent-town:bgm-volume";
export const LS_ONBOARDING_DONE = "agent-town:onboarding-done";
export const LS_DELETED_SESSIONS = "agent-town:deleted-sessions";

// ── Audio ────────────────────────────────────────────────
export const DEFAULT_BGM_VOLUME = 0.45;

// ── Limits ───────────────────────────────────────────────
export const MAX_CHAT = 500;
export const MAX_SESSIONS = 20;

// ── Worker seat activity presets ─────────────────────────
export interface SeatActivityDef {
  emote: string;
  bubbles: string[];
  minDuration: number;
  maxDuration: number;
}

export const SEAT_ACTIVITIES: SeatActivityDef[] = [
  {
    emote: "emote:sleep",
    bubbles: ["Zzz...", "So sleepy...", "*dozing off*"],
    minDuration: 6000,
    maxDuration: 14000,
  },
  {
    emote: "emote:sleep",
    bubbles: ["*stretch*", "*yawn~*", "5 more minutes..."],
    minDuration: 4000,
    maxDuration: 8000,
  },
  {
    emote: "emote:thinking",
    bubbles: ["Hmm...", "Let me think...", "How does this work?"],
    minDuration: 5000,
    maxDuration: 10000,
  },
  {
    emote: "emote:thinking",
    bubbles: ["Reading docs...", "Taking notes...", "Interesting~"],
    minDuration: 5000,
    maxDuration: 10000,
  },
  {
    emote: "emote:device",
    bubbles: ["Debugging...", "Writing code~", "Fixing bugs..."],
    minDuration: 5000,
    maxDuration: 12000,
  },
  {
    emote: "emote:device",
    bubbles: ["Refactoring~", "Almost done!", "One more test..."],
    minDuration: 4000,
    maxDuration: 8000,
  },
  {
    emote: "emote:star",
    bubbles: ["Got it!", "Eureka!", "Great idea!"],
    minDuration: 2000,
    maxDuration: 4000,
  },
  {
    emote: "emote:heart",
    bubbles: ["Feeling great!", "Love this~", "Best day ever!"],
    minDuration: 3000,
    maxDuration: 5000,
  },
  {
    emote: "emote:music",
    bubbles: ["~♪♪~", "Humming~", "Good vibes~"],
    minDuration: 3000,
    maxDuration: 6000,
  },
  {
    emote: "emote:confused",
    bubbles: ["Huh?", "This is weird...", "What happened?"],
    minDuration: 3000,
    maxDuration: 6000,
  },
  {
    emote: "emote:angry",
    bubbles: ["Ugh...", "This bug...", "Not again!"],
    minDuration: 2000,
    maxDuration: 4000,
  },
];

// ── POI bubble texts ─────────────────────────────────────
export const POI_BUBBLE_TEXTS: Record<string, string[]> = {
  water: ["Getting water...", "Staying hydrated!", "Refilling bottle~"],
  printer: ["Checking prints...", "Printing docs...", "Paper jam again?"],
  book: ["Browsing books...", "Looking up reference~", "Good read!"],
  whiteboard: ["Reviewing plans...", "Sketching ideas~", "Hmm, let me think..."],
  sofa: ["Taking a break~", "Quick rest...", "So comfy..."],
  coffee: ["Need caffeine!", "Making coffee~", "Espresso time!"],
};

// ── Scene constants ──────────────────────────────────────
export const BOSS_PROMPT_OFFSET_X = 40;
export const BOSS_PROMPT_OFFSET_Y = 16;
export const CAMERA_LERP = 0.1;
export const ZOOM_SENSITIVITY = 0.001;
export const ZOOM_DEFAULT = 0.82;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const CAMERA_DRAG_THRESHOLD = 3;

// ── Press E prompt style (shared between boss seat & worker) ──
export const PRESS_E_STYLE: {
  fontFamily: string;
  fontSize: string;
  color: string;
  backgroundColor: string;
  padding: { x: number; y: number };
  align: string;
} = {
  fontFamily: '"SF Mono", "Cascadia Code", Consolas, "Liberation Mono", Menlo, monospace',
  fontSize: "14px",
  color: "#c9a227",
  backgroundColor: "rgba(37, 34, 25, 0.95)",
  padding: { x: 8, y: 4 },
  align: "center",
};

// ── Chat message filter ──────────────────────────────────
export function isVisibleChatMessage(msg: { role: string; content: string }) {
  return !(msg.role === "system" && msg.content.startsWith("Connected to "));
}

// ── Formatters (shared across HUD components) ────────────

export function formatCompact(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

export function formatModelLabel(model?: string) {
  if (!model) return "No model yet";
  if (model.length <= 22) return model;
  const pieces = model.split(/[/:]/).filter(Boolean);
  const tail = pieces[pieces.length - 1];
  return tail && tail.length <= 22 ? tail : `${model.slice(0, 19)}...`;
}

export function formatRelativeTime(iso?: string) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

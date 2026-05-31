/**
 * Studio state reducer — pure function, no side effects.
 *
 * All state shape definitions and the reducer live here.
 * The provider (store.ts) wires this to React context.
 */

import type {
  ConnectionStatus,
  SeatState,
  SeatType,
  TaskItem,
  ChatMessage,
  SessionMetrics,
  SessionRecord,
  StudioSnapshot,
} from "@/types/game";
import { MAX_CHAT, MAX_SESSIONS } from "./constants";
import { WORKER_SPRITES } from "@/components/game/config/animations";
import type { SeatDef as DiscoveredSeat } from "@/components/game/utils/MapHelpers";
import type { PersistedSeatConfig } from "./persistence";

// ── Helpers ────────────────────────────────────────────

const CONNECTED_TO_PREFIX = "Connected to ";
export const MAIN_SESSION_KEY = "agent:main:main";

let _chatSeq = 0;
export function chatId(): string {
  return `chat_${Date.now()}_${++_chatSeq}`;
}

let _sessionSeq = 0;
export function generateSessionKey(): string {
  return `agent:main:${Date.now()}_${++_sessionSeq}`;
}

function isRedundantConnectionMessage(msg: ChatMessage): boolean {
  return msg.role === "system" && msg.content.startsWith(CONNECTED_TO_PREFIX);
}

function patchTasks(tasks: TaskItem[], taskId: string, patch: Partial<TaskItem>) {
  return tasks.map((task) =>
    task.taskId === taskId || task.runId === taskId ? { ...task, ...patch } : task,
  );
}

export function findTask(tasks: TaskItem[], taskId: string) {
  return tasks.find((task) => task.taskId === taskId || task.runId === taskId);
}

export function findAssignableSeatIndex(seats: SeatState[]) {
  const available = seats.findIndex(
    (seat) => seat.assigned && seat.status !== "running" && seat.status !== "returning",
  );
  return available >= 0 ? available : -1;
}

function findSeatIndexById(seats: SeatState[], seatId?: string) {
  if (!seatId) return -1;
  return seats.findIndex((seat) => seat.seatId === seatId);
}

export function resolveSeatLabelForTask(seats: SeatState[], seatId?: string) {
  if (seatId) {
    return seats.find((seat) => seat.seatId === seatId)?.label;
  }
  const seatIndex = findAssignableSeatIndex(seats);
  return seatIndex >= 0 ? seats[seatIndex]?.label : undefined;
}

function mergeSessionChat(existing: ChatMessage[], sessionKey: string, incoming: ChatMessage[]) {
  return [...existing.filter((msg) => msg.sessionKey !== sessionKey), ...incoming].slice(
    -MAX_CHAT * MAX_SESSIONS,
  );
}

function resetSeatRuntime(seats: SeatState[]) {
  return seats.map((seat) => ({
    ...seat,
    status: "empty" as const,
    runId: undefined,
    taskSnippet: undefined,
    startedAt: undefined,
  }));
}

export function createEmptySessionMetrics(): SessionMetrics {
  return { fresh: false };
}

export function mergeDiscoveredSeats(
  discovered: DiscoveredSeat[],
  storedConfigs: PersistedSeatConfig[],
  currentSeats: SeatState[],
): SeatState[] {
  const storedById = new Map(storedConfigs.map((seat) => [seat.seatId, seat]));
  const currentById = new Map(currentSeats.map((seat) => [seat.seatId, seat]));

  return discovered.map((seat, index) => {
    const stored = storedById.get(seat.seatId);
    const runtime = currentById.get(seat.seatId);
    const fallback = WORKER_SPRITES[index];

    const assigned = stored?.assigned ?? Boolean(fallback);
    const spriteKey = stored?.spriteKey ?? fallback?.key;
    const spritePath = stored?.spritePath ?? fallback?.path;
    const label = stored?.label ?? fallback?.label ?? `Seat ${index + 1}`;
    const seatType: SeatType = stored?.seatType ?? "worker";
    const roleTitle =
      stored?.roleTitle ??
      (assigned ? (seatType === "agent" ? "Independent Agent" : "Worker") : undefined);

    return {
      seatId: seat.seatId,
      label,
      seatType,
      roleTitle,
      assigned,
      spriteKey: assigned ? spriteKey : undefined,
      spritePath: assigned ? spritePath : undefined,
      spawnX: seat.x,
      spawnY: seat.y,
      spawnFacing: seat.facing,
      status: runtime?.status ?? "empty",
      runId: runtime?.runId,
      taskSnippet: runtime?.taskSnippet,
      startedAt: runtime?.startedAt,
      agentConfig: stored?.agentConfig,
    };
  });
}

// ── Actions ────────────────────────────────────────────

export type Action =
  | { type: "SET_CONNECTION"; status: ConnectionStatus }
  | { type: "ADD_TASK"; task: TaskItem }
  | { type: "UPDATE_TASK"; taskId: string; patch: Partial<TaskItem> }
  | { type: "APPEND_CHAT"; message: ChatMessage }
  | { type: "APPEND_DELTA"; runId: string; delta: string; actorName?: string }
  | { type: "FINALIZE_ASSISTANT"; runId: string; content: string; actorName?: string }
  | { type: "SET_RUN_ACTOR"; runId: string; actorName: string }
  | { type: "SET_ACTIVE_SESSION"; sessionKey?: string }
  | { type: "SET_SESSION_METRICS"; metrics: SessionMetrics }
  | { type: "ASSIGN_SEAT"; runId: string; taskSnippet: string; seatId?: string }
  | { type: "BIND_SEAT_RUN"; taskId: string; runId: string }
  | { type: "SET_SEAT_STATUS"; runId: string; status: SeatState["status"] }
  | {
      type: "PATCH_SEAT_RUNTIME";
      seatId: string;
      patch: Partial<Pick<SeatState, "status" | "taskSnippet" | "runId" | "startedAt">>;
    }
  | { type: "SYNC_SEATS"; seats: SeatState[] }
  | { type: "UPDATE_SEAT_CONFIG"; seatId: string; patch: Partial<SeatState> }
  | { type: "RESET_SEATS" }
  | {
      type: "RESTORE";
      tasks: TaskItem[];
      chatMessages: ChatMessage[];
      sessions: SessionRecord[];
      activeSessionKey?: string;
    }
  | { type: "NEW_SESSION"; session: SessionRecord }
  | { type: "SET_SESSIONS"; sessions: SessionRecord[] }
  | { type: "HYDRATE_SESSION_CHAT"; sessionKey: string; chatMessages: ChatMessage[] }
  | { type: "SWITCH_SESSION"; sessionKey: string }
  | { type: "CLEAR_CHAT"; sessionKey: string }
  | { type: "DELETE_MESSAGE"; messageId: string }
  | { type: "DELETE_SESSION"; sessionKey: string; nextSessionKey?: string };

// ── Initial state ──────────────────────────────────────

export const initialState: StudioSnapshot = {
  connection: "disconnected",
  seats: [],
  tasks: [],
  chatMessages: [],
  activeSessionKey: undefined,
  sessionMetrics: createEmptySessionMetrics(),
  sessions: [],
};

// ── Reducer ────────────────────────────────────────────

export function reducer(state: StudioSnapshot, action: Action): StudioSnapshot {
  switch (action.type) {
    case "SET_CONNECTION":
      return { ...state, connection: action.status };

    case "ADD_TASK":
      return { ...state, tasks: [action.task, ...state.tasks] };

    case "UPDATE_TASK":
      return {
        ...state,
        tasks: patchTasks(state.tasks, action.taskId, action.patch),
      };

    case "APPEND_CHAT":
      if (isRedundantConnectionMessage(action.message)) return state;
      return {
        ...state,
        chatMessages: [...state.chatMessages, action.message].slice(-MAX_CHAT * MAX_SESSIONS),
      };

    case "APPEND_DELTA": {
      const msgs = [...state.chatMessages];
      let idx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.runId === action.runId && m.role === "assistant") {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        const existing = msgs[idx];
        if (existing.role !== "tool") {
          msgs[idx] = {
            ...existing,
            content: existing.content + action.delta,
            actorName: existing.actorName ?? action.actorName,
            streaming: true,
          };
        }
      } else {
        msgs.push({
          id: chatId(),
          runId: action.runId,
          role: "assistant" as const,
          content: action.delta,
          timestamp: new Date().toISOString(),
          sessionKey: findTask(state.tasks, action.runId)?.sessionKey ?? MAIN_SESSION_KEY,
          actorName: action.actorName,
          streaming: true,
        });
      }
      return { ...state, chatMessages: msgs.slice(-MAX_CHAT) };
    }

    case "FINALIZE_ASSISTANT": {
      const all = [...state.chatMessages];
      let fi = -1;
      for (let i = all.length - 1; i >= 0; i--) {
        const m = all[i];
        if (m.runId === action.runId && m.role === "assistant") {
          fi = i;
          break;
        }
      }
      if (fi >= 0) {
        const existing = all[fi];
        if (existing.role !== "tool") {
          all[fi] = {
            ...existing,
            content: action.content,
            actorName: existing.actorName ?? action.actorName,
            streaming: false,
          };
        }
      } else {
        all.push({
          id: chatId(),
          runId: action.runId,
          role: "assistant" as const,
          content: action.content,
          timestamp: new Date().toISOString(),
          sessionKey: findTask(state.tasks, action.runId)?.sessionKey ?? MAIN_SESSION_KEY,
          actorName: action.actorName,
          streaming: false,
        });
      }
      return { ...state, chatMessages: all };
    }

    case "SET_RUN_ACTOR":
      return {
        ...state,
        chatMessages: state.chatMessages.map((msg) =>
          msg.runId === action.runId && msg.role === "assistant"
            ? { ...msg, actorName: action.actorName }
            : msg,
        ),
      };

    case "SET_ACTIVE_SESSION":
      return { ...state, activeSessionKey: action.sessionKey };

    case "SET_SESSION_METRICS":
      return { ...state, sessionMetrics: action.metrics };

    case "ASSIGN_SEAT": {
      const seatIndex = action.seatId
        ? findSeatIndexById(state.seats, action.seatId)
        : findAssignableSeatIndex(state.seats);
      if (seatIndex < 0) return state;

      const seats = [...state.seats];
      const seat = seats[seatIndex];
      if (action.seatId && seat.status === "running" && seat.runId && seat.runId !== action.runId) {
        return state;
      }
      seats[seatIndex] = {
        ...seat,
        status: "running",
        runId: action.runId,
        taskSnippet: action.taskSnippet,
        startedAt: new Date().toISOString(),
      };
      return { ...state, seats };
    }

    case "BIND_SEAT_RUN":
      return {
        ...state,
        seats: state.seats.map((seat) =>
          seat.runId === action.taskId ? { ...seat, runId: action.runId } : seat,
        ),
      };

    case "SET_SEAT_STATUS": {
      const seats: SeatState[] = state.seats.map((seat) => {
        if (seat.runId !== action.runId) return seat;
        if (action.status === "empty") {
          return {
            ...seat,
            status: "empty",
            runId: undefined,
            taskSnippet: undefined,
            startedAt: undefined,
          };
        }
        return { ...seat, status: action.status };
      });
      return { ...state, seats };
    }

    case "PATCH_SEAT_RUNTIME":
      return {
        ...state,
        seats: state.seats.map((seat) =>
          seat.seatId === action.seatId ? { ...seat, ...action.patch } : seat,
        ),
      };

    case "SYNC_SEATS":
      return { ...state, seats: action.seats };

    case "UPDATE_SEAT_CONFIG":
      return {
        ...state,
        seats: state.seats.map((seat) => {
          if (seat.seatId !== action.seatId) return seat;
          const next = { ...seat, ...action.patch };
          if (!next.assigned) {
            next.label = seat.label;
            next.seatType = "worker";
            next.roleTitle = undefined;
            next.spriteKey = undefined;
            next.spritePath = undefined;
            next.status = "empty";
            next.runId = undefined;
            next.taskSnippet = undefined;
            next.startedAt = undefined;
            next.agentConfig = undefined;
          }
          return next;
        }),
      };

    case "RESET_SEATS":
      return { ...state, seats: resetSeatRuntime(state.seats) };

    case "RESTORE": {
      // Keep in-flight tasks in their original status — the gateway may still be running them.
      // A separate timeout will mark stale tasks as interrupted if no events arrive.
      return {
        ...state,
        tasks: action.tasks,
        chatMessages: action.chatMessages.filter((m) => !isRedundantConnectionMessage(m)),
        sessions: action.sessions,
        activeSessionKey: action.activeSessionKey ?? state.activeSessionKey,
      };
    }

    case "NEW_SESSION": {
      const existingSessions = state.sessions.filter((s) => s.key !== action.session.key);
      return {
        ...state,
        activeSessionKey: action.session.key,
        sessionMetrics: createEmptySessionMetrics(),
        seats: resetSeatRuntime(state.seats),
        sessions: [action.session, ...existingSessions].slice(0, MAX_SESSIONS),
      };
    }

    case "SET_SESSIONS": {
      const incomingKeys = new Set(action.sessions.map((s) => s.key));
      const existingByKey = new Map(state.sessions.map((s) => [s.key, s]));
      const merged = action.sessions.map((incoming) => {
        const existing = existingByKey.get(incoming.key);
        if (existing) return { ...existing, label: existing.label ?? incoming.label };
        return incoming;
      });
      const localOnly = state.sessions.filter((s) => !incomingKeys.has(s.key));
      return { ...state, sessions: [...merged, ...localOnly].slice(0, MAX_SESSIONS) };
    }

    case "HYDRATE_SESSION_CHAT":
      return {
        ...state,
        chatMessages: mergeSessionChat(
          state.chatMessages.filter((m) => !isRedundantConnectionMessage(m)),
          action.sessionKey,
          action.chatMessages.filter((m) => !isRedundantConnectionMessage(m)),
        ),
      };

    case "SWITCH_SESSION":
      return {
        ...state,
        activeSessionKey: action.sessionKey,
        sessionMetrics: createEmptySessionMetrics(),
        seats: resetSeatRuntime(state.seats),
      };

    case "CLEAR_CHAT":
      return {
        ...state,
        chatMessages: state.chatMessages.filter((m) => m.sessionKey !== action.sessionKey),
      };

    case "DELETE_MESSAGE":
      return {
        ...state,
        chatMessages: state.chatMessages.filter((m) => m.id !== action.messageId),
      };

    case "DELETE_SESSION": {
      const remaining = state.sessions.filter((s) => s.key !== action.sessionKey);
      const nextKey =
        state.activeSessionKey === action.sessionKey
          ? (action.nextSessionKey ?? remaining[0]?.key)
          : state.activeSessionKey;
      return {
        ...state,
        sessions: remaining,
        chatMessages: state.chatMessages.filter((m) => m.sessionKey !== action.sessionKey),
        activeSessionKey: nextKey,
        ...(state.activeSessionKey === action.sessionKey
          ? { sessionMetrics: createEmptySessionMetrics(), seats: resetSeatRuntime(state.seats) }
          : {}),
      };
    }

    default:
      return state;
  }
}

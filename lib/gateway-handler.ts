/**
 * Gateway event handler — wires GatewayClient events to store dispatch.
 *
 * Extracted from StudioProvider to keep the provider thin.
 * Uses strongly-typed gateway event payloads.
 */

import type { Dispatch } from "react";
import type { TaskItem, SeatState, ChatMessage, SessionRecord } from "@/types/game";
import type { GatewayClient } from "./gateway";
import type { Action } from "./reducer";
import {
  type GatewayFrame,
  type SessionsListPayload,
  type SessionsPreviewPayload,
  type ModelsListPayload,
  type ModelChoice,
  isAgentPayload,
  isChatPayload,
  isLifecycleData,
  isToolData,
  isAssistantDelta,
} from "./gateway-types";
import { gameEvents } from "./events";
import { chatId, findTask, MAIN_SESSION_KEY } from "./reducer";
import { loadDeletedSessionKeys } from "./persistence";
import { createLogger } from "./logger";

const log = createLogger("Gateway");

const SUBAGENT_KEY_RE = /subagent:/;
const BUBBLE_THROTTLE_MS = 150;
const MAX_BUBBLE_ACCUM = 50_000;

interface HandlerRefs {
  dispatch: () => Dispatch<Action>;
  tasks: () => TaskItem[];
  seats: () => SeatState[];
  activeSessionKey: () => string | undefined;
  setActiveSessionKey: (key?: string) => void;
  seenStarts: Set<string>;
  bubbleAccum: Map<string, string>;
  bubbleThrottleTimers: Map<string, ReturnType<typeof setTimeout>>;
  runActors: Map<string, string>;
  stoppedRunIds: Set<string>;
  modelCatalog: { current: ModelChoice[] | null };
  sessionRefreshTimer: { current: ReturnType<typeof setTimeout> | null };
  taskCounter: { current: number };
}

function isRunStopped(refs: HandlerRefs, runId: string): boolean {
  return refs.stoppedRunIds.has(runId) || findTask(refs.tasks(), runId)?.status === "stopped";
}

function resolveRunSessionKey(refs: HandlerRefs, runId: string, sessionKey?: string): string {
  return (
    sessionKey ??
    findTask(refs.tasks(), runId)?.sessionKey ??
    refs.activeSessionKey() ??
    MAIN_SESSION_KEY
  );
}

/** Clean up transient per-run state (seen starts, bubble accumulator, stopped IDs, throttle timer). */
function cleanupRun(refs: HandlerRefs, runId: string) {
  refs.seenStarts.delete(runId);
  refs.bubbleAccum.delete(runId);
  refs.stoppedRunIds.delete(runId);
  clearBubbleTimer(refs, runId);
}

function scheduleSessionMetricsRefresh(refs: HandlerRefs, client: GatewayClient, delayMs = 250) {
  if (refs.sessionRefreshTimer.current) {
    clearTimeout(refs.sessionRefreshTimer.current);
  }
  refs.sessionRefreshTimer.current = setTimeout(() => {
    refs.sessionRefreshTimer.current = null;
    void refreshSessionMetrics(refs, client);
  }, delayMs);
}

async function loadModelCatalog(refs: HandlerRefs, client: GatewayClient): Promise<ModelChoice[]> {
  if (refs.modelCatalog.current) return refs.modelCatalog.current;
  try {
    const response = await client.request("models.list", {});
    const payload = (response.payload ?? {}) as ModelsListPayload;
    const models = Array.isArray(payload.models) ? payload.models : [];
    refs.modelCatalog.current = models;
    return models;
  } catch {
    return [];
  }
}

async function refreshSessionMetrics(refs: HandlerRefs, client: GatewayClient) {
  if (client.status !== "connected") return;
  if (!client.hasScope("operator.read")) {
    log.warn("skipping session metrics refresh: missing operator.read scope");
    return;
  }

  try {
    const response = await client.request("sessions.list", {});
    const payload = (response.payload ?? {}) as SessionsListPayload;
    const gatewaySessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const deletedKeys = loadDeletedSessionKeys();
    const nonSubagent = gatewaySessions.filter(
      (s) => !SUBAGENT_KEY_RE.test(s.key) && !deletedKeys.has(s.key),
    );

    const sessionRecords: SessionRecord[] = nonSubagent.map((s, i) => ({
      key: s.key,
      label: `Session ${nonSubagent.length - i}`,
      createdAt: new Date().toISOString(),
    }));
    refs.dispatch()({ type: "SET_SESSIONS", sessions: sessionRecords });

    if (nonSubagent.length === 0) {
      if (!refs.activeSessionKey()) {
        const defaultKey = `agent:main:${Date.now()}_default`;
        const record: SessionRecord = {
          key: defaultKey,
          label: "Session 1",
          createdAt: new Date().toISOString(),
        };
        refs.setActiveSessionKey(defaultKey);
        refs.dispatch()({ type: "NEW_SESSION", session: record });
      }
      refs.dispatch()({ type: "SET_SESSION_METRICS", metrics: { fresh: false } });
      return;
    }

    const preferredKey = refs.activeSessionKey();
    const row =
      (preferredKey ? nonSubagent.find((s) => s.key === preferredKey) : undefined) ??
      nonSubagent.find((s) => s.key === MAIN_SESSION_KEY) ??
      nonSubagent[0];

    if (!row) return;

    if (!preferredKey) {
      refs.setActiveSessionKey(row.key);
      refs.dispatch()({
        type: "SET_SESSIONS",
        sessions:
          sessionRecords.length > 0
            ? sessionRecords
            : [{ key: row.key, label: "Session 1", createdAt: new Date().toISOString() }],
      });
    }

    let maxContextTokens =
      typeof row.contextTokens === "number" && row.contextTokens > 0
        ? row.contextTokens
        : undefined;

    if (!maxContextTokens && row.model) {
      const models = await loadModelCatalog(refs, client);
      const matchedModel = models.find(
        (model) =>
          model.id === row.model &&
          (!row.modelProvider || !model.provider || model.provider === row.modelProvider),
      );
      if (typeof matchedModel?.contextWindow === "number" && matchedModel.contextWindow > 0) {
        maxContextTokens = matchedModel.contextWindow;
      }
    }

    refs.dispatch()({
      type: "SET_SESSION_METRICS",
      metrics: {
        usedTokens: typeof row.totalTokens === "number" ? row.totalTokens : undefined,
        maxContextTokens,
        inputTokens: typeof row.inputTokens === "number" ? row.inputTokens : undefined,
        outputTokens: typeof row.outputTokens === "number" ? row.outputTokens : undefined,
        fresh: typeof row.totalTokens === "number" ? row.totalTokensFresh !== false : false,
        model: row.model ?? undefined,
        provider: row.modelProvider ?? undefined,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.error("session metrics refresh failed:", error);
  }
}

function emitBubbleThrottled(refs: HandlerRefs, runId: string, text: string, ttl: number) {
  const existing = refs.bubbleThrottleTimers.get(runId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    refs.bubbleThrottleTimers.delete(runId);
    gameEvents.emit("task-bubble", runId, text, ttl);
  }, BUBBLE_THROTTLE_MS);

  refs.bubbleThrottleTimers.set(runId, timer);
}

function clearBubbleTimer(refs: HandlerRefs, runId: string) {
  const timer = refs.bubbleThrottleTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    refs.bubbleThrottleTimers.delete(runId);
  }
}

function fmtJson(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

export function wireGatewayClient(client: GatewayClient, refs: HandlerRefs) {
  const refresh = (delay?: number) => scheduleSessionMetricsRefresh(refs, client, delay);
  const dispatch = () => refs.dispatch();

  client.onStatus((s) => {
    dispatch()({ type: "SET_CONNECTION", status: s });
    if (s === "connected") refresh(120);
  });

  client.on("agent", (payload: unknown) => {
    if (!isAgentPayload(payload)) return;
    const p = payload;
    const runId = p.runId;
    if (!runId) return;

    const sessionKey = p.sessionKey;
    const isSubagent = sessionKey ? SUBAGENT_KEY_RE.test(sessionKey) : false;
    const stream = p.stream;
    const data = p.data;
    const resolvedSessionKey = resolveRunSessionKey(
      refs,
      runId,
      isSubagent ? undefined : sessionKey,
    );

    if (sessionKey && !isSubagent && !refs.activeSessionKey()) {
      refs.setActiveSessionKey(sessionKey);
      refresh();
    }

    if (isLifecycleData(stream, data)) {
      if (data.phase === "start" && !refs.seenStarts.has(runId)) {
        refs.seenStarts.add(runId);
        if (isSubagent) {
          dispatch()({
            type: "ASSIGN_SEAT",
            runId,
            taskSnippet: `[Sub] ${(data.label ?? "sub-task").slice(0, 28)}`,
          });
          const label = data.label ?? "sub-task";
          const targetSeatId = "seatId" in data ? (data.seatId as string) : undefined;
          gameEvents.emit("subagent-assigned", runId, runId, label, targetSeatId);
          refs.runActors.set(runId, label);
          dispatch()({ type: "SET_RUN_ACTOR", runId, actorName: label });
          dispatch()({
            type: "APPEND_CHAT",
            message: {
              id: chatId(),
              runId,
              role: "system",
              content: `Subagent started: ${label}`,
              timestamp: new Date().toISOString(),
              sessionKey: resolvedSessionKey,
            },
          });
        } else {
          const agentId = sessionKey?.match(/^agent:([^:]+):main$/)?.[1];
          if (agentId && agentId !== "main") {
            const seat = refs.seats().find((s) => s.agentConfig?.agentId === agentId);
            if (seat) gameEvents.emit("run-seat-bound", runId, seat.seatId);
          }
          refresh();
        }
      } else if (data.phase === "end") {
        if (isRunStopped(refs, runId)) {
          cleanupRun(refs, runId);
          refresh(400);
          return;
        }
        refs.seenStarts.delete(runId);
        refs.bubbleAccum.delete(runId);
        refs.stoppedRunIds.delete(runId);
        clearBubbleTimer(refs, runId);
        gameEvents.emit("task-completed", runId);
        dispatch()({ type: "SET_SEAT_STATUS", runId, status: "done" });
        dispatch()({
          type: "UPDATE_TASK",
          taskId: runId,
          patch: { status: "completed", completedAt: new Date().toISOString() },
        });
        dispatch()({
          type: "APPEND_CHAT",
          message: {
            id: chatId(),
            runId,
            role: "system",
            content: "Task completed",
            timestamp: new Date().toISOString(),
            sessionKey: resolvedSessionKey,
          },
        });
        refresh(400);
      } else if (data.phase === "error") {
        if (isRunStopped(refs, runId)) {
          cleanupRun(refs, runId);
          refresh(400);
          return;
        }
        refs.seenStarts.delete(runId);
        refs.bubbleAccum.delete(runId);
        refs.stoppedRunIds.delete(runId);
        clearBubbleTimer(refs, runId);
        gameEvents.emit("task-failed", runId);
        dispatch()({ type: "SET_SEAT_STATUS", runId, status: "failed" });
        dispatch()({
          type: "UPDATE_TASK",
          taskId: runId,
          patch: { status: "failed" },
        });
        dispatch()({
          type: "APPEND_CHAT",
          message: {
            id: chatId(),
            runId,
            role: "system",
            content: `Task error: ${data.error ?? "unknown"}`,
            timestamp: new Date().toISOString(),
            sessionKey: resolvedSessionKey,
          },
        });
        refresh(400);
      }
    }

    if (isToolData(stream, data)) {
      if (isRunStopped(refs, runId)) return;
      const toolName = data.name ?? data.tool;
      if (toolName) {
        gameEvents.emit("task-bubble", runId, `🔧 ${toolName}`, 3000);

        const rawInput = data.input ?? data.arguments;
        const rawOutput = data.output ?? data.content ?? data.result;

        dispatch()({
          type: "APPEND_CHAT",
          message: {
            id: chatId(),
            runId,
            role: "tool",
            content: toolName,
            sessionKey: resolvedSessionKey,
            toolName,
            toolInput: rawInput ? fmtJson(rawInput) : undefined,
            toolOutput: rawOutput ? fmtJson(rawOutput) : undefined,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    if (isAssistantDelta(stream, data)) {
      if (isRunStopped(refs, runId)) return;
      const delta = typeof data.delta === "string" ? data.delta : "";
      if (delta.length > 0) {
        const raw = (refs.bubbleAccum.get(runId) ?? "") + delta;
        const accum = raw.length > MAX_BUBBLE_ACCUM ? raw.slice(-MAX_BUBBLE_ACCUM) : raw;
        refs.bubbleAccum.set(runId, accum);
        const display = accum.length > 80 ? "..." + accum.slice(-77) : accum;
        emitBubbleThrottled(refs, runId, display, 4000);
        dispatch()({
          type: "APPEND_DELTA",
          runId,
          delta,
          actorName: refs.runActors.get(runId),
        });
      }
    }
  });

  client.on("chat", (payload: unknown) => {
    if (!isChatPayload(payload)) return;
    const p = payload;
    const runId = p.runId;
    if (!runId) return;
    const sessionKey = p.sessionKey;
    const resolvedSessionKey = resolveRunSessionKey(refs, runId, sessionKey);
    if (sessionKey && !SUBAGENT_KEY_RE.test(sessionKey) && !refs.activeSessionKey()) {
      refs.setActiveSessionKey(sessionKey);
    }

    const eventState = p.state;
    if (eventState === "final") {
      if (isRunStopped(refs, runId)) {
        refresh(400);
        return;
      }
      const content = p.message?.content;
      const text = content?.find((c) => c.type === "text")?.text;
      // Emit task-completed for the Phaser worker if lifecycle end didn't already do it.
      // This acts as a defensive fallback — lifecycle end may not arrive (e.g. provider quirks).
      if (!refs.seenStarts.has(runId)) {
        // lifecycle end already fired (it deletes from seenStarts), so task-completed was emitted.
      } else {
        // lifecycle end didn't fire yet — emit task-completed now as fallback.
        refs.seenStarts.delete(runId);
        refs.bubbleAccum.delete(runId);
        clearBubbleTimer(refs, runId);
        gameEvents.emit("task-completed", runId);
      }
      dispatch()({ type: "SET_SEAT_STATUS", runId, status: "done" });
      dispatch()({
        type: "UPDATE_TASK",
        taskId: runId,
        patch: { status: "completed", completedAt: new Date().toISOString(), result: text },
      });
      if (text) {
        dispatch()({
          type: "FINALIZE_ASSISTANT",
          runId,
          content: text,
          actorName: refs.runActors.get(runId),
        });
      }
      refresh(400);
    } else if (eventState === "error" || eventState === "aborted") {
      const stopped = eventState === "aborted";
      const alreadyFinalized = isRunStopped(refs, runId);
      dispatch()({
        type: "UPDATE_TASK",
        taskId: runId,
        patch: { status: stopped ? "stopped" : "failed", completedAt: new Date().toISOString() },
      });
      dispatch()({ type: "SET_SEAT_STATUS", runId, status: stopped ? "empty" : "failed" });
      gameEvents.emit(stopped ? "task-aborted" : "task-failed", runId);
      if (!alreadyFinalized) {
        dispatch()({
          type: "APPEND_CHAT",
          message: {
            id: chatId(),
            runId,
            role: "system",
            content: stopped ? "Task stopped" : "Task failed",
            timestamp: new Date().toISOString(),
            sessionKey: resolvedSessionKey,
          },
        });
      }
      refresh(400);
    }
  });

  client.onFinalResponse((frame: unknown) => {
    if (typeof frame !== "object" || frame === null) return;
    const f = frame as GatewayFrame;
    const payload = f.payload;
    const runId = typeof payload?.runId === "string" ? payload.runId : undefined;
    if (!runId) return;
    if (isRunStopped(refs, runId)) return;

    const status = typeof payload?.status === "string" ? payload.status : undefined;
    if (f.ok && (status === "ok" || status === "completed")) {
      dispatch()({ type: "SET_SEAT_STATUS", runId, status: "done" });
      dispatch()({
        type: "UPDATE_TASK",
        taskId: runId,
        patch: { status: "completed", completedAt: new Date().toISOString() },
      });
      refresh(400);
    } else if (!f.ok || status === "error" || status === "timeout") {
      dispatch()({
        type: "UPDATE_TASK",
        taskId: runId,
        patch: { status: "failed" },
      });
      dispatch()({ type: "SET_SEAT_STATUS", runId, status: "failed" });
    }
  });

  return { refresh, refreshSessionMetrics: () => refreshSessionMetrics(refs, client) };
}

export async function loadSessionPreview(
  client: GatewayClient,
  sessionKey: string,
): Promise<ChatMessage[]> {
  if (client.status !== "connected") return [];
  if (!client.hasScope("operator.read")) return [];

  try {
    const res = await client.request("sessions.preview", {
      keys: [sessionKey],
      limit: 50,
      maxChars: 2000,
    });
    const payload = (res.payload ?? {}) as SessionsPreviewPayload;
    const entry = payload.previews?.find((p) => p.key === sessionKey);
    if (!entry || entry.status !== "ok" || entry.items.length === 0) return [];

    const messages: ChatMessage[] = [];
    const items = entry.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const role = item.role === "other" ? ("system" as const) : item.role;

      if (role === "tool") {
        const resultParts: string[] = [];
        while (i + 1 < items.length && items[i + 1].role === "tool") {
          i++;
          resultParts.push(items[i].text);
        }
        messages.push({
          id: `preview_${i}_${Date.now()}`,
          runId: "",
          role: "tool",
          content: item.text,
          sessionKey,
          toolName: item.text,
          toolOutput: resultParts.length > 0 ? resultParts.join("\n\n---\n\n") : undefined,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      messages.push({
        id: `preview_${i}_${Date.now()}`,
        runId: "",
        role,
        content: item.text,
        sessionKey,
        timestamp: new Date().toISOString(),
      });
    }
    return messages;
  } catch (err) {
    log.error("sessions.preview failed:", err);
    return [];
  }
}

export type { HandlerRefs, ModelChoice };

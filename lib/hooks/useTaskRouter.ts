"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from "react";
import type { SeatState, TaskItem } from "@/types/game";
import type { GatewayClient } from "../gateway";
import type { GatewayFrame } from "../gateway-types";
import { gameEvents } from "../events";
import type { Action } from "../reducer";
import { chatId, findTask, resolveSeatLabelForTask, MAIN_SESSION_KEY } from "../reducer";
import { createLogger } from "../logger";

const log = createLogger("TaskRouter");

export interface TaskRouterRefs {
  dispatch: MutableRefObject<Dispatch<Action>>;
  clientRef: MutableRefObject<GatewayClient | null>;
  tasks: MutableRefObject<TaskItem[]>;
  seats: MutableRefObject<SeatState[]>;
  activeSessionKey: MutableRefObject<string | undefined>;
  seatIdToSessionKey: MutableRefObject<Map<string, string>>;
  stoppedRunIds: MutableRefObject<Set<string>>;
  runActors: MutableRefObject<Map<string, string>>;
  nextTaskId: () => string;
}

export function useTaskRouter(refs: TaskRouterRefs) {
  const sessionQueueRef = useRef<
    Map<string, Array<{ taskId: string; message: string; seatId?: string }>>
  >(new Map());

  const sendTaskToGateway = useCallback(
    (taskId: string, message: string, seatId?: string) => {
      const client = refs.clientRef.current;
      if (!client || client.status !== "connected") return;
      const task = findTask(refs.tasks.current, taskId);

      const seat = seatId ? refs.seats.current.find((s) => s.seatId === seatId) : undefined;
      const isAgentSeat = seat?.seatType === "agent" && seat.agentConfig?.agentId;
      const sessionKey = isAgentSeat
        ? `agent:${seat!.agentConfig!.agentId}:main`
        : (task?.sessionKey ?? refs.activeSessionKey.current ?? MAIN_SESSION_KEY);
      const actorName = task?.actorName ?? resolveSeatLabelForTask(refs.seats.current, seatId);

      refs.dispatch.current({ type: "UPDATE_TASK", taskId, patch: { status: "submitted" } });
      if (seatId) {
        refs.dispatch.current({
          type: "PATCH_SEAT_RUNTIME",
          seatId,
          patch: {
            status: "running",
            runId: taskId,
            taskSnippet: message.slice(0, 28),
            startedAt: new Date().toISOString(),
          },
        });
      }

      client
        .request("chat.send", {
          sessionKey,
          message,
          idempotencyKey: taskId,
          // Passed through to the Auggie bridge for personality injection.
          ...(process.env.NEXT_PUBLIC_AGENT_PROVIDER === "auggie" && {
            seatLabel: seat?.label,
            seatRole: seat?.roleTitle,
          }),
        })
        .then((res: GatewayFrame) => {
          const runId = (res.payload?.runId as string) ?? undefined;
          const finalRunId = runId ?? taskId;
          if (actorName) {
            refs.runActors.current.set(finalRunId, actorName);
            refs.dispatch.current({ type: "SET_RUN_ACTOR", runId: finalRunId, actorName });
          }
          refs.dispatch.current({
            type: "UPDATE_TASK",
            taskId,
            patch: { status: "running", runId: runId ?? undefined, actorName, seatId },
          });
          refs.dispatch.current({ type: "BIND_SEAT_RUN", taskId, runId: finalRunId });
          gameEvents.emit("task-bound", taskId, finalRunId);
        })
        .catch((err: Error) => {
          log.error("assign failed:", err);
          refs.dispatch.current({ type: "UPDATE_TASK", taskId, patch: { status: "failed" } });
          refs.dispatch.current({ type: "SET_SEAT_STATUS", runId: taskId, status: "failed" });
          gameEvents.emit("task-failed", taskId);
          refs.dispatch.current({
            type: "APPEND_CHAT",
            message: {
              id: chatId(),
              runId: taskId,
              role: "system",
              content: `Assign failed: ${err.message}`,
              timestamp: new Date().toISOString(),
              sessionKey,
            },
          });
        });
    },
    [refs],
  );

  const drainSessionQueue = useCallback(
    (sessionKey: string) => {
      const queue = sessionQueueRef.current.get(sessionKey);
      if (!queue || queue.length === 0) return;
      const next = queue.shift()!;
      if (queue.length === 0) sessionQueueRef.current.delete(sessionKey);
      sendTaskToGateway(next.taskId, next.message, next.seatId);
    },
    [sendTaskToGateway],
  );

  const assignTask = useCallback(
    (message: string, seatId?: string) => {
      const client = refs.clientRef.current;
      if (!client || client.status !== "connected") return;

      const taskId = refs.nextTaskId();
      const sessionKey = refs.activeSessionKey.current ?? MAIN_SESSION_KEY;
      const actorName = seatId ? resolveSeatLabelForTask(refs.seats.current, seatId) : undefined;

      refs.dispatch.current({
        type: "ADD_TASK",
        task: {
          taskId,
          message,
          status: "submitted",
          sessionKey,
          seatId,
          actorName,
          createdAt: new Date().toISOString(),
        },
      });
      refs.dispatch.current({
        type: "APPEND_CHAT",
        message: {
          id: chatId(),
          runId: taskId,
          role: "user",
          content: message,
          timestamp: new Date().toISOString(),
          sessionKey,
        },
      });
      gameEvents.emit("task-assigned", taskId, message, seatId, sessionKey);
    },
    [refs],
  );

  const finalizeStoppedTask = useCallback(
    (runId: string, seatId?: string) => {
      const task = findTask(refs.tasks.current, runId);
      if (!task || task.status === "stopped" || task.status === "completed") return;
      refs.stoppedRunIds.current.add(task.runId ?? task.taskId);
      refs.dispatch.current({
        type: "UPDATE_TASK",
        taskId: runId,
        patch: {
          status: "stopped",
          completedAt: new Date().toISOString(),
          result: task.result ?? "Stopped by user",
        },
      });
      if (seatId) {
        refs.dispatch.current({
          type: "PATCH_SEAT_RUNTIME",
          seatId,
          patch: {
            status: "empty",
            runId: undefined,
            taskSnippet: undefined,
            startedAt: undefined,
          },
        });
      } else {
        refs.dispatch.current({ type: "SET_SEAT_STATUS", runId, status: "empty" });
      }
      refs.dispatch.current({
        type: "APPEND_CHAT",
        message: {
          id: chatId(),
          runId,
          role: "system",
          content: "Task stopped",
          timestamp: new Date().toISOString(),
          sessionKey: task.sessionKey,
        },
      });
      gameEvents.emit("task-aborted", runId);
    },
    [refs],
  );

  // task-ready: queue or send immediately
  useEffect(() => {
    return gameEvents.on("task-ready", (taskId, message, seatId) => {
      const task = findTask(refs.tasks.current, taskId);
      const sessionKey = task?.sessionKey ?? refs.activeSessionKey.current ?? MAIN_SESSION_KEY;
      const hasRunning = refs.tasks.current.some(
        (t) =>
          t.sessionKey === sessionKey &&
          t.taskId !== taskId &&
          (t.status === "running" || t.status === "submitted"),
      );
      if (hasRunning) {
        const queue = sessionQueueRef.current.get(sessionKey) ?? [];
        queue.push({ taskId, message, seatId });
        sessionQueueRef.current.set(sessionKey, queue);
        return;
      }
      sendTaskToGateway(taskId, message, seatId);
    });
  }, [sendTaskToGateway, refs]);

  // drain queue on completion/failure/abort
  useEffect(() => {
    const drain = (runId: string) => {
      const task = findTask(refs.tasks.current, runId);
      if (task?.sessionKey) drainSessionQueue(task.sessionKey);
    };
    const unsubComplete = gameEvents.on("task-completed", drain);
    const unsubFailed = gameEvents.on("task-failed", drain);
    const unsubAborted = gameEvents.on("task-aborted", drain);
    return () => {
      unsubComplete();
      unsubFailed();
      unsubAborted();
    };
  }, [drainSessionQueue, refs]);

  // task-routed: bind session to seat
  useEffect(() => {
    return gameEvents.on("task-routed", (taskId, seatId, actorName) => {
      refs.dispatch.current({ type: "UPDATE_TASK", taskId, patch: { seatId, actorName } });
      const task = findTask(refs.tasks.current, taskId);
      if (task?.sessionKey) refs.seatIdToSessionKey.current.set(seatId, task.sessionKey);
    });
  }, [refs]);

  // task-staged
  useEffect(() => {
    return gameEvents.on("task-staged", (taskId, stage, seatId) => {
      refs.dispatch.current({ type: "UPDATE_TASK", taskId, patch: { status: stage, seatId } });
      if (!seatId) return;
      refs.dispatch.current({
        type: "PATCH_SEAT_RUNTIME",
        seatId,
        patch: {
          status: stage === "returning" ? "returning" : "running",
          runId: taskId,
          taskSnippet: stage === "returning" ? "Returning to desk..." : "Queued task",
          startedAt: new Date().toISOString(),
        },
      });
    });
  }, [refs]);

  // stop-task
  useEffect(() => {
    return gameEvents.on("stop-task", async (runId, seatId) => {
      const task = findTask(refs.tasks.current, runId);
      if (!task) return;
      if (task.status === "queued" || task.status === "returning" || !task.runId) {
        finalizeStoppedTask(runId, seatId);
        return;
      }

      const client = refs.clientRef.current;
      if (!client || client.status !== "connected") {
        finalizeStoppedTask(runId, seatId);
        return;
      }

      finalizeStoppedTask(runId, seatId);
      try {
        await client.request(
          "chat.abort",
          { sessionKey: task.sessionKey, runId: task.runId },
          10000,
        );
      } catch {
        refs.dispatch.current({
          type: "APPEND_CHAT",
          message: {
            id: chatId(),
            runId,
            role: "system",
            content: "Stop task failed: gateway rejected the stop request",
            timestamp: new Date().toISOString(),
            sessionKey: task.sessionKey,
          },
        });
      }
    });
  }, [finalizeStoppedTask, refs]);

  return {
    assignTask,
    finalizeStoppedTask,
  };
}

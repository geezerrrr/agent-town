"use client";

import { useCallback, useRef, type Dispatch, type MutableRefObject } from "react";
import type { SeatState, TaskItem, GatewayConfig } from "@/types/game";
import { GatewayClient } from "../gateway";
import type { ModelChoice } from "../gateway-handler";
import { wireGatewayClient } from "../gateway-handler";
import { getDefaultGatewayUrl } from "../utils";
import { saveGatewayConfig } from "../persistence";
import type { Action } from "../reducer";
import { chatId, MAIN_SESSION_KEY, createEmptySessionMetrics } from "../reducer";
import { createLogger } from "../logger";

const log = createLogger("Gateway");

const DEFAULT_URL = getDefaultGatewayUrl();
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";

export interface GatewayRefs {
  dispatch: MutableRefObject<Dispatch<Action>>;
  tasks: MutableRefObject<TaskItem[]>;
  seats: MutableRefObject<SeatState[]>;
  activeSessionKey: MutableRefObject<string | undefined>;
  setActiveSessionKey: (key?: string) => void;
  taskCounter: MutableRefObject<number>;
}

export function useGateway(refs: GatewayRefs) {
  const clientRef = useRef<GatewayClient | null>(null);
  const configRef = useRef<GatewayConfig>({ url: DEFAULT_URL, token: DEFAULT_TOKEN });
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seenStartsRef = useRef(new Set<string>());
  const stoppedRunIdsRef = useRef(new Set<string>());
  const bubbleAccumRef = useRef(new Map<string, string>());
  const bubbleThrottleTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const runActorRef = useRef(new Map<string, string>());
  const modelCatalogRef = useRef<ModelChoice[] | null>(null);

  const connectImpl = useCallback(
    (cfg: GatewayConfig) => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }

      configRef.current = cfg;
      modelCatalogRef.current = null;

      const client = new GatewayClient(cfg.url, cfg.token);
      clientRef.current = client;

      wireGatewayClient(client, {
        dispatch: () => refs.dispatch.current,
        tasks: () => refs.tasks.current,
        seats: () => refs.seats.current,
        activeSessionKey: () => refs.activeSessionKey.current,
        setActiveSessionKey: refs.setActiveSessionKey,
        seenStarts: seenStartsRef.current,
        stoppedRunIds: stoppedRunIdsRef.current,
        bubbleAccum: bubbleAccumRef.current,
        bubbleThrottleTimers: bubbleThrottleTimersRef.current,
        runActors: runActorRef.current,
        modelCatalog: modelCatalogRef,
        sessionRefreshTimer: sessionRefreshTimerRef,
        taskCounter: refs.taskCounter,
      });

      client
        .connect()
        .then(() => {
          saveGatewayConfig(cfg);
        })
        .catch((err) => {
          log.warn("connect failed:", err.message);
          const terminalStates = new Set([
            "auth_failed",
            "unreachable",
            "rate_limited",
            "protocol_mismatch",
          ]);
          if (!terminalStates.has(client.status)) {
            refs.dispatch.current({ type: "SET_CONNECTION", status: "error" });
          }
          refs.dispatch.current({
            type: "APPEND_CHAT",
            message: {
              id: chatId(),
              runId: "",
              role: "system",
              content: `Connection failed: ${err.message}`,
              timestamp: new Date().toISOString(),
              sessionKey: refs.activeSessionKey.current ?? MAIN_SESSION_KEY,
            },
          });
        });
    },
    [refs],
  );

  const connect = useCallback(
    (config?: GatewayConfig) => {
      connectImpl(config ?? configRef.current);
    },
    [connectImpl],
  );

  const disconnect = useCallback(() => {
    if (sessionRefreshTimerRef.current) {
      clearTimeout(sessionRefreshTimerRef.current);
      sessionRefreshTimerRef.current = null;
    }
    clientRef.current?.disconnect();
    clientRef.current = null;
    refs.setActiveSessionKey(undefined);
    refs.dispatch.current({
      type: "SET_SESSION_METRICS",
      metrics: createEmptySessionMetrics(),
    });
  }, [refs]);

  return {
    clientRef,
    configRef,
    seenStartsRef,
    stoppedRunIdsRef,
    bubbleAccumRef,
    bubbleThrottleTimersRef,
    runActorRef,
    sessionRefreshTimerRef,
    connectImpl,
    connect,
    disconnect,
  };
}

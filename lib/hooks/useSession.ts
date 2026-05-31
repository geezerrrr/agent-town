"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from "react";
import type { ChatMessage, SessionRecord } from "@/types/game";
import type { GatewayClient } from "../gateway";
import { loadSessionPreview } from "../gateway-handler";
import { gameEvents } from "../events";
import { saveActiveSessionKey, addDeletedSessionKey } from "../persistence";
import type { Action } from "../reducer";
import { generateSessionKey, MAIN_SESSION_KEY } from "../reducer";
import { createLogger } from "../logger";

const log = createLogger("Session");

export interface SessionRefs {
  dispatch: MutableRefObject<Dispatch<Action>>;
  clientRef: MutableRefObject<GatewayClient | null>;
  activeSessionKey: MutableRefObject<string | undefined>;
  setActiveSessionKey: (key: string | undefined) => void;
  seenStarts: MutableRefObject<Set<string>>;
  bubbleAccum: MutableRefObject<Map<string, string>>;
  stoppedRunIds: MutableRefObject<Set<string>>;
  sessions: MutableRefObject<SessionRecord[]>;
}

export function useSession(refs: SessionRefs) {
  const seatIdToSessionKeyRef = useRef(new Map<string, string>());

  /** Clear transient per-session state (bubble accumulator, seen starts, stopped runs). */
  const clearTransientState = useCallback(() => {
    refs.bubbleAccum.current.clear();
    refs.seenStarts.current.clear();
    refs.stoppedRunIds.current.clear();
  }, [refs]);

  const newSession = useCallback(() => {
    const newKey = generateSessionKey();
    const record = {
      key: newKey,
      label: `Session ${refs.sessions.current.length + 1}`,
      createdAt: new Date().toISOString(),
    };

    clearTransientState();
    refs.dispatch.current({ type: "NEW_SESSION", session: record });
    refs.setActiveSessionKey(newKey);
    saveActiveSessionKey(newKey);
  }, [refs, clearTransientState]);

  const switchSession = useCallback(
    async (sessionKey: string) => {
      if (sessionKey === refs.activeSessionKey.current) return;

      clearTransientState();
      saveActiveSessionKey(sessionKey);

      refs.dispatch.current({ type: "SWITCH_SESSION", sessionKey });
      refs.setActiveSessionKey(sessionKey);

      const client = refs.clientRef.current;
      let messages: ChatMessage[] = [];
      try {
        messages = client ? await loadSessionPreview(client, sessionKey) : [];
      } catch (err) {
        log.error("loadSessionPreview failed:", err);
      }

      if (refs.activeSessionKey.current !== sessionKey) return;
      refs.dispatch.current({
        type: "HYDRATE_SESSION_CHAT",
        sessionKey,
        chatMessages: messages,
      });
    },
    [refs, clearTransientState],
  );

  const prepareSessionForSeat = useCallback(
    async (seatId: string) => {
      const bound = seatIdToSessionKeyRef.current.get(seatId);
      if (bound) {
        await switchSession(bound);
      } else {
        newSession();
        seatIdToSessionKeyRef.current.set(
          seatId,
          refs.activeSessionKey.current ?? MAIN_SESSION_KEY,
        );
      }
    },
    [newSession, switchSession, refs],
  );

  const newSessionForSeat = useCallback(
    (seatId: string) => {
      newSession();
      const newKey = refs.activeSessionKey.current ?? MAIN_SESSION_KEY;
      seatIdToSessionKeyRef.current.set(seatId, newKey);
    },
    [newSession, refs],
  );

  const getBoundSessionForSeat = useCallback((seatId: string) => {
    return seatIdToSessionKeyRef.current.get(seatId);
  }, []);

  const deleteSession = useCallback(
    async (sessionKey: string, allSessions: { key: string }[]) => {
      addDeletedSessionKey(sessionKey);
      const remaining = allSessions.filter((s) => s.key !== sessionKey);
      const nextKey = remaining[0]?.key;

      if (sessionKey === refs.activeSessionKey.current) {
        clearTransientState();
        if (nextKey) {
          refs.setActiveSessionKey(nextKey);
          saveActiveSessionKey(nextKey);
        }
      }

      refs.dispatch.current({ type: "DELETE_SESSION", sessionKey, nextSessionKey: nextKey });

      if (sessionKey === refs.activeSessionKey.current && nextKey) {
        const client = refs.clientRef.current;
        let messages: ChatMessage[] = [];
        try {
          messages = client ? await loadSessionPreview(client, nextKey) : [];
        } catch {}
        refs.dispatch.current({
          type: "HYDRATE_SESSION_CHAT",
          sessionKey: nextKey,
          chatMessages: messages,
        });
      }
    },
    [refs, clearTransientState],
  );

  const loadSessionChat = useCallback(
    async (sessionKey: string): Promise<ChatMessage[]> => {
      const client = refs.clientRef.current;
      if (!client || client.status !== "connected") return [];
      try {
        return await loadSessionPreview(client, sessionKey);
      } catch (err) {
        log.error("loadSessionChat failed:", err);
        return [];
      }
    },
    [refs],
  );

  useEffect(() => {
    return gameEvents.on("new-session-for-seat", (seatId) => {
      newSessionForSeat(seatId);
      gameEvents.emit("open-terminal", seatId);
    });
  }, [newSessionForSeat]);

  return {
    seatIdToSessionKeyRef,
    newSession,
    switchSession,
    deleteSession,
    prepareSessionForSeat,
    newSessionForSeat,
    getBoundSessionForSeat,
    loadSessionChat,
  };
}

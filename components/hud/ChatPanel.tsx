"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SendHorizontal, ChevronDown } from "lucide-react";
import { useStudio } from "@/lib/store";
import { gameEvents } from "@/lib/events";
import type { ChatMessage, SessionRecord, SeatState, TaskItem } from "@/types/game";
import { findTask } from "@/lib/reducer";
import HudFlyout from "./HudFlyout";
import MessageBubble from "./MessageBubble";
import SessionSwitcher from "./SessionSwitcher";

export default function ChatPanel({
  messages,
  tasks,
  isConnected,
  sessions,
  activeSessionKey,
  seats = [],
}: {
  messages: ChatMessage[];
  tasks: TaskItem[];
  isConnected: boolean;
  sessions: SessionRecord[];
  activeSessionKey?: string;
  seats?: SeatState[];
}) {
  const { assignTask, deleteMessage } = useStudio();
  const [input, setInput] = useState("");
  const [selectedSeatId, setSelectedSeatId] = useState<string>("");
  const [targetOpen, setTargetOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!targetOpen) return;
    const handler = (e: MouseEvent) => {
      if (targetRef.current && !targetRef.current.contains(e.target as Node)) setTargetOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [targetOpen]);

  const assignableSeats = useMemo(() => seats.filter((s) => s.assigned && s.spriteKey), [seats]);

  const actorByRunId = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (!task.actorName) continue;
      if (task.runId) map.set(task.runId, task.actorName);
      map.set(task.taskId, task.actorName);
    }
    return map;
  }, [tasks]);

  const stopHandler = useCallback((runId: string, seatId: string) => {
    gameEvents.emit("stop-task", runId, seatId);
  }, []);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  useEffect(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
  }, [messages.length, virtualizer]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !isConnected) return;
    assignTask(trimmed, selectedSeatId || undefined);
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <HudFlyout
      title="Chat"
      subtitle={isConnected ? "Send messages and view execution" : "Connect to start"}
      headerAction={<SessionSwitcher sessions={sessions} activeKey={activeSessionKey} />}
      bodyClass="hud-flyout__body--chat"
    >
      <div className="hud-chat-layout">
        <div ref={scrollRef} className="hud-chat">
          {messages.length === 0 ? (
            <div className="hud-empty">No conversation yet. Type a message to begin.</div>
          ) : (
            <div
              style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const message = messages[virtualRow.index];
                const task = findTask(tasks, message.runId);
                const canStop = task?.status === "running" && (task.runId ?? task.taskId);
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div style={{ paddingBottom: 8 }}>
                      <MessageBubble
                        msg={message}
                        actorName={actorByRunId.get(message.runId)}
                        canStop={!!canStop}
                        onStop={
                          canStop
                            ? () => stopHandler(task.runId ?? task.taskId, task.seatId ?? "")
                            : undefined
                        }
                        onDelete={() => deleteMessage(message.id)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {assignableSeats.length > 0 && (
          <div className="hud-chat-target-row">
            <span className="hud-chat-target-label">To:</span>
            <div ref={targetRef} className="session-switcher" style={{ flex: 1 }}>
              <button
                type="button"
                className="pixel-button"
                style={{
                  fontSize: 7,
                  padding: "3px 8px",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  flex: 1,
                  justifyContent: "space-between",
                }}
                onClick={() => setTargetOpen((prev) => !prev)}
                disabled={!isConnected}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selectedSeatId
                    ? (assignableSeats.find((s) => s.seatId === selectedSeatId)?.label ??
                      selectedSeatId)
                    : "Auto (first idle)"}
                </span>
                <ChevronDown
                  size={10}
                  style={{ flexShrink: 0, transform: targetOpen ? "rotate(180deg)" : undefined }}
                />
              </button>

              {targetOpen && (
                <div
                  className="session-dropdown"
                  style={{ right: "auto", left: 0, minWidth: "100%" }}
                >
                  <div className="session-dropdown__row">
                    <button
                      type="button"
                      className={`session-dropdown__item ${selectedSeatId === "" ? "session-dropdown__item--active" : ""}`}
                      onClick={() => {
                        setSelectedSeatId("");
                        setTargetOpen(false);
                      }}
                    >
                      Auto (first idle)
                    </button>
                  </div>
                  {assignableSeats.map((seat) => (
                    <div key={seat.seatId} className="session-dropdown__row">
                      <button
                        type="button"
                        className={`session-dropdown__item ${selectedSeatId === seat.seatId ? "session-dropdown__item--active" : ""}`}
                        onClick={() => {
                          setSelectedSeatId(seat.seatId);
                          setTargetOpen(false);
                        }}
                      >
                        {seat.label}
                        {seat.roleTitle ? ` · ${seat.roleTitle}` : ""}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="hud-chat-input-row">
          <textarea
            ref={inputRef}
            className="pixel-input"
            style={{ flex: 1, minHeight: 40, height: 40, resize: "none", padding: "8px 10px" }}
            placeholder={isConnected ? "Type a message..." : "Connect first..."}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
          />
          <button
            type="button"
            className="pixel-icon-btn pixel-icon-btn--primary"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            onClick={handleSend}
            disabled={!isConnected || !input.trim()}
            title="Send"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </HudFlyout>
  );
}

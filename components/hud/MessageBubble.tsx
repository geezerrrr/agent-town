"use client";

import { useState } from "react";
import { Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/types/game";
import ToolBubble from "./ToolBubble";
import MessageMenu from "./MessageMenu";

export default function MessageBubble({
  msg,
  actorName,
  canStop,
  onStop,
  onDelete,
}: {
  msg: ChatMessage;
  actorName?: string;
  canStop?: boolean;
  onStop?: () => void;
  onDelete?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  if (msg.role === "system") {
    return (
      <div
        className="hud-chat__system"
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span style={{ flex: 1 }}>{msg.content}</span>
        {onDelete && <MessageMenu onDelete={onDelete} visible={hovered} />}
      </div>
    );
  }

  if (msg.role === "tool") {
    return <ToolBubble msg={msg} onDelete={onDelete} />;
  }

  return (
    <div
      className={`hud-chat__bubble ${
        msg.role === "user" ? "hud-chat__bubble--user" : "hud-chat__bubble--assistant"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="hud-chat__header">
        <div className="hud-chat__role">
          {msg.role === "user" ? "You" : (msg.actorName ?? actorName ?? "Assistant")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {canStop && msg.role === "user" && (
            <button
              type="button"
              className="hud-chat__stop"
              onClick={onStop}
              title="Stop task"
              aria-label="Stop task"
            >
              <Square size={10} fill="currentColor" />
            </button>
          )}
          {onDelete && <MessageMenu onDelete={onDelete} visible={hovered} />}
        </div>
      </div>
      <div className="hud-chat__content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        {msg.streaming ? <span className="pixel-cursor">▌</span> : null}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { ToolChatMessage } from "@/types/game";
import MessageMenu from "./MessageMenu";

function parseToolParts(msg: ToolChatMessage): { summary: string; detail: string | null } {
  let summary = msg.toolName;
  if (msg.toolInput) {
    try {
      const parsed = JSON.parse(msg.toolInput);
      const hint =
        parsed.command ??
        parsed.path ??
        parsed.filename ??
        parsed.pattern ??
        parsed.query ??
        parsed.url;
      if (typeof hint === "string") {
        const short = hint.length > 60 ? hint.slice(0, 57) + "..." : hint;
        summary = `${msg.toolName}  ${short}`;
      }
    } catch {}
  }
  return { summary, detail: msg.toolOutput ?? null };
}

export default function ToolBubble({
  msg,
  onDelete,
}: {
  msg: ToolChatMessage;
  onDelete?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { summary, detail } = parseToolParts(msg);

  return (
    <div
      className="hud-chat__tool"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 6,
        }}
      >
        <div className="hud-chat__tool-name">{summary}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {detail && (
            <button
              type="button"
              className="hud-chat__tool-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "hide" : "show"}
            </button>
          )}
          {onDelete && <MessageMenu onDelete={onDelete} visible={hovered} />}
        </div>
      </div>
      {expanded && detail && <div className="hud-chat__tool-output">{detail}</div>}
    </div>
  );
}

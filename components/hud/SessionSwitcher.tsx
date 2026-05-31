"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, ChevronDown, X } from "lucide-react";
import { useStudio } from "@/lib/store";
import { formatRelativeTime } from "@/lib/constants";
import type { SessionRecord } from "@/types/game";

export default function SessionSwitcher({
  sessions,
  activeKey,
}: {
  sessions: SessionRecord[];
  activeKey?: string;
}) {
  const { newSession, switchSession, deleteSession } = useStudio();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeLabel =
    sessions.find((s) => s.key === activeKey)?.label ?? activeKey?.split(":").pop() ?? "Default";

  return (
    <div ref={ref} className="session-switcher">
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
          maxWidth: 140,
        }}
        onClick={() => setOpen((prev) => !prev)}
        title="Switch session"
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{activeLabel}</span>
        <ChevronDown
          size={10}
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      <button
        type="button"
        className="pixel-button pixel-button--primary"
        style={{ fontSize: 7, padding: "3px 6px", whiteSpace: "nowrap" }}
        onClick={() => {
          newSession();
          setOpen(false);
        }}
        title="New session"
      >
        <Plus size={10} />
      </button>

      {open && (
        <div className="session-dropdown">
          {sessions.length === 0 ? (
            <div className="session-dropdown__empty">No sessions yet</div>
          ) : (
            sessions.map((session) => {
              const isActive = session.key === activeKey;
              return (
                <div key={session.key} className="session-dropdown__row">
                  <button
                    type="button"
                    className={`session-dropdown__item ${isActive ? "session-dropdown__item--active" : ""}`}
                    onClick={() => {
                      switchSession(session.key);
                      setOpen(false);
                    }}
                  >
                    <div style={{ fontWeight: isActive ? "bold" : "normal" }}>
                      {session.label ?? session.key.split(":").pop()}
                    </div>
                    <div className="session-dropdown__time">
                      {formatRelativeTime(session.createdAt)}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="session-dropdown__delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.key);
                      setOpen(false);
                    }}
                    title="Delete session"
                    aria-label="Delete session"
                  >
                    <X size={8} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

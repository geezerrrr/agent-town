"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical, Trash2 } from "lucide-react";

export default function MessageMenu({
  onDelete,
  visible = true,
}: {
  onDelete: () => void;
  visible?: boolean;
}) {
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

  return (
    <div
      ref={ref}
      className="msg-menu"
      style={{ opacity: visible || open ? 1 : 0, pointerEvents: visible || open ? "auto" : "none" }}
    >
      <button
        type="button"
        className="msg-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        title="Message options"
        aria-label="Message options"
      >
        <MoreVertical size={10} />
      </button>
      {open && (
        <div className="msg-menu__dropdown">
          <button
            type="button"
            className="msg-menu__item msg-menu__item--danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={9} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

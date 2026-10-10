"use client";

import { useState } from "react";
import { useStudio } from "@/lib/store";
import { LS_CONFIG, STATUS_LABELS } from "@/lib/constants";
import { parseGatewayAddress, getAgentProvider } from "@/lib/utils";
import HudFlyout from "./HudFlyout";

const DEFAULT_GATEWAY = "ws://127.0.0.1:18789";
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";
const IS_AUGGIE = getAgentProvider() === "auggie";

function loadSavedConfig(): { url: string; token: string } {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LS_CONFIG) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { url?: string; token?: string };
      return {
        url: parsed.url || DEFAULT_GATEWAY,
        token: parsed.token || DEFAULT_TOKEN,
      };
    }
  } catch {}
  return { url: DEFAULT_GATEWAY, token: DEFAULT_TOKEN };
}

export default function ConnectionPanel() {
  const { state, connect, disconnect } = useStudio();
  const [url, setUrl] = useState(() => loadSavedConfig().url);
  const [token, setToken] = useState(() => loadSavedConfig().token);
  const isConnected = state.connection === "connected";
  const isConnecting = state.connection === "connecting";
  const isAuthFailed = state.connection === "auth_failed";
  const isUnreachable = state.connection === "unreachable";
  const isRateLimited = state.connection === "rate_limited";
  const isProtocolMismatch = state.connection === "protocol_mismatch";

  const [error, setError] = useState("");

  const handleConnect = () => {
    setError("");
    if (IS_AUGGIE) {
      // Auggie doesn't need a gateway URL or token — connect via local bridge
      connect({ url: parseGatewayAddress("") ?? "", token: "" });
      return;
    }
    const parsed = parseGatewayAddress(url);
    if (!parsed) {
      setError("Invalid URL. Use ws://host:port or host:port.");
      return;
    }
    connect({ url: parsed, token: token.trim() });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      handleConnect();
    }
  };

  return (
    <HudFlyout
      title="Connection"
      subtitle={`${STATUS_LABELS[state.connection]}${IS_AUGGIE ? " (Auggie)" : " gateway link"}`}
    >
      <div className="hud-panel__stack">
        {!IS_AUGGIE && (
          <>
            <label className="hud-panel__label">Gateway URL</label>
            <input
              className="pixel-input hud-panel__input"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="ws://127.0.0.1:18789"
              disabled={isConnected || isConnecting}
            />
            <label className="hud-panel__label">Token</label>
            <input
              className="pixel-input hud-panel__input"
              type="password"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="optional"
              disabled={isConnected || isConnecting}
            />
          </>
        )}
        {IS_AUGGIE && !isConnected && !isConnecting && (
          <p style={{ color: "var(--pixel-muted)", fontSize: "8px" }}>
            Using Auggie CLI as agent provider. Make sure <code>auggie</code> is installed and
            authenticated.
          </p>
        )}
        {isAuthFailed && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Authentication failed. Token may be invalid or expired — please re-enter.
          </p>
        )}
        {isUnreachable && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Gateway is unreachable. Please check if your gateway is running.
          </p>
        )}
        {isRateLimited && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Too many failed attempts. Please wait a moment before retrying.
          </p>
        )}
        {isProtocolMismatch && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Gateway protocol version is not supported. Please update Agent Town or your gateway.
          </p>
        )}
        {error && <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>{error}</p>}
        {!isConnected && !isConnecting ? (
          <button
            type="button"
            className="pixel-button pixel-button--primary"
            onClick={handleConnect}
            disabled={!url.trim()}
          >
            Connect
          </button>
        ) : null}
        {isConnected ? (
          <button type="button" className="pixel-button" onClick={disconnect}>
            Disconnect
          </button>
        ) : null}
        {isConnecting ? (
          <button type="button" className="pixel-button" onClick={disconnect}>
            Cancel
          </button>
        ) : null}
      </div>
    </HudFlyout>
  );
}

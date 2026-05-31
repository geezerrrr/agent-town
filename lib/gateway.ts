/**
 * OpenClaw Gateway WebSocket client.
 *
 * Protocol: frame-based RPC over WebSocket.
 *   - req/res for request-response
 *   - event for server-pushed updates
 *   - Handshake: connect.challenge -> connect -> hello-ok
 *
 * Features:
 *   - Automatic reconnection with exponential backoff
 *   - Typed event dispatching
 *   - Request timeout management
 *   - Device identity signing (Ed25519 via Web Crypto) for operator.write scope
 */

import type { GatewayFrame } from "./gateway-types";

type Listener = (payload: unknown) => void;

interface PendingRequest {
  resolve: (res: GatewayFrame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type GatewayStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "auth_failed"
  | "unreachable"
  | "rate_limited";

// ── Reconnect config ───────────────────────────────────

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_FACTOR = 2;
const RECONNECT_MAX_ATTEMPTS = 3;
const HANDSHAKE_TIMEOUT_MS = 15000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

let counter = 0;
function nextId(): string {
  return `aw_${++counter}_${Date.now()}`;
}

// ── Device identity (Ed25519, stored in localStorage) ──

const DEVICE_STORAGE_KEY = "aw-device-v1";
const CONNECT_SCOPES = ["operator.read", "operator.write", "operator.admin"];

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCodePoint(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const p = s.replaceAll("-", "+").replaceAll("_", "/");
  const padded = p + "=".repeat((4 - (p.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.codePointAt(i)!;
  return out;
}

interface StoredDevice {
  version: 1;
  deviceId: string;
  publicKey: string;
  privateKeyPkcs8: string;
  createdAtMs: number;
}

interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKeyPkcs8: Uint8Array;
}

async function loadDevice(): Promise<DeviceIdentity | null> {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!raw) return null;

    const stored = JSON.parse(raw) as StoredDevice;
    if (!stored.deviceId) return null;

    return {
      deviceId: stored.deviceId,
      publicKey: stored.publicKey,
      privateKeyPkcs8: fromB64Url(stored.privateKeyPkcs8),
    };
  } catch {
    return null;
  }
}

async function createDevice(): Promise<DeviceIdentity | null> {
  try {
    const alg = { name: "Ed25519" } as AlgorithmIdentifier;
    const kp = (await crypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const priv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    const hashBuf = new Uint8Array(await crypto.subtle.digest("SHA-256", pub.slice()));
    const deviceId = Array.from(hashBuf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const stored: StoredDevice = {
      version: 1,
      deviceId,
      publicKey: toB64Url(pub),
      privateKeyPkcs8: toB64Url(priv),
      createdAtMs: Date.now(),
    };
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(stored));
    return { deviceId, publicKey: stored.publicKey, privateKeyPkcs8: priv };
  } catch {
    return null;
  }
}

async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity | null> {
  if (typeof localStorage === "undefined" || !globalThis.crypto?.subtle) {
    return null;
  }

  return (await loadDevice()) ?? (await createDevice());
}

async function buildDeviceParams(
  identity: DeviceIdentity,
  token: string,
  nonce: string,
): Promise<Record<string, unknown>> {
  const signedAt = Date.now();
  const payload = [
    "v2",
    identity.deviceId,
    "gateway-client",
    "backend",
    "operator",
    CONNECT_SCOPES.join(","),
    String(signedAt),
    token,
    nonce,
  ].join("|");

  const alg = { name: "Ed25519" } as AlgorithmIdentifier;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    identity.privateKeyPkcs8.slice(),
    alg,
    false,
    ["sign"],
  );
  const sigBuf = new Uint8Array(
    (await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode(payload),
    )) as ArrayBuffer,
  );

  return {
    id: identity.deviceId,
    publicKey: identity.publicKey,
    signature: toB64Url(sigBuf),
    signedAt,
    nonce,
  };
}

// ── GatewayClient ──────────────────────────────────────

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventListeners = new Map<string, Set<Listener>>();
  private statusListeners = new Set<(s: GatewayStatus) => void>();
  private _status: GatewayStatus = "disconnected";
  private _grantedScopes: Set<string> = new Set();
  private url: string;
  private token: string;

  private connectReject: ((err: Error) => void) | null = null;
  private connectSettled = false;

  /** Reconnection state */
  private autoReconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  get status(): GatewayStatus {
    return this._status;
  }

  hasScope(scope: string): boolean {
    return this._grantedScopes.has(scope);
  }

  private setStatus(s: GatewayStatus) {
    this._status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  onStatus(fn: (s: GatewayStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  on(event: string, fn: Listener): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(fn);
    return () => this.eventListeners.get(event)?.delete(fn);
  }

  connect(): Promise<GatewayFrame> {
    this.autoReconnect = true;
    this.reconnectAttempt = 0;
    this.intentionalClose = false;
    return this.connectOnce();
  }

  private connectOnce(): Promise<GatewayFrame> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      this.setStatus("connecting");
      this.connectSettled = false;
      this.connectReject = reject;

      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        // Wait for connect.challenge event from server
      };

      ws.onmessage = (ev: MessageEvent) => {
        let frame: GatewayFrame;
        try {
          frame = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
        } catch {
          return;
        }
        this.handleFrame(frame, (res) => {
          if (!this.connectSettled) {
            this.connectSettled = true;
            this.connectReject = null;
            this.reconnectAttempt = 0;
            resolve(res);
          }
        });
      };

      ws.onerror = () => {
        // Don't overwrite terminal states set by handshake failure
        if (
          this._status !== "auth_failed" &&
          this._status !== "unreachable" &&
          this._status !== "rate_limited"
        ) {
          this.setStatus("error");
        }
        this.rejectConnect(new Error("WebSocket connection error"));
      };

      ws.onclose = () => {
        const wasConnected = this._status === "connected";
        // Don't overwrite terminal states set by handshake failure
        if (
          this._status !== "auth_failed" &&
          this._status !== "unreachable" &&
          this._status !== "rate_limited"
        ) {
          this.setStatus("disconnected");
        }
        this.rejectConnect(new Error("Connection closed before handshake"));
        this.clearPending();

        if (!this.intentionalClose && this.autoReconnect) {
          this.scheduleReconnect(wasConnected);
        }
      };
    });
  }

  private scheduleReconnect(wasConnected: boolean) {
    if (this.reconnectTimer) return;

    // If we were previously connected, reset attempt counter for faster retry
    if (wasConnected) {
      this.reconnectAttempt = 0;
    }

    if (this.reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
      this.autoReconnect = false;
      this.setStatus("unreachable");
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.autoReconnect || this.intentionalClose) return;

      this.connectOnce().catch(() => {
        // Error handled by onclose -> scheduleReconnect
      });
    }, delay);
  }

  private rejectConnect(err: Error) {
    if (!this.connectSettled) {
      this.connectSettled = true;
      this.connectReject?.(err);
      this.connectReject = null;
    }
  }

  private clearPending() {
    for (const [id, p] of this.pending) {
      p.reject(new Error("Connection closed"));
      clearTimeout(p.timer);
      this.pending.delete(id);
    }
  }

  private handleFrame(frame: GatewayFrame, onConnected?: (res: GatewayFrame) => void) {
    if (frame.type === "event") {
      if (frame.event === "connect.challenge") {
        const nonce = (frame.payload as { nonce?: string } | undefined)?.nonce ?? "";
        void this.sendConnectHandshake(nonce);
        return;
      }

      if (frame.event) {
        const listeners = this.eventListeners.get(frame.event);
        if (listeners) {
          listeners.forEach((fn) => fn(frame.payload));
        }
      }
      // Fire wildcard listeners
      const wildcard = this.eventListeners.get("*");
      if (wildcard) {
        wildcard.forEach((fn) => fn(frame));
      }
      return;
    }

    if (frame.type === "res" && frame.id) {
      const pending = this.pending.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);

        if (frame.ok) {
          if (frame.payload?.type === "hello-ok") {
            this.storeGrantedScopes(frame);
            this.setStatus("connected");
            onConnected?.(frame);
          }
          pending.resolve(frame);
        } else {
          pending.reject(new Error(frame.error?.message ?? "Request failed"));
        }
        return;
      }

      if (frame.ok && frame.payload?.type === "hello-ok") {
        this.storeGrantedScopes(frame);
        this.setStatus("connected");
        onConnected?.(frame);
        return;
      }

      // Gateway sends a second res frame for long-running requests
      // (first = "accepted", second = final "ok"/"error"). Route it
      // as an internal event so the store can update task status.
      const listeners = this.eventListeners.get("__final_res__");
      if (listeners) {
        listeners.forEach((fn) => fn(frame));
      }
    }
  }

  private storeGrantedScopes(frame: GatewayFrame) {
    this._grantedScopes.clear();
    const scopes =
      frame.payload?.scopes ?? (frame.payload?.auth as Record<string, unknown>)?.scopes;
    if (Array.isArray(scopes)) {
      for (const s of scopes) {
        if (typeof s === "string") this._grantedScopes.add(s);
      }
    }
  }

  private async sendConnectHandshake(nonce: string) {
    const id = nextId();

    // Attempt device signing for full operator scope
    const identity = await loadOrCreateDeviceIdentity();
    let deviceParam: Record<string, unknown> | undefined;
    if (identity) {
      try {
        deviceParam = await buildDeviceParams(identity, this.token, nonce);
      } catch {
        // signing failed — proceed without device identity
      }
    }

    const frame: GatewayFrame = {
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 4,
        client: {
          id: "gateway-client",
          displayName: "Agent Town",
          version: "1.0.0",
          platform: "web",
          mode: "backend",
          instanceId: `aw-${Date.now()}`,
        },
        auth: { token: this.token },
        role: "operator",
        scopes: CONNECT_SCOPES,
        locale: "en-US",
        ...(deviceParam ? { device: deviceParam } : {}),
      },
    };

    const timer = setTimeout(() => {
      this.pending.delete(id);
      this.setStatus("error");
      this.rejectConnect(new Error("Handshake timeout (15s)"));
    }, HANDSHAKE_TIMEOUT_MS);

    this.pending.set(id, {
      resolve: () => {},
      reject: (err) => {
        // Server explicitly rejected the handshake — stop retrying immediately.
        this.autoReconnect = false;
        const isRateLimited = /rate.limit|too many/i.test(err.message);
        this.setStatus(isRateLimited ? "rate_limited" : "auth_failed");
        this.rejectConnect(err);
      },
      timer,
    });

    this.ws?.send(JSON.stringify(frame));
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<GatewayFrame> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    const id = nextId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const frame: GatewayFrame = { type: "req", id, method, params };
      this.ws!.send(JSON.stringify(frame));
    });
  }

  onFinalResponse(fn: (frame: GatewayFrame) => void): () => void {
    return this.on("__final_res__", fn as Listener);
  }

  disconnect() {
    this.intentionalClose = true;
    this.autoReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.connectSettled = true;
    this.connectReject = null;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._grantedScopes.clear();
    this.clearPending();
    this.setStatus("disconnected");
  }
}

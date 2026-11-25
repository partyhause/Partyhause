/**
 * MCP transport abstraction.
 *
 * A transport is a bidirectional JSON-RPC pipe to an MCP server. Implementations
 * exist for stdio (spawned subprocess) and SSE (remote server over HTTP).
 */

import { TransportClosedError } from './protocol.js';
import type { JsonRpcRequest, JsonRpcNotification, PendingRequest } from './protocol.js';

/** A transport that can send JSON-RPC and emit incoming messages. */
export interface McpTransport {
  /** Whether the transport is currently open. */
  readonly connected: boolean;
  /** Emitted when a JSON-RPC message arrives from the server. */
  onMessage: (handler: (message: unknown) => void) => void;
  /** Emitted when the transport closes or fails. */
  onClose: (handler: (error?: Error) => void) => void;
  /** Send a JSON-RPC request and await its response. */
  request<T>(payload: JsonRpcRequest): Promise<T>;
  /** Send a JSON-RPC notification (no response expected). */
  notify(payload: JsonRpcNotification): Promise<void>;
  /** Open the transport. */
  connect(): Promise<void>;
  /** Close the transport. */
  close(): Promise<void>;
}

/** Options shared by all transports. */
export interface McpTransportOptions {
  /** Milliseconds to wait for a response before rejecting. Default 30s. */
  requestTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Base transport handling request/response correlation and timeouts.
 * Subclasses implement the actual send wire and lifecycle.
 */
export abstract class BaseMcpTransport implements McpTransport {
  protected readonly timeoutMs: number;
  private readonly pending = new Map<string | number, PendingRequest>();
  private messageHandler: ((message: unknown) => void) | null = null;
  private closeHandler: ((error?: Error) => void) | null = null;
  private _connected = false;
  private closed = false;

  constructor(options: McpTransportOptions = {}) {
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get connected(): boolean {
    return this._connected && !this.closed;
  }

  onMessage(handler: (message: unknown) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }

  protected abstract sendRaw(payload: string): Promise<void>;
  protected abstract doConnect(): Promise<void>;
  protected abstract doClose(): Promise<void>;

  protected handleIncoming(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    this.messageHandler?.(parsed);
  }

  protected settleError(id: string | number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.reject(error);
  }

  protected handleClose(error?: Error): void {
    this.closed = true;
    this._connected = false;
    for (const pending of this.pending.values()) {
      pending.reject(error ?? new TransportClosedError());
    }
    this.pending.clear();
    this.closeHandler?.(error);
  }

  async connect(): Promise<void> {
    if (this.closed) throw new TransportClosedError();
    this._connected = true;
    await this.doConnect();
  }

  async close(): Promise<void> {
    this.closed = true;
    this._connected = false;
    await this.doClose();
    this.handleClose();
  }

  async request<T>(payload: JsonRpcRequest): Promise<T> {
    if (this.closed) throw new TransportClosedError();
    const id = payload.id;
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const pending: PendingRequest = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e: unknown) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.pending.set(id, pending);
      timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${String(id)} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      void this.sendRaw(JSON.stringify(payload)).catch((err: unknown) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async notify(payload: JsonRpcNotification): Promise<void> {
    if (this.closed) throw new TransportClosedError();
    await this.sendRaw(JSON.stringify(payload));
  }
}

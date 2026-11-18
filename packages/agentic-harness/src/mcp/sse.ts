/**
 * MCP transport over SSE (Server-Sent Events) + POST.
 *
 * Connects to a remote MCP server that exposes an SSE endpoint for server→client
 * messages and a POST endpoint for client→server messages.
 */

// EventSource and fetch are Node 18+ globals.
import { BaseMcpTransport } from './transport.js';

export interface SseMcpTransportOptions {
  /** SSE endpoint URL (server → client). */
  sseUrl: string;
  /** POST endpoint URL (client → server). Defaults to `sseUrl`. */
  postUrl?: string;
  /** Milliseconds to wait for a response. */
  requestTimeoutMs?: number;
  /** Extra headers sent with POST requests. */
  headers?: Record<string, string>;
}

/** MCP transport backed by SSE for inbound and fetch POST for outbound. */
export class SseMcpTransport extends BaseMcpTransport {
  private eventSource: EventSource | null = null;
  private readonly postUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly options: SseMcpTransportOptions) {
    super(options);
    this.postUrl = options.postUrl ?? options.sseUrl;
    this.headers = { 'Content-Type': 'application/json', ...options.headers };
  }

  protected async doConnect(): Promise<void> {
    this.eventSource = new EventSource(this.options.sseUrl);

    this.eventSource.addEventListener('message', (event: MessageEvent) => {
      if (event.data) this.handleIncoming(event.data);
    });

    this.eventSource.onerror = (err: unknown) => {
      this.handleClose(err instanceof Error ? err : new Error('MCP SSE error'));
    };

    this.eventSource.onopen = () => {
      // Connection established; no further action needed.
    };
  }

  protected async doClose(): Promise<void> {
    const es = this.eventSource;
    this.eventSource = null;
    if (es) es.close();
  }

  protected async sendRaw(payload: string): Promise<void> {
    const { postUrl } = this;
    const response = await fetch(postUrl, {
      method: 'POST',
      headers: this.headers,
      body: payload,
    });
    if (!response.ok) {
      throw new Error(`MCP SSE POST failed: ${response.status} ${response.statusText}`);
    }
  }

  /** Convenience: build an SSE transport from a base URL. */
  static create(baseUrl: string, headers?: Record<string, string>): SseMcpTransport {
    return new SseMcpTransport({ sseUrl: baseUrl, postUrl: baseUrl, headers });
  }
}

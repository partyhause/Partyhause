/**
 * MCP transport over stdio: spawns a subprocess and speaks JSON-RPC on its
 * stdin/stdout. Good for local, long-lived MCP servers (filesystem, git, etc.).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { BaseMcpTransport } from './transport.js';

export interface StdioMcpTransportOptions {
  /** Command to spawn (e.g. `npx @modelcontextprotocol/server-filesystem`). */
  command: string;
  /** Arguments to the command. */
  args?: string[];
  /** Environment variables merged with `process.env`. */
  env?: Record<string, string>;
  /** Working directory for the subprocess. */
  cwd?: string;
  /** Milliseconds to wait for a response. */
  requestTimeoutMs?: number;
}

/** MCP transport backed by a spawned child process's stdio streams. */
export class StdioMcpTransport extends BaseMcpTransport {
  private process: ChildProcess | null = null;
  private stdoutBuffer = '';

  constructor(private readonly options: StdioMcpTransportOptions) {
    super(options);
  }

  protected async doConnect(): Promise<void> {
    const { command, args = [], env, cwd } = this.options;
    this.process = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    if (!this.process.stdout) {
      throw new Error(`Failed to open stdout for MCP command: ${command}`);
    }

    this.process.stdout.on('data', (chunk: Buffer) => {
      this.handleIncomingChunk(chunk.toString('utf8'));
    });

    this.process.stdout.on('end', () => {
      this.handleClose(new Error('MCP stdio stdout ended'));
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    this.process.on('error', (err) => {
      this.handleClose(err);
    });

    this.process.on('exit', (code, signal) => {
      this.handleClose(
        code === 0 && !signal
          ? undefined
          : new Error(`MCP subprocess exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (signal ${signal})` : ''}`)
      );
    });
  }

  protected async doClose(): Promise<void> {
    const proc = this.process;
    this.process = null;
    if (!proc) return;
    if (proc.exitCode === null && proc.killed === false) {
      proc.kill();
    }
  }

  protected sendRaw(payload: string): Promise<void> {
    const proc = this.process;
    if (!proc || !proc.stdin || proc.stdin.destroyed) {
      throw new Error('MCP stdio transport is not connected');
    }
    const stdin = proc.stdin;
    return new Promise((resolve, reject) => {
      stdin.write(`${payload}\n`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private handleIncomingChunk(text: string): void {
    this.stdoutBuffer += text;
    let index: number;
    while ((index = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line) this.handleIncoming(line);
    }
  }

  /** Convenience: build a stdio transport from a command string. */
  static create(command: string, args?: string[], env?: Record<string, string>): StdioMcpTransport {
    return new StdioMcpTransport({ command, args, env });
  }
}

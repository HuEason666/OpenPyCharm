/** Minimal Debug Adapter Protocol client over a framed Tauri bridge session. */

export interface DapThread {
  id: number;
  name: string;
}

export interface DapFrame {
  id: number;
  name: string;
  source?: { path?: string };
  line: number;
  column: number;
}

export interface DapScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}

export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

interface PendingRequest {
  resolve: (body: unknown) => void;
  reject: (error: Error) => void;
}

export class DapClient {
  private seq = 0;
  private pending = new Map<number, PendingRequest>();
  private handlers = new Map<string, Set<(body: unknown) => void>>();

  constructor(private readonly sendRaw: (message: string) => void) {}

  request<T = unknown>(command: string, args: unknown = {}): Promise<T> {
    const seq = ++this.seq;
    const message = JSON.stringify({ seq, type: "request", command, arguments: args });
    this.sendRaw(message);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(seq, {
        resolve: (body) => resolve(body as T),
        reject,
      });
    });
  }

  on(event: string, handler: (body: unknown) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  handle(raw: string): void {
    let message: {
      type?: string;
      request_seq?: number;
      success?: boolean;
      message?: string;
      body?: unknown;
      event?: string;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === "response") {
      const pending = message.request_seq !== undefined ? this.pending.get(message.request_seq) : undefined;
      if (!pending) return;
      this.pending.delete(message.request_seq!);
      if (message.success) pending.resolve(message.body);
      else pending.reject(new Error(message.message ?? "Debug adapter request failed"));
      return;
    }
    if (message.type === "event" && message.event) {
      for (const handler of this.handlers.get(message.event) ?? []) handler(message.body);
    }
  }

  dispose(): void {
    for (const pending of this.pending.values()) pending.reject(new Error("Debug session ended"));
    this.pending.clear();
    this.handlers.clear();
  }
}

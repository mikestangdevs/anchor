/**
 * Async semaphore with configurable concurrency limit and timeout.
 * 
 * Used to cap concurrent OpenAI embedding calls so the server
 * behaves predictably under load instead of piling up requests.
 */
export class Semaphore {
  private active = 0;
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  constructor(
    private readonly concurrency: number,
    private readonly timeoutMs: number = 30_000,
  ) {}

  get activeCount() { return this.active; }
  get queueLength() { return this.queue.length; }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((e) => e.resolve === resolve);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new Error(`Semaphore timeout: waited ${this.timeoutMs}ms (queue: ${this.queue.length}, active: ${this.active})`));
      }, this.timeoutMs);

      this.queue.push({
        resolve: () => { clearTimeout(timer); resolve(); },
        reject,
      });
    });
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next.resolve();
    }
  }
}

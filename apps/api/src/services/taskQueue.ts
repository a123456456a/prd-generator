// Future: RedisTaskQueue for multi-instance

export interface TaskQueue {
  /** Run fn when a slot is available; resolves after fn completes. */
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  get pending(): number;
  get active(): number;
}

export class InProcessQueue implements TaskQueue {
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  get pending(): number {
    return this.waiters.length;
  }

  get active(): number {
    return this.running;
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.running += 1;
        try {
          resolve(await fn());
        } catch (error) {
          reject(error);
        } finally {
          this.running -= 1;
          this.drain();
        }
      };

      if (this.running < this.maxConcurrent) {
        void run();
      } else {
        this.waiters.push(() => {
          void run();
        });
      }
    });
  }

  private drain(): void {
    while (this.running < this.maxConcurrent && this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
}

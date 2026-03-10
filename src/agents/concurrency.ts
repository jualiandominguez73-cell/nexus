/**
 * Simple concurrency semaphore to limit parallel LLM calls.
 * Prevents rate-limit storms when multiple messages arrive simultaneously.
 */
export class Semaphore {
    private queue: (() => void)[] = [];
    private running = 0;

    constructor(private readonly maxConcurrent: number) {}

    async acquire(): Promise<void> {
        if (this.running < this.maxConcurrent) {
            this.running++;
            return;
        }
        return new Promise<void>(resolve => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        this.running--;
        const next = this.queue.shift();
        if (next) {
            this.running++;
            next();
        }
    }

    get pending(): number {
        return this.queue.length;
    }

    get active(): number {
        return this.running;
    }
}

/** Global LLM semaphore: max 5 concurrent calls to Groq/OpenRouter */
export const llmSemaphore = new Semaphore(5);

/**
 * Wraps a promise with a timeout. Rejects if the promise doesn't resolve in time.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Operation'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);

        promise.then(
            val => { clearTimeout(timer); resolve(val); },
            err => { clearTimeout(timer); reject(err); }
        );
    });
}

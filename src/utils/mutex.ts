
export class AsyncMutex {
    private isLocked: boolean = false;
    private waitQueue: Array<() => void> = [];

    private async acquire(): Promise<void> {
        if (!this.isLocked) {
            this.isLocked = true;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.waitQueue.push(resolve);
        });
    }

    private release(): void {
        if (this.waitQueue.length > 0) {
            const nextResolve = this.waitQueue.shift();
            if (nextResolve) {
                nextResolve();
            }
        } else {
            this.isLocked = false;
        }
    }

    public async invoke<T, A extends any[]>(
        func: (...args: A) => Promise<T> | T,
        ...args: A
    ): Promise<T> {
        await this.acquire();

        try {
            return await func(...args);
        } finally {
            this.release();
        }
    }
}

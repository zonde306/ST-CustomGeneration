/**
 * Concurrency Limiter - A utility for executing tasks with controlled concurrency
 */

export type ExecuteMode = 'all' | 'allSettled';

/**
 * Execute an array of task functions with limited concurrency.
 * 
 * @param tasks - Array of functions that return promises
 * @param maxConcurrency - Maximum number of concurrent executions (default: 1, minimum: 1)
 * @param mode - Result aggregation mode: 'all' (like Promise.all) or 'allSettled' (like Promise.allSettled)
 * @returns Promise with results in the same order as input tasks
 */
export async function execute<T>(
    tasks: (() => Promise<T>)[],
    maxConcurrency: number = 1,
    mode: ExecuteMode = 'allSettled',
): Promise<PromiseSettledResult<T>[]> {
    // Ensure maxConcurrency is at least 1
    const concurrency = Math.max(1, Math.floor(maxConcurrency));
    
    if (tasks.length === 0) {
        return [];
    }

    const results: PromiseSettledResult<T>[] = new Array(tasks.length);
    let runningCount = 0;
    let nextIndex = 0;
    
    let resolveAll: (value: PromiseSettledResult<T>[]) => void;
    const allPromise = new Promise<PromiseSettledResult<T>[]>((resolve) => {
        resolveAll = resolve;
    });

    const runNext = (): void => {
        // Check if all tasks are done
        if (nextIndex >= tasks.length && runningCount === 0) {
            resolveAll(results);
            return;
        }

        // Start new tasks up to concurrency limit
        while (runningCount < concurrency && nextIndex < tasks.length) {
            const currentIndex = nextIndex++;
            const task = tasks[currentIndex];
            runningCount++;

            task()
                .then((value) => {
                    results[currentIndex] = { status: 'fulfilled', value };
                })
                .catch((reason) => {
                    results[currentIndex] = { status: 'rejected', reason };
                })
                .finally(() => {
                    runningCount--;
                    runNext();
                });
        }
    };

    runNext();

    const settledResults = await allPromise;

    // In 'all' mode, throw if any task rejected
    if (mode === 'all') {
        const rejected = settledResults.find(r => r.status === 'rejected');
        if (rejected && rejected.status === 'rejected') {
            throw rejected.reason;
        }
    }

    return settledResults;
}

/**
 * Execute tasks and return fulfilled values only (throws on first rejection).
 * This is a convenience wrapper for execute with mode 'all'.
 */
export async function executeAll<T>(
    tasks: (() => Promise<T>)[],
    maxConcurrency: number = 1,
): Promise<T[]> {
    const results = await execute(tasks, maxConcurrency, 'all');
    return results
        .filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled')
        .map(r => r.value);
}

/**
 * Execute tasks and return all settled results.
 * This is a convenience wrapper for execute with mode 'allSettled'.
 */
export async function executeAllSettled<T>(
    tasks: (() => Promise<T>)[],
    maxConcurrency: number = 1,
): Promise<PromiseSettledResult<T>[]> {
    return execute(tasks, maxConcurrency, 'allSettled');
}

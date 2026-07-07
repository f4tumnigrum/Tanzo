export interface Semaphore {
  acquire(signal?: AbortSignal): Promise<() => void>
}

class SemaphoreAcquireAborted extends Error {
  constructor() {
    super('Semaphore acquire aborted')
  }
}

export function createSemaphore(max: number): Semaphore {
  let available = max
  const waiters: Array<(release: () => void) => void> = []

  function grant(): () => void {
    let released = false
    return function release(): void {
      if (released) return
      released = true
      available++
      const next = waiters.shift()
      if (next) {
        available--
        next(grant())
      }
    }
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(new SemaphoreAcquireAborted())
      if (available > 0) {
        available--
        return Promise.resolve(grant())
      }
      return new Promise<() => void>((resolve, reject) => {
        const waiter = (release: () => void): void => {
          signal?.removeEventListener('abort', onAbort)
          resolve(release)
        }
        const onAbort = (): void => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new SemaphoreAcquireAborted())
        }
        waiters.push(waiter)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
}

export function createDepthPools(perDepth: number): {
  acquire(depth: number, signal?: AbortSignal): Promise<() => void>
} {
  const pools = new Map<number, Semaphore>()
  return {
    acquire(depth: number, signal?: AbortSignal) {
      let pool = pools.get(depth)
      if (!pool) {
        pool = createSemaphore(perDepth)
        pools.set(depth, pool)
      }
      return pool.acquire(signal)
    }
  }
}

export interface KeyedSemaphores {
  acquire(key: string, signal?: AbortSignal): Promise<() => void>
}

export function createKeyedSemaphores(perKey: number): KeyedSemaphores {
  const pools = new Map<string, { semaphore: Semaphore; refs: number }>()
  return {
    async acquire(key, signal) {
      let entry = pools.get(key)
      if (!entry) {
        entry = { semaphore: createSemaphore(perKey), refs: 0 }
        pools.set(key, entry)
      }
      entry.refs++
      const drop = (): void => {
        entry.refs--
        if (entry.refs === 0 && pools.get(key) === entry) pools.delete(key)
      }
      let release: () => void
      try {
        release = await entry.semaphore.acquire(signal)
      } catch (error) {
        drop()
        throw error
      }
      let released = false
      return () => {
        if (released) return
        released = true
        release()
        drop()
      }
    }
  }
}

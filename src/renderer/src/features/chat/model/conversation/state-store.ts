export interface StateStore<T> {
  subscribe(listener: () => void): () => void
  getState(): T
  setState(patch: Partial<T>): void

  update(updater: (state: T) => Partial<T>): void
  dispose(): void
}

export function createStateStore<T extends object>(initial: T): StateStore<T> {
  let state = initial
  const listeners = new Set<() => void>()
  let disposed = false

  const apply = (patch: Partial<T>): void => {
    if (disposed) return
    let changed = false
    for (const key of Object.keys(patch) as Array<keyof T>) {
      if (!Object.is(state[key], patch[key])) {
        changed = true
        break
      }
    }
    if (!changed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    setState: apply,
    update(updater) {
      apply(updater(state))
    },
    dispose() {
      disposed = true
      listeners.clear()
    }
  }
}

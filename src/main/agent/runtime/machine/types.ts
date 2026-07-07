export interface Transition<S, Eff> {
  readonly state: S
  readonly effects: readonly Eff[]
}

export function stay<S, Eff>(state: S): Transition<S, Eff> {
  return { state, effects: [] }
}

export function next<S, Eff>(state: S, effects: readonly Eff[] = []): Transition<S, Eff> {
  return { state, effects }
}

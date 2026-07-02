/**
 * State-machine foundation shared by the agent runtime's explicit state machines
 * (goal, turn-loop, subagent-task).
 *
 * Each machine is split into a pure functional core and an imperative shell:
 *
 *   - The `*Transition` core is a PURE function: no I/O, no randomness, no clock
 *     reads. Everything non-deterministic (Date.now(), randomUUID(), external
 *     snapshots) must arrive as event payloads.
 *   - Effects are DESCRIPTIONS (discriminated unions), not function calls. The
 *     caller's shell (goal/service.ts, subagent/task-service.ts) is the only
 *     place that turns an effect into real I/O.
 *   - Illegal transitions are a no-op: return the same state with no effects
 *     via `stay(state)`. A transition never throws.
 *
 * The cores expose plain functions (`goalTransition`, `taskTransition`,
 * `decideTurnOutcome`) rather than a shared `Machine` object; the only contract
 * they share is the `Transition` result shape and the `next`/`stay` builders
 * below.
 */

/** Result of a transition: the next state plus effects to interpret. */
export interface Transition<S, Eff> {
  readonly state: S
  readonly effects: readonly Eff[]
}

/** Convenience builders for the common transition shapes. */
export function stay<S, Eff>(state: S): Transition<S, Eff> {
  return { state, effects: [] }
}

export function next<S, Eff>(state: S, effects: readonly Eff[] = []): Transition<S, Eff> {
  return { state, effects }
}

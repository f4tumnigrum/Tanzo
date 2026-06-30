/**
 * Maps compact `@eN` refs to the CDP backend node they describe. Lives in the
 * main process — the untrusted page never sees it. Rebuilt on every snapshot
 * and invalidated implicitly: a fresh snapshot replaces all entries, so a ref
 * from a stale snapshot will not resolve after the page changes.
 */
export interface RefEntry {
  backendNodeId: number
  role: string
  name: string
  /** Frame that owns this node, for cross-frame interaction. Empty = main frame. */
  frameId?: string
}

export class RefMap {
  private readonly map = new Map<string, RefEntry>()
  private counter = 0

  /** Assign and store the next sequential ref for a node. Returns "eN". */
  add(entry: RefEntry): string {
    this.counter += 1
    const ref = `e${this.counter}`
    this.map.set(ref, entry)
    return ref
  }

  get(ref: string): RefEntry | undefined {
    return this.map.get(this.normalize(ref))
  }

  clear(): void {
    this.map.clear()
    this.counter = 0
  }

  get size(): number {
    return this.map.size
  }

  /** Accept "e12", "@e12", or "ref=e12" and normalize to "e12". */
  private normalize(ref: string): string {
    const trimmed = ref.trim()
    if (trimmed.startsWith('@')) return trimmed.slice(1)
    if (trimmed.startsWith('ref=')) return trimmed.slice(4)
    return trimmed
  }
}

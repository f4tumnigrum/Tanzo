import type { CdpSession } from './cdp-session'
import type { BoxModel, NodeForLocationResult, ResolveNodeResult } from './cdp-types'
import type { RefEntry, RefMap } from './ref-map'

export interface Point {
  x: number
  y: number
}

export type InteractionError = { error: string }

function isError<T>(value: T | InteractionError): value is InteractionError {
  return typeof value === 'object' && value !== null && 'error' in value
}

/** Resolve a ref's center point in viewport coordinates via its box model. */
async function refCenter(session: CdpSession, entry: RefEntry): Promise<Point | InteractionError> {
  try {
    const box = await session.send<BoxModel>('DOM.getBoxModel', {
      backendNodeId: entry.backendNodeId
    })
    const q = box.model.content
    // content quad: [x1,y1, x2,y2, x3,y3, x4,y4]
    const x = (q[0] + q[2] + q[4] + q[6]) / 4
    const y = (q[1] + q[3] + q[5] + q[7]) / 4
    return { x, y }
  } catch {
    return { error: 'ref-not-found' }
  }
}

/** Resolve a ref to a Runtime objectId for JS-level operations (value, text). */
async function refObjectId(
  session: CdpSession,
  entry: RefEntry
): Promise<string | InteractionError> {
  try {
    const resolved = await session.send<ResolveNodeResult>('DOM.resolveNode', {
      backendNodeId: entry.backendNodeId
    })
    const objectId = resolved.object.objectId
    if (!objectId) return { error: 'ref-not-found' }
    return objectId
  } catch {
    return { error: 'ref-not-found' }
  }
}

/** Scroll the node into view so its box model is valid and clicks land. */
async function scrollIntoView(session: CdpSession, entry: RefEntry): Promise<void> {
  try {
    await session.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: entry.backendNodeId })
  } catch {
    // Some nodes (detached, display:contents) reject this; clicks will still
    // surface a clear error from the box-model resolution below.
  }
}

function lookup(refMap: RefMap, ref: string): RefEntry | InteractionError {
  const entry = refMap.get(ref)
  if (!entry) return { error: 'ref-not-found' }
  return entry
}

export async function clickRef(
  session: CdpSession,
  refMap: RefMap,
  ref: string
): Promise<{ ok: true } | InteractionError> {
  const entry = lookup(refMap, ref)
  if (isError(entry)) return entry
  await scrollIntoView(session, entry)
  const center = await refCenter(session, entry)
  if (isError(center)) return center

  // Occlusion check: what element is actually at the click point?
  try {
    const hit = await session.send<NodeForLocationResult>('DOM.getNodeForLocation', {
      x: Math.round(center.x),
      y: Math.round(center.y),
      includeUserAgentShadowDOM: false
    })
    if (hit.backendNodeId && hit.backendNodeId !== entry.backendNodeId) {
      const covering = await describeBackendNode(session, hit.backendNodeId)
      // Only treat as covered when the hit node is not a descendant; descendant
      // hits (e.g. a label span inside a button) are fine.
      const isSelf = await isSameOrDescendant(session, entry.backendNodeId, hit.backendNodeId)
      if (!isSelf) return { error: 'covered', covering } as InteractionError & { covering?: string }
    }
  } catch {
    // Location probing is best-effort; proceed with the click.
  }

  await dispatchMouse(session, 'mouseMoved', center)
  await dispatchMouse(session, 'mousePressed', center, 'left', 1)
  await dispatchMouse(session, 'mouseReleased', center, 'left', 1)
  return { ok: true }
}

export async function hoverRef(
  session: CdpSession,
  refMap: RefMap,
  ref: string
): Promise<{ ok: true } | InteractionError> {
  const entry = lookup(refMap, ref)
  if (isError(entry)) return entry
  await scrollIntoView(session, entry)
  const center = await refCenter(session, entry)
  if (isError(center)) return center
  await dispatchMouse(session, 'mouseMoved', center)
  return { ok: true }
}

export async function typeRef(
  session: CdpSession,
  refMap: RefMap,
  ref: string,
  text: string,
  clear: boolean
): Promise<{ ok: true } | InteractionError> {
  const entry = lookup(refMap, ref)
  if (isError(entry)) return entry
  await scrollIntoView(session, entry)
  try {
    await session.send('DOM.focus', { backendNodeId: entry.backendNodeId })
  } catch {
    return { error: 'not-editable' }
  }
  if (clear) {
    const cleared = await clearField(session, entry)
    if (isError(cleared)) return cleared
  }
  // insertText emits a real input event through the focused element.
  await session.send('Input.insertText', { text })
  return { ok: true }
}

export async function selectRef(
  session: CdpSession,
  refMap: RefMap,
  ref: string,
  value: string
): Promise<{ ok: true } | InteractionError> {
  const entry = lookup(refMap, ref)
  if (isError(entry)) return entry
  const objectId = await refObjectId(session, entry)
  if (isError(objectId)) return objectId
  // Set the <select> value and fire change so frameworks observe it.
  const result = await session.send<{ result: { value?: boolean } }>('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function (val) {
      if (!('options' in this)) return false;
      const opt = Array.from(this.options).find(o => o.value === val || o.label === val || o.text === val);
      if (!opt) return false;
      this.value = opt.value;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }`,
    arguments: [{ value }],
    returnByValue: true
  })
  if (result.result.value !== true) return { error: 'option-not-found' }
  return { ok: true }
}

const KEY_DEFS: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
}

export async function pressKey(
  session: CdpSession,
  key: string
): Promise<{ ok: true } | InteractionError> {
  const def = KEY_DEFS[key]
  if (!def) return { error: `Unsupported key "${key}".` }
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode
  })
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode
  })
  return { ok: true }
}

export async function scrollBy(
  session: CdpSession,
  dx: number,
  dy: number
): Promise<{ scrollX: number; scrollY: number } | InteractionError> {
  // Dispatch a real wheel event at the viewport center so overflow containers
  // and virtualized lists react the same way they do for a user.
  const metrics = await session.send<{
    layoutViewport: { clientWidth: number; clientHeight: number }
  }>('Page.getLayoutMetrics')
  const vw = metrics.layoutViewport.clientWidth
  const vh = metrics.layoutViewport.clientHeight
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(vw / 2),
    y: Math.round(vh / 2),
    deltaX: dx,
    deltaY: dy
  })
  const pos = await readScrollPosition(session)
  return pos
}

export async function readText(
  session: CdpSession,
  refMap: RefMap,
  ref?: string
): Promise<{ text: string } | InteractionError> {
  let objectId: string | InteractionError
  if (ref) {
    const entry = lookup(refMap, ref)
    if (isError(entry)) return entry
    objectId = await refObjectId(session, entry)
  } else {
    const evaluated = await session
      .send<ResolveNodeResult>('Runtime.evaluate', {
        expression: 'document.body',
        objectGroup: 'tanzo'
      })
      .then((r) => r as unknown as { result: { objectId?: string } })
    objectId = evaluated.result.objectId ?? { error: 'ref-not-found' }
  }
  if (isError(objectId)) return objectId

  const result = await session.send<{ result: { value?: string } }>('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function () {
      const t = (this.innerText || this.textContent || '');
      return t.replace(/\\n{3,}/g, '\\n\\n').trim();
    }`,
    returnByValue: true
  })
  return { text: result.result.value ?? '' }
}

// --- internal helpers ---------------------------------------------------------

async function dispatchMouse(
  session: CdpSession,
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
  point: Point,
  button?: 'left',
  clickCount?: number
): Promise<void> {
  await session.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    ...(button ? { button } : {}),
    ...(clickCount ? { clickCount, buttons: 1 } : {})
  })
}

async function clearField(
  session: CdpSession,
  entry: RefEntry
): Promise<{ ok: true } | InteractionError> {
  const objectId = await refObjectId(session, entry)
  if (isError(objectId)) return objectId
  await session.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function () {
      if ('value' in this) { this.value = ''; this.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (this.isContentEditable) { this.textContent = ''; }
    }`
  })
  return { ok: true }
}

async function readScrollPosition(
  session: CdpSession
): Promise<{ scrollX: number; scrollY: number }> {
  const result = await session.send<{ result: { value?: { scrollX: number; scrollY: number } } }>(
    'Runtime.evaluate',
    {
      expression: '({ scrollX: window.scrollX, scrollY: window.scrollY })',
      returnByValue: true
    }
  )
  return result.result.value ?? { scrollX: 0, scrollY: 0 }
}

async function describeBackendNode(session: CdpSession, backendNodeId: number): Promise<string> {
  try {
    const described = await session.send<{ node: { nodeName: string; attributes?: string[] } }>(
      'DOM.describeNode',
      { backendNodeId }
    )
    const tag = described.node.nodeName.toLowerCase()
    const attrs = described.node.attributes ?? []
    const ariaIdx = attrs.indexOf('aria-label')
    if (ariaIdx >= 0 && attrs[ariaIdx + 1]) return `${tag} "${attrs[ariaIdx + 1].slice(0, 60)}"`
    return tag
  } catch {
    return 'another element'
  }
}

async function isSameOrDescendant(
  session: CdpSession,
  ancestorBackendId: number,
  candidateBackendId: number
): Promise<boolean> {
  if (ancestorBackendId === candidateBackendId) return true
  try {
    const ancestor = await session.send<ResolveNodeResult>('DOM.resolveNode', {
      backendNodeId: ancestorBackendId
    })
    const candidate = await session.send<ResolveNodeResult>('DOM.resolveNode', {
      backendNodeId: candidateBackendId
    })
    if (!ancestor.object.objectId || !candidate.object.objectId) return false
    const result = await session.send<{ result: { value?: boolean } }>('Runtime.callFunctionOn', {
      objectId: ancestor.object.objectId,
      functionDeclaration: 'function (other) { return this.contains(other); }',
      arguments: [{ objectId: candidate.object.objectId }],
      returnByValue: true
    })
    return result.result.value === true
  } catch {
    return false
  }
}

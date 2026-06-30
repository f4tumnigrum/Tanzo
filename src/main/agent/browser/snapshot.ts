import type { CdpSession } from './cdp-session'
import type { AXNode, DescribeNodeResult, GetFullAXTreeResult } from './cdp-types'
import { RefMap } from './ref-map'

/** Roles that get a ref because the agent can act on them. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
  'Iframe'
])

/** Roles emitted for context (text/structure) but not necessarily actionable. */
const CONTENT_ROLES = new Set([
  'heading',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'listitem',
  'article',
  'img'
])

const SNAPSHOT_NODE_CAP = 1500

/** Names longer than this are truncated in the tree output to save tokens. */
const NAME_MAX = 80

export interface SnapshotBuild {
  tree: string
  nodeCount: number
  truncated: boolean
}

interface BuildState {
  session: CdpSession
  refMap: RefMap
  lines: string[]
  count: number
  truncated: boolean
  /** Interactive mode emits only actionable nodes; content nodes are dropped. */
  interactive: boolean
}

function axText(value?: { value?: unknown }): string {
  if (!value || typeof value.value !== 'string') return ''
  return value.value.replace(/\s+/g, ' ').trim()
}

function propBool(node: AXNode, name: string): boolean {
  return node.properties?.some((p) => p.name === name && p.value.value === true) ?? false
}

function propValue(node: AXNode, name: string): unknown {
  return node.properties?.find((p) => p.name === name)?.value.value
}

function attrSummary(node: AXNode, role: string): string[] {
  const parts: string[] = []
  if (propBool(node, 'disabled')) parts.push('disabled')
  if (propBool(node, 'required')) parts.push('required')
  const checked = propValue(node, 'checked')
  if (checked === true || checked === 'true' || checked === 'mixed') {
    parts.push(checked === 'mixed' ? 'mixed' : 'checked')
  }
  if (propValue(node, 'selected') === true) parts.push('selected')
  if (propValue(node, 'expanded') === true) parts.push('expanded')
  if (role === 'heading') {
    const level = propValue(node, 'level')
    if (typeof level === 'number') parts.push(`h${level}`)
  }
  return parts
}

function buildLine(
  depth: number,
  ref: string | null,
  role: string,
  name: string,
  attrs: string[]
): string {
  const indent = '  '.repeat(depth)
  const head = ref ? `${indent}@${ref} [${role}]` : `${indent}[${role}]`
  const named = name
    ? `${head} "${name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 3)}...` : name}"`
    : head
  return attrs.length ? `${named} ${attrs.join(' ')}` : named
}

/**
 * Walk the accessibility tree from `nodeId`, emitting a compact indented tree
 * and assigning `@eN` refs to interactive/content nodes. Iframe owner nodes are
 * expanded one level by resolving the child frame's own AX tree.
 */
async function walk(
  state: BuildState,
  byId: Map<string, AXNode>,
  nodeId: string,
  depth: number,
  frameId: string | undefined,
  allowFrameExpansion: boolean
): Promise<void> {
  if (state.truncated) return
  const node = byId.get(nodeId)
  if (!node || node.ignored) {
    // Skip ignored nodes but keep walking their children at the same depth.
    if (node?.childIds) {
      for (const childId of node.childIds) {
        await walk(state, byId, childId, depth, frameId, allowFrameExpansion)
      }
    }
    return
  }

  const role = axText(node.role)
  const name = axText(node.name) || axText(node.description)
  const isInteractive = INTERACTIVE_ROLES.has(role)
  const isContent = CONTENT_ROLES.has(role) && name.length > 0
  // Interactive mode (default) emits only actionable nodes, mirroring
  // agent-browser's `snapshot -i`. Full mode also emits named content nodes.
  const emit = isInteractive || (!state.interactive && isContent)

  let nextDepth = depth
  if (emit && node.backendDOMNodeId !== undefined) {
    if (state.count >= SNAPSHOT_NODE_CAP) {
      state.truncated = true
      return
    }
    state.count += 1
    const ref = state.refMap.add({
      backendNodeId: node.backendDOMNodeId,
      role,
      name,
      ...(frameId ? { frameId } : {})
    })
    state.lines.push(buildLine(depth, ref, role, name, attrSummary(node, role)))
    nextDepth = depth + 1

    // Inline one level of iframe content.
    if (role === 'Iframe' && allowFrameExpansion) {
      await expandFrame(state, node, nextDepth)
      return
    }
  }

  for (const childId of node.childIds ?? []) {
    await walk(state, byId, childId, nextDepth, frameId, allowFrameExpansion)
  }
}

/** Resolve an iframe owner's child document and inline its AX subtree. */
async function expandFrame(state: BuildState, ownerNode: AXNode, depth: number): Promise<void> {
  if (ownerNode.backendDOMNodeId === undefined) return
  try {
    const described = await state.session.send<DescribeNodeResult>('DOM.describeNode', {
      backendNodeId: ownerNode.backendDOMNodeId
    })
    const childDocId = described.node.contentDocument?.backendNodeId
    const frameId = described.node.frameId
    if (childDocId === undefined) return

    const frameTree = await state.session.send<GetFullAXTreeResult>('Accessibility.getFullAXTree', {
      backendNodeId: childDocId
    })
    if (frameTree.nodes.length === 0) return
    const byId = new Map(frameTree.nodes.map((n) => [n.nodeId, n]))
    // The first node is the frame's root document.
    await walk(state, byId, frameTree.nodes[0].nodeId, depth, frameId, false)
  } catch {
    // Cross-origin frames that block AX access are silently skipped.
  }
}

export interface SnapshotOptions {
  selector?: string
  /** Default true: emit only actionable nodes. False emits content nodes too. */
  interactive?: boolean
}

/**
 * Capture a compact accessibility snapshot of the page (or a subtree). Rebuilds
 * the ref map from scratch so prior refs become invalid. Interactive mode
 * (default) emits only actionable elements to keep the snapshot small.
 */
export async function buildSnapshot(
  session: CdpSession,
  refMap: RefMap,
  options: SnapshotOptions = {}
): Promise<SnapshotBuild | { error: string }> {
  const { selector, interactive = true } = options
  refMap.clear()

  let rootBackendId: number | undefined
  if (selector) {
    const doc = await session.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 })
    const found = await session.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector
    })
    if (!found.nodeId) return { error: 'root-not-found' }
    const described = await session.send<{ node: { backendNodeId: number } }>('DOM.describeNode', {
      nodeId: found.nodeId
    })
    rootBackendId = described.node.backendNodeId
  }

  const tree = await session.send<GetFullAXTreeResult>(
    'Accessibility.getFullAXTree',
    rootBackendId !== undefined ? { backendNodeId: rootBackendId } : {}
  )
  if (tree.nodes.length === 0) return { error: 'empty-tree' }

  const byId = new Map(tree.nodes.map((n) => [n.nodeId, n]))
  const state: BuildState = {
    session,
    refMap,
    lines: [],
    count: 0,
    truncated: false,
    interactive
  }
  await walk(state, byId, tree.nodes[0].nodeId, 0, undefined, true)

  return {
    tree:
      state.lines.length === 0 && interactive
        ? '(no interactive elements)'
        : state.lines.join('\n'),
    nodeCount: state.count,
    truncated: state.truncated
  }
}

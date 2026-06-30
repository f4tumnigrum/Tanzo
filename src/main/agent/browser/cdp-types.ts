/**
 * Minimal CDP types for the commands and events the browser tools use. Only the
 * fields we read are declared; CDP returns much more.
 */

export interface AXValue {
  type: string
  value?: unknown
}

export interface AXProperty {
  name: string
  value: AXValue
}

export interface AXNode {
  nodeId: string
  ignored: boolean
  role?: AXValue
  name?: AXValue
  value?: AXValue
  description?: AXValue
  properties?: AXProperty[]
  childIds?: string[]
  backendDOMNodeId?: number
  /** Present on nodes that own a child frame's document. */
  frameId?: string
}

export interface GetFullAXTreeResult {
  nodes: AXNode[]
}

export interface BoxModel {
  model: {
    content: number[]
    width: number
    height: number
  }
}

export interface DescribeNodeResult {
  node: {
    nodeName: string
    frameId?: string
    contentDocument?: { backendNodeId: number }
  }
}

export interface ResolveNodeResult {
  object: { objectId?: string }
}

export interface NodeForLocationResult {
  backendNodeId?: number
  nodeId?: number
}

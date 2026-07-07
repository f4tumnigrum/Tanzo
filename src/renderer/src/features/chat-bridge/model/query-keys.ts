export const chatBridgeKeys = {
  all: ['chatBridge'] as const,
  config: () => [...chatBridgeKeys.all, 'config'] as const,
  status: () => [...chatBridgeKeys.all, 'status'] as const
}

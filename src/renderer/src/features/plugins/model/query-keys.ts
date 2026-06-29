export const pluginKeys = {
  all: ['plugins'] as const,
  snapshot: () => [...pluginKeys.all, 'snapshot'] as const,
  detail: (id: string) => [...pluginKeys.all, 'detail', id] as const,
  marketplace: () => [...pluginKeys.all, 'marketplace'] as const,
  sources: () => [...pluginKeys.all, 'sources'] as const
}

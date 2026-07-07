import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChannelConfigInput, ChannelId, ChatBridgeStatus } from '@shared/chat-bridge'
import { chatBridgeClient } from '@/platform/electron/chat-bridge-client'
import { chatBridgeKeys } from './query-keys'

export function useChatBridgeConfig() {
  return useQuery({
    queryKey: chatBridgeKeys.config(),
    queryFn: () => chatBridgeClient.getConfig(),
    staleTime: 30_000
  })
}

export function useChatBridgeStatus() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: chatBridgeKeys.status(),
    queryFn: () => chatBridgeClient.getStatus(),
    staleTime: 5_000,
    refetchInterval: 15_000
  })

  // Live per-channel status pushes from main keep badges current without hard polling.
  useEffect(() => {
    const unsubscribe = chatBridgeClient.onEvent((event) => {
      if (event.kind !== 'status') return
      queryClient.setQueryData<ChatBridgeStatus>(chatBridgeKeys.status(), (prev) => {
        if (!prev) return prev
        return {
          channels: { ...prev.channels, [event.channelId]: event.status }
        }
      })
    })
    return unsubscribe
  }, [queryClient])

  return query
}

export function useChatBridgeMutations() {
  const queryClient = useQueryClient()
  const invalidateConfig = (): void =>
    void queryClient.invalidateQueries({ queryKey: chatBridgeKeys.config() })
  const invalidateStatus = (): void =>
    void queryClient.invalidateQueries({ queryKey: chatBridgeKeys.status() })

  const patchChannelStatus = (status: ChatBridgeStatus['channels'][ChannelId]): void => {
    queryClient.setQueryData<ChatBridgeStatus>(chatBridgeKeys.status(), (prev) =>
      prev ? { channels: { ...prev.channels, [status.id]: status } } : prev
    )
  }

  const saveConfig = useMutation({
    mutationFn: (config: ChannelConfigInput) => chatBridgeClient.setChannelConfig(config),
    onSuccess: () => {
      invalidateConfig()
      invalidateStatus()
    }
  })

  const setSecret = useMutation({
    mutationFn: ({ channelId, secret }: { channelId: ChannelId; secret: string }) =>
      chatBridgeClient.setSecret(channelId, secret),
    onSuccess: (result, { channelId }) => {
      queryClient.setQueryData<ChatBridgeStatus>(chatBridgeKeys.status(), (prev) => {
        if (!prev) return prev
        return {
          channels: {
            ...prev.channels,
            [channelId]: {
              ...prev.channels[channelId],
              secretConfigured: result.secretConfigured
            }
          }
        }
      })
      invalidateStatus()
    }
  })

  const connect = useMutation({
    mutationFn: (channelId: ChannelId) => chatBridgeClient.connect(channelId),
    onSuccess: (status) => patchChannelStatus(status)
  })

  const disconnect = useMutation({
    mutationFn: (channelId: ChannelId) => chatBridgeClient.disconnect(channelId),
    onSuccess: (status) => patchChannelStatus(status)
  })

  const testConnection = useMutation({
    mutationFn: (channelId: ChannelId) => chatBridgeClient.testConnection(channelId)
  })

  return { saveConfig, setSecret, connect, disconnect, testConnection }
}

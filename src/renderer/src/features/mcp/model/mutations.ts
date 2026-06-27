import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { McpServerConfig, ServerFormData } from '@/common/contracts'
import * as mcpClient from '@/platform/electron/mcp-client'
import i18n from '@/i18n'
import { errorMessage } from '@/common/lib/error-utils'
import { TanzoOperationError } from '@shared/errors'
import { parseServerFormData } from '../lib'
import { mcpClientKeys, serverKeys } from './query-keys'

function nextOptimisticId(): string {
  return `optimistic:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

function setServerList(queryClient: QueryClient, servers: McpServerConfig[]): void {
  queryClient.setQueryData<McpServerConfig[]>(serverKeys.lists(), servers)
}

function invalidateServerQueries(queryClient: QueryClient, serverName?: string): void {
  queryClient.invalidateQueries({ queryKey: mcpClientKeys.connectionStates() })
  if (serverName) {
    queryClient.invalidateQueries({ queryKey: mcpClientKeys.serverTools(serverName) })
    queryClient.invalidateQueries({ queryKey: mcpClientKeys.serverResources(serverName) })
    queryClient.invalidateQueries({ queryKey: mcpClientKeys.serverPrompts(serverName) })
    queryClient.invalidateQueries({
      queryKey: mcpClientKeys.serverResourceTemplates(serverName)
    })
  }
}

function removeServerQueries(queryClient: QueryClient, serverName: string): void {
  queryClient.removeQueries({ queryKey: mcpClientKeys.serverTools(serverName) })
  queryClient.removeQueries({ queryKey: mcpClientKeys.serverPrompts(serverName) })
  queryClient.removeQueries({ queryKey: mcpClientKeys.serverResources(serverName) })
  queryClient.removeQueries({
    queryKey: mcpClientKeys.serverResourceTemplates(serverName)
  })
}

export function useCreateServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (formData: ServerFormData): Promise<McpServerConfig> => {
      const serverData = parseServerFormData(formData)
      return mcpClient.createServer(serverData)
    },
    onMutate: async (formData) => {
      await queryClient.cancelQueries({ queryKey: serverKeys.all })
      const previousServers = queryClient.getQueryData<McpServerConfig[]>(serverKeys.lists()) ?? []
      const optimisticServer: McpServerConfig = {
        id: nextOptimisticId(),
        ...parseServerFormData(formData),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      setServerList(queryClient, [...previousServers, optimisticServer])
      return { previousServers, optimisticServer }
    },
    onSuccess: (newServer, _, context) => {
      queryClient.setQueryData<McpServerConfig[]>(
        serverKeys.lists(),
        (old) =>
          old?.map((s) => (s.id === context?.optimisticServer.id ? newServer : s)) ?? [newServer]
      )
      invalidateServerQueries(queryClient, newServer.enabled ? newServer.name : undefined)
      toast.success(i18n.t('mcp.server.notifications.createSuccess'))
    },
    onError: (err, _, context) => {
      if (context?.previousServers) setServerList(queryClient, context.previousServers)
      toast.error(errorMessage(err, i18n.t('mcp.server.notifications.createError')))
    }
  })
}

export function useUpdateServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      formData
    }: {
      id: string
      formData: ServerFormData
    }): Promise<McpServerConfig> => {
      const serverData = parseServerFormData(formData)
      const updatedServer = await mcpClient.updateServer(id, serverData)
      if (!updatedServer) {
        throw new TanzoOperationError(
          'MCP_SERVER_UPDATE_FAILED',
          i18n.t('mcp.server.notifications.updateError')
        )
      }
      return updatedServer
    },
    onMutate: async ({ id, formData }) => {
      await queryClient.cancelQueries({ queryKey: serverKeys.all })
      const previousServers = queryClient.getQueryData<McpServerConfig[]>(serverKeys.lists()) ?? []
      const previousServer = previousServers.find((server) => server.id === id)
      const optimisticUpdate = {
        ...parseServerFormData(formData),
        updated_at: new Date().toISOString()
      }
      const updatedServers = previousServers.map((server) =>
        server.id === id ? { ...server, ...optimisticUpdate } : server
      )
      setServerList(queryClient, updatedServers)
      return { previousServers, previousServer }
    },
    onSuccess: (updatedServer, _, context) => {
      queryClient.setQueryData<McpServerConfig[]>(
        serverKeys.lists(),
        (old) => old?.map((s) => (s.id === updatedServer.id ? updatedServer : s)) ?? []
      )
      if (context?.previousServer?.name && context.previousServer.name !== updatedServer.name) {
        removeServerQueries(queryClient, context.previousServer.name)
      }
      invalidateServerQueries(queryClient, updatedServer.name)
      toast.success(i18n.t('mcp.server.notifications.updateSuccess'))
    },
    onError: (err, _, context) => {
      if (context?.previousServers) setServerList(queryClient, context.previousServers)
      toast.error(errorMessage(err, i18n.t('mcp.server.notifications.updateError')))
    }
  })
}

export function useDeleteServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const deleted = await mcpClient.deleteServer(id)
      if (!deleted) {
        throw new TanzoOperationError(
          'MCP_SERVER_DELETE_FAILED',
          i18n.t('mcp.server.notifications.deleteError')
        )
      }
      return deleted
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: serverKeys.all })
      const previousServers = queryClient.getQueryData<McpServerConfig[]>(serverKeys.lists()) ?? []
      const serverToDelete = previousServers.find((s) => s.id === id)
      setServerList(
        queryClient,
        previousServers.filter((s) => s.id !== id)
      )
      if (serverToDelete?.name) {
        removeServerQueries(queryClient, serverToDelete.name)
      }
      return { previousServers }
    },
    onSuccess: () => {
      invalidateServerQueries(queryClient)
      toast.success(i18n.t('mcp.server.notifications.deleteSuccess'))
    },
    onError: (err, _, context) => {
      if (context?.previousServers) setServerList(queryClient, context.previousServers)
      toast.error(errorMessage(err, i18n.t('mcp.server.notifications.deleteError')))
    }
  })
}

export function useToggleServerEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const updatedServer = await mcpClient.toggleServer(id, enabled)
      if (!updatedServer) {
        throw new TanzoOperationError(
          'MCP_SERVER_TOGGLE_FAILED',
          i18n.t('mcp.server.notifications.toggleError')
        )
      }
      return updatedServer
    },
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: serverKeys.all })
      const previousServers = queryClient.getQueryData<McpServerConfig[]>(serverKeys.lists()) ?? []
      const updatedServers = previousServers.map((s) =>
        s.id === id ? { ...s, enabled, updated_at: new Date().toISOString() } : s
      )
      setServerList(queryClient, updatedServers)
      return { previousServers }
    },
    onSuccess: (updatedServer) => {
      queryClient.setQueryData<McpServerConfig[]>(
        serverKeys.lists(),
        (old) => old?.map((s) => (s.id === updatedServer.id ? updatedServer : s)) ?? []
      )
      invalidateServerQueries(queryClient, updatedServer.name)
      const stateLabel = updatedServer.enabled
        ? i18n.t('common.status.enabled')
        : i18n.t('common.status.disabled')
      toast.success(i18n.t('mcp.server.notifications.toggleSuccess', { state: stateLabel }))
    },
    onError: (err, _, context) => {
      if (context?.previousServers) setServerList(queryClient, context.previousServers)
      toast.error(errorMessage(err, i18n.t('mcp.server.notifications.toggleError')))
    }
  })
}

export function useReconnectServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverName: string) => mcpClient.reconnectServer(serverName),
    onSuccess: (_data, serverName) => {
      queryClient.invalidateQueries({ queryKey: mcpClientKeys.connectionStates() })
      queryClient.invalidateQueries({ queryKey: mcpClientKeys.serverTools(serverName) })
      queryClient.invalidateQueries({ queryKey: mcpClientKeys.serverPrompts(serverName) })
      queryClient.invalidateQueries({ queryKey: mcpClientKeys.serverResources(serverName) })
      toast.success(i18n.t('mcp.server.notifications.reconnectSuccess'))
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : i18n.t('mcp.server.notifications.reconnectError')
      )
    }
  })
}

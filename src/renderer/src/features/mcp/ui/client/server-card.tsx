import { useState } from 'react'
import { CheckCircle2, MoreVertical, Edit, Trash2, AlertCircle } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  FeatureCard,
  CardHeader,
  CardDescription,
  CardDivider,
  CardFooter,
  CardStatusBadge
} from '@/components/ui/feature-card'
import type { McpServerConfig, McpServerStatus } from '@/common/contracts'
import { patchPreferences } from '@/common/preferences'
import {
  useToggleServerEnabled,
  useDeleteServer,
  useServerConnectionState
} from '@/features/mcp/model'
import { serverKeys, mcpClientKeys } from '@/features/mcp/model/query-keys'
import { ServerEditorDialog } from './server-editor-dialog'

interface ServerCardProps {
  server: McpServerConfig
  onClick?: (serverId: string) => void
}
interface StatusBadgeProps {
  enabled: boolean
  status: McpServerStatus
  toolCount: number
  errorMessage?: string
}

function StatusBadge({ enabled, status, toolCount, errorMessage }: StatusBadgeProps) {
  const { t } = useTranslation()

  const inactiveBadgeProps = {
    active: false as const,
    activeIcon: <CheckCircle2 className="size-3 text-background" />,
    activeText: t('mcp.server.metrics.toolsCount', { count: 0 })
  }

  if (!enabled) {
    return <CardStatusBadge {...inactiveBadgeProps} inactiveText={t('common.status.disabled')} />
  }

  if (status === 'connecting') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        <span>{t('mcp.server.status.connecting')}</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex items-center gap-1.5 text-xs text-destructive cursor-help" />
          }
        >
          <AlertCircle className="size-3" />
          <span>{t('common.status.error')}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{errorMessage || t('mcp.server.status.connectionFailed')}</p>
        </TooltipContent>
      </Tooltip>
    )
  }
  if (status === 'connected') {
    return (
      <CardStatusBadge
        active={true}
        activeIcon={<CheckCircle2 className="size-3 text-background" />}
        activeText={t('mcp.server.metrics.toolsCount', { count: toolCount })}
      />
    )
  }

  return (
    <CardStatusBadge {...inactiveBadgeProps} inactiveText={t('mcp.server.status.disconnected')} />
  )
}

export function ServerCard({ server, onClick }: ServerCardProps) {
  const { t } = useTranslation()
  const toggleEnabled = useToggleServerEnabled()
  const deleteServerMutation = useDeleteServer()
  const queryClient = useQueryClient()
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const isBuiltin = server.builtin === true

  const { state: connectionState } = useServerConnectionState(server.name)
  const status: McpServerStatus = connectionState?.status ?? 'disconnected'
  const toolCount = connectionState?.toolCount ?? 0
  const errorMessage = connectionState?.error
  const isPending = toggleEnabled.isPending || deleteServerMutation.isPending
  const fallbackDescription = isBuiltin
    ? t('mcp.server.card.description.builtinBrowser')
    : server.description ||
      (server.transport === 'stdio' && server.command
        ? t('mcp.server.card.description.command', { command: server.command })
        : server.url
          ? t('mcp.server.card.description.url', { url: server.url })
          : t('mcp.server.card.description.generic'))

  function handleToggle(checked: boolean) {
    if (isBuiltin) {
      // The built-in server mirrors the browser-automation capability switch;
      // there is no database row to toggle. Same preference as Settings → Tools.
      void patchPreferences({ browserAutomation: checked }).then(() => {
        void queryClient.invalidateQueries({ queryKey: serverKeys.lists() })
        void queryClient.invalidateQueries({ queryKey: mcpClientKeys.connectionStates() })
      })
      return
    }
    if (!server.id) return
    toggleEnabled.mutate({ id: server.id, enabled: checked })
  }

  function handleCardClick() {
    if (server.id) onClick?.(server.id)
  }

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setIsEditDialogOpen(true)
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteDialogOpen(true)
  }

  function handleDeleteConfirm() {
    if (!server.id) return
    deleteServerMutation.mutate(server.id, {
      onSettled: () => setDeleteDialogOpen(false)
    })
  }

  const actionsMenu = (
    <div className="flex items-center gap-1.5">
      <Switch
        checked={server.enabled}
        onCheckedChange={handleToggle}
        disabled={isPending}
        className="scale-75"
      />
      {!isBuiltin ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-[var(--radius-4xl)] hover:bg-accent"
                disabled={isPending}
              />
            }
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={handleEdit}>
              <Edit className="mr-2 size-3.5" />
              {t('common.actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDeleteClick}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" />
              {t('common.actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )

  return (
    <>
      <FeatureCard onClick={handleCardClick}>
        <div className="flex-1">
          <CardHeader
            title={server.name}
            badge={
              isBuiltin ? (
                <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[0.625rem]">
                  {t('mcp.server.card.builtinBadge')}
                </Badge>
              ) : (
                server.transport === 'sse' && (
                  <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[0.625rem]">
                    SSE
                  </Badge>
                )
              )
            }
            actions={actionsMenu}
          >
            <CardDescription>{fallbackDescription}</CardDescription>
          </CardHeader>
        </div>

        <CardDivider />

        <CardFooter>
          <StatusBadge
            enabled={server.enabled}
            status={status}
            toolCount={toolCount}
            errorMessage={errorMessage}
          />
        </CardFooter>
      </FeatureCard>
      <ServerEditorDialog
        mode="edit"
        server={server}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mcp.server.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mcp.server.delete.description', { name: server.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

import { useState, cloneElement, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
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

interface DiscardConfirmProps {
  onConfirm: () => void
  /**
   * Number of untracked files in the selection. When > 0 the copy escalates to
   * warn that those files are deleted permanently (git clean, not recoverable
   * with git), so the user is not surprised by irreversible data loss.
   */
  untrackedCount: number
  trigger: ReactElement<{ onClick?: () => void }>
}

export function DiscardConfirm({
  onConfirm,
  untrackedCount,
  trigger
}: DiscardConfirmProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const destructive = untrackedCount > 0
  return (
    <>
      {cloneElement(trigger, { onClick: () => setOpen(true) })}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {destructive ? t('gitReview.discard.confirmTitle') : t('gitReview.confirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {destructive ? t('gitReview.discard.confirmBody') : t('gitReview.confirmBody')}
              {destructive ? (
                <span className="mt-2 block font-medium text-destructive">
                  {t('gitReview.discard.confirmBodyUntracked', { count: untrackedCount })}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              {destructive ? t('gitReview.discard.confirmAction') : t('gitReview.confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

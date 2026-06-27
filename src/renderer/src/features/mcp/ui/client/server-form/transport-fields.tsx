import type { Dispatch, SetStateAction } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslation } from 'react-i18next'
import type { ServerFormDataState } from './use-server-form-state'

interface TransportFieldsProps {
  formData: ServerFormDataState
  setFormData: Dispatch<SetStateAction<ServerFormDataState>>
  labelClass: string
  inputClass: string
  textareaClass: string
  helperClass: string
}

export function StdioFields({
  formData,
  setFormData,
  labelClass,
  inputClass,
  helperClass
}: TransportFieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="command" className={labelClass}>
          {t('mcp.server.form.command')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="command"
          value={formData.command}
          onChange={(event) => setFormData((prev) => ({ ...prev, command: event.target.value }))}
          placeholder="npx"
          className={`${inputClass} font-mono`}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="args" className={labelClass}>
          {t('mcp.server.form.arguments.label')}
        </Label>
        <Input
          id="args"
          value={formData.args}
          onChange={(event) => setFormData((prev) => ({ ...prev, args: event.target.value }))}
          placeholder={t('mcp.server.form.arguments.placeholder')}
          className={`${inputClass} font-mono`}
        />
        <p className={helperClass}>{t('mcp.server.form.arguments.help')}</p>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="cwd" className={labelClass}>
          {t('mcp.server.form.cwd')}
        </Label>
        <Input
          id="cwd"
          value={formData.cwd}
          onChange={(event) => setFormData((prev) => ({ ...prev, cwd: event.target.value }))}
          placeholder="."
          className={`${inputClass} font-mono`}
        />
      </div>
    </>
  )
}

export function HttpFields({
  formData,
  setFormData,
  labelClass,
  inputClass,
  textareaClass
}: TransportFieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="url" className={labelClass}>
          {t('mcp.server.form.url.label')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="url"
          value={formData.url}
          onChange={(event) => setFormData((prev) => ({ ...prev, url: event.target.value }))}
          placeholder={t('mcp.server.form.url.placeholder')}
          className={`${inputClass} font-mono`}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="headers" className={labelClass}>
          {t('mcp.server.form.headers.label')}
        </Label>
        <Textarea
          id="headers"
          value={formData.headers}
          onChange={(event) => setFormData((prev) => ({ ...prev, headers: event.target.value }))}
          placeholder={t('mcp.server.form.headers.placeholder')}
          rows={2}
          className={`${textareaClass} font-mono`}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="redirect" className={labelClass}>
          {t('mcp.server.form.redirect.label')}
        </Label>
        <Select
          value={formData.redirect}
          onValueChange={(value) => {
            if (!value) return
            setFormData((prev) => ({
              ...prev,
              redirect: value === 'error' ? 'error' : 'follow'
            }))
          }}
        >
          <SelectTrigger id="redirect" size="sm" className={inputClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="follow">{t('mcp.server.form.redirect.follow')}</SelectItem>
            <SelectItem value="error">{t('mcp.server.form.redirect.error')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

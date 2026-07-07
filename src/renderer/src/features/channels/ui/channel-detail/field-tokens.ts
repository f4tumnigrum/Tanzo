// House-style layout tokens for channel detail forms, matched to settings-tools-tab and the
// provider detail forms. Kept in a plain module (no component exports) so React Fast Refresh
// stays happy for the component files that consume them.
export const ROW = 'flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5'
export const ROW_STACK = 'flex w-full flex-col gap-1.5 px-3 py-2'
export const LABEL =
  'text-[0.8125rem] font-medium leading-tight tracking-[0.01em] text-foreground/90'
export const HINT = 'text-[0.625rem] leading-4 tracking-[0.01em] text-foreground/45'
export const FIELD_LABEL = 'text-[0.6875rem] font-medium tracking-[0.01em] text-foreground/60'
// Inline caution note (webhook/public-URL caveats). Amber, sits under a field inside a ROW_STACK.
export const WARNING_HINT = 'text-[0.625rem] leading-4 tracking-[0.01em] text-amber-600'
// Applied to a whole SectionCard's body when the channel is off, to de-emphasise inert controls.
export const SECTION_DISABLED = 'pointer-events-none opacity-55 transition-opacity'

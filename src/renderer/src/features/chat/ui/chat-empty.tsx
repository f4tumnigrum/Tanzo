import tanzoEmptyImage from '@/assets/tanzo1.png'

export interface ChatEmptyProps {
  children?: React.ReactNode
}

export function ChatEmpty({ children }: ChatEmptyProps): React.JSX.Element {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-3 pb-4 @md/chat:px-5">
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pt-4 pb-8 sm:pt-6 sm:pb-10">
        <img
          src={tanzoEmptyImage}
          alt="Tanzo"
          className="h-auto w-full max-w-[10rem] object-contain opacity-60 transition-[filter,opacity] duration-200 select-none sm:max-w-[11rem] md:max-w-[12rem] dark:opacity-50 dark:invert"
          draggable={false}
          style={{
            maskImage: 'radial-gradient(ellipse 80% 80% at center, black 30%, transparent 100%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 80% 80% at center, black 30%, transparent 100%)'
          }}
        />
      </div>
      {children ? <div className="w-full">{children}</div> : null}
    </div>
  )
}

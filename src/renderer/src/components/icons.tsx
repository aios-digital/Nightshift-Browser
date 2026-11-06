import type { ReactNode } from 'react'

const Svg = ({ children, flip = false }: { children: ReactNode; flip?: boolean }) => (
  <svg
    className={flip ? 'flip' : undefined}
    width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
  >
    {children}
  </svg>
)

export const BackIcon = () => <Svg flip><path d="M10 3 5 8l5 5" /></Svg>
export const ForwardIcon = () => <Svg flip><path d="m6 3 5 5-5 5" /></Svg>
export const ReloadIcon = () => <Svg><path d="M13 8a5 5 0 1 1-1.5-3.5" /><path d="M13 2.5v3h-3" /></Svg>
export const StopIcon = () => <Svg><path d="m4 4 8 8M12 4l-8 8" /></Svg>
export const CloseIcon = () => <Svg><path d="m4 4 8 8M12 4l-8 8" /></Svg>
export const PlusIcon = () => <Svg><path d="M8 3v10M3 8h10" /></Svg>
export const MaximizeIcon = () => <Svg><rect x="3" y="3" width="10" height="10" rx="1.5" /></Svg>
export const RestoreIcon = () => <Svg><rect x="3" y="5" width="8" height="8" rx="1.5" /><path d="M5.5 3H13v7.5" /></Svg>
export const SleepIcon = () => <Svg><path d="M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6Z" /></Svg>

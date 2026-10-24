import { cn } from '@renderer/lib/utils'
import { HUE_CLASSES, type MemberHue } from '@renderer/components/sharing/memberModel'

// A Member Code in its hue (#1514, assessment item 20): the roster row's 18px
// chip, the capture list's 16px chip, the detail header's 20px chip, the
// identity card's 24px chip and the note byline's borderless 14px chip. The
// hue is a class from HUE_CLASSES, never a hex: the four member hues and the
// accent are tokens with a light and a dark value.

export type ChipSize = 14 | 16 | 18 | 20 | 24

const SIZE_CLASSES: Record<ChipSize, { chip: string; dot: string }> = {
  14: { chip: 'h-3.5 rounded-[3px] border-0 px-1 text-[10px] font-semibold', dot: 'h-1 w-1' },
  16: {
    chip: 'h-4 rounded-[3px] px-[5px] text-[10px] font-semibold tracking-[.02em] tabular-nums',
    dot: 'h-[5px] w-[5px]'
  },
  18: {
    chip: 'h-[18px] rounded px-1.5 text-[10px] font-semibold tracking-[.02em]',
    dot: 'h-1.5 w-1.5'
  },
  20: { chip: 'h-5 rounded px-[7px] text-[11px] font-semibold', dot: 'h-1.5 w-1.5' },
  24: { chip: 'h-6 rounded px-2 text-xs font-semibold tracking-[.02em]', dot: 'h-1.5 w-1.5' }
}

interface MemberCodeChipProps {
  code: string
  hue: MemberHue
  size?: ChipSize
  dot?: boolean
  title?: string
  className?: string
  'data-testid'?: string
}

export function MemberCodeChip({
  code,
  hue,
  size = 18,
  dot = false,
  title,
  className,
  'data-testid': testId
}: MemberCodeChipProps) {
  const sizes = SIZE_CLASSES[size]
  const hues = HUE_CLASSES[hue]
  return (
    <span
      data-testid={testId}
      data-hue={String(hue)}
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-[5px] border text-text-primary',
        sizes.chip,
        hues.chip,
        className
      )}
    >
      {dot ? <span aria-hidden="true" className={cn('rounded-full', sizes.dot, hues.dot)} /> : null}
      {code}
    </span>
  )
}

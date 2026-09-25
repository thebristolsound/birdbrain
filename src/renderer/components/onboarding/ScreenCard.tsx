import { motion } from 'motion/react'
import { presets } from '@renderer/lib/motion'
import { screenCountLabel, type TourStep } from '@renderer/components/onboarding/tourSteps'
import {
  screenLayout,
  SCREEN_CARD_WIDTH,
  type TourRect,
  type Viewport
} from '@renderer/components/onboarding/tourGeometry'

interface ScreenCardProps {
  step: TourStep
  steps: TourStep[]
  index: number
  rect: TourRect | null
  viewport: Viewport
  onNext: () => void
  onSkip: () => void
}

/**
 * The card that introduces a screen, notched off the sidebar rail button it
 * rings. Falls back to a centred card when the rail button cannot be found.
 */
export function ScreenCard({
  step,
  steps,
  index,
  rect,
  viewport,
  onNext,
  onSkip
}: ScreenCardProps) {
  const layout = screenLayout(rect, viewport)

  return (
    <>
      {layout.ring ? (
        <div
          data-testid="tour-nav-ring"
          className="pointer-events-none fixed z-[71] rounded-lg"
          style={{
            top: layout.ring.top,
            left: layout.ring.left,
            width: layout.ring.width,
            height: layout.ring.height,
            border: '1px solid color-mix(in srgb, var(--color-accent) 55%, var(--color-border))',
            boxShadow:
              '0 0 0 4px color-mix(in srgb, var(--color-accent) 12%, transparent), 0 0 18px 2px color-mix(in srgb, var(--color-accent) 30%, transparent), 0 0 0 100vmax rgba(6,6,10,0.45)'
          }}
        />
      ) : null}
      <div
        data-testid="tour-screen"
        data-anchored={layout.ring ? 'true' : 'false'}
        className="fixed z-[73]"
        style={{ width: SCREEN_CARD_WIDTH, top: layout.card.top, left: layout.card.left }}
      >
        <motion.div {...presets.fadeIn} className="relative">
          {layout.ring ? (
            <div
              className="absolute left-[-6px] z-[1] h-2.5 w-2.5 rotate-45 border-b border-l border-border-strong bg-elevated"
              style={{ top: layout.notchTop }}
            />
          ) : null}
          <div
            // Modal for the keyboard, like the coach mark: OnboardingTour holds
            // focus inside the tour and dismisses it on Escape.
            role="dialog"
            aria-modal="true"
            aria-label={step.screen}
            className="rounded-md border border-border-strong bg-elevated p-5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
          >
            <div
              data-testid="tour-screen-count"
              className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-accent"
            >
              {screenCountLabel(steps, index)}
            </div>
            <div className="mb-1.5 font-display text-base font-extrabold tracking-[-0.025em] text-text-primary">
              {step.screen}
            </div>
            <div className="mb-4 text-xs leading-relaxed text-text-muted">{step.body}</div>
            <div className="flex items-center justify-between">
              <button
                data-testid="tour-skip"
                onClick={onSkip}
                className="border-none bg-transparent p-0 text-[11px] text-text-faint underline"
              >
                skip tour
              </button>
              <button
                data-testid="tour-next"
                onClick={onNext}
                className="h-7 shrink-0 whitespace-nowrap rounded border-none bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Show me →
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  )
}

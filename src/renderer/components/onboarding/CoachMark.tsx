import { motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { presets } from '@renderer/lib/motion'
import { INSTALL_STEPS } from '@renderer/components/extension/installSteps'
import { markCountLabel, markNumber, type TourStep } from '@renderer/components/onboarding/tourSteps'
import {
  markLayout,
  TOOLTIP_WIDTH,
  type TourRect,
  type Viewport
} from '@renderer/components/onboarding/tourGeometry'

interface CoachMarkProps {
  step: TourStep
  steps: TourStep[]
  index: number
  rect: TourRect | null
  viewport: Viewport
  installOpen: boolean
  onNext: () => void
  onSkip: () => void
  onToggleInstall: () => void
}

/**
 * One spotlight coach mark: ring, numbered badge, and the 296px tooltip.
 *
 * The ring and badge are `pointer-events-none` so the ringed control stays
 * usable — clicking the thing the tour points at does what it always did, and
 * never advances the tour.
 */
export function CoachMark({
  step,
  steps,
  index,
  rect,
  viewport,
  installOpen,
  onNext,
  onSkip,
  onToggleInstall
}: CoachMarkProps) {
  const layout = rect ? markLayout(rect, viewport) : null

  const card = (
    <div className="rounded-md border border-border-strong bg-elevated px-3.5 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
      <div className="text-xs leading-relaxed text-text-secondary">
        {/* Inline with the body copy by design, so it carries heading semantics
            rather than an <h*> element, which would force a block break. */}
        {step.title ? (
          <span role="heading" aria-level={2} className="font-bold text-text-primary">
            {step.title}.
          </span>
        ) : null}{' '}
        {step.body}
      </div>

      {step.kbd ? (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="shrink-0 whitespace-nowrap rounded border border-border-strong bg-canvas px-[5px] py-px font-mono text-[10px] text-text-muted">
            {step.kbd}
          </span>
          <span className="text-[11px] text-text-faint">{step.kbdNote}</span>
        </div>
      ) : null}

      {step.install ? (
        <>
          <button
            data-testid="tour-install-toggle"
            aria-expanded={installOpen}
            onClick={onToggleInstall}
            className="mt-2 inline-flex items-center gap-[5px] border-none bg-transparent p-0 text-[11px] font-medium text-accent hover:text-accent-hover"
          >
            Install walkthrough
            <ChevronDown
              size={11}
              strokeWidth={2}
              className={`transition-transform ${installOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {installOpen ? (
            <div
              data-testid="tour-install-steps"
              className="mt-2 flex flex-col gap-[7px] rounded border border-border bg-surface px-2.5 py-[9px]"
            >
              {INSTALL_STEPS.map((installStep, i) => (
                <div key={installStep.title} className="flex gap-2" data-testid="tour-install-step">
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent-subtle text-[9px] font-bold text-accent">
                    {i + 1}
                  </span>
                  <span className="text-[11px] leading-normal text-text-muted">
                    <span className="font-semibold text-text-secondary">{installStep.title}</span>
                    {' — '}
                    {installStep.brief}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span
          data-testid="tour-count"
          className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-[11px] tabular-nums text-text-faint"
        >
          {markCountLabel(steps, index)} &middot;{' '}
          <button
            data-testid="tour-skip"
            onClick={onSkip}
            className="border-none bg-transparent p-0 text-[11px] text-text-faint underline"
          >
            skip
          </button>
        </span>
        <button
          data-testid="tour-next"
          onClick={onNext}
          className="h-6 shrink-0 whitespace-nowrap rounded border-none bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover"
        >
          {step.last ?? (step.final ? 'Keep exploring' : 'Next →')}
        </button>
      </div>
    </div>
  )

  // Anchor slip is the expected failure here, because most of these anchors sit
  // on surfaces the rest of the redesign rebuilt. A step whose target cannot be
  // found still shows its copy, centred, instead of a card pinned to (0,0).
  if (!layout) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[73] flex items-center justify-center">
        <motion.div
          {...presets.modal}
          data-testid="tour-mark"
          data-anchored="false"
          className="pointer-events-auto"
          style={{ width: TOOLTIP_WIDTH }}
        >
          {card}
        </motion.div>
      </div>
    )
  }

  return (
    <>
      <div
        data-testid="tour-ring"
        className="pointer-events-none fixed z-[71] rounded-lg"
        style={{
          top: layout.ring.top,
          left: layout.ring.left,
          width: layout.ring.width,
          height: layout.ring.height,
          border: '1px solid color-mix(in srgb, var(--color-accent) 55%, var(--color-border))',
          boxShadow:
            '0 0 0 4px color-mix(in srgb, var(--color-accent) 12%, transparent), 0 0 0 100vmax rgba(6,6,10,0.38)'
        }}
      />
      <div
        data-testid="tour-badge"
        className="pointer-events-none fixed z-[72] grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-[10px] font-bold tabular-nums text-white"
        style={{ top: layout.badge.top, left: layout.badge.left }}
      >
        {markNumber(steps, index)}
      </div>
      {/* The flip is a transform on this wrapper, and the entrance animation is
          opacity-only on the child, so motion's own transform never fights it. */}
      <div
        data-testid="tour-mark"
        data-anchored="true"
        data-flipped={layout.tooltip.flipped ? 'true' : 'false'}
        className="fixed z-[73]"
        style={{
          width: TOOLTIP_WIDTH,
          top: layout.tooltip.top,
          left: layout.tooltip.left,
          transform: layout.tooltip.flipped ? 'translateY(-100%)' : undefined
        }}
      >
        <motion.div {...presets.fadeIn}>
          {layout.arrow.below ? (
            <div
              data-testid="tour-arrow-up"
              className="h-2.5 w-2.5 rotate-45 border-l border-t border-border-strong bg-elevated"
              style={{ margin: `0 0 -5px ${layout.arrow.marginLeft}px` }}
            />
          ) : null}
          {card}
          {layout.arrow.below ? null : (
            <div
              data-testid="tour-arrow-down"
              className="h-2.5 w-2.5 rotate-45 border-b border-r border-border-strong bg-elevated"
              style={{ margin: `-5px 0 0 ${layout.arrow.marginLeft}px` }}
            />
          )}
        </motion.div>
      </div>
    </>
  )
}

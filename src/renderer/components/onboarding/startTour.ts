import type { TourChapter } from '@renderer/components/onboarding/tourSteps'

export const TOUR_EVENT = 'birdbrain:tour'

export interface TourEventDetail {
  chapter: TourChapter
}

/**
 * Replays a tour chapter from anywhere.
 *
 * A window event rather than shared state, matching the `birdbrain:report`
 * wiring: the four entry points (command palette, Settings → About, the
 * dashboard extension banner, the captures getting-started panel) then need
 * nothing but this function, and the single mounted tour owns all the state.
 *
 * Always a replay — nothing dispatched here writes completion.
 */
export function startTour(chapter: TourChapter): void {
  window.dispatchEvent(new CustomEvent<TourEventDetail>(TOUR_EVENT, { detail: { chapter } }))
}

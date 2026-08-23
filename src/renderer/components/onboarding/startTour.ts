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
 * The chapter this starts is always a replay, so closing it writes nothing.
 * Starting it is not free of writes, though: if a chapter is already running,
 * this displaces it, and `useTourEngine.start` persists the displaced chapter's
 * completion on the way past. Only the displaced chapter's own `auto` flag
 * decides that, never this one's.
 */
export function startTour(chapter: TourChapter): void {
  window.dispatchEvent(new CustomEvent<TourEventDetail>(TOUR_EVENT, { detail: { chapter } }))
}

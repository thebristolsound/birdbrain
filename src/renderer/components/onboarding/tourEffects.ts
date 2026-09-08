export const NOTE_COMPOSER_EVENT = 'birdbrain:tour-open-composer'

/**
 * Asks the Notes screen to open its composer.
 *
 * A window event rather than shared state, matching `startTour`: the note
 * editor is the anchor of one case-chapter step and is not mounted until the
 * composer is open (#405, Q2), and the alternative — the screen opening its
 * composer by default — would change what every operator sees on arrival
 * whether or not a tour is running. `NotesOverview` is the only listener.
 */
export function openNoteComposer(): void {
  window.dispatchEvent(new CustomEvent(NOTE_COMPOSER_EVENT))
}

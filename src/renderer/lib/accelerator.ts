/**
 * How a keyboard hint spells the platform's primary accelerator modifier
 * (#902).
 *
 * Display only. Where the app binds the chord, its handler already tests
 * `ctrlKey || metaKey`, so the same chord fires on every platform and only its
 * label moves — macOS names ⌘, everywhere else names Ctrl. The two Ctrl+N
 * hints (`onboarding/tourSteps.ts`, `dashboard/HeroSection.tsx`) are the
 * exception: nothing binds that chord on any platform (#911), so this renames
 * a hint that stays dead until it does.
 *
 * The join differs with the label. macOS sets the glyph flush against the key
 * the way its own menus do (⌘K); a word-spelled modifier needs a visible
 * separator (Ctrl+K), and the sites that already read `Ctrl F` or `Ctrl-click`
 * keep their own. Flush is for a single label: the dashboard hero renders the
 * modifier as its own key cap beside the key's, so those two keep the ` + `
 * between them rather than butting two borders together.
 */

const MAC_LABEL = '⌘'
const DEFAULT_LABEL = 'Ctrl'

/**
 * Read per call rather than snapshotted into a module constant: nothing here is
 * evaluated before the first hint asks for it, and a test can move the platform
 * between assertions. `navigator` is absent outside a DOM, where Ctrl is the
 * safe answer.
 */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.platform.toLowerCase().startsWith('mac')
}

/** The modifier on its own: `⌘` on macOS, `Ctrl` elsewhere. */
export function modifierLabel(): string {
  return isMac() ? MAC_LABEL : DEFAULT_LABEL
}

export interface AcceleratorJoin {
  /** What separates the modifier from the key off macOS. Defaults to `+`. */
  join?: string
  /** The same on macOS, where the glyph normally sits flush. Defaults to none. */
  macJoin?: string
}

/**
 * A full hint for the primary modifier plus `key` — `⌘K` on macOS, `Ctrl+K`
 * elsewhere.
 */
export function accelerator(
  key: string,
  { join = '+', macJoin = '' }: AcceleratorJoin = {}
): string {
  return isMac() ? `${MAC_LABEL}${macJoin}${key}` : `${DEFAULT_LABEL}${join}${key}`
}

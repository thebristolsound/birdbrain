import { FolderOpen, ShieldAlert, Users, type LucideIcon } from 'lucide-react'
import type { Case } from '@shared/types'

// Per-case-type icon and colour, shared by the dashboard's case cards and the
// activity feed's case chips so the two never drift. Case-type tints are one of
// the sanctioned raw-colour exceptions: they identify a case at a glance and do
// not theme-swap. The icon and pill text take the hue tokens, which darken in
// the light theme to keep their contrast.
export interface CaseTypeStyle {
  icon: LucideIcon
  /** Icon tile background + border. */
  bgClass: string
  iconClass: string
  /** Pill treatment for the activity feed's case chip. */
  chipClass: string
  /** The Older Cases list's type dot. */
  dotClass: string
}

const CASE_TYPE_STYLES: Record<string, CaseTypeStyle> = {
  crypto: {
    icon: FolderOpen,
    bgClass: 'bg-orange-500/10 border border-orange-500/20',
    iconClass: 'text-hue-orange-fg',
    chipClass: 'border-orange-500/25 bg-orange-500/10 text-hue-orange-fg',
    dotClass: 'bg-orange-500'
  },
  malware: {
    icon: ShieldAlert,
    bgClass: 'bg-sky-500/10 border border-sky-500/20',
    iconClass: 'text-hue-sky-fg',
    chipClass: 'border-sky-500/25 bg-sky-500/10 text-hue-sky-fg',
    dotClass: 'bg-sky-500'
  },
  fraud: {
    icon: Users,
    bgClass: 'bg-pink-500/10 border border-pink-500/20',
    iconClass: 'text-hue-pink-fg',
    chipClass: 'border-pink-500/25 bg-pink-500/10 text-hue-pink-fg',
    dotClass: 'bg-pink-500'
  }
}

const DEFAULT_CASE_TYPE_STYLE: CaseTypeStyle = {
  icon: FolderOpen,
  bgClass: 'bg-accent-subtle border border-accent/20',
  iconClass: 'text-accent',
  chipClass: 'border-accent/25 bg-accent-subtle text-accent',
  dotClass: 'bg-accent'
}

export function getCaseTypeStyle(type?: Case['type']): CaseTypeStyle {
  return CASE_TYPE_STYLES[type ?? ''] ?? DEFAULT_CASE_TYPE_STYLE
}

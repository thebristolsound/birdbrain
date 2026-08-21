import { FolderOpen, ShieldAlert, Users, type LucideIcon } from 'lucide-react'
import type { Case } from '@shared/types'

// Per-case-type icon and colour, shared by the dashboard's case cards and the
// activity feed's case chips so the two never drift. Case-type colours are one
// of the sanctioned raw-colour exceptions (like status colours): they identify
// a case at a glance and do not theme-swap.
export interface CaseTypeStyle {
  icon: LucideIcon
  /** Icon tile background + border. */
  bgClass: string
  iconClass: string
  /** Pill treatment for the activity feed's case chip. */
  chipClass: string
}

const CASE_TYPE_STYLES: Record<string, CaseTypeStyle> = {
  crypto: {
    icon: FolderOpen,
    bgClass: 'bg-amber-500/10 border border-amber-500/20',
    iconClass: 'text-amber-500',
    chipClass: 'border-amber-500/25 bg-amber-500/10 text-amber-500'
  },
  malware: {
    icon: ShieldAlert,
    bgClass: 'bg-sky-500/10 border border-sky-500/20',
    iconClass: 'text-sky-500',
    chipClass: 'border-sky-500/25 bg-sky-500/10 text-sky-500'
  },
  fraud: {
    icon: Users,
    bgClass: 'bg-pink-500/10 border border-pink-500/20',
    iconClass: 'text-pink-500',
    chipClass: 'border-pink-500/25 bg-pink-500/10 text-pink-500'
  }
}

const DEFAULT_CASE_TYPE_STYLE: CaseTypeStyle = {
  icon: FolderOpen,
  bgClass: 'bg-accent-subtle border border-accent/20',
  iconClass: 'text-accent',
  chipClass: 'border-accent/25 bg-accent-subtle text-accent'
}

export function getCaseTypeStyle(type?: Case['type']): CaseTypeStyle {
  return CASE_TYPE_STYLES[type ?? ''] ?? DEFAULT_CASE_TYPE_STYLE
}

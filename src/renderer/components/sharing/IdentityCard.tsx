import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { SharingMember } from '@shared/types'
import { Card, SectionLabel } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { MemberCodeChip } from '@renderer/components/sharing/MemberCodeChip'
import {
  COPY,
  fingerprintFull,
  fingerprintPrefix,
  identityLine
} from '@renderer/components/sharing/memberModel'

// "This installation" (#1514, mock 1a): the local member's chip, name, role
// and key fingerprint, collapsed to two groups until the operator asks for
// all eight.
export function IdentityCard({ self }: { self: SharingMember }) {
  const [open, setOpen] = useState(false)
  const { fingerprint } = self
  return (
    <Card className="p-4" data-testid="identity-card">
      <SectionLabel className="mb-3">This installation</SectionLabel>
      <div className="flex items-start gap-3.5">
        <MemberCodeChip code={self.memberCode} hue="accent" size={24} dot />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-text-primary">{self.operatorName}</span>
            <span className="text-[11px] text-text-muted">
              {identityLine(self.role, self.memberCode)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-text-muted">{COPY.fingerprintLabel}</span>
            {fingerprint === null ? (
              <span className="font-mono text-[11px] text-text-muted">—</span>
            ) : (
              <button
                type="button"
                title={COPY.fingerprintToggleTitle}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-text-secondary"
                data-testid="fingerprint-toggle"
              >
                {open ? fingerprintFull(fingerprint) : fingerprintPrefix(fingerprint)}
                <ChevronDown
                  size={11}
                  aria-hidden="true"
                  className={cn('text-text-faint transition-transform', open && 'rotate-180')}
                />
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-[1.55] text-text-muted">
            {COPY.fingerprintExplainer}
          </p>
        </div>
      </div>
    </Card>
  )
}

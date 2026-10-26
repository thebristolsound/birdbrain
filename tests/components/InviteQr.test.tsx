// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import qrcode from 'qrcode-generator'
import { InviteQr } from '@renderer/components/sharing/InviteQr'

const INVITE_A =
  'bbinvite1mfrggzdfmzt' + 'wq2lknnwg2zlonfxxaylcmvygczlsmfzxi2lpnyqgc3teebtg64ranfxhm2lumu2gklba'
const INVITE_B = 'bbinvite1orugsyzaifneg2lteb2gqzjamvxgizlsebtgs4tfn5uca'

// The dark modules the library computes for the same string, so the test
// pins the drawing against the encoder rather than a fixed count.
function darkModules(invite: string): number {
  const qr = qrcode(0, 'M')
  qr.addData(invite, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  let dark = 0
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark++
  return dark
}

afterEach(cleanup)

describe('InviteQr', () => {
  it('draws one rect per dark module under the mock’s label', () => {
    const { container } = render(<InviteQr invite={INVITE_A} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-label')).toBe('QR code for the same invite')
    expect(svg?.getAttribute('role')).toBe('img')
    expect(svg?.querySelectorAll('rect')).toHaveLength(darkModules(INVITE_A))
    // The modules are raw values on purpose: a scanner needs the contrast.
    expect(svg?.querySelector('rect')?.getAttribute('fill')).toBe('#111')
  })

  it('draws two invites differently', () => {
    const a = render(<InviteQr invite={INVITE_A} />).container.innerHTML
    cleanup()
    const b = render(<InviteQr invite={INVITE_B} />).container.innerHTML
    expect(a).not.toBe(b)
    expect(darkModules(INVITE_A)).not.toBe(darkModules(INVITE_B))
  })
})

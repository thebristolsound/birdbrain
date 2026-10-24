import { useMemo } from 'react'
import qrcode from 'qrcode-generator'
import { COPY } from '@renderer/components/sharing/memberModel'

// The invite as a QR code (#1514, mock 1c; qrcode-generator 2.0.4 by ruling
// 3 of 2026-10-10). The modules come out of the encoder as booleans and go
// in as <rect>s: no markup string from the library reaches the DOM. White pad
// and #111 modules are raw values on purpose, so a scanner gets the contrast
// in both themes.
export function InviteQr({ invite }: { invite: string }) {
  const { count, dark } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(invite, 'Byte')
    qr.make()
    const n = qr.getModuleCount()
    const cells: Array<[number, number]> = []
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) if (qr.isDark(row, col)) cells.push([row, col])
    }
    return { count: n, dark: cells }
  }, [invite])

  return (
    <div className="shrink-0 rounded bg-white p-1.5" data-testid="invite-qr">
      <svg
        role="img"
        aria-label={COPY.qrLabel}
        width={100}
        height={100}
        viewBox={`0 0 ${count} ${count}`}
        shapeRendering="crispEdges"
      >
        {dark.map(([row, col]) => (
          <rect key={`${row}:${col}`} x={col} y={row} width={1} height={1} fill="#111" />
        ))}
      </svg>
    </div>
  )
}

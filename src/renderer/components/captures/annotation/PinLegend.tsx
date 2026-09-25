import { ChevronDown, MapPin } from 'lucide-react'

export interface PinLegendRow {
  shapeId: string
  number: number
  body: string
  meta: string
}

interface Props {
  rows: PinLegendRow[]
  openShapeId: string | null
  onToggle: (shapeId: string) => void
}

// Every pin on the screenshot at once, floated over the canvas's top-right
// corner. Opening a row shows the whole note and its meta and rings the pin.
export function PinLegend({ rows, openShapeId, onToggle }: Props) {
  return (
    <div
      data-testid="pin-legend"
      className="absolute right-3 top-3 z-[24] flex max-h-[56%] w-[212px] flex-col overflow-hidden rounded-md border border-border bg-card/95 shadow-md backdrop-blur-sm"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        <MapPin aria-hidden className="h-[11px] w-[11px] text-text-faint" strokeWidth={2} />
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-text-faint">
          Pins
        </span>
        <span className="text-[10px] tabular-nums text-text-faint">{rows.length}</span>
      </div>
      <div className="min-h-0 overflow-y-auto p-1">
        {rows.map(({ shapeId, number, body, meta }) => {
          const open = openShapeId === shapeId
          return (
            <button
              key={shapeId}
              type="button"
              aria-expanded={open}
              onClick={() => onToggle(shapeId)}
              className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-elevated ${
                open ? 'bg-surface' : ''
              }`}
            >
              <span
                aria-hidden
                className="mt-px grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full bg-accent font-display text-[9px] font-bold text-white"
              >
                {number}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={`min-w-0 overflow-hidden text-ellipsis text-[11px] leading-[1.45] text-text-secondary ${
                    open ? 'whitespace-normal break-words' : 'whitespace-nowrap'
                  }`}
                >
                  {body || <span className="italic text-text-faint">No note</span>}
                </span>
                {open && <span className="text-[10px] text-text-faint">{meta}</span>}
              </span>
              <ChevronDown
                aria-hidden
                className={`mt-[3px] h-2.5 w-2.5 shrink-0 text-text-faint transition-transform duration-150 ${
                  open ? 'rotate-180' : ''
                }`}
                strokeWidth={2}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

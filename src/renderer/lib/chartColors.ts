// Bar-chart series palette (Recharts default 4 + X11/CSS named colors). Mode-independent.
// Legend/tooltip reference (for any future real chart): dark popover, each row a small
// color swatch + label + right-aligned value, with a separated `Total` row.
export const CHART_SERIES = [
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
  '#FF69B4',
  '#9ACD32',
  '#4682B4',
  '#FF4500',
  '#FF6347',
  '#DA70D6',
  '#3CB371',
  '#F08080',
  '#BDB76B',
  '#800080',
  '#DAA520',
  '#2E8B57',
  '#40E0D0',
  '#6B8E23',
  '#7B68EE',
  '#DB7093'
] as const

// Chart axis lines / ticks (zinc-400) and grid lines (low-alpha zinc).
export const CHART_AXIS = '#a1a1aa'
export const CHART_GRID = 'rgba(161,161,170,0.2)'

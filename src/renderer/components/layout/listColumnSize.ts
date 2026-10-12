// Layout facts for the list column the Captures and Notes screens share, so the two open
// at the same width and drag within the same bounds. The bounds are the design's own:
// 316/240/560, and react-resizable-panels reads bare numbers as pixels.
export const LIST_COLUMN_SIZE = {
  defaultSize: 316,
  minSize: 240,
  maxSize: 560
} as const

// 7px hit strip, invisible until the library flags it hovered, focused or
// being dragged — the design's own treatment for every splitter.
export const SEPARATOR_CLASS =
  'w-[7px] shrink-0 self-stretch bg-transparent transition-colors data-[separator=hover]:bg-accent/40 data-[separator=active]:bg-accent/40 data-[separator=focus]:bg-accent/40 focus-visible:outline-none'

// The "i" beside a line, holding the detail behind it, drawn as the investigation header draws
// it (ViewHeader.tsx). The text is its title and its accessible name.
export function InfoTip({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-border-strong font-mono text-[10px] font-bold text-text-muted"
    >
      i
    </span>
  )
}

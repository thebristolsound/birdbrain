// The Member Code an Owner is offered for a member (#1810): the initials of
// up to three words of the Operator name, with accents removed and anything
// outside `[A-Z0-9]` dropped, which is the shape `MEMBER_CODE_PATTERN` admits
// (design decision 8). Shared so the members screens (SC-8) show the same
// default the main process writes. When the initials are empty or taken, `M`
// is tried, then `M2` to `M9`; the empty string comes back when all of those
// are taken too, and `memberCodeProblem` refuses it with a reason.

const FALLBACKS = ['M', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']

export function suggestMemberCode(operatorName: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((code) => code.toUpperCase()))
  const initials = operatorName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (initials.length > 0 && !used.has(initials)) return initials
  return FALLBACKS.find((code) => !used.has(code)) ?? ''
}

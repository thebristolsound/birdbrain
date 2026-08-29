export const normalizeName = (name: string): string => {
  const trimmed = name.trim()
  if (trimmed === '') return 'stranger'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

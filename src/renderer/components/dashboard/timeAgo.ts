// The dashboard's "Updated 3 days ago": the card's footer and the Older
// Cases list read the same ladder.
export function timeAgo(dateStr: string, nowMs: number = Date.now()): string {
  const diff = nowMs - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

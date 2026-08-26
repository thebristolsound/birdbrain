import type { CaptureMethod } from '@shared/types'

// What a capture's method is called on screen. 'extension' has no label because
// it is the operator-witnessed baseline every other method departs from; the
// two that do carry one must never be readable as an ordinary capture —
// 'background' saw the page without an operator watching, and 'duplicate'
// (#827) saw nothing at all.
export const CAPTURE_METHOD_LABELS: Partial<Record<CaptureMethod, string>> = {
  background: 'Background',
  duplicate: 'Duplicate'
}

// The small amount of statistics the report needs. Paired differences with
// a normal-approximation interval; the pass-rate noise floor from the plan.

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function sd(xs) {
  if (xs.length < 2) return null
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

// Mean of paired differences with its 95% interval. `different` is false
// when the interval covers zero, which the report prints as no difference.
export function paired(diffs) {
  const n = diffs.length
  if (n === 0) return { n: 0, mean: null, lo: null, hi: null, different: null }
  const m = mean(diffs)
  const s = sd(diffs)
  if (s === null || s === 0) return { n, mean: m, lo: m, hi: m, different: m !== 0 }
  const half = (1.96 * s) / Math.sqrt(n)
  return { n, mean: m, lo: m - half, hi: m + half, different: m - half > 0 || m + half < 0 }
}

// Roughly the resolution of a pass rate over n cases and R reps.
export const noiseFloor = (cases, reps) => (cases * reps > 0 ? 1 / Math.sqrt(cases * reps) : null)

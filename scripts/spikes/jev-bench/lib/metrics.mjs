// Scoring helpers. Labels are booleans (binary) or strings (multiclass).
export function binary(rows, threshold = 0.5) {
  // rows: [{ p, label }]
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const { p, label } of rows) {
    const pred = p >= threshold
    if (pred && label) tp++
    else if (pred && !label) fp++
    else if (!pred && label) fn++
    else tn++
  }
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  return { n: rows.length, threshold, tp, fp, fn, tn, precision, recall, f1, accuracy: (tp + tn) / rows.length }
}

export function bestThreshold(rows) {
  let best = binary(rows, 0.5)
  for (let t = 0.05; t < 1; t += 0.05) {
    const m = binary(rows, Number(t.toFixed(2)))
    if (m.f1 > best.f1) best = m
  }
  return best
}

// Area under ROC by rank statistic.
export function auc(rows) {
  const pos = rows.filter((r) => r.label).map((r) => r.p)
  const neg = rows.filter((r) => !r.label).map((r) => r.p)
  if (!pos.length || !neg.length) return null
  let s = 0
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0
  return s / (pos.length * neg.length)
}

// Reliability: does p≈0.8 mean 80% yes? Returns per-bin {range, n, meanP, rate}.
export function calibration(rows, bins = 5) {
  const out = []
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins
    const inBin = rows.filter((r) => r.p >= lo && (b === bins - 1 ? r.p <= hi : r.p < hi))
    if (!inBin.length) continue
    out.push({
      range: `${lo.toFixed(1)}–${hi.toFixed(1)}`,
      n: inBin.length,
      meanP: inBin.reduce((s, r) => s + r.p, 0) / inBin.length,
      rate: inBin.filter((r) => r.label).length / inBin.length
    })
  }
  return out
}

export function confusion(rows) {
  // rows: [{ pred, gold }]
  const labels = [...new Set(rows.flatMap((r) => [r.pred, r.gold]))].sort()
  const m = Object.fromEntries(labels.map((g) => [g, Object.fromEntries(labels.map((p) => [p, 0]))]))
  let correct = 0
  for (const { pred, gold } of rows) {
    m[gold][pred]++
    if (pred === gold) correct++
  }
  return { accuracy: correct / rows.length, n: rows.length, labels, matrix: m }
}

export const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(0)}%`)
export const f2 = (x) => (x == null ? '–' : x.toFixed(2))

export function table(rows) {
  if (!rows.length) return '(empty)'
  const keys = Object.keys(rows[0])
  const w = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)))
  const line = (vals) => `| ${vals.map((v, i) => String(v ?? '').padEnd(w[i])).join(' | ')} |`
  return [line(keys), `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`, ...rows.map((r) => line(keys.map((k) => r[k])))].join('\n')
}

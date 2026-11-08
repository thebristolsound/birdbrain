// The run manifest: every input byte a result depends on, hashed into one id.
// The id names a run. Two runs compare when their manifests agree on every
// field except the axes under comparison (model, effort, and across vendors
// the harness); the report joins on that comparison key, never on the id.

import { createHash } from 'node:crypto'

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// JSON with object keys sorted at every depth, so the same inputs always
// serialise to the same bytes whatever order the caller built them in.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const manifestHash = (manifest) => sha256(canonical(manifest)).slice(0, 16)

// The corpus a run scores: case ids with the head each pins, the PR body the
// reviewer reads and the truth it is graded against. A changed truth file, PR
// body or a re-pinned head changes the id.
export function corpusHash(fixtures) {
  const entries = [...fixtures.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => ({
      id: f.id,
      head: f.source.head,
      body: f.prBody == null ? null : sha256(f.prBody),
      truth: sha256(canonical(f.truth))
    }))
  return sha256(canonical(entries)).slice(0, 16)
}

export function buildManifest({
  harness,
  harnessVersion,
  model,
  effort,
  tier,
  toolSpec,
  promptTemplate,
  agentDefinition,
  instructions,
  corpus,
  nodeVersion,
  timeoutMs,
  login,
  placement,
  mode,
  dispatchSkill
}) {
  const required = { harness, harnessVersion, model, effort, tier, promptTemplate, corpus }
  for (const [k, v] of Object.entries(required)) {
    if (v === undefined || v === null || v === '') throw new Error(`manifest: ${k} is required`)
  }
  const manifest = {
    harness,
    harnessVersion,
    model,
    effort,
    tier,
    toolSpec: toolSpec ?? null,
    promptTemplate: sha256(promptTemplate),
    agentDefinition: agentDefinition == null ? null : sha256(agentDefinition),
    instructions: instructions == null ? null : sha256(instructions),
    placement: placement ?? null,
    mode: mode ?? 'direct',
    dispatchSkill: dispatchSkill == null ? null : sha256(dispatchSkill),
    corpus,
    nodeVersion: nodeVersion ?? null,
    timeoutMs: timeoutMs ?? null,
    login: login ?? null
  }
  return { manifest, id: manifestHash(manifest) }
}

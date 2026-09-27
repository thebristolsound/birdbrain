// Renders the review prompt for one case at one tier. The template is a
// file so its bytes are hashed into the manifest; the tier decides whether
// the diff travels in the prompt or sits in a worktree the model reads.

import { TIERS } from './schema.mjs'

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g

export function renderPrompt(template, vars) {
  const out = template.replace(PLACEHOLDER, (_, key) => {
    if (!(key in vars)) throw new Error(`prompt: no value for {{${key}}}`)
    return vars[key]
  })
  const left = out.match(PLACEHOLDER)
  if (left) throw new Error(`prompt: unresolved ${left.join(', ')}`)
  return out
}

// The body of an agent definition file: everything after its front matter.
export function agentBody(definition) {
  const m = definition.match(/^---\n[\s\S]*?\n---\n/)
  return (m ? definition.slice(m[0].length) : definition).trim()
}

export function tierContext(tier, { base }) {
  switch (tier) {
    case 'L0':
      return (
        'You have no tools. The pull request description and the complete diff are in this ' +
        'message; line numbers in your findings refer to the changed file after the diff is ' +
        'applied, which you can count from the hunk headers.'
      )
    case 'L1':
      return (
        'The repository is checked out in the working directory at the reviewed commit with ' +
        `the change applied to the working tree. Read the diff with \`git diff ${base}\`, ` +
        'read any file you need, and search the tree. You cannot write files, run the ' +
        'package scripts, reach the network, or use gh.'
      )
    case 'L2':
      return (
        'The repository is checked out in the working directory at the reviewed commit with ' +
        `the change applied to the working tree and dependencies installed. Read the diff ` +
        `with \`git diff ${base}\`, read any file you need, and run the verify loop ` +
        '(`pnpm lint`, `pnpm typecheck`, `pnpm test <path>`). You cannot reach the network ' +
        'or use gh.'
      )
    default:
      throw new Error(`unknown tier ${tier}; one of ${TIERS.join(', ')}`)
  }
}

// instructionsInPrompt: true when the harness has no agent slot and the
// reviewer definition travels in the prompt (Codex); false when the harness
// loads it as the agent (Claude, --agents plus --agent).
export function buildPrompt({ template, tier, fixture, agentDefinition, instructionsInPrompt }) {
  const { pr, base, head } = fixture.source
  const instructions = instructionsInPrompt
    ? `## Reviewer instructions\n\n${agentBody(agentDefinition)}`
    : 'Your agent definition holds the reviewer instructions; apply them here.'
  const diffSection =
    tier === 'L0' ? `\n## Diff (base to head)\n\n\`\`\`diff\n${fixture.diff}\`\`\`\n` : ''
  return renderPrompt(template, {
    pr: String(pr),
    base,
    head,
    instructions,
    context: tierContext(tier, { base }),
    pr_body: fixture.prBody ?? '(no description available)',
    diff_section: diffSection
  })
}

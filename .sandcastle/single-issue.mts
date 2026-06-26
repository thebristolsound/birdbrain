// Stage 3 test runner — runs the implement→review pipeline against EXACTLY ONE
// issue, on its own branch, and does NOT merge. Inspect (and delete) the branch
// yourself before trusting the full main.mts merge phase.
//
//   npx tsx .sandcastle/single-issue.mts            # picks the first planned issue
//   SANDCASTLE_ISSUE=42 npx tsx .sandcastle/single-issue.mts   # forces issue id "42"
//
// Differences from main.mts:
//   - Single plan cycle (no outer loop).
//   - Implementer capped at 25 iterations (vs 100).
//   - Only one issue is executed, even if the planner finds several.
//   - No merge phase — the work stays on its branch for review.
//
// Cleanup after a run (replace <branch> with the one printed at the end):
//   git worktree remove --force .sandcastle/worktrees/<branch>
//   git branch -D <branch>

import * as sandcastle from "@ai-hero/sandcastle"
import { docker } from "@ai-hero/sandcastle/sandboxes/docker"
import { z } from "zod"

// Cap the implementer well below main.mts's 100 for a bounded first real run.
const IMPLEMENTER_ITERATIONS = 25

const planSchema = z.object({
  issues: z.array(z.object({ id: z.string(), title: z.string(), branch: z.string() }))
})

type PlannedIssue = z.infer<typeof planSchema>["issues"][number]

const hooks = { sandbox: { onSandboxReady: [{ command: "pnpm install" }] } }
const copyToWorktree = ["node_modules"]

// --- Phase 1: Plan (1 iteration, read-only reasoning) ---------------------
const plan = await sandcastle.run({
  hooks,
  sandbox: docker(),
  name: "planner",
  maxIterations: 1,
  agent: sandcastle.claudeCode("claude-opus-4-8"),
  promptFile: "./.sandcastle/plan-prompt.md",
  output: sandcastle.Output.object({ tag: "plan", schema: planSchema })
})

const issues = plan.output.issues
if (issues.length === 0) {
  console.log("No unblocked issues to work on. Nothing to test.")
  process.exit(0)
}

// --- Gate to exactly one issue --------------------------------------------
const wanted = process.env.SANDCASTLE_ISSUE
const issue = wanted ? issues.find((i: PlannedIssue) => i.id === wanted) : issues[0]

if (!issue) {
  console.error(
    `Issue id "${wanted}" was not in the planner's unblocked set. Planned ids: ` +
      issues.map((i: PlannedIssue) => i.id).join(", ")
  )
  process.exit(1)
}

console.log(`Testing a single issue: ${issue.id}: ${issue.title} → ${issue.branch}`)
if (issues.length > 1) {
  console.log(`(Planner found ${issues.length} unblocked; ignoring the rest for this test.)`)
}

// --- Phase 2: Implement + Review on its own branch (no merge) --------------
const sandbox = await sandcastle.createSandbox({
  branch: issue.branch,
  sandbox: docker(),
  hooks,
  copyToWorktree
})

try {
  const implement = await sandbox.run({
    name: "implementer",
    maxIterations: IMPLEMENTER_ITERATIONS,
    agent: sandcastle.claudeCode("claude-opus-4-8"),
    promptFile: "./.sandcastle/implement-prompt.md",
    promptArgs: { TASK_ID: issue.id, ISSUE_TITLE: issue.title, BRANCH: issue.branch }
  })

  let reviewCommits = 0
  if (implement.commits.length > 0) {
    const review = await sandbox.run({
      name: "reviewer",
      maxIterations: 1,
      agent: sandcastle.claudeCode("claude-opus-4-8"),
      promptFile: "./.sandcastle/review-prompt.md",
      promptArgs: { BRANCH: issue.branch }
    })
    reviewCommits = review.commits.length
  }

  console.log("\n--- single-issue result ---")
  console.log("branch:            ", issue.branch)
  console.log("implementer commits:", implement.commits.length)
  console.log("reviewer commits:   ", reviewCommits)
  console.log(
    implement.commits.length > 0
      ? `\n✓ Work is on branch '${issue.branch}'. Inspect it (git log/diff), then delete when done — it was NOT merged.`
      : "\nImplementer produced no commits. Check the logs above."
  )
} finally {
  await sandbox.close()
}

// Stage 2 smoke test — verifies auth + Docker sandbox lifecycle end-to-end
// WITHOUT touching your working branch or any GitHub issue.
//
//   npx tsx .sandcastle/smoke.mts
//
// Confirms: CLAUDE_CODE_OAUTH_TOKEN authenticates, the sandcastle:birdbrain
// image boots, the agent runs one iteration, and the completion signal fires.
// The agent is told not to write anything; any (unexpected) commits would land
// on a throwaway branch, never your HEAD.
//
// Cleanup after a run:
//   git worktree remove --force .sandcastle/worktrees/sandcastle-smoke-test
//   git branch -D sandcastle/smoke-test

import * as sandcastle from "@ai-hero/sandcastle"
import { docker } from "@ai-hero/sandcastle/sandboxes/docker"

const SIGNAL = "<promise>SMOKE-OK</promise>"

const result = await sandcastle.run({
  name: "smoke",
  sandbox: docker(),
  // bypassPermissions so the agent doesn't block waiting for tool approval.
  agent: sandcastle.claudeCode("claude-opus-4-8", { permissionMode: "bypassPermissions" }),
  maxIterations: 1,
  // Named throwaway branch — isolates anything the agent might do from your HEAD.
  branchStrategy: { type: "branch", branch: "sandcastle/smoke-test" },
  logging: { type: "stdout", verbose: true },
  completionSignal: SIGNAL,
  prompt: [
    "This is a connectivity smoke test. Do NOT modify, create, or commit any files.",
    "Reply with a single line confirming you are running inside the sandbox,",
    `then output exactly this on its own line to finish: ${SIGNAL}`
  ].join("\n")
})

console.log("\n--- smoke result ---")
console.log("branch:            ", result.branch)
console.log("completion signal: ", result.completionSignal ?? "(none — agent never signalled)")
console.log("iterations:        ", result.iterations.length)
console.log("commits (expect 0):", result.commits.length)

if (!result.completionSignal) {
  console.error("\n✗ No completion signal — check auth/output above.")
  process.exit(1)
}
console.log("\n✓ Smoke test passed. Clean up the throwaway branch/worktree (see header).")

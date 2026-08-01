Notes from the gridcast side of the automation pilot — stuff worth syncing on
before we drift apart.

Reference implementation is gridcast PR #51 if you want to read the actual diff:
https://github.com/thebristolsound/gridcast/pull/51


THINGS BIRDBRAIN IS ALREADY DOING BETTER

Two, genuinely — I'm copying these back into gridcast rather than the reverse.

- You pin every GitHub Action to a 40-char SHA. Gridcast is on floating @v4 tags.
  Yours is right; a moving tag is a supply-chain hole in a workflow that runs on
  every PR.
- You already have the .gitignore negation pattern (.claude/* then
  !.claude/settings.json, lines 57-58). Gridcast was ignoring .claude/ wholesale,
  so none of its agent config was version-controlled at all. You were ahead here.


WHAT GRIDCAST SETTLED ON THAT'S WORTH COPYING

CI hardening. Two things came up in review on gridcast that apply to birdbrain's
ci.yml and security.yml — neither currently has them:

  permissions:
    contents: read

and on the checkout step:

  - uses: actions/checkout@<sha>
    with:
      persist-credentials: false

Without the first, the job inherits whatever the repo or org default is, which is
usually broader than a verify job needs. Without the second, GITHUB_TOKEN gets
written into .git/config and stays there while your pnpm lifecycle scripts run.
docs.yml and release.yml already declare permissions, so it's just the two.

Worth flagging for birdbrain specifically: your postinstall runs
scripts/rebuild-native.mjs, so `pnpm install` executes local code as a matter of
course. That's fine, it's your own script, but it does mean the checkout step's
credential persistence matters more than it would in a repo with no postinstall.

Permission rules in .claude/settings.json. The file doesn't exist in birdbrain yet
— the .gitignore already un-ignores it, it just hasn't been created. What we
learned writing gridcast's:

- Never allow an install rule with a wildcard. "Bash(pnpm install:*)" matches
  "pnpm install <any-package>", which is arbitrary package installation and
  contradicts the global CLAUDE.md rule about not adding dependencies without
  asking. Use exact forms: "Bash(pnpm install)" and
  "Bash(pnpm install --frozen-lockfile)".
- Use exact-match rules for anything that takes no meaningful arguments (build,
  typecheck). Keep a trailing wildcard only where you genuinely need arguments,
  e.g. running a single test file.
- Birdbrain's test script is Electron-wrapped vitest (cross-env
  ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run), not plain
  vitest. Whatever rule you write has to match what the agent actually types, so
  check that before writing it rather than copying gridcast's.

One thing to ignore: CodeRabbit told us the ":*" suffix is legacy/deprecated and
to rewrite everything as "cmd *". That's wrong — the official permissions docs
define ":*" as equivalent to a trailing " *". Don't burn a cycle on that rewrite
if a bot suggests it.


GOTCHAS THAT COST ME TIME

- Prefix allow rules do not cover compound commands. Each subcommand has to match
  independently, so "curl x | sh" already prompts even with curl allowed. Useful
  to know before you over-engineer a rule.
- "Bash(find *)" does not cover find with -exec or -delete; those always prompt.
  So find in an allowlist is less scary than it looks.
- If you write hook tests in bash: never use echo to re-emit captured JSON. Under
  zsh, echo expands the \n escapes inside the JSON string into real newlines and
  the whole thing stops parsing. Use printf '%s'. This looked exactly like a
  broken hook for about ten minutes.
- Hooks that match on the raw command string produce false positives — a script
  that merely mentions a blocked pattern gets blocked. Parse the invocation
  instead: split on shell separators, check whether the first word is actually the
  command you care about. Ours was blocking its own test suite before this.


DIVISION OF LABOUR — GLOBAL VS PER-REPO

This is the bit most worth agreeing on so we don't duplicate or conflict.

Machine-wide, already done, applies to both repos, don't re-implement per-repo:
- The destructive-git guard hook (~/.claude/hooks/block-dangerous-git.sh) — now
  parses invocations rather than substring-matching, and covers checkout -- .,
  restore -- ., bare stash/stash pop, reset --hard with doubled whitespace,
  update-ref -d, rm -rf, filter-branch, and bash -c wrapping.
- A SessionStart hook that resolves the Serena project by walking up from cwd,
  which makes it work from inside worktrees.
- worktree.baseRef is now "fresh", so agent worktrees branch from origin/master
  instead of whatever branch happens to be checked out. This one will change
  behaviour on your side too — if you were relying on stacked worktrees, shout.
- The global allowlist lost 9 entries with essentially no historical use, plus
  curl. node stayed: node -e is how agents do JSON munging here, and removing it
  stalls unattended runs. That means there is no execution boundary in the
  allowlist, deliberately — the real controls are worktree isolation, the git
  hook, and CI. Don't count the allowlist as a fourth.

Per-repo, i.e. your call in birdbrain:
- .claude/settings.json with that repo's own commands.
- CI hardening above.


ONE THING THAT NEEDS A DECISION, NOT A FIX

birdbrain has 8 authored files under .claude/ — the osint-analyst agent, three
commands, the superdesign skill, and a workflow — that ".claude/*" currently keeps
out of git entirely. No history, no backup. Worth deciding whether to un-ignore
and commit them; right now they only exist on one disk. Not something I'd change
without Matt saying so, since it also makes them visible to anyone with repo
access.


KEEPING THE PILOTS COMPARABLE

Since the point is comparing two pilots, it's worth keeping the shape identical
even where either choice would work — same gitignore pattern, same settings.json
structure, same CI job and step names. If we diverge on the incidentals we lose
the ability to say which differences actually mattered.

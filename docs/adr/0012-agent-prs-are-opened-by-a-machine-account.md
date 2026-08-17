# Agent PRs are opened by a machine account

**Status:** Accepted

**Date:** 2026-08-16

## Context

The dispatch routine (`.claude/skills/dispatch/SKILL.md` §3) opens every agent PR itself, and
it has always done so as `thebristolsound` — the maintainer's own account. GitHub forbids
reviewing your own PR, so the maintainer has never been able to approve or request changes on
an agent PR (#487). Three consequences followed:

- No `CHANGES_REQUESTED` review has ever been posted on this repo. Across PRs #372–#477 every
  review from every reporter is `COMMENTED`.
- The ruleset on `main` has no `pull_request` rule. Requiring approvals would lock the repo,
  because the only human who could give one is the PR author.
- Nothing records that a human reviewed. "Merged" and "reviewed, then merged" leave the same
  trace, which is what makes ADR-0011's believability streak hard to read and ADR-0007's
  override record necessary at all.

PR #486 made the reviewer pre-pass a required `agent/pre-pass` commit status. That gives a
blocking gate and in-flight visibility, but it produces no evidence that a human looked.

Self-review is only an immovable constraint while the dispatcher owns the PR. `coderabbitai[bot]`
already posts here under its own identity, so a second identity is known to work mechanically.

## Decision

**The agent pipeline writes to GitHub as a dedicated machine account, not as the maintainer.**

1. A separate GitHub user account (the *machine account*; login recorded below once created)
   is added as a collaborator on `thebristolsound/birdbrain` with write access. It is the
   pipeline's identity: it opens agent PRs, applies their labels, posts claim comments,
   pre-pass comments, and `agent/pre-pass` statuses, and posts the implementer's review
   replies. Every write the dispatch routine makes goes through it.
2. **The maintainer's account never opens an agent PR again.** A dispatch cycle that cannot
   authenticate as the machine account — token missing, wrong login, insufficient scope —
   stops before claiming the slot and reports. Falling back to the maintainer identity is not
   an option, because it would put self-authored PRs back into the same population this
   decision exists to separate.
3. **Token custody.** The machine account's credential is a **fine-grained personal access
   token**, resource owner the machine account, repository access restricted to
   `thebristolsound/birdbrain` only, with the minimum permissions the write path needs
   (contents: read; issues, pull requests, commit statuses: read and write). Fine-grained PATs
   offer no Checks permission at all — a GitHub limitation, not a choice — so on this private
   repo the token cannot read CI check runs; the dispatcher reads CI state through the
   maintainer's own `gh` login, and only *writes* go through the machine token.
   It is held **only by the maintainer**, on the maintainer's machine, in a file outside any
   repository checkout — `~/.config/birdbrain-agent/env`, directory `0700`, file `0600` —
   as `BIRDBRAIN_AGENT_GH_TOKEN`, alongside `BIRDBRAIN_AGENT_GH_LOGIN` and the token's expiry
   date. It is never committed, never written to a repo `.env`, never stored as an Actions
   secret (no workflow needs it), and never pasted into a chat. The dispatch routine sources
   that file and passes the token to `gh` per write call as `GH_TOKEN`; the maintainer's own
   `gh` login is untouched. Rotation is re-running the provisioning wizard.
4. **Human commits and pushes stay under the human's identity.** The machine account is a
   GitHub-API identity for the dispatcher. Branch pushes still go over the maintainer's git
   credentials (SSH), and commit authorship is unchanged; the token deliberately lacks
   contents-write so it cannot push. Whether pushes should also move is a separate decision
   and is not made here.
5. The web write path (`docs/agents/github-access.md`) is not exempt from rule 2. Where the
   GitHub MCP tools would write as the sandbox identity, they no longer satisfy the dispatch
   contract for opening PRs. Provisioning the machine token into that environment is future
   work; until it exists, a web dispatch cycle stops at the identity check.

## Consequences

- The maintainer becomes a genuine reviewer of agent PRs. Approvals and `CHANGES_REQUESTED`
  become available, and either can later be made required in the ruleset without locking the
  repo — a follow-up, not part of this decision.
- The dispatch skill's "formal `CHANGES_REQUESTED` reviews cannot occur here" reasoning is
  retired: feedback may now arrive as a review with a state, and the routine treats
  `CHANGES_REQUESTED` exactly as it treats a human comment asking for changes.
- Agent-authored PRs are distinguishable from human ones by author, not only by label. The
  audit trail gains a second account; that is the accepted cost, and it is a *pipeline*
  identity, not an evidence-package identity — nothing inside a case archive, manifest, or
  signature changes.
- The pre-pass verdict is still a commit status (PR #486). The status now comes from the
  machine account rather than the maintainer; the required-check rule keys on context, not
  poster, so nothing in the ruleset changes.
- One more secret to rotate. Expiry is recorded next to the token so a cycle can say *why* it
  stopped rather than failing on the first write.

Provisioning is a human-only procedure: `scripts/setup-agent-github-account.sh` walks it
(create the account with 2FA, invite and accept, mint the token, store it, verify the
identity end to end). The dispatch skill checks the identity at the top of every cycle.

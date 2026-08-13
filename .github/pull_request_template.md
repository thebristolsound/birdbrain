<!--
Thanks for contributing. Keep the completed PR description concise and remove prompts that
do not apply. Non-trivial changes need an issue first; see CONTRIBUTING.md.
-->

## Summary

<!-- What problem does this PR solve, why is the change needed, and what is the approach? -->

## Related issue

<!-- Use "Closes #123" when merging this PR should close an issue. Explain if no issue applies. -->

## Changes

<!-- List the material changes. Call out deliberate exclusions or follow-up work. -->

## Verification

<!-- Check only commands you ran. Add results and explain any omitted applicable check. -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm build:extension` (if `extension/` changed)
- [ ] `pnpm test:e2e` (if end-to-end behavior changed)
- [ ] `pnpm types:check && pnpm build` from `website/` (if the docs site changed)

### Test coverage and manual checks

<!-- Tests added or updated, manual test steps and results, or why no additional test applies. -->

## Visual evidence

<!--
Add before/after screenshots or a recording for visible UI changes. Otherwise write
"Not applicable."
-->

## Risk and recovery

<!--
Describe user-facing risk, compatibility or migration concerns, and how to recover or roll
back. "Low risk; revert this PR" is fine when accurate.
-->

## Documentation

<!-- Docs updated (README, website/content/docs, docs/), or why no documentation is needed. -->

## Security and privacy impact

<!--
Cover changes to network egress, permissions, IPC surface, untrusted-input parsing, secrets,
stored data, or telemetry. "None" is a valid answer; say it explicitly.
-->

## Evidence-affecting change review

<!-- Birdbrain is an evidence tool. Select exactly one answer, even for docs-only changes. -->

Does this change touch capture, parsing, extraction, storage, hashing, signing, trusted
time, manifests, verification, redaction, export, reporting, AI analysis, or release
distribution? Check the path inventory in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` if unsure.

- [ ] No — no evidence-affecting paths are touched.
- [ ] Yes — this PR carries the `evidence-affecting` label and requires human review before
      merge (`docs/adr/0005-unattended-agents-on-the-evidence-path.md`). Complete the section
      below.

### Evidence impact (required when "Yes" is selected)

- Evidentiary result or interpretation that could change:
- What verification proves and does not prove after this change:
- Existing evidence package compatibility:
- Known-answer test added or extended (or justification if none applies):

## Reviewer notes

<!-- Point reviewers to the highest-risk code, important tradeoffs, or specific open questions. -->

## Author checklist

- [ ] I reviewed my own diff and removed unrelated changes, debug code, and generated files.
- [ ] I added or updated tests for changed behavior, or explained why no test applies.
- [ ] I documented breaking changes, migrations, security impact, and evidence impact above.
- [ ] I confirmed this PR contains no secrets, credentials, or private investigation data.

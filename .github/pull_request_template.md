<!-- Thanks for contributing. Non-trivial changes need an issue first — see CONTRIBUTING.md. -->

## What changed

<!-- What this PR does and why. Link the issue it implements: "Fixes #123". -->

## Verification

<!-- Check what you ran; paste relevant output for anything non-trivial. -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm build:extension` (if `extension/` changed)

## Tests

<!-- Tests added or updated — or why none apply. -->

## Documentation

<!-- Docs updated (README, website/content/docs, docs/) — or why none are affected. -->

## Security impact

<!-- Any change to attack surface: network egress, permissions, IPC surface, parsing of
     untrusted input, secrets handling. "None" is a valid answer — say it explicitly. -->

## Evidence-affecting change review

<!-- Birdbrain is an evidence tool. Answer this even if the answer is no. -->

Does this change touch capture, parsing, extraction, storage, hashing, signing, trusted
time, manifests, verification, redaction, export, reporting, AI analysis, or release
distribution? Check the path inventory in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` if unsure.

- [ ] No — no evidence-affecting paths are touched.
- [ ] Yes — this PR must carry the `evidence-affecting` label and requires human review
      before merge (`docs/adr/0005-unattended-agents-on-the-evidence-path.md`). Include an
      **Evidence impact** section below covering: what evidentiary result or interpretation
      could change; what verification proves and does not prove after this change; whether
      existing evidence packages still verify; and a known-answer test extended for the
      affected method — or an explicit justification for why none applies.

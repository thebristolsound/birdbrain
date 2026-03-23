---
name: require-checks-before-stop
enabled: true
event: stop
pattern: .*
action: warn
---

✋ **Before finishing, verify all checks pass!**

You must run and confirm these pass before stopping:

- [ ] **Tests:** `pnpm test` — all tests passing
- [ ] **Lint:** `pnpm lint` — no lint errors
- [ ] **Build:** `pnpm build` — build succeeds

If any check fails, fix the issues before completing the task.
Do not claim work is done until all three pass.

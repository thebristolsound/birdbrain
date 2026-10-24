# Clear the Shared Cases dependency audit blockers

**Status:** active

The dependency audit on PR #1966 reports three unaccepted high-severity advisories.
Its dependency files match `main` at `e94b30e6`; this change fixes that shared baseline
without adding dependency changes to the Shared Cases implementation branches.

## Change

- Update Happy DOM to 21.0.4, the same version proposed by Dependabot in PR #1962.
- Override body-parser 2 to 2.4.0 or later, following the existing override pattern.
- Raise the existing Undici 6 and 7 overrides to 6.29.1 and 7.30.1.
- Regenerate the lockfile. Keep the accepted audit exceptions and gate unchanged.

The version floors come from the published advisories for
[body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[Happy DOM](https://github.com/advisories/GHSA-834v-8h66-3h79), and
[Undici](https://github.com/advisories/GHSA-xjj6-f33q-929c).

## Verification and handoff

`mise x -- pnpm audit:check` reproduced all three blockers on PR #1966 with exit 1.
After the update, the same check exits 0 with no blocking advisories outside the
existing accepted exceptions. Commit and run clean-head full verification. The full
verification output belongs in the draft PR description at its final head.

Next command:

```sh
BIRDBRAIN_TEST_SYSTEM_SHARP=1 PKG_CONFIG_PATH=/usr/lib/pkgconfig mise x -- pnpm preflight
```

Open a separate draft PR after verification. Human review and merge remain pending.
Once it merges, update the Shared Cases branches and rerun their checks. Their
evidence-affecting merge gates still require Matt's approval at each reviewed head.

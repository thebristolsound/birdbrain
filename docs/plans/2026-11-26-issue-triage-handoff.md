# Issue triage handoff

**Status:** parked on 2026-11-26. The first pass recorded five decisions or
reproductions. Resume with the evidence-impact decisions below.

The review used main at `6901358b7`. The tracker held no unlabeled open issues,
five awaiting triage, and one awaiting a reporter reply. All five triage notes
are on their issues.

- The design-system build produced the agreed palette and copied the stale
  section-label note. A person with access to the design artifact can update the
  note, rebuild, and confirm what the published artifact displays. [Design-system issue](https://github.com/thebristolsound/birdbrain/issues/2246#issuecomment-7204750694)
- The receiver read both the Transaction Record and the PDF into whole buffers
  in a test with small fixtures. Peak memory at the size caps remains unmeasured.
  [Shared Case receiving issue](https://github.com/thebristolsound/birdbrain/issues/2250#issuecomment-7204750712)
- Both Verify Runbook defects reproduced with a signed two-member fixture
  under plain `sh`. [Merge-head issue](https://github.com/thebristolsound/birdbrain/issues/2253#issuecomment-7204750736),
  [receipt issue](https://github.com/thebristolsound/birdbrain/issues/2254#issuecomment-7204750704)
- Both capture result types reproduced the disappearing notice during the
  earlier notice's fade in a fake-timer test. [Extension issue](https://github.com/thebristolsound/birdbrain/issues/2263#issuecomment-7204750696)
- The Wayback issue still awaits the maintainer's URL equivalence and import
  rulings. [Wayback triage notes](https://github.com/thebristolsound/birdbrain/issues/867)

## Resume triage

Start by reading the verification issues and any replies:

```bash
gh issue view 2253 --repo thebristolsound/birdbrain --comments
gh issue view 2254 --repo thebristolsound/birdbrain --comments
```

The pending choice is whether to apply the evidence gate to the two Verify
Runbook changes, the received Capture hash check, and the extension notice
change. The affected files are listed as blocking in the
[evidence path assessment](../specs/2026-07-31-evidence-affecting-paths-assessment.md).
The four issues carry `bug` and `needs-triage` pending that decision. Severity
scoring awaits access to Jev.

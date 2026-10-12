Friction notes: PR review

1. The implementer had to work out again which accounts count as trusted reviewers, because the rule is split across two guides.
2. The dispatcher could not tell from the instructions whether a closed pull request still holds a slot.

<details>
<summary>Each note in full</summary>

| # | from | kind | anchor | cost | fix |
|---|---|---|---|---|---|
| 1 | reviewer | re-derived | `.claude/skills/dispatch/SKILL.md#session-rules` | read the whole dispatch skill to find the list | link the trusted-account list from the implementer brief |
| 2 | reviewer | confusing | `.claude/skills/dispatch/SKILL.md#1-slot-check` | queried the slot labels twice | unknown |

</details>

<details>
<summary>Where these came from</summary>

Run: https://github.com/thebristolsound/birdbrain/actions/runs/1
Commit: a1b2c3d4e5f60718293a4b5c6d7e8f9012345678
Date: 2026-10-11

</details>

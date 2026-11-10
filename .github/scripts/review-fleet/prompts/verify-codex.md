**Check Codex's findings.** `codex.json` lists the findings Codex posted on this head. Each is a
claim to check, not a fact. For each one, read the code it points at, follow the data far enough
to decide, and rule:

- `CONFIRMED`: the defect is real at head, and its consequence is what Codex says or worse.
- `REFUTED`: the code at head does not behave as claimed, or a guard elsewhere prevents it. Your
  reason names the line that shows it.
- `UNCLEAR`: deciding needs a run you cannot make. Your reason says which.

This pass returns `rulings`, not `findings`: one entry per Codex finding, with its `id` from
`codex.json` and a one-sentence `reason`. The "Output" section above describes `findings` for
the other passes; ignore it here. Rule on every finding in the file.

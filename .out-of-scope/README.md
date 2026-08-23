# Out-of-scope knowledge base

Durable records of enhancement requests this project decided not to build. One file per concept, not per issue.

Read by the `/triage` skill during context gathering, which checks an incoming request against these files by concept similarity rather than keyword and surfaces any match before re-litigating a settled decision.

## When a file goes here

Only when an **enhancement** is closed as `wontfix` because it was **rejected**. That is the whole rule, and both halves matter.

Bug reports do not go here. A bug closed as `wontfix` is a judgement about one defect, not a standing position on a feature.

Neither does anything closed as `wontfix` because it is **already implemented**. Recording a built feature as a rejection poisons the deduplication check, which would then surface a false prior rejection the next time someone asks about it. Point at where the feature lives in the closing comment instead, and leave this directory alone.

Deferrals do not go here either. "Not now" is not a rejection, and a file that says "we were busy" reads as settled when it is not. If the work is wanted eventually, it stays open with a state label.

## File format

Name the file after the concept in kebab-case, short enough that someone browsing the directory understands what was rejected without opening it. `dark-mode.md`, `plugin-system.md`, `cloud-sync.md`.

```markdown
# Cloud sync

This project does not sync cases or captures to a remote service.

## Why this is out of scope

State the reasoning substantively. Reference project scope, a technical
constraint, or a strategic decision, and make the argument rather than
asserting the conclusion. Code samples and examples are welcome; this
reads better as a short design note than as a database row.

The reason must be durable. Anything that turns on temporary
circumstances is a deferral wearing a rejection's clothes.

## Prior requests

- #42, "Sync cases between machines"
- #87, "Backup to S3"
```

## Adding to an existing file

If a new request matches a concept already recorded, append it to that file's prior-requests list and close the issue. Do not create a second file for the same concept.

## Changing a decision

If a rejection no longer holds, delete the file. Old issues stay closed as historical record and do not need reopening; the new request that prompted the reconsideration goes through normal triage.

## Related

- `docs/agents/triage-labels.md` for the label vocabulary and the `ready-for-agent` bar
- `docs/agents/issue-tracker.md` for the `gh` commands triage uses

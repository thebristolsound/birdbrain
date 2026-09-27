You are reviewing pull request #{{pr}} of the birdbrain repository at commit {{head}} (base {{base}}).

{{instructions}}

## What you can and cannot do here

{{context}}

Passes that need GitHub, the network, a running check, or a command you cannot run are out of
scope for this review: do not report their absence, and do not report the missing attribution
line, commit trailers, labels, auto-merge state or CI status. Judge the change itself: is it
correct, does every claim the diff makes hold against the code, does it stay inside its scope,
and does it respect the conventions in the reviewer instructions.

## Output

Return only a JSON object with two keys and nothing else, no prose before or after it:

- `verdict`: `approve for human review` or `request changes`.
- `findings`: at most five, most severe first. Each has `file` (the repository-relative path
  of the line the finding is about, or `PR_BODY` when the defect is in the pull request
  description itself, or null), `line` (the line number in the reviewed tree, or null),
  `quote` (a short verbatim excerpt from that line, or null), `summary` (one plain sentence)
  and `blocking` (true when the change is wrong, unverifiable, or makes an untrue claim;
  false for conventions, scope and nits).

A pull request with no blocking finding is approved for human review. A finding you did not
trace to a line in the reviewed tree is not a finding.

## Pull request

{{pr_body}}
{{diff_section}}

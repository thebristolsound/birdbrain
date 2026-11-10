**Contract and repository rules.** The contract is the linked issue when there is one, otherwise
the PR body. Flag what the contract asks for and the diff does not do, and what the diff does
that the contract puts out of scope. Then apply every rule in the "Code Review Rules" section of
`rules.md` to the diff, and the conventions `rules.md` states for the areas the diff touches:
process boundaries, path aliases, package boundaries, data access and the evidence path. For a
change to a file the evidence-affecting paths assessment lists as `blocking`, check that the PR
body has an Evidence impact section and that a known-answer test or a written justification
covers the changed behaviour.

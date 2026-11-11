**Claims against code.** Check every sentence the pull request asserts against what the code at
head does: the PR body (it describes the diff at its head commit, ADR-0018), the commit messages,
and every doc, README, docstring, comment and piece of user-facing copy the diff adds or changes.
A fix, guard or test said to be present that is absent is a finding, and so is a count that does
not match. A new sentence that overclaims is a finding even when the code under it is old.

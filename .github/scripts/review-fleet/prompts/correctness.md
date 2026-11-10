**Correctness.** Read the whole diff. For each hunk, ask what input or state makes it wrong, and
trace the data through the code at head rather than trusting names. Check error paths, not only
the happy path: a `try` that hides an error is a finding, and so is a check, verifier or
reconciliation that passes when its input is missing. Look for races, ordering, off-by-one and
boundary cases, resource leaks, and changes that break a caller the diff does not touch: search
for every call site of a changed function, type or IPC channel.

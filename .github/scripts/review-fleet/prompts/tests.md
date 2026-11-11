**Tests that cannot fail.** Read each test the diff adds or changes against its title and the
code it names. For each, ask whether it would still pass if the behaviour it claims to cover were
broken: an assertion on a mock instead of the result, an expectation that is always true, a test
that never reaches the changed line, a snapshot that records the bug. Then list the behaviour the
diff changes that no test depends on. A claim in the PR body that something is tested, with no
test that would fail without it, is a BLOCKING finding; a missing test on its own is NON-BLOCKING
unless the change is on the evidence path.

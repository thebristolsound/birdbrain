# Finish the launched Capture review fixes

Scope: fix the four defects found in merged pull request #2068. Issues #2138 and
#2139 group the three recording defects and the progress defect. The maintainer
requested the fixes through merge.

## Completed

- Add regression tests for failed page setup, early document headers, redirect
  hops after the cut, and a shortcut pressed during an active Capture.
- Fix recording eligibility and retain early headers when a document commits.
- Give the collector an optional request boundary so later redirects can finish
  an earlier exchange without adding their own exchange to the Capture.
- Preserve active progress when another trigger arrives. Check the running app
  with a held acquisition fixture before and after the fix; finish that fixture
  and observe its Exhibit Number.
- Run the focused recorder, collector, artifact, and service tests: 139 pass.
- Rebuild test-only libvips and sharp under the ignored local cache because the
  old build names a missing OpenEXR library. Production dependencies stay unchanged.

- Complete type checking and scoped lint.
- Address Sol finding S1: count service-worker responses by the hop's request
  boundary. A response after the cut still counts when its hop began before it.
- Obtain Sol approval in round two, with S1 resolved and no new findings.

## In flight

- Run full verification after the other full test runs finish.
- Open the pull request with the screenshot pair, and handle
  review and checks through the repository's merge gate.

Next command after the other full test runs on this machine finish:

```bash
pnpm preflight
```

Open questions: none. Existing package verification and record schemas stay unchanged.

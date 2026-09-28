# Run the gate for v1.0.1-beta.20 — do these in order

Tick as you go. Full reference: docs/plans/2026-08-15-pre-ship-validation-gate.md
Checklist to fill in: birdbrain-beta20-gate.md (in the worktree root, next to this file)

NOTE ON NUMBERING: the STEPS below (0-8) are execution order, not gate sections.
The gate itself has five sections, 1-5. There is no section 6, 7 or 8.
  STEP 1 = section 1        STEP 5 = section 4b (Windows)
  STEP 2 = section 2        STEP 6 = section 4a + finishing 4b (WSL)
  STEP 3 = section 5 (Win)  STEP 7 = section 5 then section 3, on Ubuntu
  STEP 4 = section 3 (Win)  STEP 8 = record the verdict

Release page:
https://github.com/thebristolsound/birdbrain-releases/releases/tag/v1.0.1-beta.20

--------------------------------------------------------------------------
STEP 0 — What you need before you start
--------------------------------------------------------------------------
- A Windows VM you can snapshot and roll back.
- An Ubuntu box or VM.
- Chrome on both.
- Nothing else. Do not build anything locally except the verifier (step 6).

--------------------------------------------------------------------------
STEP 1 — Section 1 (CI + Security green).  ALREADY DONE.
--------------------------------------------------------------------------
Tick all 8 boxes. Evidence, both on b6505e7, the exact commit v1.0.1-beta.20 points at:

  CI       run 32217834302  changes/lint/typecheck/e2e/build/test  = all success
  Security run 32217834309  secret scan/publish guard/dep audit    = all success

Nothing reported "skipped". Verified before the tag was pushed.

--------------------------------------------------------------------------
STEP 2 — Section 2 (CI artifacts only).  Download these four files.
--------------------------------------------------------------------------
From the release page above:

  Birdbrain-Setup-1.0.1-beta.20.exe     -> Windows VM
  Birdbrain-1.0.1-beta.20.AppImage      -> Ubuntu box
  birdbrain-extension.zip               -> both
  (macOS testers only: Birdbrain-1.0.1-beta.20-arm64.dmg or ...-beta.20.dmg)

ALSO download, for step 3:
  https://github.com/thebristolsound/birdbrain-releases/releases/tag/v1.0.1-beta.19
  Birdbrain-Setup-1.0.1-beta.19.exe
  Birdbrain-1.0.1-beta.19.AppImage

Tick both section 2 boxes. Do not use a locally built installer anywhere.

--------------------------------------------------------------------------
STEP 3 — WINDOWS VM, Section 5 FIRST (upgrade path)
--------------------------------------------------------------------------
Do section 5 before section 3, because section 3 needs a clean machine and
this one does not.

  3.1  Snapshot the clean VM. You will roll back to this.
  3.2  Install Birdbrain-Setup-1.0.1-beta.19.exe  (SmartScreen -> More info -> Run anyway)
  3.3  Launch it. Create a case. Take at least one capture in it.
  3.4  Settings -> Updates -> Check for updates
  3.5  Download, then Restart to update.
  3.6  App relaunches on 1.0.1-beta.20. Confirm in Settings -> About.
  3.7  Confirm the case is still there and the capture still opens.
  3.8  LAST BOX: Settings -> Database -> Utilities -> Pre-Migration Snapshots.
       .19 and .20 are BOTH schema version 27, so NO snapshot is expected.
       Write "no schema change, none expected" instead of ticking it.
       An absent snapshot here is correct, not a failure.

  Record: path used = IN-APP.

--------------------------------------------------------------------------
STEP 4 — WINDOWS VM, roll back, then Section 3 (smoke)
--------------------------------------------------------------------------
  4.0  Roll the VM back to the clean snapshot from 3.1.
  4.1  Install Birdbrain-Setup-1.0.1-beta.20.exe (SmartScreen click-through expected)
  4.2  Launch. Create a case.
  4.3  Unzip birdbrain-extension.zip. In Chrome: chrome://extensions ->
       Developer mode ON -> Load unpacked -> pick the unzipped folder.
       Dashboard banner must flip to "Browser Extension Connected" and the
       top bar must read "Connected".
  4.4  Capture a page. MHTML is the only format the extension produces --
       there is no HTML capture path, ignore any instruction that asks for one.
  4.5  Capture a second, different page.
  4.6  View both captures in the app.
  4.7  Export the case.
  4.8  Quit, relaunch, confirm the case and both captures are still there.

  NOTE on 4.3: the "Connected" indicator is currently unreliable (#628) --
  the app forgets the extension 10s after each poll, and the extension only
  polls every 30s. Treat a successful capture in 4.4, not the indicator, as
  proof the extension is connected. Do not fail the gate on the indicator.

--------------------------------------------------------------------------
STEP 5 — WINDOWS VM, Section 4b (live capture -> verify -> export -> re-verify)
--------------------------------------------------------------------------
Stay on the VM from step 4.

  5.1  Take a fresh capture in that case.
  5.2  Open it, click Verify on its provenance badge. Result must not be "tampered".
  5.3  Export the case as an EVIDENCE PACKAGE (zip).
  5.4  Unzip it. Confirm it contains:
         manifest.jsonl, evidence.json, report.html, certification.html,
         signing-public-key.pem, VERIFY.md, tsa-intermediates.pem
       and tsa-root.pem (expected, since the default DigiCert TSA is in use).
  5.5  Leave the unzipped folder there. You will run the verifier against it in step 6.

--------------------------------------------------------------------------
STEP 6 — Section 4a (known-answer) + finish 4b.  Run in WSL.
--------------------------------------------------------------------------
In your WSL repo, on the tag:

  cd /path/to/your/clone     # the repository root
  git fetch origin
  git checkout v1.0.1-beta.20
  pnpm install

  # 6a - the openssl known-answer check
  cd tests/fixtures/timestamp
  openssl ts -verify -in digicert-response.tsr -queryfile request.tsq \
    -CAfile digicert-trusted-root-g4.pem
  # MUST print: Verification: OK
  cd ../../..

  # 6b - the verifier's own self-check
  pnpm build:verifier
  dist/verifier/birdbrain-verify --self-check

  # 6c - finish 4b: run it against the package from step 5
  dist/verifier/birdbrain-verify /path/to/unzipped/package
  # MUST report PASS

Copy the unzipped package folder from the Windows VM into WSL for 6c.

The verifier is the ONE exception to "CI artifacts only" - it is not a release
asset, so you build it locally from the tag. Every installer stays CI-built.

--------------------------------------------------------------------------
STEP 7 — UBUNTU BOX, Section 5 then Section 3
--------------------------------------------------------------------------
  7.1  chmod +x Birdbrain-1.0.1-beta.19.AppImage && ./Birdbrain-1.0.1-beta.19.AppImage
       The AppImage needs FUSE 2, which Ubuntu does not ship by default (#641):
         sudo apt install libfuse2t64     # 24.04+
         sudo apt install libfuse2        # 22.04 and earlier
       No-install fallback: ./Birdbrain-....AppImage --appimage-extract-and-run
  7.2  Create a case, take a capture.
  7.3  Settings -> Updates -> Check for updates -> Download -> Restart to update.
  7.4  Confirm 1.0.1-beta.20 in Settings -> About, case and capture intact.
       Same snapshot note as 3.8 - none expected.
  7.5  Then the eight smoke steps from step 4 (4.2 - 4.8) on this machine.

This is the FIRST time the in-app upgrade path has been exercised on Linux.
Windows already proved it on .18 -> .19. If anything is going to fail, expect
it here.

--------------------------------------------------------------------------
STEP 8 — Record the verdict
--------------------------------------------------------------------------
Fill in the go/no-go table at the bottom of birdbrain-beta20-gate.md.

GO      = every must-pass ticked.
NO-GO   = any must-pass failed. Tell me what failed and I fix the build,
          we re-tag, and section 1 starts again.

.deb is best-effort. Skip it if you are short on time and write "not run".
macOS is not in the gate at all.

Anything that failed and you accepted anyway goes in the release notes.

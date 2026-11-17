# Consolidation phase 3: launch in one dialog

**Status:** active

This is the detail plan for phase 3 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). A first
launch takes three stops today: the launch dialog refuses because no Operator name is set, the
Operator goes to Settings and comes back, and after Launch a second dialog repeats the VPN
warning the first one already showed (finding U2). This phase makes it one dialog. Code
references are to `origin/main` at `ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan and the review notes left on #2201.

No slice here waits for the design bundle. Slice 3.2 rests on decision 3 of the parent plan and
amends ADR-0032 in its own pull request.

ADR-0032's Decision section has two numbered lists. The rules cited here are in the second,
under "Birdbrain pushes the Operator toward a VPN, but only warns". As in the parent plan, they
are called VPN rule 2, VPN rule 3 and VPN rule 4.

The rules every slice follows are in the parent plan under "Slices" and in `CLAUDE.md` under
"Posting surfaces".

## How the dialog works today

`StartDialog.tsx`:

- reads `settings.operatorName`; when it is empty, `canLaunch` is false, the Operator row says
  "Not set", and a "Set operator name" button calls `setOperatorName()`, which closes the
  dialog and opens Settings on the Operator tab;
- shows `launch-no-vpn`, an amber line of plain text under Egress, when the Egress is Direct
  and `vpnStatusQueryOptions` reports no VPN seen. The line has no filled box, so finding C3
  does not apply to this dialog;
- in `launch()`, awaits `confirmContact({ caseId }, 'session')` before activating the Case.
  That call asks main through `egress.checkVpnWarning` and, when a warning is due, opens the
  one `VpnWarningDialog` mounted at the root;
- then calls `launchBrowser`, which resolves once the browser is open and its Capture Session
  runs. The footer says so: "Starts a Capture Session in ‹Case›."

The amber line and the warning have different sources. The line follows the VPN status. Whether
a warning is due is main's answer, which is quiet for a Case already warned and on a muted
network. So today the line can show with no second dialog after it.

`src/main/services/vpnWarning.ts` decides whether a warning is due. `check` returns
`{ warn, canMute }` and records only which network the question was raised on; `answer` is what
marks the Case as warned and, for `mute-network`, mutes the network.

The critique counted four info tips in this dialog. The code has three, and the parent plan
follows the code: beside the title, beside the Egress, and beside "Not set" only while no
Operator name is saved.

## Slice 3.1: ask for the Operator name in the launch dialog

Finding U2.

- **Change.**
  - When `settings` has loaded and `operatorName` is empty, the Operator row renders a text
    field with the label and placeholder the Operator tab uses, and one line under it: every
    Capture carries an operator name.
  - Launch is enabled once the field holds a non-blank value. On Launch the dialog saves the
    name through `useSettingsMutations().update`, the mutation `OperatorConfig.tsx` uses, and
    only then runs the existing launch steps. A failed save shows in the row and nothing
    launches.
  - `setOperatorName()` and the "Set operator name" button go.
- **Same rule as the Operator tab.** `OperatorConfig.tsx` refuses a blank name with "Operator
  name is required for capture and export." The dialog applies the same test and adds no other
  write path: the name is stamped on every Capture.
- **Files.** `src/renderer/components/launchedBrowser/StartDialog.tsx`.
- **Tests.** `tests/components/StartDialog.test.tsx`: with no name, the field shows and Launch
  is disabled; typing a name enables it; Launch saves the name before `activateCase`; a failed
  save launches nothing; with a name set, no field shows.
- **Screenshots.** The dialog on a profile with no Operator name, empty and filled, before and
  after.
- **Docs.** `tester-guide.mdx`: if a step sends the tester to Settings for the name before a
  first launch, it changes to the dialog.
- **Evidence tier.** Treat the slice as `evidence-affecting` whatever tier `StartDialog.tsx`
  is given. The assessment lists the Operator tab, `OperatorConfig.tsx`, as `blocking` because
  the export certification embeds the Operator identity verbatim, and this slice adds a second
  place that writes the name. It takes the label and an Evidence impact section, and waits for
  the maintainer's review.
- **Known answer.** A test shows the dialog saves the same value the Operator tab saves for the
  same input, trimmed the same way, and refuses the same empty and whitespace names.
- **Acceptance.**
  - [ ] A first launch on a new profile needs no visit to Settings.
  - [ ] The saved name appears in Settings, on the Operator tab.
  - [ ] A blank or whitespace name cannot launch.
  - [ ] For any input, the dialog and the Operator tab store the same name or refuse alike.

## Slice 3.2: one VPN statement per launch

Findings U2 and C3. Decision 3 allows it.

- **Change.**
  - When the dialog opens for a Case, it asks `egress.checkVpnWarning({ caseId }, 'session')`.
    While the answer is `warn: true`:
    - the `launch-no-vpn` line stays under Egress as it is;
    - a "Set up a proxy" link sits beside it and does what `VpnWarningDialog`'s `setUpProxy`
      does;
    - when `canMute` is true, a checkbox reads "Do not warn on this network";
    - the primary button reads "Launch without VPN".
  - On that button, the dialog calls `egress.answerVpnWarning` with `continue`, or with
    `mute-network` when the checkbox is ticked, then runs the launch.
  - `launch()` no longer calls `confirmContact`.
  - When `warn` is false the dialog looks as it does today and the button reads "Launch" or
    "Launch and join". That includes a Case already warned and a muted network, where the
    amber line still shows: the button's label follows main's answer, not the line.
- **Both calls are required.** The review of the parent plan noted that an inline button wired
  straight to the launch would skip main. Without `checkVpnWarning`, "Launch without VPN" shows
  on a muted network. Without `answerVpnWarning`, main never marks the Case warned, so
  `VpnWarningDialog` returns at the next start, and "Do not warn on this network" never
  reaches the muted list.
- **What does not change.** `VpnWarningDialog` and every other caller of `confirmContact` and
  `requireContact`: the Capture Session switch, recaptures, pasted URLs and Wayback lookups.
- **ADR-0032.** The same pull request amends VPN rule 3. Proposed wording to add: "When the
  session starts from the launch dialog, the dialog itself carries the warning: the same
  sentence, the offer to set up a proxy, the offer to stop warning on this network, and a
  primary button whose label says the launch goes ahead without a VPN. No second dialog
  follows." The amendment also records why this still counts as a warning: the Operator
  cannot launch without pressing a button that names the condition.
- **Files.** `src/renderer/components/launchedBrowser/StartDialog.tsx`,
  `docs/adr/0032-route-app-egress-but-do-not-disguise-the-browser.md`. The preload and main
  handlers already expose both calls.
- **Tests.** `tests/components/StartDialog.test.tsx`: with `warn: true` the label, link and
  checkbox show; Launch answers `continue` or `mute-network` before launching; with `warn:
  false` nothing is answered. `e2e/vpn-warning.spec.ts`: a new test opens the launch dialog on
  a Direct Egress with no VPN, presses the button, and checks no `vpn-warning-dialog` appears
  and that the Case is not warned again. Its existing test that nothing about the warning is
  recorded in a Capture row or Manifest Entry must still pass.
- **Screenshots.** The dialog with a warning due, with and without the mute checkbox, before
  and after; and the removed second dialog, before only.
- **Evidence tier.** Confirm `StartDialog.tsx`'s tier. ADR-0032 VPN rule 4 says the result of
  the check is not evidence, and nothing here writes it anywhere new.
- **Acceptance.**
  - [ ] A launch with a warning due shows one dialog.
  - [ ] All three offers from ADR-0032 VPN rule 2 are present in it.
  - [ ] On a muted network, and for a Case already warned, the button reads "Launch".
  - [ ] After the launch, main reports the Case as warned for the `session` occasion.
  - [ ] A ticked checkbox mutes the network, as `mute-network` does today.
  - [ ] The amended ADR is in the same pull request.

## Slice 3.3: fold the info tips into one disclosure

Finding U15.

- **Change.** The dialog's three `InfoTip`s become one "How this works" disclosure under the
  description, closed by default, holding the text of `TITLE_TIP` and the Egress tip. The
  Operator tip shows only while no Operator name is saved, the state slice 3.1 changes: 3.1
  turns `OPERATOR_TIP` into the line under the field. If 3.1 has not landed, that text joins
  the disclosure.
- **Check against the copy cut.** `docs/plans/2026-11-16-ui-copy-cut.md` reviews the same
  sentences. If it cuts a tip's text, the disclosure holds what is left, and if nothing is
  left the disclosure is not built.
- **Files.** `src/renderer/components/launchedBrowser/StartDialog.tsx`.
- **Tests.** `tests/components/StartDialog.test.tsx`: the disclosure opens by keyboard and holds
  both texts.
- **Screenshots.** The dialog closed and with the disclosure open, before and after.
- **Evidence tier.** As 3.1.
- **Acceptance.**
  - [ ] The dialog at rest shows no info icon.
  - [ ] Every sentence the tips held is still reachable.

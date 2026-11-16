# Consolidation phase 6: status tiers

**Status:** active

This is the detail plan for phase 6 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). "VPN not
seen" is a permanent amber word in the chrome for any Operator whose VPN the check cannot see
(finding U6), and below the `xl` width the control shows its state by colour and a small icon
only (A2). Decision 2 of the parent plan lets the advisory show as a coloured dot. This phase is
one slice. Code references are to `origin/main` at `03668a1`.

It does not wait for the design bundle: frame H of
`docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md` draws the same three tiers and
can follow the code if the code lands first.

The rules every slice follows are in the parent plan under "Slices" and in `CLAUDE.md` under
"Posting surfaces".

## How the control decides today

`statusModel` in `statusGroupModel.ts` gives each of three signals a `Severity` of `nominal`,
`warning` or `danger`:

- the Egress is `danger` when it could not be read, and `warning` when it is Direct with no VPN
  seen or with a failed VPN check;
- Capture Health is `danger` when a Capture failed;
- the extension is always `nominal`.

The worst signal sets `worst`, `severity` and `word`. `StatusGroup.tsx` colours only the worst
signal's dot, shows that signal's icon, and prints the word: beside a count at any width, and
alone from the `xl` width. So `warning` is already the advisory tier in the model; the control
only draws it the same way as a problem.

## Slice 6.1: advisory, problem and nominal look different

Findings U6 and A2.

- **Change.**
  - `statusGroupModel.ts`: when the worst signal is `warning`, `word` is null. The `summary`,
    the signals' `text` and `severity` are unchanged, so the accessible name and the popover
    still say "VPN not seen" or "VPN check failed".
  - `StatusGroup.tsx`: no icon for a `warning`; the Egress dot keeps the warning colour. For a
    `danger`, the icon and the word show at every width, so the word no longer hides below
    `xl`.
  - The rule that only the worst signal's dot takes colour stays: an advisory behind a problem
    shows as a faint dot, as today.
  - The polite live region still announces a change into and out of the advisory tier.
- **Where the words still appear.** The status popover's Egress row; the launch dialog's
  `launch-no-vpn` line; and, once slice 5.4 lands, the Egress row of the Launch browser
  control's menu.
- **ADR-0032.** The same pull request amends rule 2. Proposed wording to add: "In the top bar
  the Egress and a VPN not seen show as one dot of the status control, coloured while no VPN
  is seen, with the words in the control's accessible name and its popover. The words are
  printed where a contact starts: the launch dialog and the capture menu." The amendment
  records why: the check misses a VPN on a router or a corporate network, so for those
  Operators a printed warning on every screen is permanent and wrong.
- **Files.** `src/renderer/components/status/statusGroupModel.ts`,
  `src/renderer/components/status/StatusGroup.tsx`,
  `docs/adr/0032-route-app-egress-but-do-not-disguise-the-browser.md`.
- **Tests.**
  - `tests/components/statusGroupModel.test.ts`: `word` is null for a VPN not seen and for a
    failed VPN check; it is unchanged for an unknown Egress and for failures.
  - `tests/components/StatusGroup.test.tsx`: "warns, with a word of its own, when the check
    fails" and "colours the Egress dot when the VPN warning is the only signal off nominal"
    change to expect the dot and no word or icon; "keeps the Egress text where the VPN warning
    e2e reads it" must still pass, since `e2e/vpn-warning.spec.ts` reads `egress-indicator`.
  - A new case: a `danger` word is visible at a width below `xl`.
  - "announces a change of severity in the polite live region" and "does not announce a new
    count at the same severity" must still pass.
- **Screenshots.** The top bar in four states, at 1440 and 1100: nominal, VPN not seen, Egress
  unknown, and failures with a VPN not seen behind them, each with its popover open. Before and
  after.
- **Docs.** `tester-guide.mdx` and `features.mdx`, if either tells the reader to look for the
  words "VPN not seen" in the top bar.
- **Evidence tier.** `src/renderer/components/status/**` is renderer chrome. ADR-0032 rule 4
  already says the VPN result is not evidence.
- **Acceptance.**
  - [ ] With a Direct Egress and no VPN seen, the top bar prints no word and shows one coloured
    dot.
  - [ ] The control's accessible name and its popover still state that a VPN was not seen.
  - [ ] An unknown Egress and a failed Capture each show an icon and a word at 1,100 pixels.
  - [ ] The amended ADR is in the same pull request.

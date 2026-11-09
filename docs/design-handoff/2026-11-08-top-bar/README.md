# The Case top bar: 2026-11-08

Design mock for the app chrome's top bar and Case action bar, built in the same change as the code
(`src/renderer/components/layout/TopBar.tsx`, `CaseActionBar.tsx`, `status/StatusGroup.tsx`,
`status/RecordingMark.tsx`).

- `Top Bar.dc.html`: the canvas. Section 0 is the bar as it was (seven controls and the OS buttons
  in one row, three tinted status pills, the Case name cut before the search); M is the two marks
  before and after; A, B and C are the options; R the rules. It loads `support.js` and `_ds/`
  from the 2026-11-01 bundle beside this folder, so keep that folder in place for it to render.

## What was built: Option B

- **Top bar**: where you are and how the app is doing. Logo, breadcrumb (Member Code chip, Case
  name with at least 160px), search, the status group, Settings at 28px, the OS buttons. The
  theme toggle leaves the chrome; Settings → Appearance holds it.
- **Case action bar**: what you can do to this Case. The section name on the left; Share, Export
  (a plain button whose menu holds the formats), Launch browser, and while a session runs the
  recording mark and the Capture Session switch.
- **Status group**: the Egress, the extension connection and Capture Health as three faint dots in
  an unfilled pill. Off nominal, the most severe indicator's icon joins its dot and both take
  that indicator's colour, with one short word. Ranking: Egress unknown, capture failures, VPN not seen. A
  disconnected extension never colours anything. The count stays visible while a session runs;
  a failure count always shows. The button's accessible name is the whole state in one sentence;
  a polite live region announces severity changes only. App-wide, not per Case.
- **Recording mark**: a 6px danger dot, a mono elapsed timer (a launched browser's session start)
  or the word Recording, and the source. No pill, fill, pulse or "REC". On the dashboard and in
  Settings, which have no action bar, it is the Capture Session popover's trigger while that popover
  has a launched browser or a notice to show; otherwise the mark shows alone, with no popover.

Two independent reviews of the options (a product read and an accessibility and consistency
read) both chose B on the condition that the action bar's left side names the section; their
corrections are folded into the canvas's A, B and R sections. The reviews ran in the design
session and are not in this repository.

Invented names only: the Case **New Shared Case**, Member Code JD.

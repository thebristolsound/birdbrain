# The Case top bar: 2026-11-08

Design mock for the app chrome's top bar and Case action bar, built in the same change as the code
(`src/renderer/components/layout/TopBar.tsx`, `CaseActionBar.tsx`, `status/StatusGroup.tsx`,
`status/RecordingMark.tsx`).

- `Top Bar.dc.html`: the canvas. Section 0 is the bar as it was (seven controls and the OS buttons
  in one row, three tinted status pills, the Case name cut before the search); M is the two marks
  before and after; A, B and C are the options; R the rules. It loads `support.js` and `_ds/`
  from the 2026-11-01 bundle beside this folder, so keep that folder in place for it to render.

## What was built: Option B

- **Top bar**: where you are and how the app is doing. Logo, breadcrumb (Member Code chip and Case
  name, in a track of at least 160px that the chip and the switcher's chevron share, so the name
  itself can shorten to 64px), search, the status group, Settings at 28px, the OS buttons. Below
  1,000px the name hides. The theme toggle leaves the chrome; Settings → Appearance holds it.
- **Case action bar**: what you can do to this Case. The section name on the left; Share, Export
  (a plain button whose menu holds the formats), Launch browser, the recording mark while a
  session runs, and the Capture Session switch, in that order. The switch shows while the
  extension is connected, a launched browser is open, or one has exited with its Capture Session
  still running.
- **Status group**: the Egress, the extension connection and Capture Health as three faint dots in
  an unfilled pill. Off nominal, the most severe indicator's icon joins its dot and both take
  that indicator's colour, with one short word: "Egress unknown", the failure count, "VPN not
  seen" or "VPN check failed". Ranking: Egress unknown, capture failures, then a VPN not seen or
  a failed VPN check. A disconnected extension never colours anything. While a session runs and
  has stored a Capture, the count of stored Captures shows with the word beside it; with no
  count, the word shows from the `xl` width. The popover's Capture Health row always names the
  failures. The button's accessible name carries the whole state: a lead, then the Egress, the
  extension and Capture Health, and the queued background captures when there are some. While
  the settings or a Direct Egress's VPN check are still being read, the lead says so and does not
  say "all nominal". A polite live region announces severity changes only. App-wide, not per
  Case.
- **Recording mark**: a 6px danger dot, a mono elapsed timer (a launched browser's session start)
  or the word Recording, and the source. No pill, fill, pulse or "REC". On the dashboard and in
  Settings, which have no action bar, it is the Capture Session popover's trigger while that popover
  has a launched browser or a notice to show; otherwise the mark shows alone, with no popover.

Two independent reviews of the options (a product read and an accessibility and consistency
read) both chose B on the condition that the action bar's left side names the section; their
corrections are folded into the canvas's A, B and R sections. The reviews ran in the design
session and are not in this repository.

Invented names only: the Case **New Shared Case**, Member Code JD.

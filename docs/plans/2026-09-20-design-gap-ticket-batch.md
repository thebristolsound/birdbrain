# Design gap ticket batch, 2026-09-20

A draft of the issues that would close every design gap the 2026-09-19 sweep found. Nothing on this page is filed yet. It exists so the grouping can be reviewed once, and then filed in one pass, with a tracking issue that keeps every row accounted for.

Sources: [mock reconciliation](2026-09-19-mock-reconciliation.md) and [UI and UX pass](2026-09-19-ui-ux-pass.md), both at main `5902b28f`.

## Accounting

Every mock-ahead or drifted row, and every high or medium UI finding, lands in exactly one place below. A script checked that no row is missing or doubled.

| Destination | Gap rows | UI findings |
| --- | ---: | ---: |
| 22 new tickets and the #1526 extension | 122 | 93 |
| Direction list: contradicts a recorded ruling or touches evidence wording | 27 | 0 |
| Already covered by an open issue | 62 | 6 |
| App-ahead rows, the app has something the mock lacks | 78 | 0 |

Not carried: 80 absorbed and 31 not-a-gap rows, which need no work, and 75 low UI findings, which stay in the UI pass page.

## Decisions taken

- **Direction defaults to mock.** The reconciliation page leaves the direction column to the maintainer. The maintainer's 2026-09-20 instruction was that no design gap should drift, so every gap row outside the direction list is ticketed as mock: the app moves to the design.
- **Grouped by system first, then by screen.** A fix that one shared primitive can make once, such as contrast, focus, labels or motion, is one ticket across all screens. Everything screen-specific is one ticket per screen.
- **The wizard extends #1526** instead of opening a second wizard ticket.
- **Labels.** Each new ticket gets `redesign`, `ready-for-agent`, and `enhancement` or `bug`. None gets `queued`; queuing stays the maintainer's pick. The maintainer's account files them, so the stale-issue workflow, which only closes issues the machine account filed, never closes them.
- **A tracking issue** lists the 22 new tickets and #1526 as a checklist, plus the direction list, so the batch has one place to watch.

## Tickets

### `feat(theme): open dark by default and cross-fade theme switches like the mock`

Type: enhancement. 5 gap rows, 1 UI finding. Related open issues: #1336, #1335, #671.

- drifted, App shell: [Theme: theme-switch transition](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L41)
- drifted, App shell: [Theme: default theme on a fresh install](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L42)
- drifted, Settings: [Theme switch transition suppression](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L375)
- drifted, Settings: [Nav tab active and inactive colour under the dark theme](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L351)
- drifted, Data explorer: [Status colours under the light theme](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L331)
- UI medium, Settings: [No colour scheme is declared, so native controls paint light in dark mode](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L229)

### `fix(theme): light-theme text and controls fail contrast across every screen`

Type: bug. 0 gap rows, 11 UI findings. Related open issues: #1524. The export light-theme notice is already #1524 and stays there.

- UI medium, App shell: [Light-theme Connected and REC pills fail contrast badly](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L53)
- UI high, Dashboard: [The case-card delete Confirm button is unreadable in light theme](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L76)
- UI medium, Dashboard: [Six to eight serious contrast failures per theme](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L87)
- UI medium, Case Overview: [Eighteen serious contrast failures inside the Overview in light theme](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L107)
- UI medium, Captures list: [The Wayback not-evidence warning band is invisible in light theme](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L126)
- UI medium, Captures list: [Light theme fails contrast across the capture rows and viewer chrome](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L134)
- UI high, Signals: [In light theme the Live Preview renders every matched value as a blank block](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L152)
- UI medium, Signals: [Serious contrast on 24 to 29 nodes per theme, several of them the screen's own faint text](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L161)
- UI medium, Notes: [Light theme fails contrast on the note meta line, the source URL and the New note button](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L186)
- UI medium, Data explorer: [Rail group headings and the pane subtitle fail contrast in both themes](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L207)
- UI medium, Chrome extension install surfaces: [The walkthrough's disclosure link and step copy fail contrast](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L260)

### `fix(a11y): dialogs, menus and the palette drop or hide keyboard focus`

Type: bug. 0 gap rows, 12 UI findings. Related open issues: #1290, #1291, #1294. Build on the Dialog focus-trap fixes in #1290, #1291 and #1294 rather than a second primitive.

- UI medium, App shell: [The palette declares `aria-modal` but never contains focus](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L55)
- UI medium, App shell: [Escape from a keyboard-opened palette drops focus to `body`](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L56)
- UI medium, Dashboard: [The command palette opened from the Dashboard drops focus to `body` on Escape](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L82)
- UI medium, Case Overview: [Closing the command palette drops focus to `body` instead of the opener](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L109)
- UI medium, Captures list: [Escape from the delete dialog leaves focus on a detached button](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L130)
- UI medium, Signals: [Focus drops to `body` every time a dialog or the inline editor closes](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L157)
- UI medium, Notes: [Focus falls to `body` when the selection confirm popover closes](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L184)
- UI medium, Chrome extension install surfaces: [The tour overlay traps nothing, announces nothing, ignores Escape and drops focus on close](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L257)
- UI medium, New Case wizard: [The import dialog is not a dialog for the keyboard](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L278)
- UI medium, Export dialog: [The export dialog has no focus management at all](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L305)
- UI medium, Captures list: [Keyboard focus is invisible on the list search field and on every themed button](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L129)
- UI medium, Notes: [Most Notes controls show the browser's default amber focus ring](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L185)

### `fix(a11y): controls across the app have no accessible name, label or state`

Type: bug. 2 gap rows, 16 UI findings. Related open issues: #938, #1328.

- mock-ahead, New Case wizard: [Step pip accessible names](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L442)
- drifted, Export dialog: [Dialog: modality semantics](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L495)
- UI medium, App shell: [Rail labels appear on hover only and are announced twice](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L58)
- UI medium, Dashboard: [The case-card kebab has no accessible name and is fully transparent while focused](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L79)
- UI medium, Dashboard: [The case-card kebab menu ignores Escape and declares no menu semantics](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L83)
- UI medium, Case Overview: [The per-capture verification shield has no text alternative](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L105)
- UI high, Signals: [Every control nested inside a signal row is keyboard-dead](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L153)
- UI medium, Signals: [Serious `nested-interactive` on every signal row, in both themes and densities](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L159)
- UI medium, Signals: [The merge and delete dialogs have a visible title and no accessible name](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L160)
- UI medium, Notes: [The composer's close button has no accessible name](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L183)
- UI medium, Data explorer: [Artifact table rows declare a row role with no table parent and no cell children](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L206)
- UI medium, Data explorer: [The rail declares a tree role with no arrow-key navigation, and every row is its own tab stop](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L208)
- UI medium, Settings: [The label primitive never sets `htmlFor`, so twelve fields have no programmatic label](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L232)
- UI medium, Settings: [The table picker, both export selects and both pagination buttons have no accessible name](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L233)
- UI medium, Settings: [The required-operator-name error is not exposed to assistive technology](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L237)
- UI medium, New Case wizard: [Neither wizard field is programmatically labelled](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L283)
- UI medium, New Case wizard: [Selector preset chips expose no selected state](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L284)
- UI medium, Export dialog: [The dropdown declares menu roles and implements no menu keyboard behaviour](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L308)

### `fix(copy): raw error strings and copy that promises things the app cannot do`

Type: bug. 0 gap rows, 13 UI findings. Related open issues: #1178.

- UI medium, Dashboard: [A failed case-archive import prints the raw Electron IPC error](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L78)
- UI medium, New Case wizard: [A bad archive file surfaces the raw Electron IPC error](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L280)
- UI medium, Export dialog: [Both export failure paths print the raw Electron IPC string](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L304)
- UI medium, Dashboard: [The footer prints a version the build does not have](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L80)
- UI medium, Dashboard: [All three footer links are inert buttons](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L81)
- UI medium, Dashboard: [Quick Start describes a capability that does not exist, in a marketing register](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L88)
- UI medium, Case Overview: [Two card actions promise surfaces the app does not have](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L110)
- UI medium, Captures list: [The pro tip names an extension control that does not exist](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L128)
- UI medium, Settings: [Report a problem tells a public user to attach the bundle to the tester chat](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L239)
- UI medium, Data explorer: [The Staging node subtitle cites an internal architecture decision number](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L210)
- UI medium, Settings: [The action button in the Purge confirm dialog says Delete](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L234)
- UI medium, Settings: [Recent slow operations lists operations that took no measurable time](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L238)
- UI medium, Settings: [The row editor gives no reason a save failed](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L231)

### `fix(layout): screens break or hide their primary actions at the minimum window size`

Type: bug. 3 gap rows, 8 UI findings. Related open issues: #920.

- drifted, App shell: [TopBar: case search field placement](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L35)
- drifted, New Case wizard: [Wizard scroll container](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L425)
- drifted, Export dialog: [Dialog: sticky header and footer versus whole-dialog scroll](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L466)
- UI medium, App shell: [The centred search field overlaps the right-hand controls at the default window size](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L52)
- UI medium, App shell: [At the enforced 900x600 minimum the top bar controls overprint each other](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L54)
- UI medium, New Case wizard: [At the minimum window size the wizard card is cut off and Create Case cannot be reached with the mouse](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L276)
- UI medium, Export dialog: [After a failed export the error text and the retry action are below the fold](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L302)
- UI medium, Export dialog: [Cancel and Export are already below the fold in the default state](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L309)
- UI medium, New Case wizard: [The failed-verification panel has no height cap and clips at both ends](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L279)
- UI medium, Export dialog: [The archive-saved banner is clipped by its anchor, so the label truncates and the action wraps over it](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L303)
- UI medium, Captures list: [The compare-pane disclosure truncates mid-sentence at the default width](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L133)

### `feat(density): honour the density steps on Notes, Settings, the extension screen and the Overview strip`

Type: enhancement. 2 gap rows, 3 UI findings. Related open issues: #535.

- drifted, Case Overview: [Recent captures strip, gap ignores density](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L120)
- drifted, Notes: [Density response of the Notes list](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L249)
- UI medium, Notes: [The Notes list is pixel-identical at compact and comfortable](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L188)
- UI medium, Settings: [Density changes nothing inside Settings, but the Appearance helper says it does](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L235)
- UI medium, Chrome extension install surfaces: [Compact and comfortable render this screen identically](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L258)

### `feat(motion): add the mock's press feedback, entrance staggers and count-ups`

Type: enhancement. 5 gap rows, 0 UI findings. Every animation honours reduced motion, as the mock does.

- mock-ahead, App shell: [Sidebar: rail button press feedback](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L52)
- drifted, Dashboard: [Recent Cases stagger animation](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L92)
- mock-ahead, Case Overview: [Metric tile count-up](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L129)
- mock-ahead, Case Overview: [Entry motion: metric stagger and link-map reveal](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L130)
- mock-ahead, Signals: [Signal row entrance animation](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L205)

### `feat(menus): add the missing context menus and the customise-menu footer`

Type: enhancement. 5 gap rows, 0 UI findings. Related open issues: #938. Menus whose omission is a recorded ruling are on the direction list, not here.

- mock-ahead, App shell: [TopBar: right-click menu on pipeline event rows](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L49)
- mock-ahead, App shell: [Overlays: context-menu 'Customise this menu' footer](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L69)
- mock-ahead, Captures list: [Wayback snapshot row, context menu](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L167)
- mock-ahead, Signals: [Tag row context menu](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L208)
- mock-ahead, Export dialog: [Dialog: pinned Wayback row context menu](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L484)

### `feat(feedback): the mock's toast, completion and banner patterns`

Type: enhancement. 4 gap rows, 2 UI findings.

- drifted, App shell: [Overlays: toast](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L68)
- drifted, New Case wizard: [Post-create destination and confirmation toast](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L427)
- drifted, Export dialog: [Completion: in-dialog panel versus toast](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L491)
- drifted, Export dialog: [Menu: archive-saved banner and error banner](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L494)
- UI medium, Export dialog: [Closing the progress dialog mid-run leaves the export going with no completion signal](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L306)
- UI medium, Export dialog: [The archive success and error banners never dismiss and have no close control](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L307)

### `feat(tokens): type scale, radii, shadows and button metrics drift from the mock`

Type: enhancement. 10 gap rows, 0 UI findings.

- drifted, Dashboard: [Coloured glow shadows on hero CTA, banner tiles, banner button and Quick Start badge](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L85)
- drifted, Dashboard: [Hero call-to-action button sizing](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L86)
- drifted, Dashboard: [Hero subheading text size](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L87)
- drifted, Dashboard: [Extension banner control shapes](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L90)
- drifted, Dashboard: [Recent Cases count badge typeface](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L101)
- drifted, Case Overview: [Case name type size](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L116)
- drifted, Case Overview: [NEW badge type size](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L123)
- drifted, Case Overview: [Bar and thumbnail corner radii](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L138)
- drifted, Case Overview: [Type scale and font-family substitutions](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L139)
- drifted, Settings: [Appearance: theme swatch buttons](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L359)

### `feat(shell): top-bar search, tooltips, tour step text and the wizard route`

Type: enhancement. 5 gap rows, 3 UI findings.

- drifted, App shell: [TopBar: search placeholder copy](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L36)
- mock-ahead, App shell: [TopBar: search empty-result state](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L37)
- drifted, App shell: [TopBar: theme-toggle tooltip copy](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L40)
- drifted, App shell: [Onboarding tour: install walkthrough step text](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L61)
- drifted, Chrome extension: [Tour: install-walkthrough step title prefix](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L387)
- UI medium, App shell: [The New Case route renders an empty case breadcrumb and a live search field](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L57)
- UI medium, App shell: [The Settings screen hides the REC indicator and the stop control mid-session](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L59)
- UI medium, New Case wizard: [The wizard route is mistaken for a case, so the top bar shows a dead search field](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L285)

### `feat(dashboard): Quick Start cards, case cards and footer match the mock`

Type: enhancement. 8 gap rows, 4 UI findings.

- mock-ahead, Dashboard: [Quick Start step cards, illustrated preview panels](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L78)
- drifted, Dashboard: [Quick Start copy (4 titles, 4 descriptions)](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L79)
- drifted, Dashboard: [Case card hover treatment](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L84)
- drifted, Dashboard: [Recent Cases count badge versus the cards shown](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L88)
- drifted, Dashboard: [Quick Start step badge, connector and completion dot](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L89)
- drifted, Dashboard: [Footer GitHub link icon](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L91)
- drifted, Dashboard: [Case card kebab button](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L100)
- drifted, Dashboard: [Case type icon, tile and colour mapping](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L105)
- UI medium, Dashboard: [Case cards and the New Investigation tile cannot be reached or activated by keyboard](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L77)
- UI medium, Dashboard: [A long case name is never clamped, so the Recent Cases row goes ragged](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L84)
- UI medium, Dashboard: [The New Investigation tile is 43px taller than the cards beside it](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L85)
- UI medium, Dashboard: [The extension banner's two buttons render 38px and 28px tall](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L86)

### `feat(overview): heading, sources, capture strip and tag cards match the mock`

Type: enhancement. 7 gap rows, 4 UI findings.

- drifted, Case Overview: [Case name colour](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L115)
- drifted, Case Overview: [Case-type pill colour](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L117)
- drifted, Case Overview: [Top sources, bar and dot colours](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L119)
- drifted, Case Overview: [Recent capture card, title block height](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L121)
- mock-ahead, Case Overview: [Recent capture thumbnail placeholder](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L122)
- drifted, Case Overview: [Recent capture shield colour ladder](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L124)
- drifted, Case Overview: [Tag chip interactivity](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L126)
- UI medium, Case Overview: [One tab round trip destroys the since-your-last-visit summary and every NEW badge](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L103)
- UI medium, Case Overview: [Capture activity paints a full-strength bar for today on a case with zero captures](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L104)
- UI medium, Case Overview: [The review count double-counts: two new captures are reported as four things to review](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L106)
- UI medium, Case Overview: [Recent-captures cards lose their shared baseline when one title wraps](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L108)

### `feat(captures): list, viewer tabs, pins and Wayback compare match the mock`

Type: enhancement. 10 gap rows, 1 UI finding.

- drifted, Captures list: [Selection bar, third icon action](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L153)
- drifted, Captures list: [Viewer pager, index and total](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L154)
- drifted, Captures list: [Empty capture list, visual treatment](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L156)
- drifted, Captures list: [Narrowed empty state, body copy and button](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L157)
- drifted, Captures list: [Text tab, extracted-text rendering](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L158)
- mock-ahead, Captures list: [Screenshot tab, pin legend panel](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L163)
- drifted, Captures list: [Screenshot tab, pin comment popover](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L164)
- mock-ahead, Captures list: [Wayback compare, per-pane facts table](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L165)
- drifted, Captures list: [Wayback calendar, range hint copy](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L166)
- drifted, Captures list: [Capture row thumbnail, fallback gradient colour](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L168)
- UI medium, Captures list: [The paste-URLs box is one row tall and names one rejection reason for every entry](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L132)

### `feat(signals): detail rail and tag list match the mock, and signal edits stop destroying data`

Type: enhancement. 3 gap rows, 4 UI findings.

- drifted, Signals: [Tag list scroll height](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L210)
- drifted, Signals: [Detail rail footer buttons](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L214)
- drifted, Signals: [Detail rail, Rescan all captures control](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L215)
- UI medium, Signals: [The inline add row creates a duplicate selector that bulk import in the same card refuses](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L154)
- UI medium, Signals: [A selector and its persisted matches are destroyed with no confirmation from three routes](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L155)
- UI medium, Signals: [A duplicate tag name fails with a generic bug-report toast](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L156)
- UI medium, Signals: [One key, two names, and the action rewrites what the selector matches](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L158)

### `feat(notes): rebuild Notes as the mock's two-pane workspace`

Type: enhancement. 11 gap rows, 0 UI findings. Code block stays out of the toolbar; it is schema-disabled by ruling.

- drifted, Notes: [Screen shell: list and detail split versus a single-column card list](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L234)
- drifted, Notes: [Note editor format toolbar](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L236)
- mock-ahead, Notes: [Sort and Filter menus on the list toolbar](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L238)
- mock-ahead, Notes: [Detailed and List view toggle](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L239)
- drifted, Notes: [Empty state](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L240)
- mock-ahead, Notes: [List count footer](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L241)
- mock-ahead, Notes: [Screen footer strip (grammar legend and save state)](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L242)
- drifted, Notes: [Note title, inline editable heading](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L244)
- drifted, Notes: [Linked-capture chip in the note header](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L246)
- drifted, Notes: [List row meta line and snippet](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L247)
- drifted, Notes: [Sidebar header: search field and New note control](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L250)

### `feat(notes): mention inline-create, hover peek and honest dead mentions`

Type: enhancement. 2 gap rows, 3 UI findings.

- mock-ahead, Notes: [Mention grammar: mention popup inline-create row](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L251)
- mock-ahead, Notes: [Mention grammar: hover peek card on a mention](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L255)
- UI medium, Notes: [A mention whose target was deleted reads as a live reference in the saved note](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L181)
- UI medium, Notes: [The tag mention popup offers tags that exist only in other cases](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L182)
- UI medium, Notes: [The tag confirm popover labels a tag name with the selector kind](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L187)

### `feat(data): Data explorer table, detail strip and ledger match the mock`

Type: enhancement. 13 gap rows, 2 UI findings.

- drifted, Data explorer: [Counts on group heads](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L281)
- drifted, Data explorer: [Source column value](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L289)
- mock-ahead, Data explorer: [Row multi-select (modifier-click)](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L294)
- drifted, Data explorer: [Selected-row left accent bar](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L295)
- drifted, Data explorer: [Table column track widths](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L296)
- drifted, Data explorer: [Truncated hash form](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L297)
- drifted, Data explorer: [Detail strip visibility with no selection](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L302)
- drifted, Data explorer: [Table and detail-strip split ratio](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L303)
- drifted, Data explorer: [Detail-strip header subtitle](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L304)
- drifted, Data explorer: [TLS certificate card fields](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L311)
- drifted, Data explorer: [Ledger column headers](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L316)
- drifted, Data explorer: [Sequence formatting in the chain verdict](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L318)
- drifted, Data explorer: [Ledger highlight of the selected file's entries](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L320)
- UI high, Data explorer: [A capture that lands while the Data screen is open never appears](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L205)
- UI medium, Data explorer: [Selecting a row opens the detail strip on the second tab, never the leading one](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L209)

### `feat(settings): database integrity check, Diagnostics header and Operator layout`

Type: enhancement. 3 gap rows, 2 UI findings.

- mock-ahead, Settings: [Database: integrity check button](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L346)
- drifted, Settings: [Diagnostics: header actions](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L355)
- drifted, Settings: [Operator: column width](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L357)
- UI medium, Settings: [The Diagnostics tab strip renders as a vertical stack](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L230)
- UI medium, Settings: [Operator is the only tab with no card and no heading](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L236)

### `feat(extension): popup and in-page capture card match the mock`

Type: enhancement. 7 gap rows, 2 UI findings.

- drifted, Chrome extension: [Popup: header logo](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L393)
- drifted, Chrome extension: [Popup: case-menu row dot colour](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L395)
- mock-ahead, Chrome extension: [Popup: idle page status for an arbitrary page](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L398)
- drifted, Chrome extension: [Popup: right-click capture hint](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L402)
- drifted, Chrome extension: [Popup: footer action row](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L403)
- mock-ahead, Chrome extension: [In-page capture toast: post-capture confirmation card](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L412)
- drifted, Chrome extension: [In-page selection bar: button icons](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L413)
- UI medium, Chrome extension install surfaces: [The install banner's primary action silently does nothing when the extension folder cannot be opened](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L256)
- UI medium, Chrome extension install surfaces: [The install button opens a file manager and nothing says so](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L259)

### Extend #1526: New Case wizard visual drift and validation

Type: extend. 9 gap rows, 2 UI findings. Appended to the existing wizard ticket instead of a new one.

- drifted, New Case wizard: [Step progress indicator](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L426)
- drifted, New Case wizard: [Name field treatment and placeholder](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L429)
- drifted, New Case wizard: [Description placeholder copy](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L430)
- drifted, New Case wizard: [Selector section heading copy](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L431)
- drifted, New Case wizard: [Primary action label](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L432)
- drifted, New Case wizard: [Page chrome: card, icon tile, subtitle, column width](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L434)
- drifted, New Case wizard: [Back and Cancel button](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L435)
- drifted, New Case wizard: [Selector chips pre-selected on open](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L436)
- drifted, New Case wizard: [Preset chip metrics](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L443)
- UI medium, New Case wizard: [A case name that already exists is accepted silently](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L281)
- UI medium, New Case wizard: [An empty name produces no message, and the disabled button leaves the tab order](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-ui-ux-pass.md#L282)

### `feat(export): export menu wiring and dialog chrome match the mock`

Type: enhancement. 8 gap rows, 0 UI findings. Related open issues: #1335.

- drifted, Export dialog: [Menu: which item opens the dialog](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L462)
- mock-ahead, Export dialog: [Dialog: subtitle or purpose line](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L464)
- mock-ahead, Export dialog: [Dialog: header close button](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L465)
- drifted, Export dialog: [Dialog: scope row chrome](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L467)
- mock-ahead, Export dialog: [Dialog: selected-item count on the disclosure row](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L474)
- drifted, Export dialog: [Dialog: purpose or authority field placement](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L480)
- drifted, Export dialog: [Dialog: primary action button label and icon](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L485)
- drifted, Export dialog: [Dialog: width](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L496)

## Direction list

These rows are not ticketed, because moving the app to the mock would overturn a recorded ruling or change what an evidence surface claims. Write mock, app or drop in the Decision column. A mock decision turns the row into a ticket; app or drop closes it.

| Row | Screen | Why it needs a decision | Decision |
| --- | --- | --- | --- |
| [TopBar: Browser button (Browser, puzzle icon, `data-tour` browser)](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L31) | App shell | adjudicated as a deliberate decline | |
| [Case card delete confirmation](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L83) | Dashboard | needs a Trash with undo, which the app does not have | |
| [Tags card, zero-count chips](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L125) | Case Overview | deliberate per the block's docstring | |
| [Page tab, archived-copy banner contents](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L161) | Captures list | adjudicated; banner claims were dropped on purpose | |
| [Page tab, blocked-resource notice](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L162) | Captures list | blocked-resource denials are deliberately not logged | |
| [Delete from the selection bar, outcome](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L169) | Captures list | needs a Trash with undo | |
| [Auto-capture switch scope and locked third state](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L192) | Signals | per-case switch versus the app-wide three-state capture mode | |
| [Selector row context menu](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L207) | Signals | omissions documented in the app | |
| [Tag delete: confirm dialog versus trash and undo](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L209) | Signals | needs a Trash with undo | |
| [Mention grammar: suggestion ranking and trigger position](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L254) | Notes | two documented divergences | |
| [Mention grammar: in-app capture-viewer selection bar](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L260) | Notes | deliberately two actions, note editor only | |
| [Captured column value](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L290) | Data explorer | which clock the Captured column shows is an evidence reading | |
| [TLS section heading and provenance claim](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L310) | Data explorer | app states the opposite provenance claim, load-bearing | |
| [Ledger signer line](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L317) | Data explorer | multi-segment signer line is deliberate | |
| [Ledger row interactions (show target, copy hash)](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L322) | Data explorer | no-menu choice is deliberate | |
| [Ledger context menu](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L323) | Data explorer | no-menu choice is deliberate | |
| [File-row context menu items](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L324) | Data explorer | omissions documented, reveal awaits a ruling | |
| [Tree-node (folder) context menu items](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L325) | Data explorer | deliberate under the accelerator-not-sole-route rule | |
| [Capture: dedupe window slider](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L345) | Settings | the setting's only consumer is commented out | |
| [Operator: organization placeholder copy](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L358) | Settings | mock placeholder names a police department | |
| [Popup: page status sub-line, verified versus recorded](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L397) | Chrome extension | verified versus recorded; the app is the correct side | |
| [Popup: match-summary line for an un-capturable page](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L400) | Chrome extension | app broadened the wording for operator rules | |
| [Popup: no-case privacy note](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L404) | Chrome extension | opposite factual privacy claim | |
| [Dialog: chain-of-custody preview card](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L460) | Export dialog | custody preview card covered by a ruling | |
| [Dialog: manifest-scope note under the scope row](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L469) | Export dialog | half ruled, half open | |
| [Dialog: checklist item set and labels](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L475) | Export dialog | four items ruled out of the package | |
| [Dialog: per-item metadata column](https://github.com/thebristolsound/birdbrain/blob/5902b28f0b71/docs/plans/2026-09-19-mock-reconciliation.md#L476) | Export dialog | two rows ruled out, four open | |

## Already covered by an open issue

These rows attach to the issue the sweep linked. They get no new ticket; the tracking issue lists the issue numbers.

- #382 `Spec: 2026-08 design handoff implementation program (mentions, multiselect, exports, tours`: 9 rows
- #481 `Unsaved edit to an existing note silently lost on navigation (edit variant of #464)`: 1 row
- #675 `feat(dashboard): selector-hit events in the recent-activity feed (needs selector_matches.m`: 2 rows
- #803 `feat(data): rebuild the Data screen as an artifact browser over the case's real evidence f`: 20 rows
- #824 `feat(selectors): typed confirm popover for Selector creation (Watch + Backfill toggles) in`: 3 rows
- #830 `feat(export): per-entity export for captures, notes, selectors and tags`: 5 rows
- #846 `Export dialog hardcodes zip, so the 'html' and 'pdf' case-export formats are unreachable`: 1 row
- #859 `feat(notes): note tags have no read surface in the renderer`: 1 row
- #870 `fix(export): an unparseable imported snapshot_timestamp crashes the export dialog`: 1 row
- #887 `fix(export): the dialog promises pinned Wayback references in a report that excludes them `: 1 row
- #922 `feat(notes): Notes context rail (Suggested / Links out / Linked mentions)`: 1 row
- #1276 `fix(captures): the getting-started panel still promises browsing saves pages`: 2 rows
- #1281 `fix(settings): the three new exhibit tables are missing from Settings -> Database`: 2 rows
- #1296 `fix(onboarding): seeding the demo case displaces the intro tour chapter on first launch`: 1 row
- #1306 `fix(status): a disconnected extension renders no indicator at all, behind an undated HOTFI`: 1 row
- #1317 `fix(captures): stored thumbnail is 4:3 but every consumer renders it into a wider box`: 1 row
- #1329 `Two tag colour palettes diverge, so a capture-set colour shows as no selection in Signals`: 1 row
- #1335 `fix(export): export and import dialog checkboxes and radios are unthemed in dark mode`: 1 row
- #1391 `signals: the Create button overflows its grid track and is clipped by the scroll container`: 1 row
- #1392 `signals: the Selectors section shows two create forms, and the second is not marked as the`: 1 row
- #1406 `Sweep the CaptureServerBindError prose and surface the errno in the Log tab`: 1 row
- #1526 `feat(cases): the New Case wizard lacks the mock's Signals and Review steps and the per-cas`: 5 rows
- UI findings already filed: #1520, #1521, #1522, #1523, #1524, #1525

## App-ahead rows

78 rows record something the app has and the mock does not, such as the update dot on Settings or notes in search results. They are not gaps in the design, so they get no ticket; many are deliberate. Moving them to the mock would remove shipped features, so the tracking issue carries them as one open question: which, if any, should go.


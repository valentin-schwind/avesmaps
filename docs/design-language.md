# Avesmaps design language

One warm, *aventurian* visual language shared by **every** surface — the route
planner (left, `#search`), the infobox panel (right, `.avesmaps-infopanel`),
dialogs, popups, the editor. Warm browns, parchment, coat-of-arms gold. **No
blue** — it reads as a foreign UI kit and is what made the panels diverge.

## The one rule

**Never hardcode a colour, size, radius, spacing, or divider. Always use a token
from `css/base/tokens.css`.** If the value you need has no token yet, add the token
first, then use it. A colour written as a literal in two places is divergence
waiting to happen — it is how the infobox and route planner drifted apart.

## Tokens — the single source of truth (`css/base/tokens.css`)

| Group | Tokens |
|---|---|
| Surfaces | `--color-page-bg`, `--color-page-bg-deep` (editor backdrop), `--color-panel` (white card), `--color-panel-soft` (grouped bg), `--color-panel-muted` |
| Text | `--color-text`, `--color-text-strong`, `--color-text-muted`, `--color-placeholder` |
| Lines | `--color-border` (hairline), `--color-border-strong`, `--color-divider` (section separator — the *same* everywhere) |
| Button · primary (filled) | `--color-button`, `--color-button-text`, `--color-button-border`, `--color-button-hover`, `--color-button-active` |
| Button · secondary (soft/outline) | `--color-button-soft`, `--color-button-soft-text`, `--color-button-soft-border`, `--color-button-soft-hover`, `--color-button-soft-active` |
| Accent · links | `--color-accent` (coat gold), `--color-accent-strong`, `--color-link` (gold-brown — links are **never** blue), `--color-link-hover` |
| Pills / tags | `--color-pill`, `--color-pill-border`, `--color-pill-text` |
| Interaction · focus/states | `--color-focus` (+ `--focus-ring` recipe), `--color-hover-wash`, `--color-active-wash`, `--color-disabled-bg` / `-text` / `-border` |
| Typography | `--font-size-caption` … `--font-size-display` (7 rungs), `--leading-tight` / `-snug` / `-normal`, `--font-weight-regular` / `-bold`, `--font-ui` |
| Spacing | `--space-2` … `--space-24` (9 steps: 2/4/6/8/10/12/16/20/24) |
| Radius | `--radius-sm` 5px (panel shell), `--radius-md` 8px (all controls), `--radius-lg` 10px (menus/cards) |
| Icons | `--icon-sm` 16 / `--icon-md` 20 (UI glyphs) · `--icon-lg` 24 / `--icon-xl` 40 / `--icon-2xl` 48 / `--icon-hero` 130 (imagery) |
| Status · markers · elevation | `--color-danger`, `--color-success`, `--color-marker-destination`, `--color-marker-active` (clicked settlement → gold-yellow fill), `--shadow-panel`, `--shadow-dialog`, `--shadow-button-hover` / `--shadow-button-hover-strong` (button hover lift — strong = filled main action), `--z-map-ui` / `--z-dialog` / `--z-dialog-high` |
| Review stars | `--color-star` (filled glyph, warm coat-gold), `--color-star-muted` (empty-star track) — rating summary + write-dialog picker; both carry a dark value |

## Themes — light & dark

The palette direction is **C ("Heller / Papier")**: a light, neutral parchment
with warm taupe-brown controls and a restrained coat-gold. Light is the default
(`:root`). A full dark theme is defined under `:root[data-theme="dark"]` — the
same warm family on a deep parchment-brown canvas, cream text, and a warm gold
kept deliberately calm — ~12% desaturated from the light gold so it reads warm on
dark instead of neon.

Dark is **opt-in**, deliberately *not* `prefers-color-scheme`: the map tiles are
light, so auto-dark panels would clash over them. Every colour token carries a
dark value, so components that reference tokens (never literals) get both themes
in sync from this one file.

## Typography

`--font-ui` is Faculty Glyphic. **Two weights only** — `--font-weight-regular`
(400) and `--font-weight-bold` (700); never 500 / 600 / 800. Seven size rungs
with an 11px floor:

| Token | px | Line-height | Use |
|---|---|---|---|
| `--font-size-caption` | 11 | snug | section labels (bold + caps), pills, meta |
| `--font-size-small` | 12 | snug | dense secondary text — distances, counts, options |
| `--font-size-body` | 13 | snug | default controls — buttons, selects, tabs |
| `--font-size-reading` | 14 | normal | reading text — infobox type + description, inputs |
| `--font-size-subhead` | 16 | snug | subheaders |
| `--font-size-title` | 20 | tight | dialog / panel titles |
| `--font-size-display` | 22 | tight | infobox hero name |

Line-heights: `--leading-tight` 1.15 (titles/display), `--leading-snug` 1.25
(controls/labels), `--leading-normal` 1.45 (reading). Nothing renders below 11px —
the old 9–10.5px micro sizes come up to `--font-size-caption`.

## Spacing & radius

Spacing uses one value-named scale — **2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24**
(`--space-2` … `--space-24`, where the name is the pixel value). Always reach for
a step; a stray `7px` or `11px` is how rhythm drifts. Old odd values fold to the
nearest step. The divider gaps are scale steps: `--divider-gap` = `--space-12`,
`--divider-gap-tight` = `--space-6`.

Radius has **three** rungs: `--radius-sm` 5px (the mirrored panel shell + the
tiniest chips), `--radius-md` 8px (**all** controls — buttons, inputs, selects,
pills, list rows), `--radius-lg` 10px (menus, cards, autocomplete). The old
4/6/7/9px radii fold in — controls to `--radius-md`, floating surfaces to
`--radius-lg`. No pill / `999px` shapes anywhere.

## Component rules

- **Text colour by role — one token per role, never per element.** Pick a text
  colour from the element's *role* and use that token everywhere; don't invent a
  shade for one spot. Primary / content text → `--color-text`; secondary &
  explanatory prose, captions, meta, table / axis labels → `--color-text-muted`;
  titles, emphasised labels, inline emphasis → `--color-text-strong`; section /
  card headings → `--color-accent-strong` (gold). Two colours for the same role in
  one view is the bug — an intro paragraph darker than a later one, or a table's
  two header axes drawn differently (the speed-info dialog did both).
- **Button hierarchy.** The main action is *filled* (`--color-button` /
  `--color-button-text`); everything else is *soft/outline* (`--color-button-soft`
  + `--color-button-soft-border`). Radius `--radius-md`. No pill/`999px` shapes.
- **Button states** (both tiers): **hover** shifts to `--color-button-hover` /
  `--color-button-soft-hover` with a 1px lift + slightly stronger shadow;
  **active/pressed** drops to `--color-button-active` / `--color-button-soft-active`
  with an inset shadow and no lift; **focus-visible** adds the focus ring
  **composed with** the element's own shadow — `box-shadow: var(--focus-ring),
  <elevation>`, never `var(--focus-ring)` alone (that would drop the elevation) — a
  warm gold glow, never the blue UA ring; set `outline: none` alongside it;
  **disabled** uses
  `--color-disabled-bg` / `-text` / `-border` with no shadow and
  `cursor: not-allowed` — use sparingly, prefer keeping actions enabled.
- **Action-button tiles (infobox).** In the settlement infobox — floating map box
  *and* right panel — the action buttons are **square icon tiles**, not inline
  pills: icon **centred on top**, label **centred below** (`flex-direction: column`
  + centre both axes), fixed size (`width: 90px; min-height: 60px`), label may wrap,
  the bar wraps to a new row on overflow. Give every icon an **equal fixed slot**
  (`.location-popup__action-icon` → a centred `26×26` box) so a thin glyph (`+`) and
  a wide emoji (🔗) read as the same size. Fill hierarchy still holds (main action
  filled, rest soft); the tile row is framed by dividers (header divider above,
  section divider below). Exception: the inline "Bewertung schreiben" in the rating
  row stays a normal inline button. Impl: `.floating-location-popup` /
  `.avesmaps-infopanel .location-popup__action-button` in `location-popups-markers.css`.
- **Selection wash.** Hoverable/selectable rows (route entries, combobox options,
  marker toggles) tint with `--color-hover-wash` (hover) and `--color-active-wash`
  (selected), plus a `--color-border-strong` edge — not a filled-button look. This
  replaces the old bright-yellow `rgba(255,216,88,…)` washes.
- **Group by divider, not by box.** Separate sections with a `--color-divider`
  line + heading — do **not** wrap each section in a framed panel (dense panels
  like the infobox turn into a box-stack). This is a **grouping-style change**
  (framed box → line + heading), **not a layout restructure**: the controls and
  their order stay exactly where they are; only the box chrome (bg + border +
  radius) turns into a divider + heading. E.g. the route planner's
  Transportmittel / Routenoptionen boxes become divider-grouped *in place*.
- **Peer sections share one grouping treatment.** Divider-grouping stays the
  default; cards are the exception for self-contained blocks (menus, autocomplete,
  the route result, the speed-info travel cards). But within one set of sibling
  sections, pick **one** treatment for all — never mix carded and bare peers (the
  speed-info dialog had Fluss-/Meerreise as cards but Landreise bare). And one role
  uses **one class**, not two (a card title styled by both `.tsi-section` and
  `.tsi-wtitle` was a duplicate).
- **`border` vs `divider` are not interchangeable.** `--color-border` is for
  *control and panel edges* (solid hairline); `--color-divider` is for *section
  separators inside a panel* (soft). A section line is **always** the divider —
  the infobox header line uses the divider, not the border.
- **Divider mechanics (hard rules):** exactly **one** 1px line per section, never
  doubled; always **full-bleed** — negative side-margin equal to the container's
  horizontal padding, so the line runs edge to edge; **symmetric** spacing above
  and below via `--divider-gap` (reading sections, e.g. infobox) or
  `--divider-gap-tight` (dense control groups, e.g. route planner). After any
  width or padding change, **measure the line and screenshot it.**
- **Symmetric insets — left gap equals right gap.** A control/row sits the same
  distance from its container's left edge as from the right. Common breakages: a
  control narrower than its grid cell, or fixed grid tracks whose `gap` makes
  `col1 + gap + col2` exceed the content width so the last column overflows the
  right inset. Fix with a flexible track (`minmax(0,1fr)`) and let the control fill
  it; after any layout change, **measure both insets — they must match.**
- **Links** use `--color-link`; **hover** → `--color-link-hover` with a thicker
  underline; **focus** the shared `var(--focus-ring)`. Never blue.
- **External links carry a trailing `↗`.** Any link that leaves the site (Wiki
  Aventurica, source URLs, publication links, any off-domain target) **always**
  gets a trailing `↗` (U+2197) so it's clear it opens elsewhere; in-app /
  same-site links do **not**. Apply it once — a shared external-link treatment or
  an auto `a[href^="http"]:not([href*="avesmaps"])::after { content: " ↗"; }` —
  never hand-typed per link, so it stays consistent everywhere.
- **No blue = UI chrome only.** The no-blue rule covers panels, controls, links and
  menus. Two deliberate, code-commented exceptions stay and must **not** be
  "corrected": the *edit-in-progress* handles (path-edit dots,
  `REGION_EDIT_EDGE_COLOR`) and the analytics chart's categorical data palette
  (`#2a78d6` / `#4a3aa7`) — they encode state / data, not chrome.
- **Selects / inputs**: `--color-panel` background (flat — never the native grey
  browser control), `--color-border` + `--radius-md`; **hover** →
  `--color-border-strong`; **focus / open** → border-strong + `var(--focus-ring)`;
  **disabled** → the disabled tokens; placeholders use `--color-placeholder`.
  Combobox options tint with the selection wash.
- **Filters above sorting.** In a control bar that carries both, the filter row
  sits **above** the sort row — filtering narrows the set, sorting orders what
  remains (standard UI convention). The sort row is prefixed with a muted
  `Sortierung:` label. The adventures "Alle anzeigen" dialog stacks its controls
  as view toggle → filter bar → sort row.
- **Pills** (publication tags, counts): `--color-pill*`, `--radius-md`.
- **Panels** stay white with mirrored `--radius-sm` corners + shadow — already good.
- **Icons — two classes.** *UI glyphs* (add, remove, close, chevron, arrows, drag,
  zoom) are monochrome, **one consistent outline style**, drawn in `currentColor`
  so they follow text + theme — they may also take `--color-text-muted` or
  `--color-accent`, never a new colour; sizes `--icon-sm` (dense inline) /
  `--icon-md` (standard). Stop mixing CSS shapes and unicode characters — settle on
  one outline set. *Content imagery* (settlement-type icons, transport icons,
  region icons, coats of arms) are the **existing full-colour assets** — keep and
  reuse them **frameless** (no surrounding tile, background, or border — the icon
  sits directly in its row or header), `object-fit: contain`, decorative ones
  `pointer-events: none`; they are **never** recoloured to currentColor. Canonical sizes: `--icon-lg` 24
  (inline / transport), `--icon-xl` 40 (map-display type toggles), `--icon-2xl` 48
  (infobox type fallback), `--icon-hero` 130 (coat / logo).

## Route & waypoint markers

The waypoint timeline is a drag-grip + a column of connected markers (hollow
circles in `--color-text-muted` joined by a dotted line) + an input + a remove
control. The **destination pin** (last waypoint) uses `--color-marker-destination`
— a heraldic red matching the red map location markers. This red is the *one*
intentionally saturated accent; everything else stays in the warm-brown / gold
family. Route legs (`route-plan-entry`) are quiet rows that use the selection wash
(hover / active), never a framed box.

## Building something new

Reach for the tokens above and the nearest existing component as a template;
match the warmth and the divider-not-box grouping. If you need a colour that
isn't a token yet, **add the token** — don't invent a literal.

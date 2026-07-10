# Avesmaps design language

One warm, *aventurian* visual language shared by **every** surface — the route
planner (left, `#search`), the infobox panel (right, `.avesmaps-infopanel`),
dialogs, popups, the editor. Warm browns, parchment, coat-of-arms gold. **No
blue** — it reads as a foreign UI kit and is what made the panels diverge.

## The one rule

**Never hardcode a colour, radius, or divider. Always use a token from
`css/base/tokens.css`.** If the value you need has no token yet, add the token
first, then use it. A colour written as a literal in two places is divergence
waiting to happen — it is how the infobox and route planner drifted apart.

## Tokens — the single source of truth (`css/base/tokens.css`)

| Group | Tokens |
|---|---|
| Surfaces | `--color-page-bg`, `--color-panel` (white card), `--color-panel-soft` (grouped bg), `--color-panel-muted` |
| Text | `--color-text`, `--color-text-strong`, `--color-text-muted` |
| Lines | `--color-border` (hairline), `--color-border-strong`, `--color-divider` (section separator — the *same* everywhere) |
| Button · primary (filled) | `--color-button`, `--color-button-text`, `--color-button-border` |
| Button · secondary (soft/outline) | `--color-button-soft`, `--color-button-soft-text`, `--color-button-soft-border` |
| Accent · links | `--color-accent` (coat gold), `--color-accent-strong`, `--color-link` (gold-brown — links are **never** blue) |
| Pills / tags | `--color-pill`, `--color-pill-border`, `--color-pill-text` |
| Radius | `--radius-sm` 5px, `--radius-md` 8px (controls/buttons/pills), `--radius-lg` 10px |

## Component rules

- **Button hierarchy.** The main action is *filled* (`--color-button` /
  `--color-button-text`); everything else is *soft/outline* (`--color-button-soft`
  + `--color-button-soft-border`). Radius `--radius-md`. No pill/`999px` shapes.
- **Group by divider, not by box.** Separate sections with a `--color-divider`
  line + heading — do **not** wrap each section in a framed panel (dense panels
  like the infobox turn into a box-stack). In popups/infoboxes dividers run
  edge-to-edge (full-bleed): negative side-margin equal to the container's
  horizontal padding.
- **Links** use `--color-link`. Never blue.
- **Selects / inputs**: warm border (`--color-border`), `--radius-md`, warm bg —
  never the native grey browser control.
- **Pills** (publication tags, counts): `--color-pill*`, `--radius-md`.
- **Panels** stay white with mirrored `--radius-sm` corners + shadow — already good.

## Building something new

Reach for the tokens above and the nearest existing component as a template;
match the warmth and the divider-not-box grouping. If you need a colour that
isn't a token yet, **add the token** — don't invent a literal.

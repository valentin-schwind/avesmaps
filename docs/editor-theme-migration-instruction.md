# Instruction: Backend-Editor Dark/Light — Stufe 2 (Territorien-Editor + restliches Backend)

> Umsetzungs-Instruction für eine **eigene, fokussierte Session**. Selbsttragend
> (ohne den Chat, der sie erzeugt hat, ausführbar). Prosa DE; Code/Kommentare/
> Commits EN (Projekt-Konvention, AGENTS.md §8). Design-Grundlage:
> `docs/design-language.md` (§12) + `css/base/tokens.css`.

## Ziel

Der Backend-Editor folgt dem Dark/Light-Umschalter (`data-theme="dark"` auf
`<html>`, `js/app/theme-toggle.js`) noch nicht, weil seine CSS Farben **hart
verdrahtet**. Diese Stufe macht den **Territorien-Editor + die restlichen
Backend-Flächen (Lister, Fenster, Dialoge)** theme-fähig.

**Stufe 1 ist bereits LIVE** (commit `19fd5827`): Editor-Panel (`review-panel.css`)
+ Mails (`mail-inbox.css`) tokenisiert; neue Tokens `--color-success-soft` /
`--color-danger-soft` (bg/border/text, Hell+Dunkel). Diese Stufe 2 mirror-t diesen
Ansatz. Siehe Memory `editor-theme-migration.md`.

## Prinzip (Owner-freigegeben)

- **Reines Tokenisieren:** der **Hell-Look bleibt 1:1**, es kommt nur sauberes
  **Dunkel** dazu. Kein Umstyling, keine JS-Overrides (Werte global im Token,
  Memory `no-js-ui-overrides-and-global-design`).
- **Kein Blau/Lila** (Designsprache): der Editor stammt aus der iframe-Zeit und hat
  einen **blauen Accent** (`--accent: #385d72`, `--accent-soft: #eef5f8`) + evtl.
  vereinzelte blaue Hex. Alle → **warm/gold** (`--color-link` / `--color-accent` /
  `--color-pill`), wie beim Panel-Sweep in Stufe 1.
- **Dunkel ist ALLES-ODER-NICHTS:** bleibt auch nur ein Teil hartkodiert-hell,
  leuchtet er im Dunkel-Panel grell auf → sieht kaputt aus. Die Stufe muss
  **vollständig** sein, bevor sie taugt. Nach dem Sweep: `grep -riE '#[0-9a-f]{3,8}'`
  über ALLE Editor-CSS → es dürfen nur bewusste Ausnahmen übrig bleiben (schwarze
  Schatten-`rgba(0,0,0,…)`, evtl. eine dokumentierte Daten-Highlight-Farbe).

## Architektur (WICHTIG — nicht wie Stufe 1)

Zwei Gruppen von Editor-CSS mit **unterschiedlichem Deploy-/Cache-Fluss**:

### Gruppe A — auto-generiert (Territorien-Editor-Kern)
`css/pages/political-territory-editor-inline.css` ist **AUTO-GENERIERT** („do not
edit by hand"). Es wird von `tools/scope_editor_css.js` erzeugt, das die Selektoren
unter `#political-territory-editor-host` scoped. Es wird **dynamisch** vom Host-JS
geladen (NICHT via `styles.css`-@import) → die Cache-Bustung läuft über
**`ASSET_VERSION`**.

- **Quellen (DIESE editieren):**
  - `css/pages/political-territory-editor.css` — 113 Hex, **enthält die Palette** (2×, s.u.)
  - `css/pages/political-territory-editor-layout.css` — 8 Hex
  - `css/pages/political-territory-wiki-tree.css` — 21 Hex
- **Regenerieren:** `node tools/scope_editor_css.js` (schreibt `…-inline.css`; prüft
  am Ende `LEAKING_SELECTORS=0` — muss 0 sein).
- **Cache:** `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js:23`
  bumpen (aktuell `"20260708b"` → z. B. `"20260713a"`). Sonst lädt der Browser alten
  Editor-Code/-CSS (AGENTS.md §7).

### Gruppe B — direkt @import (Dialoge/Fenster/Listen drumherum)
Via `css/styles.css`-@import geladen → pro Datei den `?v=`-Tag in `styles.css`
bumpen (wie in Stufe 1).

- `css/components/political-territory-editor-overlay.css` — 5 Hex
- `css/components/political-territory-tree.css` — 31 Hex
- `css/components/political-territory-controls.css` — 32 Hex
- `css/components/political-territory-wiki.css` — 11 Hex
- (`css/components/political-territory-editor-columns.css` — falls vorhanden, grep prüfen)

**Schon 0 Hex (nichts zu tun):** `css/components/region-wiki-dialogs.css`,
`css/components/edit-overlays.css`.

## Schritt 1 — Palette umbiegen (der große Hebel)

Der Editor trichtert die meisten Farben durch eine Palette, definiert in
`css/pages/political-territory-editor.css` unter `#political-territory-editor-host`
(**zweimal** im File — beide Vorkommen ändern). Die Palette-Werte durch die
Haupt-Tokens ERSETZEN (nicht den Wert, die REFERENZ):

| Editor-Var | heutiger Wert | → Haupt-Token |
|---|---|---|
| `--page-bg` | `#f4efe7` | `var(--color-page-bg)` |
| `--page-bg-deep` | `#2f322c` | `var(--color-page-bg-deep)` |
| `--panel` | `#fff9f4` | `var(--color-panel)` |
| `--panel-soft` | `#fffaf5` | `var(--color-panel-soft)` |
| `--panel-muted` | `#f8efe4` | `var(--color-panel-muted)` |
| `--panel-hover` | `#f5eadc` | `var(--color-panel-muted)` |
| `--text` | `#2f251c` | `var(--color-text)` |
| `--text-strong` | `#3f3428` | `var(--color-text-strong)` |
| `--muted` | `#6c5a49` | `var(--color-text-muted)` |
| `--muted-2` | `#806c59` | `var(--color-text-muted)` |
| `--border` | `#d8c6b2` | `var(--color-border)` |
| `--border-strong` | `#cdb79f` | `var(--color-border-strong)` |
| `--accent` | `#385d72` **(BLAU)** | `var(--color-link)` **(gold)** |
| `--accent-soft` | `#eef5f8` **(hellblau)** | `var(--color-hover-wash)` **(warm)** |
| `--button` | `#565044` | `var(--color-button)` |
| `--button-border` | `#5f4f40` | `var(--color-button-border)` |
| `--danger` | `#8a3a1b` | `var(--color-danger)` |
| `--synthetic` | `#8b5d2a` | behalten (Querfeldein-Datenfarbe) — nur wenn nirgends als Chrome genutzt |
| `--shadow` | `rgba(0,0,0,.18)` | behalten (schwarzer Schatten, theme-neutral) |

> `var(--color-*)` löst am Host-Element den `:root`-Wert auf, der mit `data-theme`
> flippt → alles, was `var(--panel)`/`var(--text)`/… nutzt, wird damit in EINEM
> Rutsch theme-fähig. Prüfe, wo `--accent` genutzt wird (Links → `--color-link`,
> Highlight/aktiv → `--color-accent`), und wähle je Fall.

## Schritt 2 — hartkodierte Streuner tokenisieren

Wie in Stufe 1: **Node-Skript** (Scratchpad) mit einer Mapping-Liste
`[literal, token]`, exakt-String-Ersetzung, Zähler pro Key. Property-qualifiziert
für mehrdeutige Werte (`#fff` als bg vs Text; ein Hex in Border- vs Hover-Bg-Rolle).
Schwarze Schatten `rgba(0,0,0,…)` NICHT ersetzen. **Alle Blau/Lila → warm/gold.**
Danach `grep` auf Rest-Hex; Klammer-Balance prüfen; `git diff --stat` sollte ein
~1:1-Zeilentausch sein (nur Farbzeilen geändert). Referenz-Mapping der warmen Browns
→ Tokens: siehe den Stufe-1-Commit `19fd5827` (`review-panel.css`) — dieselben Werte.

Das je Datei anwenden: Gruppe-A-Quellen (editor.css, editor-layout.css, wiki-tree.css)
UND Gruppe-B-Dateien (overlay, tree, controls, wiki).

## Schritt 3 — Regenerieren + Versionen

1. `node tools/scope_editor_css.js` → prüfen: `LEAKING_SELECTORS=0`.
2. `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` bumpen.
3. In `css/styles.css` die `?v=`-Tags der Gruppe-B-Dateien bumpen (aktuellen Tag
   erst greppen — Parallel-Sessions ändern die Tags; Memory `push-workflow`).
4. `tokens.css` braucht KEINE neuen Tokens (Stufe 1 hat `--color-success-soft`/
   `--color-danger-soft` schon angelegt) — außer der Editor braucht eine Farbe ohne
   passendes Token: dann Token ZUERST in `tokens.css` (Hell+Dunkel) anlegen, dann
   nutzen.

## Schritt 4 — Verifikation Hell + Dunkel (Pflicht)

Der Editor ist ein **Overlay** (Edit-Mode + Interaktion nötig); in der MCP-/Electron-
Pane kaum zu screenshotten (0-breit, Canvas-rAF-Timeouts — Memories
`mcp-hiddentab-raf-verification-trap`, `verify-ui-fix-via-localhost-repro`). Deshalb:

- **Computed-Farben messen** (wie Stufe 1): synthetische Elemente mit den echten
  Editor-Klassen unter einem `#political-territory-editor-host`-Wrapper erzeugen,
  `getComputedStyle` in Hell lesen, `document.documentElement.setAttribute('data-theme','dark')`,
  erneut lesen → müssen flippen (Panel dunkel, Text hell). Kein Rest, der hell bleibt.
- **Server-Gegenprobe:** `curl` der deployten Dateien (cache-gebustet) auf die Tokens
  (`grep`, KEIN `grep -P` — Locale-Bug), und `styles.css` auf die neuen Tags +
  `territory-editor-inline-host.js` auf die neue `ASSET_VERSION`.
- Der Owner prüft final im echten Browser (Editor öffnen, 🌙 umschalten).

## Gotchas / Invarianten

- **Auto-Gen:** `…-inline.css` NIE von Hand editieren — Quellen editieren + Generator.
- **ASSET_VERSION** nach jeder Editor-Asset-Änderung bumpen (sonst stale).
- **Shared Tree:** nur EIGENE Dateien per Pfad stagen (`git add -- <pfad>`), nie
  `git add -A`; bei Push-Reject `fetch` + `rebase origin/master --autostash` + retry,
  nie force-push (Memory `shared-working-tree-selective-staging`, `push-workflow`).
- **Kleine verifizierte Commits direkt auf master**, Push frei, Remote-SHA prüfen,
  ~1–2 min Deploy, dann Live-Gegenprobe.
- **Kein Blau** außer UI-Chrome/Handles/Charts (Memory `designsprache-warm-trenner`).
- **Dunkel vollständig** halten (s. o. — alles-oder-nichts).
- STRATO: keine schweren Endpoints loopen (irrelevant hier, reine CSS-Arbeit).

## Umfang (grob)

~142 Hex in Gruppe A (Quellen) + ~79 Hex in Gruppe B + Palette-Remap (2× ~19 Vars).
Palette-Remap deckt den Großteil; die Streuner sind der Rest. Ein fokussierter
Sweep, gut in einer Session machbar.

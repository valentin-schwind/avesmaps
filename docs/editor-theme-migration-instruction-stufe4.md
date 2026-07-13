# Instruction: Backend-Editor Dark/Light — Stufe 4 (Siedlungseditor + Sync-/Territoriums-Editor, die 2 Legacy-Iframes)

> Umsetzungs-Instruction für eine **eigene, fokussierte Session**. Selbsttragend
> (ohne den Chat, der sie erzeugt hat, ausführbar). Prosa DE; Code/Kommentare/
> Commits EN (Projekt-Konvention, AGENTS.md §8). Design-Grundlage:
> `docs/design-language.md` (§12) + `css/base/tokens.css`. Vorbild/Methode:
> `docs/editor-theme-migration-instruction.md` (Stufe 2) — dieselbe Vorgehensweise,
> nur andere Zieldateien mit einer zusätzlichen Eigenheit (echte `<iframe>`-Dokumente,
> s. u.).

## Ziel

Owner-Feststellung: „der siedlungseditor und der territoriumseditor im editmode
haben noch kein hell/dunkel theme". Konkret sind das **zwei** Dateien:

- **Siedlungseditor** = `html/wiki-sync-settlement-editor.html` (Titel „Siedlungen
  zuordnen und editieren", 2346 Zeilen). Geöffnet über
  `window.openAvesmapsSettlementEditorOverlay` in `js/review/review-settlement-list.js`.
- **Territoriums-/Sync-Editor** = `html/wiki-sync-monitor.html` (Titel
  „Herrschaftsgebiete synchronisieren und editieren", 1360 Zeilen — das ist mit
  „Territoriumseditor im Editmode" gemeint). Geöffnet über
  `window.openAvesmapsSyncEditorOverlay` in `js/review/review-wiki-sync.js`.

**Nicht verwechseln** mit dem bereits themefähigen politischen Territorien-Editor
(`html/political-territory-editor.html`, wird per `fetch` + `host.innerHTML` INLINE
in die Hauptseite injiziert, kein eigenes Dokument — der war Stufe 2 und ist LIVE).
Die beiden Dateien hier sind echte `<iframe src="...">`-Overlays mit **eigenem**
Browsing-Kontext (siehe Architektur unten) — deshalb bewusst zurückgestellt
(Memory `editor-theme-migration.md`, Stufe 3: „eigenes Thema, mit echtem
Browser-Check").

## Ausgangslage (was schon LIVE ist, damit nichts doppelt gemacht wird)

- Stufe 1 (`review-panel.css`, `mail-inbox.css`), Stufe 2 (Territorien-Editor:
  `political-territory-editor.html` + zugehörige CSS), Stufe 3 (Hinweise-Dialog,
  `region-sync.css`, `visitor-analytics.css`, `admin.css`/`edit.css`, 4 Modal-Scrims
  vereinheitlicht, `adventure-editor.html` bekam die Theme-Propagation) sind
  **LIVE**. Details: Memory `editor-theme-migration.md`.
- `adventure-editor.html` ist das **fertige Vorbild** für „echtes Iframe-Dokument,
  komplett auf `tokens.css`": lädt `/css/base/tokens.css` direkt, hat **keine**
  lokale Mini-Palette mehr, 0 Hex. Die Theme-Propagation-Guard-Funktion daraus
  (Kopiervorlage, s. Schritt 1) ist bereits produktiv.
- Die beiden Zieldateien hier haben dagegen **noch beides ihrer eigenen Historie**:
  eine unabhängige lokale `:root{--bg:...}`-Mini-Palette **plus** hunderte
  direkt-hartkodierte Hex-Werte, die diese Mini-Palette gar nicht nutzen. Das ist
  der Grund, warum sie in Stufe 3 explizit zurückgestellt wurden.

## Architektur — der Unterschied zu Stufe 2

`political-territory-editor.html` wird per `fetch()` geholt und ihr Markup direkt
in die Haupt-DOM injiziert (`js/territory/territory-editor-inline-host.js`) → es
teilt sich das `<html data-theme="dark">` der Hauptseite, Tokenisieren allein reichte.

Die beiden Dateien hier sind **echte** `<iframe>`s (eigenes `<html>`, eigenes
`document`, eigenes `localStorage`-Origin ist gleich, aber der `data-theme`-Attribut-
Zustand der Elternseite wird NICHT automatisch vererbt). Sie brauchen daher **zwei**
unabhängige Maßnahmen:

1. Eine **eigene Theme-Propagation-Guard** im `<head>`, die **vor** dem Stylesheet
   rendert (sonst Flash-of-wrong-theme) — exakt wie in `html/adventure-editor.html`
   Zeilen 8–32 (das ist bereits fertiger Code, 1:1 kopierbar):

   ```html
   <script>
     (function () {
       function isDark() {
         var saved = null;
         try { saved = localStorage.getItem("avesmaps-theme"); } catch (e) {}
         if (saved === "dark") { return true; }
         if (saved === "light") { return false; }
         return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
       }
       function apply() {
         if (isDark()) { document.documentElement.setAttribute("data-theme", "dark"); }
         else { document.documentElement.removeAttribute("data-theme"); }
       }
       apply();
       if (window.matchMedia) {
         var mq = window.matchMedia("(prefers-color-scheme: dark)");
         if (mq.addEventListener) { mq.addEventListener("change", apply); }
         else if (mq.addListener) { mq.addListener(apply); }
       }
     })();
   </script>
   ```

2. Ein `<link rel="stylesheet" href="/css/base/tokens.css">` **vor** dem
   bestehenden Inline-`<style>`-Block, damit `var(--color-*)` in den lokalen
   Palette-Variablen auflösbar ist.

`html/wiki-sync-settlement-editor.html` und `html/wiki-sync-monitor.html` werden
mit `?v=" + Date.now()` gebaut (`buildSettlementEditorSrc`/`buildSyncEditorSrc` in
den jeweiligen JS-Dateien) — **kein `ASSET_VERSION`-Mechanismus nötig**, jeder
Öffnen-Klick ist bereits cache-gebustet. Falls `tokens.css` selbst neue Tokens
bekommt (Schritt 4), dessen `?v=`-Tag in `css/styles.css` Zeile 2 bumpen (aktuellen
Tag erst greppen, Parallel-Sessions ändern ihn — Memory `push-workflow`).

## Schritt 1 — Guard + tokens.css einbauen

In **beiden** Dateien: das Script + den `<link>` aus dem Architektur-Abschnitt in
den `<head>` einfügen, VOR dem bestehenden `<style>`-Block (der `<link
rel="stylesheet" href="/css/base/fonts.css">` bleibt).

## Schritt 2 — lokale Palette umbiegen (der große Hebel)

Beide Dateien haben **dieselbe** lokale `:root`-Zeile (identischer Wortlaut, je
einmal):

```
:root { --bg:#f4efe7; --panel:#fff9f4; --soft:#fffaf5; --line:#d8c6b2; --line2:#cdb79f; --fg:#3f3428; --mut:#6c5a49; --accent:#8f7326; --accent-hover:#6f5a1c; --warn:#b8860b; --bad:#9d3a2e; --ok:#2e7d32; --font-ui:"Faculty Glyphic","Arial",sans-serif; }
```

Diese Werte sind (bis auf `--warn`) **exakt** dieselben, die Stufe 2 schon einmal
gemappt hat (`political-territory-editor.css`s Palette war aus derselben Quelle
abgeleitet) — hohe Sicherheit, dass die Zuordnung stimmt:

| Lokale Var | heutiger Wert | → Haupt-Token |
|---|---|---|
| `--bg` | `#f4efe7` | `var(--color-page-bg)` |
| `--panel` | `#fff9f4` | `var(--color-panel)` |
| `--soft` | `#fffaf5` | `var(--color-panel-soft)` |
| `--line` | `#d8c6b2` | `var(--color-border)` |
| `--line2` | `#cdb79f` | `var(--color-border-strong)` |
| `--fg` | `#3f3428` | `var(--color-text-strong)` |
| `--mut` | `#6c5a49` | `var(--color-text-muted)` |
| `--accent` | `#8f7326` | `var(--color-link)` (Wert ist heute schon identisch — kein Blau hier, anders als in Stufe 2) |
| `--accent-hover` | `#6f5a1c` | `var(--color-link-hover)` (Wert identisch) |
| `--bad` | `#9d3a2e` | `var(--color-danger)` |
| `--ok` | `#2e7d32` | `var(--color-success)` |
| `--warn` | `#b8860b` | **kein passendes Token — siehe Schritt 4** |

`--font-ui` unverändert lassen (kein Farb-Token).

## Schritt 3 — hartkodierte Streuner tokenisieren

Beide Dateien haben zusätzlich hunderte Hex-Literale, die die lokale Palette gar
nicht referenzieren (grep-Zählung, häufigste zuerst):

- **Settlement-Editor** (~50 unique Werte): `#fff` (7×), `#3f3428` (7×, direkt
  statt `var(--fg)`), `#fff9f4` (4×), `#f3ebdf` (4×), `#bfa03a` (4×, Highlight —
  entspricht exakt `--color-accent` im Haupt-Token!), `#faeeda`/`#ef9f27`/`#6a7f3a`
  (je 3×), Rest 1-2×.
- **Sync-Monitor** (~35 unique Werte): `#3f3428` (6×), `#fff` (5×), `#fff9f4`/
  `#f3ebdf`/`#ead9c2`/`#b99a78`/`#6a7f3a`/`#513c2b` (je 3×), Rest 1-2×.
- **Blau/Lila (Designsprache-Verstoß, MUSS raus):**
  - `.ident-chip.active { background:#385d72; color:#fff; border-color:#385d72; }`
    (nur Sync-Monitor) — derselbe Legacy-Blau-Akzent wie Stufe 2s
    `political-territory-editor.css`-`--accent`. Rollen-abhängig mappen (Vorbild
    Stufe 2: solide Aktiv-Füllung → `--color-button`/`--color-button-text`).
  - `.tag.sied { color:#7a4fa0; border-color:#b79fce; }` und
    `.tag.excl { color:#7a4fa0; border-color:#c0998f; }` (nur Sync-Monitor) — Lila
    auf Tag-Pillen. Dafür gibt es bereits ein passendes Token-Set aus Stufe 3:
    `--color-accent-brown*` („WikiSync-/Label-/Pfad-/Ort-Dialoge eigener Akzent").

**Methode wie Stufe 1/2:** Node-Skript (Scratchpad) mit Mapping-Liste
`[literal, token]`, exakte String-Ersetzung, Zähler pro Key, property-qualifiziert
bei Mehrdeutigkeit. Schwarze Schatten-`rgba(0,0,0,…)` NICHT anfassen. Da beide
Dateien einen sehr ähnlichen Satz an Button-/Tag-/Status-Klassen teilen (fast
identisches CSS, vermutlich Copy-Paste-Historie), lohnt sich EIN Mapping-Skript,
das über beide Dateien läuft.

**Wichtige Falle (neu, nicht in Stufe 1/2 aufgetreten):** manche Hex-Werte sind
**ON-FILL-Text** (weiße/helle Schrift auf einem farbig gefüllten Button), nicht
Seiten-/Panel-Hintergrund — obwohl der Zahlenwert zufällig mit einem Seiten-Token
übereinstimmt. Beispiel real gefunden:

```css
button.primary { background:#565044; border-color:#5f4f40; color:#fff9f4; }
```

`#fff9f4` ist hier **Text auf einem dunkel gefüllten Button**, nicht `--panel`
(auch wenn der Zahlenwert zufällig identisch ist) — würde man das blind auf
`var(--color-panel)` mappen, wird der Button-Text im Dunkelmodus dunkel auf
dunklem Grund (unlesbar), weil `--color-panel` im Dark-Theme kippt. Genau dafür
gibt es die in Stufe 2/3 angelegten **gepinnten** (kein Dark-Override) Tokens:
`--color-on-button-muted`, `--color-accent-brown-text` (`#fff` hell / dunkel im
Dark — bewusst FÜR farbig gefüllte Buttons gedacht). Vor jedem Ersetzen einer
Textfarbe auf einem `.primary`/`.is-active`/gefüllten Button/Chip **die Selektor-
Rolle prüfen**, nicht nur den Hex-Wert stumpf abgleichen.

## Schritt 4 — Entscheidung `--warn` (neues Token oder Ausnahme)

`--color-warning` existiert heute noch **nicht** in `tokens.css`. Vor dem Ersetzen
klären (AGENTS.md §12 „Token zuerst anlegen, dann nutzen"):

- Prüfen, wo `--warn`/`#b8860b` tatsächlich verwendet wird (voraussichtlich Warn-
  Badges/Status in den Konflikt-Listen).
- Falls mehrfach als **Status-Farbe** (analog `--color-success`/`--color-danger`)
  gebraucht: neues Token-Paar `--color-warning` (+ ggf. `-soft`/`-soft-border`/
  `-soft-text` nach dem Muster von `--color-success-soft`) in `tokens.css`
  **Hell UND Dunkel** anlegen, dann in beiden Editor-Dateien nutzen.
- Falls nur 1-2 Stellen und eher Chrome-Charakter: als bewusst gepinnte Ausnahme
  dokumentieren (wie `--synthetic`/`--shadow` in Stufe 2) — kurz im Commit/Kommentar
  begründen.

## Schritt 5 — CRLF-Falle (aus Stufe 2 bekannt, hier bestätigt)

`git ls-files --eol html/wiki-sync-settlement-editor.html
html/wiki-sync-monitor.html` zeigt `i/lf w/crlf` — die Repo-Version ist LF, die
lokale Arbeitskopie unter Windows CRLF. Mehrzeilige Scratchpad-Find-Strings
brauchen `\r\n`, sonst `MISMATCH (0/1)` **still** (kein Korruptionsrisiko, nur ein
unausgeführter Fix, der leicht übersehen wird). Zähler nach jedem Lauf prüfen.

## Schritt 6 — Verifikation (Pflicht, diesmal mit echtem Browser)

Anders als bei der reinen CSS-Arbeit in Stufe 1-3 sind hier zwei Dinge NUR im
echten Browser sauber zu prüfen:

1. **Computed-Style-Sanity-Check zuerst** (wie Stufe 2): synthetische Elemente mit
   den echten Klassen bauen, `var(--…)`-Ketten aus `tokens.css`s zwei `:root`-
   Blöcken auflösen, Hell/Dunkel vergleichen — filtert die meisten Fehler günstig
   vor.
2. **Owner/echter Browser zwingend** für: (a) den Iframe-Flash-Check (Theme-Guard
   greift VOR dem Stylesheet-Paint — nur im echten Browser sichtbar/unsichtbar zu
   machen), (b) die ON-FILL-Text-Fälle aus Schritt 3 (ein Computed-Style-Diff sieht
   nicht, ob Text auf seinem eigenen Hintergrund lesbar bleibt — das ist ein
   visuelles Urteil). Beide Editoren öffnen (Siedlung: „Alle anzeigen"/Editor-
   Button im Siedlungs-Reiter; Sync: Territorium-Konflikt-Editor im Review-Panel),
   🌙 umschalten, Buttons/Tags/Status-Pillen in beiden Zuständen ansehen.
3. Rest-Hex-Grep über beide Dateien am Ende: nur bewusste Ausnahmen (schwarze
   Schatten-rgba, ggf. gepinnte `--warn`-Ausnahme) dürfen übrig bleiben.

## Gotchas / Invarianten

- **Shared Tree:** nur die beiden eigenen Dateien per Pfad stagen (`git add --
  html/wiki-sync-settlement-editor.html html/wiki-sync-monitor.html
  css/base/tokens.css` falls Schritt 4 zutrifft), nie `git add -A` (Memory
  `shared-working-tree-selective-staging`).
- **Push:** `fetch` + `rebase origin/master --autostash` + Retry bei Reject, nie
  force-push; Remote-SHA nach jedem Push prüfen (Memory `push-workflow`).
- **Kein Blau/Lila** außer UI-Chrome/Handles/Charts (Memory
  `designsprache-warm-trenner`) — die beiden gefundenen Fälle (`#385d72`,
  `#7a4fa0`) MÜSSEN raus.
- **Dunkel vollständig** halten — alles-oder-nichts, sonst leuchtet ein
  vergessener Rest im Dunkel-Panel grell auf.
- Kleine verifizierte Commits direkt auf `master`, ~1–2 min Deploy, Live-
  Gegenprobe danach.

## Umfang (grob)

2 Dateien, 2346 + 1360 Zeilen, ~85 unique Hex-Werte kombiniert (viel Überlappung
zwischen den Dateien, ein gemeinsames Mapping-Skript deckt beide ab) + 1
Palette-Remap-Tabelle (12 Vars, identisch in beiden) + 1 offene Token-Entscheidung
(`--warn`). Realistisch eine fokussierte Session, aber mit echtem Browser-Check
am Ende (Pflicht, s. Schritt 6) — nicht rein CI/grep-verifizierbar wie Stufe 1-3.

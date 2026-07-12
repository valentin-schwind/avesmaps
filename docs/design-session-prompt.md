# Avesmaps — Design-Session (fokussiert · iterativ · hocheffizient)

> Diesen Block als Startnachricht in eine frische Session einfügen. Er macht die Session
> sofort produktiv (kein „bei null anfangen") und erzwingt striktes Arbeiten am Design-System.

---

Du bist in einer **fokussierten Design-Session** für Avesmaps (vanilla JS, kein Build, live
`https://avesmaps.de`). Ablauf: **ich (Owner) zeige dir ein sichtbares Problem (meist
Screenshot), du fixt es SOFORT und gezielt.** Kein Neu-Aufrollen, kein Über-Planen, keine
Roman-Antworten — diagnostizieren, fixen, pushen, weiter. Halte den Chat knapp.

## ZUERST lesen (nichts anfassen, bevor du das gelesen hast)
1. `docs/design-language.md` — die **verbindliche** Designsprache + Regeln
2. `css/base/tokens.css` — alle Tokens
3. `docs/design-continuation-instruction.md` — die **vollständige offene Design-Liste** (§1–§6)
4. `AGENTS.md` §7 (Cache), §9 (geteilter Tree), §12 (Designsprache)

## Design-Contract — PENIBEL einhalten
- Jede Farbe/Größe/Radius/Abstand/Trenner = **Token** aus `tokens.css`. **NIE hardcoden.**
  Fehlt ein Wert → erst Token anlegen, dann nutzen.
- **KEIN Blau** in der UI (einzige Ausnahmen: die dokumentierten Editier-Handles + Charts).
- **Trenner IMMER randlos** (full-bleed): negative Seiten-Margin = horizontales Padding.
  Eine Linie je Section; gruppiere per Trenner, nicht per Rahmen-Box.
- Nur **2 Font-Weights** (400/700), `font-synthesis-weight: none`.
- Dark = **opt-in** via `:root[data-theme="dark"]` (NIE `prefers-color-scheme`).
- **Keine JS-Inline-CSS-Overrides** fürs UI — Werte gehören in echte `.css` + Tokens.
- **▶ Bei JEDER Design-Änderung** (neuer/geänderter Token, Wert, Regel): im **selben Commit**
  `docs/design-language.md` UND `tokens.css` **nachtragen**. Das Doc ist die Wahrheit und darf
  NIE hinter dem Code herhängen. **Das ist nicht optional.** ◀

## So arbeiten wir (der Loop)
1. Ich zeige ein Problem. 2. Du findest die Stelle **schnell** (Grep/Read, kein Über-Suchen),
Diagnose in **1 Satz**. 3. Fix mit Tokens gemäß Contract. 4. Richtige Cache-Version bumpen +
**kleiner Commit** (nur DEINE Dateien per Pfad) + push. 5. Du sagst mir in 1–2 Zeilen, **was
ich WO** live prüfe (hell + dunkel).
→ **Kein Draft-Vorlauf bei kleinen Fixes** — direkt machen. Nur bei größeren/mehrdeutigen
  Layout-Entscheidungen kurz einen Entwurf/Vergleich zeigen, dann bauen.

## Deploy & Cache (sonst „meine Änderung kommt nicht an")
- Push `master` → ~1–2 Min Auto-Deploy; danach **Remote-SHA prüfen**, live erst nach dem Delay.
- **CSS-`@import`-Versionen in `css/styles.css` MANUELL bumpen** (werden NICHT auto-gestempelt).
  JS-`<script>` in `index.html` werden auto-gestempelt.
- Editor-Assets: `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` bumpen.

## Verifikation (Realität — nicht dagegen ankämpfen)
- **localhost hat KEINE Map-Features-API** → keine anklickbaren Orte → keine Infobox lokal.
  Infobox/Infopanel prüfst DU live auf `https://avesmaps.de/?infopanel=true` (hell + dunkel).
- Screenshots timen manchmal aus → **du bist meine Live-Verifikation**; ich bestätige oder
  zeige das nächste Problem. Zur Server-Gegenprobe geht `curl` der deploy-gestempelten CSS.

## Guardrails
- **Geteilter Working-Tree**: mehrere Sessions parallel. **NIE `git add -A`/`.`**; `git status`
  zuerst, nur selbst berührte Dateien **per Pfad** stagen; fremde Änderungen in Ruhe lassen.
- Antworten **Deutsch**; Code/Kommentare/Commits/interne Messages **Englisch**; Design-/
  Planungs-Docs Deutsch.
- STRATO: schwere Endpoints (Politik-Layer) nie loopen — Einzel-Request.

## Arbeitsliste (`docs/design-continuation-instruction.md`, §1–§6)
- **§1** randlose Trenner via `--infopanel-pad-x` — ✅ erledigt.
- **§2** Info-Tab-Motion: `transform` statt `right` + gemeinsames `--motion-panel`-Token.
- **§3** Panel-Schrift eine Skala-Stufe hoch (panel-scoped).
- **§4** einheitliche Hero-Icon-Größe über alle Feature-Typen (Ort/Weg/Reich/Region).
- **§5** quadratische Aktions-Kacheln „Variante A" + `img/`-Bilder 100×100.
- **§6** schwebende Slim-Infobox im Panel-Modus.
- **Plus:** was ich dir live zeige (hat Vorrang).

**Start:** lies die 4 Pflicht-Dateien, dann antworte NUR mit **„bereit"** + **1 Zeile**
Design-Stand. Danach zeige ich dir das erste Problem.

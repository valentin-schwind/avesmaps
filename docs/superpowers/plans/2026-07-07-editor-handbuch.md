# Editor-Handbuch — Umsetzungsplan

> **Für agentische Worker:** ERFORDERLICHES SUB-SKILL: Nutze
> superpowers:subagent-driven-development (empfohlen) oder
> superpowers:executing-plans, um diesen Plan Aufgabe für Aufgabe umzusetzen.
> Schritte nutzen Checkbox-Syntax (`- [ ]`) zum Nachverfolgen.

**Ziel:** Eine eigenständige, öffentlich erreichbare HTML-Handbuchseite
(`html/editor-handbuch.html`) für neu eingeladene Editoren bauen und über einen
„Tutorial"-Link in der Editor-Statuszeile verlinken.

**Architektur:** Eine einzelne, self-contained HTML-Seite mit inline `<style>`
(kein zusätzliches Asset, kein `?v=`-Stempel nötig), fester Seitenleisten-
Navigation, acht Inhaltsabschnitten (A–H) und drei inline-SVG-Diagrammen. Der
Einstieg ist ein `<a>`, das in `updateMapDataStatus()` (`js/routing/routing.js`) an
die nur im Editor-Panel sichtbare Statuszeile `#map-data-status` angehängt wird;
eine CSS-Regel hebt dort `pointer-events` an.

**Tech-Stack:** Vanilla HTML/CSS, inline SVG, jQuery 3.6.0 (bereits geladen, nur
für die Link-Verdrahtung in `routing.js`). Kein Build, kein Bundler, kein
Test-Framework.

## Globale Rahmenbedingungen

Jede Aufgabe schließt diesen Abschnitt implizit ein.

- **Kein Build, kein Test-Framework.** Verifikation erfolgt (a) über eine
  **statische Vorschau** der Seite (rendert ohne PHP-Backend), (b) Sicht- und
  Browser-Konsolen-Check (keine Fehler), (c) für die Link-Verdrahtung ein
  **Live-Check nach Deploy** auf `avesmaps.de/edit/` (die Statuszeile füllt sich
  erst, wenn Kartendaten aus dem Backend geladen sind).
- **Sprache & Labels:** Handbuch-Prosa ist **Deutsch**. UI-Bezeichnungen
  (Buttons, Reiter, Menüpunkte, Dialogfelder) werden **wörtlich aus dem Code/aus
  der UI übernommen, niemals erfunden**. Wenn ein Label unklar ist, erst die
  genannte Quelldatei lesen.
- **Absolute Produktions-URL:** Der Tutorial-Link und der „Zurück zur Karte"-Link
  zeigen fest auf `https://avesmaps.de/...` (Ein-Host-Projekt; bewusst nicht
  localhost-portabel).
- **Abschnitts-Markup (Muster für jeden Inhaltsabschnitt A–H):**

  ```html
  <section id="a" class="hb-section">
    <h2>A. Grundlagen &amp; erste Schritte</h2>
    <p class="hb-lead">Kurzer Einleitungssatz, worum es geht.</p>
    <!-- Schritt-für-Schritt als nummerierte Liste -->
    <ol class="hb-steps">
      <li>Konkreter Schritt mit <strong>echtem UI-Label</strong>.</li>
    </ol>
    <!-- optional: Diagramm, Screenshot-Platzhalter, Hinweis-Callout -->
  </section>
  ```

- **Screenshot-Platzhalter (Muster):**

  ```html
  <figure class="hb-shot" role="img" aria-label="Screenshot folgt">
    <div class="hb-shot__placeholder">📷 Screenshot folgt: &lt;kurze Beschreibung&gt;</div>
    <figcaption>Was das Bild zeigen wird.</figcaption>
  </figure>
  ```

- **Offener-Fakt-Callout (Muster, für die zwei ungeklärten Inhalte):**

  ```html
  <p class="hb-todo">⚠️ <strong>Noch zu ergänzen:</strong> &lt;Frage an den Betreiber&gt;.</p>
  ```

- **Commit-Regel (geteilter Working Tree!):** Vor jedem Commit `git status`
  laufen lassen. **Nur selbst berührte Dateien per expliziten Pfad stagen**,
  fremde modifizierte/untracked Dateien (z.B. `js/territory/territory-wiki-tree.js`)
  in Ruhe lassen. Kein `git add -A`/`.`/`-a`. Direkt auf `master`. Conventional-
  Commit-Präfixe. Commit-Message endet mit
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Bei abgelehntem Push:
  `fetch` + `rebase origin/master` (autostash), nie force-pushen.

---

## Dateistruktur

- **Neu:** `html/editor-handbuch.html` — die komplette Handbuchseite
  (HTML + inline `<style>` + inline SVG). Eine Datei, eine Verantwortung.
- **Ändern:** `css/layout/map-layout.css` — eine Regel `.map-data-status a { … }`.
- **Ändern:** `js/routing/routing.js` — in `updateMapDataStatus()` (~Z210–222) den
  Tutorial-Link anhängen.
- **Neu (Verifikation):** `.claude/launch.json` — statischer Server für die
  Vorschau (nur falls noch nicht vorhanden; nicht committen, wenn `.claude/` schon
  von einer anderen Session verwaltet wird — dann nur lokal nutzen).

---

## Task 1: Seitengerüst, Styles, Navigation, Zurück-Link

**Files:**
- Create: `html/editor-handbuch.html`
- (Verifikation) evtl. Create: `.claude/launch.json`

**Interfaces:**
- Produces: die Section-IDs `#a`…`#h`, die CSS-Klassen `hb-section`, `hb-lead`,
  `hb-steps`, `hb-shot`, `hb-todo`, `hb-diagram`, sowie das feste TOC-Grid. Alle
  Folge-Tasks füllen nur Abschnittskörper und ändern das Gerüst nicht.

- [ ] **Schritt 1: Grundgerüst mit inline-Styles anlegen**

Erzeuge `html/editor-handbuch.html` mit dieser vollständigen Basis (Abschnitts-
körper A–H bleiben zunächst leer bis auf `<h2>`; Inhalte kommen in Task 2–7):

```html
<!DOCTYPE html>
<html lang="de">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Avesmaps · Editor-Handbuch</title>
	<meta name="robots" content="noindex" />
	<style>
		:root {
			--hb-bg: #f7f5f0; --hb-fg: #23201b; --hb-muted: #6b6459;
			--hb-accent: #7a5c2e; --hb-line: #e2dccf; --hb-card: #fffdf8;
			--hb-max: 1180px;
		}
		* { box-sizing: border-box; }
		body { margin: 0; background: var(--hb-bg); color: var(--hb-fg);
			font: 16px/1.6 system-ui, "Segoe UI", Roboto, sans-serif; }
		a { color: var(--hb-accent); }
		.hb-topbar { display: flex; justify-content: space-between; align-items: center;
			gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--hb-line);
			background: var(--hb-card); position: sticky; top: 0; z-index: 10; }
		.hb-topbar a.hb-back { font-weight: 600; text-decoration: none; }
		.hb-wrap { max-width: var(--hb-max); margin: 0 auto; padding: 24px 20px 80px;
			display: grid; grid-template-columns: 240px 1fr; gap: 40px; }
		.hb-toc { position: sticky; top: 72px; align-self: start; font-size: 14px; }
		.hb-toc ol { list-style: none; margin: 0; padding: 0; }
		.hb-toc a { display: block; padding: 6px 8px; border-radius: 6px;
			text-decoration: none; color: var(--hb-muted); }
		.hb-toc a:hover { background: var(--hb-line); color: var(--hb-fg); }
		.hb-main h1 { margin: 0 0 4px; font-size: 30px; }
		.hb-section { padding: 28px 0; border-top: 1px solid var(--hb-line); scroll-margin-top: 76px; }
		.hb-section > h2 { font-size: 22px; margin: 0 0 10px; }
		.hb-lead { color: var(--hb-muted); margin-top: 0; }
		.hb-steps { padding-left: 22px; }
		.hb-steps li { margin: 6px 0; }
		.hb-shot { margin: 16px 0; }
		.hb-shot__placeholder { border: 2px dashed var(--hb-line); border-radius: 10px;
			padding: 28px; text-align: center; color: var(--hb-muted); background: var(--hb-card); }
		.hb-shot figcaption { font-size: 13px; color: var(--hb-muted); margin-top: 6px; }
		.hb-todo { border-left: 4px solid #c9a227; background: #fbf6e3; padding: 10px 14px; border-radius: 4px; }
		.hb-diagram { margin: 18px 0; background: var(--hb-card); border: 1px solid var(--hb-line);
			border-radius: 10px; padding: 14px; overflow-x: auto; }
		.hb-diagram svg { max-width: 100%; height: auto; display: block; }
		@media (max-width: 820px) { .hb-wrap { grid-template-columns: 1fr; }
			.hb-toc { position: static; } }
	</style>
</head>
<body>
	<div class="hb-topbar">
		<strong>Avesmaps · Editor-Handbuch</strong>
		<a class="hb-back" href="https://avesmaps.de/edit/">← Zurück zur Karte</a>
	</div>
	<div class="hb-wrap">
		<nav class="hb-toc" aria-label="Inhalt">
			<ol>
				<li><a href="#a">A. Grundlagen &amp; erste Schritte</a></li>
				<li><a href="#b">B. Karten-Features bearbeiten</a></li>
				<li><a href="#c">C. Mit dem Wiki verknüpfen</a></li>
				<li><a href="#d">D. Herrschaftsgebiete</a></li>
				<li><a href="#e">E. WikiSync</a></li>
				<li><a href="#f">F. Meldungen &amp; Community</a></li>
				<li><a href="#g">G. Spezial-Workflows</a></li>
				<li><a href="#h">H. Regeln &amp; Fallstricke</a></li>
			</ol>
		</nav>
		<main class="hb-main">
			<h1>Editor-Handbuch</h1>
			<p class="hb-lead">Willkommen im Editor-Team von Avesmaps. Diese Seite erklärt Schritt für Schritt, wie und wo du was machst.</p>
			<section id="a" class="hb-section"><h2>A. Grundlagen &amp; erste Schritte</h2></section>
			<section id="b" class="hb-section"><h2>B. Karten-Features bearbeiten</h2></section>
			<section id="c" class="hb-section"><h2>C. Mit dem Wiki verknüpfen</h2></section>
			<section id="d" class="hb-section"><h2>D. Herrschaftsgebiete (Territoriumseditor)</h2></section>
			<section id="e" class="hb-section"><h2>E. WikiSync</h2></section>
			<section id="f" class="hb-section"><h2>F. Meldungen &amp; Community</h2></section>
			<section id="g" class="hb-section"><h2>G. Spezial-Workflows</h2></section>
			<section id="h" class="hb-section"><h2>H. Regeln, Etikette &amp; Fallstricke</h2></section>
		</main>
	</div>
</body>
</html>
```

- [ ] **Schritt 2: Statischen Vorschau-Server sicherstellen**

Falls `.claude/launch.json` fehlt, lege einen statischen Server an (PHP ist im
Projekt vorhanden):

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "static", "runtimeExecutable": "php", "runtimeArgs": ["-S", "127.0.0.1:8137", "-t", "."], "port": 8137 }
  ]
}
```

Dann `preview_start` mit `name: "static"`.

- [ ] **Schritt 3: Rendern verifizieren**

`preview_eval`: `window.location.href = "http://127.0.0.1:8137/html/editor-handbuch.html"`,
dann `preview_snapshot`. Erwartet: Titel „Editor-Handbuch", 8 TOC-Einträge,
8 Abschnitts-Überschriften A–H. `preview_console_logs` (level `error`): leer.

- [ ] **Schritt 4: Navigation + Zurück-Link prüfen**

`preview_click` auf den TOC-Link `a[href="#d"]`, dann `preview_eval`:
`location.hash` → erwartet `#d`. `preview_inspect` auf `a.hb-back` → `href` ist
`https://avesmaps.de/edit/`.

- [ ] **Schritt 5: Commit**

```bash
git -C /c/GIT/avesmaps status --short
git -C /c/GIT/avesmaps add html/editor-handbuch.html
git -C /c/GIT/avesmaps commit -m "feat(edit): scaffold editor handbook page (nav, styles, sections)"
```

(`.claude/launch.json` nur committen, wenn `.claude/` nicht bereits fremd
verwaltet ist — sonst lokal lassen.)

---

## Task 2: Abschnitt A — Grundlagen & erste Schritte (+ SVG „Rollen & Rechte")

**Files:**
- Modify: `html/editor-handbuch.html` (Körper von `<section id="a">`)

**Quellen für exakte Labels (erst lesen, dann schreiben):**
- `edit/index.php` — Login-Seite: Felder „Benutzername"/„Passwort", Button
  „Anmelden"; nach Login Edit-Shell mit „Abmelden"; iframe lädt
  `../index.html?debugMap=1&edit=1`.
- `index.html` ~Z280–446 — Editor-Panel `#review-panel`, Reiter „Meldungen",
  „Änderungen", „WikiSync", „Status"; Toggle-Button „Editor" (`#review-panel-toggle`).
- `index.html` ~Z252 — Kontextmenü-Eintrag „Territoriumseditor öffnen".
- `api/_internal/auth.php` ~Z76–105 — Rollen `admin`/`editor`/`reviewer`,
  Capabilities `edit` (admin+editor), `review` (admin+editor+reviewer).

**Interfaces:**
- Produces: `<svg>` mit Klasse in `.hb-diagram` (Diagramm „Rollen & Rechte") und
  den Anker `#a`-Inhalt.

- [ ] **Schritt 1: Genannte Quelldateien lesen** und die exakten Labels notieren
  (nichts erfinden).

- [ ] **Schritt 2: Abschnitt A schreiben** — Inhalt (dem Abschnitts-Markup-Muster
  aus den Globalen Rahmenbedingungen folgend), mindestens:
  1. Was ein Editor tut + die goldenen Regeln (Wiki Aventurica ist maßgeblich;
     kleine, sorgfältige Schritte; im Zweifel fragen).
  2. **Zugang bekommen** — `hb-todo`-Callout: „⚠️ Noch zu ergänzen: wie du
     Benutzername/Passwort erhältst (E-Mail/Discord)." (offener Fakt §8.1 der Spec).
  3. **Anmelden** — nummerierte Schritte: `avesmaps.de/edit/` öffnen →
     Benutzername/Passwort → „Anmelden"; danach die Edit-Shell (Name | Rolle,
     „Abmelden"), Karte im iframe.
  4. **Orientierung** — Karte, „Editor"-Panel + die vier Reiter, Rechtsklick-
     Kontextmenü. Je ein Screenshot-Platzhalter für Login und Editor-Panel.
  5. **Rollen** — editor/reviewer/admin und wer was darf, mit dem SVG darunter.

- [ ] **Schritt 3: SVG „Rollen & Rechte" einfügen** — ein `<div class="hb-diagram">`
  mit inline `<svg viewBox="0 0 640 200">`: drei Spalten (editor, reviewer, admin)
  und welche Capability (`edit`, `review`, `admin`) sie haben; Farben über die
  `--hb-*`-Variablen bzw. `currentColor`. Vollständig statisch, keine externen Assets.

- [ ] **Schritt 4: Verifizieren** — `preview_eval` reload, `preview_snapshot`:
  Abschnitt A hat Login-Schritte, Rollen-Text, das `hb-todo`; `preview_inspect`
  auf `#a .hb-diagram svg` existiert. `preview_console_logs` error: leer.

- [ ] **Schritt 5: Commit**

```bash
git -C /c/GIT/avesmaps add html/editor-handbuch.html
git -C /c/GIT/avesmaps commit -m "docs(edit): handbook section A (getting started, roles diagram)"
```

---

## Task 3: Abschnitt B — Karten-Features bearbeiten (+ SVG „Bearbeiten-Klick-Fluss")

**Files:**
- Modify: `html/editor-handbuch.html` (Körper von `<section id="b">`)

**Quellen für exakte Labels:**
- `index.html` Dialoge: `#location-edit-dialog` (~Z559), `#path-edit-dialog`
  (~Z745), `#powerline-edit-dialog` (~Z800), `#label-edit-dialog` (~Z825),
  `#region-edit-dialog` (~Z898) — exakte Feldnamen/Buttons.
- `js/map-features/map-features-location-editing.js`,
  `map-features-path-geometry-editing.js`, `map-features-region-edit-handles.js`,
  `map-features-region-edit-ops.js` — wie platzieren/ziehen/Vertices einfügen/löschen.
- `js/review/review-panels-change-log.js` — „Änderungen"-Reiter (Audit-Log).
- Siedlungstyp-Slugs: `metropole`, `grossstadt`, `stadt`, `kleinstadt`, `dorf`,
  `gebaeude` (AGENTS.md §2) — mit ihren deutschen Anzeige-Labels.

- [ ] **Schritt 1: Quelldateien lesen**, exakte Feld-/Button-Labels und die reale
  Klick-/Zieh-Sequenz je Feature-Typ notieren.

- [ ] **Schritt 2: Abschnitt B schreiben** — je eine Unter-Überschrift (`<h3>`)
  mit nummerierten Schritten für: Orte/Siedlungen (anlegen, verschieben, Typ,
  Eigenschaften, Wappen), Wege/Flüsse/Straßen (Geometrie-Handles: ziehen,
  einfügen, löschen; Subtyp; Name/Label), Kraftlinien, Labels, Regionen. Dazu:
  Speichern vs. Verwerfen, und der „Änderungen"-Reiter als Audit. Mindestens zwei
  Screenshot-Platzhalter (Ort-Dialog, Wege-Geometrie).

- [ ] **Schritt 3: SVG „Bearbeiten-Klick-Fluss" einfügen** — inline `<svg>` in
  `.hb-diagram`: Kette „Rechtsklick → Kontextmenü → Dialog → Speichern → Änderungen
  (Audit)" als fünf verbundene Kästen.

- [ ] **Schritt 4: Verifizieren** — reload, `preview_snapshot`: Unter-Überschriften
  für alle fünf Feature-Typen vorhanden, SVG in `#b`. Konsole error: leer.

- [ ] **Schritt 5: Commit**

```bash
git -C /c/GIT/avesmaps add html/editor-handbuch.html
git -C /c/GIT/avesmaps commit -m "docs(edit): handbook section B (map features, edit-flow diagram)"
```

---

## Task 4: Abschnitt C — Mit dem Wiki verknüpfen

**Files:**
- Modify: `html/editor-handbuch.html` (Körper von `<section id="c">`)

**Quellen für exakte Labels:**
- `js/review/review-settlement-wiki.js`, `review-path-wiki.js`,
  `review-label-wiki.js` — Wiki-Picker-Flüsse.
- `js/app/share-link.js` und `docs/superpowers/plans/2026-07-06-link-teilen-ueberall.md`
  — „Link teilen" (bevorzugt Wiki-Link).
- Spotlight-Suche: `js/ui/` (Spotlight-Dialog `#spotlight-search-dialog` in
  `index.html` ~Z273) und Policy in `docs/`/Memory (nur wiki-verlinkte Wege
  suchbar).

- [ ] **Schritt 1: Quelldateien lesen**, Picker-Buttons und die „Link teilen"-
  Bezeichnung wörtlich notieren.

- [ ] **Schritt 2: Abschnitt C schreiben** — warum verknüpfen (Wiki = Wahrheit),
  dann nummerierte Abläufe: Siedlung ↔ Wiki-Seite, Weg/Fluss/Straße ↔ Wiki
  (Namensregeln: Zuweisen/Ändern = exakte Namensgruppe, Entfernen = weg-weit),
  Label ↔ Wiki, „Link teilen", Spotlight-Suche. Ein Screenshot-Platzhalter
  (Wiki-Picker).

- [ ] **Schritt 3: Verifizieren** — reload, `preview_snapshot`: Abschnitt C hat die
  Verknüpfungs-Abläufe. Konsole error: leer.

- [ ] **Schritt 4: Commit**

```bash
git -C /c/GIT/avesmaps add html/editor-handbuch.html
git -C /c/GIT/avesmaps commit -m "docs(edit): handbook section C (wiki linking)"
```

---

## Task 5: Abschnitt D — Herrschaftsgebiete (+ SVG „Territorien-Hierarchie")

**Files:**
- Modify: `html/editor-handbuch.html` (Körper von `<section id="d">`)

**Quellen für exakte Labels:**
- `index.html` ~Z252/263–269 — Kontextmenü „Territoriumseditor öffnen",
  Overlay `#political-territory-editor-overlay`, Titel „Territoriumseditor".
- `docs/territories.md`, `docs/political-territory-editor.md`,
  `js/territory/*` — Hierarchie/Breadcrumb, Geometrie, Zoom-Bänder, Hauptstädte,
  Gültigkeit, abgeleitete Außengrenzen.
- AGENTS.md §2 — Rangbegriffe *Reich/Grafschaft/Baronie*, *BF*-Kalender,
  `9999` = offen; *umstrittene Gebiete* = Schraffur.

- [ ] **Schritt 1: Quelldateien lesen**, Editor-Beschriftungen und Feldnamen notieren.

- [ ] **Schritt 2: Abschnitt D schreiben** — Öffnen per Rechtsklick →
  „Territoriumseditor öffnen"; dann Unter-Abschnitte: Hierarchie/Breadcrump
  (Eltern-Kind), Geometrie, Zoom-Bänder/`min_zoom`, Hauptstädte, Gültigkeit
  (BF-Jahre, `9999` = offen), abgeleitete Außengrenzen, umstrittene Gebiete
  (Schraffur). Ein Screenshot-Platzhalter (Territoriumseditor).

- [ ] **Schritt 3: SVG „Territorien-Hierarchie" einfügen** — inline `<svg>` in
  `.hb-diagram`: Baum Reich → Grafschaft → Baronie (über `parent_id`), drei Ebenen
  mit Verbindungslinien.

- [ ] **Schritt 4: Verifizieren** — reload, `preview_snapshot`: Abschnitt D +
  Hierarchie-SVG vorhanden. Konsole error: leer.

- [ ] **Schritt 5: Commit**

```bash
git -C /c/GIT/avesmaps add html/editor-handbuch.html
git -C /c/GIT/avesmaps commit -m "docs(edit): handbook section D (territories, hierarchy diagram)"
```

---

## Task 6: Abschnitte E & F — WikiSync + Meldungen & Community

**Files:**
- Modify: `html/editor-handbuch.html` (Körper von `<section id="e">` und `<section id="f">`)

**Quellen für exakte Labels:**
- `index.html` ~Z326–427 — WikiSync-Abschnitt, Button „WikiSync & Editor"
  (`#wiki-sync-territories`), Fall-Status-Tabs; `#wiki-sync-territory-tree`.
- `js/review/review-wiki-sync.js`, `review-wiki-sync-cases.js`,
  `review-wiki-sync-resolve.js` — Lauf starten, Fälle auflösen.
- `index.html` ~Z293–322 (Meldungen), ~Z430–438 (Status/Präsenz,
  `#editor-activity-figures`); `js/review/review-locations.js`,
  `review-visitor-analytics.js`.

- [ ] **Schritt 1: Quelldateien lesen** (WikiSync + Meldungen/Status), Labels notieren.

- [ ] **Schritt 2: Abschnitt E (WikiSync) schreiben** — was es tut (crawlen →
  Staging → Fälle), Lauf starten, Fälle prüfen/auflösen, kurz Dump-vs-API-Politik.

- [ ] **Schritt 3: Abschnitt F (Meldungen & Community) schreiben** — Meldungen-
  Reiter abarbeiten, Bewertungen/Reviews, Status/Präsenz (wer bearbeitet gerade).

- [ ] **Schritt 4: Verifizieren** — reload, `preview_snapshot`: Abschnitte E und F
  gefüllt. Konsole error: leer.

- [ ] **Schritt 5: Commit**

```bash
git -C /c/GIT/avesmaps add html/editor-handbuch.html
git -C /c/GIT/avesmaps commit -m "docs(edit): handbook sections E and F (wikisync, reports)"
```

---

## Task 7: Abschnitte G & H — Spezial-Workflows + Regeln & Fallstricke

**Files:**
- Modify: `html/editor-handbuch.html` (Körper von `<section id="g">` und `<section id="h">`)

**Quellen für exakte Labels:**
- Spezial-Workflows (Pläne/Memory): `docs/superpowers/plans/2026-07-05-flussrichtung.md`
  + `2026-07-06-flussrichtung-set-dir-anker`, `2026-07-05-way-labels.md`,
  `docs/refactoring-strassen-wiki-zuweisung.md` (+ Memory „Straßen-Bulk-Hopping"),
  `docs/refactoring-verlauf-sync.md`.
- Regeln: AGENTS.md §9 (Konventionen), §2 (Domänenbegriffe), Memory-Regeln
  (Wiki = Wahrheit; kleine Schritte; teure Endpoints nicht loopen).

- [ ] **Schritt 1: Quellen lesen**, die reale Bedienung je Spezial-Workflow notieren.

- [ ] **Schritt 2: Abschnitt G (Spezial-Workflows) schreiben** — kurze,
  aufgabenorientierte Abläufe für: Flussrichtung setzen, Weg-Namen-Labels,
  Straßen-Wiki-Zuweisung (Bulk-Verfahren), Verlauf-Sync.

- [ ] **Schritt 3: Abschnitt H (Regeln & Fallstricke) schreiben** — Wiki = Wahrheit;
  kleine Schritte; was man NICHT tut (fremde Arbeit nicht löschen, nicht blind
  massenhaft ändern); **Hilfe-Kontakt** als `hb-todo`-Callout: „⚠️ Noch zu
  ergänzen: wohin bei Fragen (Discord/`info@`)." (offener Fakt §8.2 der Spec).

- [ ] **Schritt 4: Verifizieren** — reload, `preview_snapshot`: Abschnitte G und H
  gefüllt, das `hb-todo` in H vorhanden. Konsole error: leer.

- [ ] **Schritt 5: Commit**

```bash
git -C /c/GIT/avesmaps add html/editor-handbuch.html
git -C /c/GIT/avesmaps commit -m "docs(edit): handbook sections G and H (special workflows, rules)"
```

---

## Task 8: „Tutorial"-Link in der Editor-Statuszeile verdrahten

**Files:**
- Modify: `css/layout/map-layout.css` (nach dem `.map-data-status`-Block, ~Z87)
- Modify: `js/routing/routing.js` (`updateMapDataStatus()`, ~Z219–221)

**Interfaces:**
- Consumes: die deployte Seite unter `https://avesmaps.de/html/editor-handbuch.html`
  (Tasks 1–7).

- [ ] **Schritt 1: CSS-Regel ergänzen** in `css/layout/map-layout.css` direkt nach
  dem bestehenden `.map-data-status[hidden]`-Block:

```css
.map-data-status a {
	pointer-events: auto;
	color: inherit;
	text-decoration: underline;
}
```

- [ ] **Schritt 2: Link in `updateMapDataStatus()` anhängen.** Ersetze in
  `js/routing/routing.js` den Block (~Z219–221)

```js
	$("#map-data-status")
		.text(`Map: ${mapDataSourceStatus.label} | Rev ${revisionText} | ${mapDataSourceStatus.featureCount.toLocaleString("de-DE")} Features`)
		.prop("hidden", false);
```

durch

```js
	$("#map-data-status")
		.text(`Map: ${mapDataSourceStatus.label} | Rev ${revisionText} | ${mapDataSourceStatus.featureCount.toLocaleString("de-DE")} Features | `)
		.append(
			$("<a>", {
				href: "https://avesmaps.de/html/editor-handbuch.html",
				target: "_blank",
				rel: "noopener",
				text: "Tutorial",
			})
		)
		.prop("hidden", false);
```

(`. text()` leert Kinder und escaped die dynamischen Werte; das `<a>` wird als
separates Element angehängt — keine HTML-Injektion. Wiederholte Aufrufe sind
idempotent, weil `.text()` zuerst leert.)

- [ ] **Schritt 3: Statisch prüfen (soweit ohne Backend möglich).** Lies die
  geänderten Zeilen zurück; bestätige, dass die Template-Literale und die Kette
  `.text().append().prop()` syntaktisch korrekt sind. (Die Statuszeile füllt sich
  nur mit Backend-Daten; ein voller Live-Test folgt nach Deploy.)

- [ ] **Schritt 4: Commit**

```bash
git -C /c/GIT/avesmaps status --short
git -C /c/GIT/avesmaps add css/layout/map-layout.css js/routing/routing.js
git -C /c/GIT/avesmaps commit -m "feat(edit): link editor handbook from map-data status line"
```

- [ ] **Schritt 5: Push + Deploy + Live-Check.** `git -C /c/GIT/avesmaps push`,
  Remote-SHA prüfen, ~1–2 min Deploy abwarten, dann auf `avesmaps.de/edit/`
  anmelden, Editor-Panel öffnen und bestätigen: Statuszeile endet mit „| Tutorial",
  Klick öffnet `html/editor-handbuch.html` in neuem Tab; für nicht angemeldete
  Besucher bleibt die Zeile unsichtbar.

---

## Selbst-Review (Plan gegen Spec)

**1. Spec-Abdeckung:**
- Spec §3 (Format: eigenständige HTML-Seite, öffentlich, Zurück-Link) → Task 1. ✔
  (Abweichung: inline `<style>` statt separatem Stylesheet — bewusst, hält die Seite
  self-contained und erspart `?v=`-Stempelung; Spec §7 damit gegenstandslos für die
  Seite selbst.)
- Spec §4 Abschnitte A–H → Tasks 2–7. ✔
- Spec §5 (Tutorial-Link, CSS `pointer-events`, `.text()`+`.append()`, absolute URL,
  neuer Tab) → Task 8. ✔
- Spec §6 (text-first, Screenshot-Platzhalter, 3 SVG-Diagramme) → Muster in Globalen
  Rahmenbedingungen; Diagramme in Tasks 2/3/5. ✔
- Spec §8 (zwei offene Fakten als Platzhalter) → `hb-todo` in Task 2 (Zugang) und
  Task 7 (Hilfe-Kontakt). ✔
- Spec §9 Definition of Done → durch die Verifikationsschritte + Task 8 Live-Check
  abgedeckt. ✔

**2. Platzhalter-Scan:** Keine „TBD/TODO" als Plan-Lücken. Die zwei `hb-todo`-
Callouts sind bewusste, spec-getriebene Inhalts-Platzhalter (offene Owner-Fakten),
kein Planungsversäumnis.

**3. Typ-/Namenskonsistenz:** Section-IDs `#a`…`#h` und die `hb-*`-Klassen aus
Task 1 werden in Tasks 2–7 unverändert verwendet. Die `routing.js`-Kette
`.text().append().prop()` und die CSS-Klasse `.map-data-status a` sind in Task 8
konsistent. ✔

---

## Ausführungs-Übergabe

Nach dem Speichern des Plans: Ausführungsweg wählen (siehe Chat-Antwort).

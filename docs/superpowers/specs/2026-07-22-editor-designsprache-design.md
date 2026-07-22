# Gemeinsame Designsprache der fünf Editoren (Design)

**Datum:** 2026-07-22 · **Auftraggeber:** Owner · **Maßstab:** `docs/design-language.md`,
AGENTS.md §12 · **Status:** Entwurf am lebenden Muster abgestimmt
(`verify-editor-shell.html`), Owner: „ich glaube jetzt haben wir eine gemeinsame
Designsprache"

---

## 1. Ausgangslage

Fünf Editoren, die dasselbe tun und fünfmal anders aussehen:

| Editor | Einstieg | Dialog |
|---|---|---|
| Siedlungen | `html/wiki-sync-settlement-editor.html` | „Siedlungen synchronisieren und editieren" |
| Territorien | `html/political-territory-editor.html` + `css/pages/political-territory-editor*.css` | „Herrschaftsgebiete synchronisieren und editieren" |
| Abenteuer | `html/adventure-editor.html` | „Abenteuer anlegen und editieren" |
| Karten | `html/citymap-editor.html` | „Kartensammlung anlegen und editieren" |
| Natur & Waren | Section, per JS in einen Dialog umgezogen | „Natur & Waren" |

Regionen und Wege haben keinen Editor — die Benennung hält ihnen einen Platz frei.

### 1.1 Fünf Typografie-Dialekte

| Editor | Schriftgrößen | Tokens |
|---|---|---|
| Abenteuer | `var(--font-size-*)` | ✅ vorbildlich |
| Karten | Tokens, 1× `10px` | ✅ fast |
| Siedlungen | `10 / 11 / 12 / 13 / 15 / 17 / 18px` hart | ❌ keine |
| Natur & Waren | `0.8 / 0.85 / 0.9 / 0.95 / 1.3rem` | ❌ eigener rem-Dialekt |
| Territorien | `9px … 22px`, **`10pt`**, `0.78em` | ❌ schlimmster Fall |

Farben sind dagegen bereits tokenisiert (Stufe-4-Theme-Migration) — das Problem ist
Struktur, Typografie und Rhythmus, nicht die Palette.

### 1.2 Die Hülle existiert, aber sie lügt über ihren Namen

Alle vier großen Editoren bauen dieselbe Overlay-Hülle mit den Klassen
`political-territory-editor-*` (`js/review/review-settlement-list.js:479`) — also
benutzen Siedlungen, Abenteuer und Karten den Rahmen des Territorien-Editors. Die
**Maße stehen als JS-Inline-Style, viermal wortgleich** kopiert:

```js
dialog.style.width  = "min(1400px, calc(100vw - 24px))";
dialog.style.height = "min(880px, calc(100vh - 24px))";
```

`review-settlement-list.js:482,536,605` und `review-wiki-sync.js:2306`. Kein
Stylesheet erreicht sie. Dazu zwei Beinah-Dubletten:
`css/components/edit-overlays.css` wiederholt `dialog-overlays.css` fast
vollständig, und `political-territory-editor-inline.css` ist ein Zwilling von
`political-territory-editor.css`.

### 1.3 Die Knopfleiste reserviert Platz für nichts

`.wiki-sync-panel__actions` (`css/features/review-panel.css:428`) ist ein Raster
mit **fest zwei Spalten**:

```css
grid-template-columns: minmax(0, 2fr) minmax(120px, 1fr);
gap: var(--space-16);
```

Die zweite Spalte gehört dem „Zuletzt gesynct"-Span. Der startet `hidden` und wird
erst sichtbar, wenn ein Netzabruf zurückkommt; schlägt der fehl, loggt der `catch`
nur eine Warnung (`review-wiki-sync.js:618`). **Ein explizites Raster legt seine
Spuren unabhängig davon an, ob das Kind `display:none` ist.** Ergebnis: jeder
Editor-Knopf steht dauerhaft auf ⅔ Breite, rechts daneben eine leere 120px-Spalte
plus 18px Lücke. Beim Laden immer, bei Netzfehler dauerhaft.

### 1.4 Fünf Schreibweisen für „von Hand geändert"

| Ort | „manuell" heißt dort | Zurücksetzen |
|---|---|---|
| Territorien | `Lizenz unbekannt → Gemeinfrei`, alt durchgestrichen | Knopf `↺ Wappen zurücksetzen` |
| Abenteuer, Karten | goldene Pille `manuell` | — |
| Quellen | Gruppe „AUS DEM WIKI (AUTOMATISCH)" + Pille `fest` | — |
| Natur & Waren | kursiv `von Hand` | **Feld leeren** |
| WikiSync-Monitor | Pille `✎ manuell` | leere Option „— (Wiki)" |

Fünf Vokabeln, drei verschiedene Wege zurück.

---

## 2. Benennung

**Regel:** Der Knopf nennt das Subjekt, nicht die Maschinerie. **Dialogtitel und
Knopf sind wortgleich.** Ein Substantiv je Domäne, aus dem Glossar (AGENTS.md §2).

| Reiter | Knopf **und** Dialogtitel |
|---|---|
| Siedlungen | **Siedlungen bearbeiten** |
| Territorien | **Territorien bearbeiten** |
| Abenteuer | **Abenteuer bearbeiten** |
| Karten | **Karten bearbeiten** |
| Natur & Waren | **Natur & Waren bearbeiten** |
| Regionen | **Regionen bearbeiten** (sobald es ihn gibt) |
| Wege | **Wege bearbeiten** (sobald es ihn gibt) |

Begründung: der Tooltip des Natur-&-Waren-Knopfs gibt es selbst zu — *„Startet
NICHTS: Syncen und Bearbeiten passieren erst im Fenster."* Die Knöpfe **öffnen ein
Fenster**; sie syncen nicht. Sie waren nach zwei Tätigkeiten benannt, die sie nicht
ausführen. „Syncen" verschwindet vom Knopf, nicht aus dem Produkt — die Sync-Kachel
und „Zuletzt gesynct" bleiben im Menüband.

**Owner-Entscheide (nicht neu verhandeln):**
- **„Territorien", nicht „Herrschaftsgebiete"** — kürzer, frisst weniger Platz.
  Gilt für **Beschriftungen**; erklärender Fließtext in Doku und Handbuch darf
  „Herrschaftsgebiete" behalten.
- **„Karten", nicht „Kartensammlung"** — passend zum Reiter.

**Mitzuziehen:** 5 Knopfbeschriftungen in `index.html`, 4 Dialogtitel
(`headingEl.textContent` in `review-settlement-list.js:487,541,610` und
`review-wiki-sync.js:2311`), 6 Fundstellen in `html/editor-handbuch.html`
(+ `Stand:`-Datum, AGENTS.md §9).

---

## 3. Die Hülle

Neu: **`css/components/editor-shell.css`**, Präfix `avm-`. Die lügenden
`political-territory-editor-*`-Klassen entfallen, die JS-Inline-Maße wandern
hierher (**eine** Definition statt vier Kopien), die beiden Dubletten aus §1.2
werden gelöscht.

### 3.1 Aufbau, von oben nach unten

```
┌────────────────────────────────────────────────────────────┐
│ Titelzeile      „Siedlungen bearbeiten"                  ✕ │
├────────────────────────────────────────────────────────────┤
│ Menüband        6 Kacheln, ALLE gleich breit, volle Breite │
├────────────────────────────────────────────────────────────┤
│ Statuszeile     „Bereit."                                  │
├────────────────────────────────────────────────────────────┤
│ [Reiterzeile]   optional — heute nur Natur & Waren         │
├──────────────┬──────────────┬──────────────────────────────┤
│  Spalte 1    │  Spalte 2    │  Spalte 3                    │
│  gleich      │  gleich      │  gleich                      │
├──────────────┴──────────────┴──────────────────────────────┤
│ Fußzeile        Löschen · Verwerfen · Speichern             │
└────────────────────────────────────────────────────────────┘
```

Maße: `width: min(1400px, calc(100vw - 24px))`,
`height: min(880px, calc(100vh - 24px))`, `--radius-sm`, `--shadow-dialog`.

**Die Titelzeile bleibt getrennt vom Menüband.** Eine echte Verschmelzung ginge über
die iframe-Grenze (Titel im Hauptdokument, Menüband im iframe) und gehört zum
De-iframe-Umbau, nicht hierher.

### 3.2 Drei gleiche Spalten — verbindlich

```css
.avm-body { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
```

Alle fünf Editoren **sind** dreispaltig (im Code geprüft, nicht aus Screenshots
geschlossen — Natur & Waren zeigt seine Spalten 2+3 erst mit ausgewähltem Eintrag,
`.lore-detail__cols` in `review-wiki-sync.js:2066`):

| Editor | 1 | 2 | 3 |
|---|---|---|---|
| Siedlungen | Territorien | Siedlungen | Eigenschaften |
| Territorien | Offene Lücken | Hierarchiemodell | Wiki-Daten & Overrides |
| Abenteuer | Liste | Stammdaten | Orte |
| Karten | Liste | Stammdaten | Orte |
| Natur & Waren | Liste | Stammdaten + Quellen | Verbundene Orte |

Jede Spalte trägt einen Titel (`--font-size-subhead`, `--color-accent-strong`).

**Nicht Teil dieser Spec:** die *Rolle* der dritten Spalte unterscheidet sich
(Eigenschaften vs. verbundene Orte). Gleich wird die **Breite**, nicht die
Reihenfolge — die bleibt, wie Editoren sie kennen.

### 3.3 Menüband — alle Kacheln gleich breit

```css
.avm-ribbon { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
```

Vorbild Siedlungen/Territorien (volle Breite, gleiche Kacheln); Abenteuer, Karten
und Natur & Waren ziehen nach. Die Kachel selbst erbt `.ae-btn2`/`.ce-btn2`
unverändert: zweizeilig (`.t1` fett, `.t2` gedämpft), **nur die Sync-Kachel trägt
ein Icon (🚨)** und `--primary` — Owner-Entscheid aus der Menüband-Session
2026-07-17, nicht neu verhandeln.

### 3.4 Statuszeile

Eigene Zeile **unter dem Menüband**, volle Breite (Vorbild Siedlungeneditor,
Owner: „find ich ok"). Gilt in allen Editoren.

### 3.5 Reihenfolge in der Eigenschaften-Spalte

**Wappen (falls vorhanden) → Bilder → Identität → Rest → Quellen.** Fehlt das
Wappen, rücken die übrigen auf; die Folge bleibt. Gilt in jedem Editor.

---

## 4. Die Regeln

### 4.1 Typografie — eine Leiter

| Rolle | Token | px |
|---|---|---|
| Dialogtitel | `--font-size-title` | 20 |
| Spaltentitel, Detail-Überschrift | `--font-size-subhead` | 16 |
| Eingabefelder, Fließtext | `--font-size-reading` | 14 |
| Bedienelemente, Knöpfe, Listenzeilen | `--font-size-body` | 13 |
| Gruppentitel (versal), Meta, Zähler, Abzeichen | `--font-size-caption` | 11 |

Es entfallen: `9px`, `10px`, `10pt`, `0.78em`, `0.8rem`, `0.85rem`, `15px`, `17px`,
`18px`, `22px` — und **`font-weight: 600`** (`review-panel.css:474`,
`lore.css`, `feature-sources.css`); es gibt nur 400 und 700.

### 4.2 Abstände, Radien, Trenner

Alles aus der Spacing-Skala. Radius nur `--radius-sm` (Hülle) und `--radius-md`
(alle Bedienelemente); `6px` und `1.5px`-Rahmen entfallen. `--color-divider`
innerhalb eines Panels, `--color-border` an Kanten, **genau eine** Linie je
Abschnitt, symmetrische Abstände darum.

**Ausnahme, bewusst:** runde Abzeichen und der ✕-Knopf behalten `999px`
(Owner-Vorlage Quellenblock; Kreise sind ohnehin ausgenommen). `docs/design-language.md`
bekommt diese Ausnahme eingetragen, statt eine Optik zu „korrigieren", die der
Owner als Vorbild benannt hat.

### 4.3 Bedienelemente — eine Höhe

Suchfeld, Knopf, Eingabe, Auswahl teilen `--avm-control-h` (32px breit, 40px
schmal). Gemessen: alle vier auf 32.

### 4.4 Filter

Alle Filter eines Editors gehören in **ein** Aufklappmenü. Die vorhandene
`.type-filter`-Komponente (`__toggle` / `__menu`) wird wiederverwendet, nichts neu
gebaut.

### 4.5 Bilder und Wappen

- **Wappen: 56 × 56** — das ist der **heutige** Wert (`.dt-wappen` in Siedlungseditor
  *und* Monitor, identisch). Sie sind bereits einheitlich; die im Gespräch genannten
  70 × 70 wären eine Vergrößerung um ein Viertel, keine Vereinheitlichung.
- **Bild-Ablagezone: keine feste Höhe.** `.dt-img-upload` ist heute
  polsterungsgetrieben und dehnt sich auf die Spaltenbreite. Owner: „behalte die
  jetzige bei" → *nicht* festnageln. Nur Rahmen, Radius und Schriftgrad ziehen auf
  Tokens (heute `1.5px` / `6px` / `12px` + `10px`-Hinweis unter der Grenze).
- **Wappen, Kreise und Listen-Icons bleiben unangetastet** (`.se-row-coat` 22 × 22
  und Verwandte).

### 4.6 Bildlaufleisten

Ein Aussehen, beide Themes:

```css
scrollbar-width: thin;
scrollbar-color: var(--color-border-strong) transparent;
```
plus die `::-webkit-scrollbar`-Entsprechung.

### 4.7 Hell und Dunkel

Jedes neue Token bekommt einen Dunkelwert — sonst ist es kein Token. Gemessene
Kontraste im Dunkelmodus: Sync-Kachel Ruhe 4,95 · normale Kachel 9,27 / 8,04 ·
Titel 10,94 · Meta 5,32 · Pille 8,53 · Link 7,79. **Eine Ausnahme siehe §8.**

---

## 5. Herkunft und Wiederherstellen

Das Vokabular existiert bereits vollständig ausformuliert im WikiSync-Monitor
(`html/wiki-sync-monitor.html:621`):

> „Der synchronisierte Wiki-Wert bleibt erhalten und wird bei Sync aufgefrischt;
> der Override gewinnt für Anzeige/Anwendung. `↺` löscht den Override → Feld zeigt
> wieder den Wiki-Stand."

Bausteine: `effVal = Override ?? Wiki`, Abzeichen `✎ manuell` mit dem Wiki-Stand im
Tooltip, Gegenüberstellung `alt → neu` (alt durchgestrichen), das Feldlabel färbt
sich (`.dt-grid .k.ovr`). Das wird auf alle Editoren gehoben — **mit einem dritten
Zustand**, der heute fehlt:

| Zustand | Kennzeichnung | `↺` |
|---|---|---|
| **Wiki** — unverändert | keine | — |
| **Manuell** — überschrieben, Wiki-Stand liegt vor | Label gefärbt + `✎ manuell`, darunter `alt → neu` | **aktiv** |
| **Nur manuell** — kein Wiki-Gegenstück | `✎ manuell` | **deaktiviert, mit Grund** |

Auf Zeilenebene (Quellen, Abenteuer-Orte, Karten-Orte, Lore-Orte) markiert dasselbe
Vokabular die Zeile; `origin = wiki | manual | community` und der
`suppressed`-Grabstein stehen dort schon in der Datenbank.

### 5.1 Die Grenze, ehrlich

**Wiederherstellen kann nur, wo der Wiki-Wert noch existiert.**

- **Territorien:** sauber gelöst — `metadata_overrides_json` legt den Override
  *neben* den Wiki-Wert. `↺` funktioniert.
- **Siedlungen:** die flachen Felder (Name, Typ, Beschreibung) werden **direkt**
  überschrieben; ein Wiki-Zweitwert existiert nur für Infobox-Felder in
  `properties.wiki_settlement`. Für den Rest gibt es nichts zum Zurückkehren →
  Zustand 3, kein falsches Versprechen.

Ein echtes „überall wiederherstellbar" wäre eine **Datenänderung** und gehört in
eine eigene Sitzung. Diese Spec ändert kein Datenmodell.

### 5.2 Falsche Überschrift

`html/wiki-sync-settlement-editor.html:306` heißt **„Eigenschaften & Overrides"** —
der Kommentar direkt darunter (Zeile 1055 ff.) sagt selbst, dass Siedlungen keinen
Override-Mechanismus je Feld haben. Mit der Kennzeichnung aus §5 wird die
Überschrift entweder wahr oder muss weichen. Owner-Entscheid nötig.

---

## 6. Quellen

Die geteilte Komponente `mountFeatureSourceEditor` /
`css/features/feature-sources.css` ist heute an **zwei** Stellen eingehängt
(Siedlungseditor, Karten-Bearbeiten-Dialog).

**Formatierung** (ohne Felder oder Optionen anzufassen — Owner: „verändere keine
Optionen oder Eigenschaften"):

- **Jeder vorhandene Eintrag ist eine eigene Karte** — `--color-panel-soft` auf
  `--color-border`, `--radius-md`. Als dünne Textzeile ging er neben dem
  fünfteiligen Formular unter. Gleiche Optik wie die verbundenen Orte in Abenteuer
  und Karten: ein Kärtchen je Eintrag.
- **Das Anlegen-Formular bekommt einen Rahmen um seine Felder**, Überschrift
  „Neue Quelle" außerhalb. Gemessen deckungsgleich mit den Karten (Breite 420,
  gleiche Kante, gleicher Radius).
- Damit liest sich die Sprache: **gerahmte Karte = vorhandener Eintrag, gerahmter
  Kasten = Eingabe.**
- Abzeichen von `10px` auf `--font-size-caption` (11), Polsterungen auf die Skala.

**Verwendung:** `feature_sources.entity_type` kennt heute
`settlement | region | path | territory`. Territorien, Regionen und Wege können die
Komponente also **sofort** bekommen. Abenteuer und Karten hängen nicht daran — dort
lässt sich nur die **Optik** angleichen.

---

## 7. Mobil

Unterhalb 900px lösen die drei Spalten einander **ab**, statt nebeneinander zu
schrumpfen: Spalte 1 → Tippen → Spalte 2 → Tippen → Spalte 3, „← Zurück" ab
Schritt 2. Menüband schiebt sich seitlich (bleibt vollständig), Fußzeile klebt
unten, Tippziele 40–44px.

Gemessen bei 390 × 844: genau **eine** Spalte je Schritt, „Zurück" ab Schritt 2,
**0 px Überlappung** mit der Fußzeile.

> **Falle, teuer gelernt:** gestapelt muss der Panel-*Container* scrollen
> (`overflow-y: auto` auf `.avm-editor-panels`), nicht jedes Panel für sich —
> sonst läuft der Inhalt aus dem Körper heraus **unter** die Speicherleiste.

---

## 8. Funde, die sonst später beißen

1. **Spacing-Tokens heißen anders, als sie messen.** `--space-10` ist **12px**,
   `--space-12` ist **14px**, `--space-16` ist **18px**. `docs/design-language.md`
   behauptet ausdrücklich „the name is the pixel value". Das ist falsch.
   **Empfehlung: die Doku korrigieren, die Werte lassen** — Werte ändern würde jede
   Oberfläche verschieben.

2. **🔴 Dunkler Hover unter der Lesbarkeitsschwelle — heute, im Produkt.**
   `--color-button-hover` wird im Dunkelmodus *heller* (#797264); gegen
   `--color-button-text` (#f5ebd7) ergibt das **4,03:1**, unter AA (4,5). `.t2`
   trägt zusätzlich `opacity: .8`, liegt also darunter — bei 11px.
   `.ae-btn2--primary:hover` (`adventure-editor.html:82`) nutzt exakt diese Tokens.
   **Empfehlung: im Dunkelmodus wird Hover dunkler statt heller.**
   ⚠️ Globales Token, wirkt auf **jede** Oberfläche → **Owner-Entscheid offen**,
   eigener kleiner Commit.

3. **`Art`-Feld zeigt rohes Wikilink-Markup.** Natur & Waren, Feld „Art":
   `[[Fisch]]`, während die Liste sauber „Fisch" zeigt. Die Bereinigung greift nur
   bei der Anzeige, nicht im Bearbeitungsfeld — wer dort tippt und speichert,
   überschreibt Markup mit Klartext. **Nicht Teil dieser Spec** (Datenfrage), aber
   notiert.

4. **Zwei CSS-Dubletten** (§1.2) — beim Extrahieren der Hülle mit löschen.

5. **Falsche Überschrift „Eigenschaften & Overrides"** (§5.2).

---

## 9. Abgrenzung zu laufenden Sessions

⚠️ **`docs/superpowers/specs/2026-07-22-lore-quellen-vereinheitlichung-design.md`
(gleicher Tag)** hängt Lore-Quellen an `feature_sources` (`entity_type='lore'`) und
montiert `mountFeatureSourceEditor` in den Natur-&-Waren-Editor — **dieselben
Dateien**, die §6 anfasst (`review-feature-sources.js`, `feature-sources.css`).

**Regel:** §6 ist reine Formatierung und darf die Mount-Punkte und die Datenschicht
nicht anfassen. Vor dem Bau von §6 den Stand jener Session prüfen; im Zweifel §6
**nach** ihr bauen. Kein `git add -A` (AGENTS.md §9) — der Baum ist geteilt.

---

## 10. Umsetzung in Schritten

| # | Schritt | Risiko |
|---|---|---|
| 1 | **Knopfleiste**: leere Rasterspalte weg, Abstände auf Tokens, Radius/Gewicht | gering |
| 2 | **Benennung**: Knöpfe + Dialogtitel + Handbuch (6 Stellen, `Stand:`) | gering |
| 3 | **`editor-shell.css`**: Hülle extrahieren, JS-Inline-Maße raus, 2 Dubletten löschen | mittel |
| 4 | **Je Editor** Typografie/Abstände/Spalten/Menüband, ein Commit pro Editor (Siedlungen → Territorien → Karten → Abenteuer → Natur & Waren) | mittel |
| 5 | **Herkunft & `↺`** nach §5, zuerst Territorien (dort ist die Datenlage sauber) | mittel |
| 6 | **Quellen** nach §6 — *nach* Abgleich mit §9 | mittel |
| 7 | **Mobil**, Bildlaufleisten, Doku-Korrekturen aus §8 | gering |

**Fallen beim Bau:**
- Schritt 3–4 fassen dynamisch geladene Editor-Assets an → **`ASSET_VERSION` in
  `js/territory/territory-editor-inline-host.js` bumpen** (AGENTS.md §7).
- `edit/index.php` verlinkt `css/pages/edit.css` mit handgeschriebenem `?v=`, das
  der Deploy-Stamper nie erreicht → **von Hand bumpen**.
- Abenteuer- und Karten-Editor laden mit `?v=Date.now()` → **nie** `ASSET_VERSION`.

---

## 11. Prüfstand

Am Muster `verify-editor-shell.html` (zieht die echten `css/base/tokens.css`)
**gemessen**, nicht geschätzt:

| | Ergebnis |
|---|---|
| Hülle | 1400 × 880 |
| Drei Spalten | 466,67 / 466,67 / 466,67 — exakt gleich |
| Menüband | 6 × 219 — exakt gleich |
| Bedienhöhen | Suche / Knopf / Eingabe / Auswahl = je 32 |
| Reihenfolge Spalte 3 | Wappen → Bilder → Identität → Quellen |
| Quellenkarte ↔ Formularkasten | Breite 420 = 420, gleiche Kante, Radius 8 |
| Abstände um Zwischenüberschrift | 14 oben / 14 unten |
| Mobil 390 × 844 | 1 Spalte je Schritt, „Zurück" ab 2, **0 px Überlappung** |
| Hover Sync-Kachel hell | 5,21:1 |
| Wappen | 56 × 56 |

**Nicht verifiziert** (Klassifizierer-Ausfälle während der Sitzung): Tippziele auf
schmalem Schirm, die vereinheitlichten Bildlaufleisten im echten Editor, und
sämtliche Aussagen am **laufenden** Produkt — die Editorlisten brauchen einen Login.
Der Owner-Browser ist die verlässliche Instanz.

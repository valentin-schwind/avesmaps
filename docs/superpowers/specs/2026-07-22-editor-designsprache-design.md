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
| Vorkommen | Section, per JS in einen Dialog umgezogen | „Vorkommen" |

Regionen und Wege haben keinen Editor — die Benennung hält ihnen einen Platz frei.

### 1.1 Fünf Typografie-Dialekte

| Editor | Schriftgrößen | Tokens |
|---|---|---|
| Abenteuer | `var(--font-size-*)` | ✅ vorbildlich |
| Karten | Tokens, 1× `10px` | ✅ fast |
| Siedlungen | `10 / 11 / 12 / 13 / 15 / 17 / 18px` hart | ❌ keine |
| Vorkommen | `0.8 / 0.85 / 0.9 / 0.95 / 1.3rem` | ❌ eigener rem-Dialekt |
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
Stylesheet erreicht sie.

> ⚠️ **Korrektur 2026-07-22 (beim Bau geprüft).** Die erste Fassung dieses
> Abschnitts nannte hier **zwei** Dubletten zum Löschen. Nur eine davon ist eine:
>
> - **`css/components/edit-overlays.css`** — Dublette **bestätigt**, aber schmaler
>   als behauptet: der Kopfblock (Zeile 1–16) erklärt für acht Overlay-IDs
>   wortgleich dasselbe wie `dialog-overlays.css:23-42`, und alle acht sind in
>   dessen Zwölferliste enthalten. Ob der *Rest* der Datei ebenfalls doppelt ist,
>   wurde **nicht** geprüft — „fast vollständig" ist unbelegt.
> - **`css/pages/political-territory-editor-inline.css`** — **kein Zwilling.** Die
>   Datei ist ein **Bauprodukt**: `tools/scope_editor_css.js` erzeugt sie aus
>   **drei** Quellen (`political-territory-editor.css`, `-layout.css`,
>   `political-territory-wiki-tree.css`) und sperrt jede Regel unter
>   `#political-territory-editor-host` ein, damit der Ganzseiten-Reset des
>   eigenständigen Editors (`*`, `body`, `html`, `button`, `input`) nicht auf die
>   Karte durchschlägt. Geladen von `territory-editor-inline-host.js`. Ihr Kopf
>   sagt es selbst: „AUTO-GENERATED … do not edit by hand."
>   **Wer sie löscht, killt den eingebetteten Territorien-Editor.**
>
> Folge für Schritt 4 am Territorien-Editor: Quelldatei ändern → `node
> tools/scope_editor_css.js` laufen lassen → **`ASSET_VERSION` bumpen**
> (AGENTS.md §7), weil der Inline-Host die erzeugte Datei dynamisch nachlädt.

Und ein dritter Fund, der Arbeit spart statt sie zu machen: die
`[hidden]`-ID-Liste in `dialog-overlays.css:6-19` ist **überflüssig**.
`css/base/reset.css:14` setzt global `[hidden] { display: none !important }`,
was jedes `display:flex` eines Overlays schlägt. Ein neues Overlay muss dort
**nicht** eingetragen werden — die Liste nicht weiter verlängern.

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
| Vorkommen | kursiv `von Hand` | **Feld leeren** |
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
| Vorkommen | **Vorkommen bearbeiten** |
| Regionen | **Regionen bearbeiten** (sobald es ihn gibt) |
| Wege | **Wege bearbeiten** (sobald es ihn gibt) |

Begründung: der Tooltip des Vorkommen-Knopfs gibt es selbst zu — *„Startet
NICHTS: Syncen und Bearbeiten passieren erst im Fenster."* Die Knöpfe **öffnen ein
Fenster**; sie syncen nicht. Sie waren nach zwei Tätigkeiten benannt, die sie nicht
ausführen. „Syncen" verschwindet vom Knopf, nicht aus dem Produkt — die Sync-Kachel
und „Zuletzt gesynct" bleiben im Menüband.

**Owner-Entscheide (nicht neu verhandeln):**
- **„Territorien", nicht „Herrschaftsgebiete"** — kürzer, frisst weniger Platz.
  Gilt für **Beschriftungen**; erklärender Fließtext in Doku und Handbuch darf
  „Herrschaftsgebiete" behalten.
- **„Karten", nicht „Kartensammlung"** — passend zum Reiter.
- **„Vorkommen", nicht „Natur & Waren"** — umbenannt in `4690fddd`, Knopf und
  Fenstertitel gleichermaßen. Der Schlüssel bleibt `lore`; nur die Beschriftung
  wechselt.

> 💣 **„Syncen" für Territorien wurde versucht und zurückgenommen.** `fefa1223`
> beschriftete `#wiki-sync-territories` mit „Syncen"; am selben Tag zurück auf
> „Territorien bearbeiten" (Owner: „Territorien bearbeiten ist doch ok"). Der
> Grund steht in `fefa1223`s eigener Commit-Nachricht: *„it does NOT start a run.
> startWikiSyncTerritoryRun calls openAvesmapsSyncEditorOverlay and returns"* —
> der Knopf öffnet ein Fenster und synct nichts, also darf er nicht nach dem
> Syncen heißen. Dazu tragen Territorien `editorButtonId: null`
> (`js/review/review-subjects.js:62`), ihr Sync-Knopf **ist** der eine Knopf des
> Subjekts und muss folglich den Editor benennen.
>
> Die Beschriftung steht an **zwei** Stellen: `index.html` und
> `WIKI_SYNC_TERRITORIES_IDLE_LABEL` (`review-wiki-sync.js`), von wo sie nach
> jedem Lauf zurückgeschrieben wird. Beim Umbenennen in `fefa1223` wurde die
> JS-Seite übersehen — die Beschriftung wäre nach dem ersten Territorien-Sync auf
> den alten Namen zurückgesprungen. **Wer sie ändert, ändert beide.**

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
│ [Reiterzeile]   optional — heute nur Vorkommen         │
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
geschlossen — Vorkommen zeigt seine Spalten 2+3 erst mit ausgewähltem Eintrag,
`.lore-detail__cols` in `review-wiki-sync.js:2066`):

| Editor | 1 | 2 | 3 |
|---|---|---|---|
| Siedlungen | Territorien | Siedlungen | Eigenschaften |
| Territorien | Offene Lücken | Hierarchiemodell | Wiki-Daten & Overrides |
| Abenteuer | Liste | Stammdaten | Orte |
| Karten | Liste | Stammdaten | Orte |
| Vorkommen | Liste | Stammdaten + Quellen | Verbundene Orte |

Jede Spalte trägt einen Titel (`--font-size-subhead`, `--color-accent-strong`).

**Nicht Teil dieser Spec:** die *Rolle* der dritten Spalte unterscheidet sich
(Eigenschaften vs. verbundene Orte). Gleich wird die **Breite**, nicht die
Reihenfolge — die bleibt, wie Editoren sie kennen.

### 3.3 Menüband — alle Kacheln gleich breit

```css
.avm-ribbon { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
```

Vorbild Siedlungen/Territorien (volle Breite, gleiche Kacheln); Abenteuer, Karten
und Vorkommen ziehen nach. Die Kachel selbst erbt `.ae-btn2`/`.ce-btn2`
unverändert: zweizeilig (`.t1` fett, `.t2` gedämpft), **nur die Sync-Kachel trägt
ein Icon (🚨)** und `--primary` — Owner-Entscheid aus der Menüband-Session
2026-07-17, nicht neu verhandeln.

> 💣 **`--primary` braucht eine eigene Hover-Regel**, und sie muss *nach* der
> allgemeinen stehen. Fehlt sie, gewinnt der allgemeine Hover mit hellem Grund,
> während die Schrift cremefarben bleibt — hell auf hell, unlesbar. Beim Bau des
> Musters genau so passiert und ohne Kontrastmessung nicht zu sehen gewesen.

**Die Startknöpfe der Übersicht tragen dasselbe Muster** (`48438139`, Owner
2026-07-22): Beschriftung oben, „Zuletzt gesynct" klein darunter. Das kehrt den
Stand vom 2026-07-19 um, als das Datum neben den Knopf wanderte — damals ging es
darum, dass Regionen/Wege anders aussahen als Siedlungen/Territorien; jetzt sind
alle gleich zweizeilig, also entsteht dieser Unterschied nicht. Owner dazu: „die
entscheidung ist in einem anderen kontext entstanden".

> 💣 Der Zeitstempel-Span wurde **in** den Knopf verschoben, nicht neu gebaut — er
> behält seine id, also schreibt `refreshWikiSyncKindSyncedStatus` unverändert
> hinein. Aber: `buttonElement.textContent = …` löscht damit **beide** Kinder, der
> Zeitstempel wäre nach dem ersten Sync-Lauf weg. Dafür gibt es
> `setWikiSyncStartButtonLabel()` (`review-wiki-sync.js:90`), die nur die
> Titelzeile anfasst. **Wer künftig eine Startknopf-Beschriftung setzt, benutzt
> sie.** Ebenso trägt der Knopf `min-height: 44px`, damit er nicht wächst, wenn
> der Statusabruf zurückkommt, und alles darunter verschiebt.

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

*Korrektur zur ersten Fassung dieser Spec: hier ist **nichts neu zu erfinden**, und
`--color-border-strong` wäre der falsche Griff gewesen.* Es gibt bereits Tokens
(`--color-scrollbar-thumb`, `-thumb-hover`, `-track`, hell **und** dunkel,
`tokens.css:195`) und eine globale Regel in `css/base/base.css:15-41`.

**Die eigentliche Ursache der Uneinheitlichkeit:** die Editor-iframes binden
`tokens.css`, aber **nicht** `base.css` — die globale Regel erreicht sie nie.
Abenteuer- und Kartensammlungs-Editor haben den Block deshalb in ihr eigenes
`<style>` **kopiert** (mit Kommentar, warum, z. B. `adventure-editor.html:41`);
Siedlungs- und Territorien-Editor sowie das Vorkommen-Fenster haben ihn
**nicht** — dort zeichnet der Browser seine Standardleisten.

**Zu tun:** den Block **einmal** in `editor-shell.css` unterbringen, das jede
Editor-Seite ohnehin bindet, und die beiden Kopien entfernen. Dabei die Breite
angleichen — die Kopien setzen `7px`, `base.css` einen anderen Wert.

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
`css/features/feature-sources.css` ist an **drei** Stellen eingehängt:
Siedlungseditor, „Ort bearbeiten"-Dialog auf der Karte
(`js/review/review-locations.js:569`) und — seit `1673b655`, siehe §9 — der
Vorkommen-Editor (`js/review/review-wiki-sync.js:2116`).

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

**Verwendung:** `feature_sources.entity_type` kennt
`settlement | region | path | territory | lore`. Territorien, Regionen und Wege
können die Komponente also **sofort** bekommen — der Lore-Umbau (§9) hat gerade
vorgeführt, dass ein neuer `entity_type` ein kleiner Eingriff ist. Abenteuer und
Karten hängen weiterhin nicht daran (eigene Shop- und Publikationslinks); dort
lässt sich vorerst nur die **Optik** angleichen.

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

1. **Spacing-Tokens messen nicht, was sie heißen — aber mit Absicht.**
   `--space-10` ist 12px, `--space-12` ist 14px, `--space-16` ist 18px.
   *Korrektur zur ersten Fassung dieser Spec:* das ist **kein Abdriften**, sondern
   ein dokumentierter Owner-Entscheid, direkt daneben in `tokens.css:202`:
   „alle Spacing-Vars global +2px (mehr Luft überall). Die Namen bleiben als
   Skala-Stufen; die WERTE tragen +2. App-weit + reversibel."
   Offen ist nur, dass `docs/design-language.md` weiterhin „the name is the pixel
   value" behauptet. **Empfehlung: die Doku nachziehen, die Werte lassen.**

2. **✅ ERLEDIGT (`5280619b`). Dunkler Hover lag unter der Lesbarkeitsschwelle.**
   `--color-button-hover` wird im Dunkelmodus *heller* (#797264); gegen
   `--color-button-text` (#f5ebd7) ergibt das **4,03:1**, unter AA (4,5). `.t2`
   trägt zusätzlich `opacity: .8`, liegt also darunter — bei 11px.
   `.ae-btn2--primary:hover` (`adventure-editor.html:82`) nutzte exakt diese Tokens.
   Owner gab frei; im Dunkelmodus geht Hover jetzt **dunkler** (`#5e5749`, 6,05:1),
   `--color-button-active` wanderte mit (`#4f4a3d`, 7,46:1) — der alte Wert hätte
   praktisch auf dem neuen Hover gelegen. Hell unverändert.

3. **Das Gruppen-Feld zeigt rohes Wikilink-Markup.** Vorkommen, Feld „Gruppe"
   (hieß bis `4690fddd` „Art" — der Fund ist derselbe, nur der Feldname wechselte):
   `[[Fisch]]`, während die Liste sauber „Fisch" zeigt. Die Bereinigung greift nur
   bei der Anzeige, nicht im Bearbeitungsfeld — wer dort tippt und speichert,
   überschreibt Markup mit Klartext. **Nicht Teil dieser Spec** (Datenfrage), aber
   notiert.

4. **Eine CSS-Dublette, nicht zwei** (§1.2, korrigiert) — `edit-overlays.css`
   ja, `political-territory-editor-inline.css` **nein**: die ist generiert und
   trägt den eingebetteten Editor. Erst lesen, dann löschen.

5. **Falsche Überschrift „Eigenschaften & Overrides"** (§5.2).

---

## 9. Abgrenzung zu laufenden Sessions

✅ **Erledigt, noch während diese Spec entstand.** Die Parallel-Session zu
`2026-07-22-lore-quellen-vereinheitlichung-design.md` ist gelandet:

```
f5d7fd98 docs(agents): sources live in one place -- never build a second source system
1673b655 refactor(lore): sources move to the shared system -- lore_source retires
41b7c726 fix(lore): empty publication staging must not wipe a whole entity type
```

Lore-Quellen hängen jetzt an `feature_sources` (`entity_type='lore'`), und der
Vorkommen-Editor montiert die geteilte Komponente
(`review-wiki-sync.js:2116`). **Folge für §6:** die Formatierung wirkt damit
sofort in *drei* Editoren statt zwei — mehr Nutzen, aber auch mehr Fläche, auf
der ein Fehler auffällt.

**Regel bleibt:** §6 ist reine Formatierung und fasst weder Mount-Punkte noch die
Datenschicht an. Vor dem Bau `git log` auf `review-feature-sources.js` und
`feature-sources.css` prüfen — dort arbeiten mehrere Sessions. Kein `git add -A`
(AGENTS.md §9), der Baum ist geteilt.

⚠️ **Genereller Hinweis:** dieser Abschnitt ist ein Schnappschuss vom 2026-07-22.
Wer die Spec später liest, prüft den Stand gegen `git log`, statt ihm zu glauben.

---

## 10. Umsetzung in Schritten

| # | Schritt | Risiko |
|---|---|---|
| ✅ 1 | **Knopfleiste** — `a505aee8`. Grid → Flex, Literale auf Tokens. Gemessen: Status versteckt → Knopf 100 %, Lücke 0; Status da → 64 % (vorher 66 %), Beschriftung nie abgeschnitten. Prüfgestell `verify-launcher-row.html` | gering |
| ✅ 2 | **Benennung** — `095ad263`. 5 Knöpfe, 5 Dialogtitel, 4 Seitentitel, Handbuch. Inklusive der zwei Stellen, die die Territorien-Beschriftung nach einem Lauf neu setzen (sonst wäre sie zurückgesprungen). Kein `ASSET_VERSION`-Bump nötig | gering |
| ✅ 2b | **Zweizeilige Startkachel** — `48438139`. „Zuletzt gesynct" wandert in den Knopf, Status-Span verschoben statt neu gebaut, `setWikiSyncStartButtonLabel()` schützt die Struktur (§3.3). Gemessen: volle Breite in jedem Zustand, Höhe konstant 44 (kein Springen), Zeitstempel überlebt einen Sync-Lauf. Owner live bestätigt: „die zweizeilige Kachel passt" | gering |
| ✅ 3 | **`editor-shell.css`** — `70a4b204`. Äußere Hülle extrahiert, JS-Inline-Maße raus, Siedlungseditor darauf umgestellt. Die drei übrigen laufen bewusst weiter auf den alten Klassen, darum darf `political-territory-editor-overlay.css` noch **nicht** weg. Zur Dublettenlöschung siehe die Korrektur in §1.2 | mittel |
| 🔶 4 | **Je Editor** Typografie/Abstände/Spalten/Menüband. ✅ Siedlungen `6cc567db` (volle Sprache) · ✅ Abenteuer + Karten `19a042c9` (Menüband auf volle Breite; Karten verlieren zwei feste Spaltenbreiten) · ✅ Vorkommen `be08016c` (rem-Dialekt auf die Leiter) · ⬜ **Territorien offen** — eigener Fall, siehe unten | mittel |
| 5 | **Herkunft & `↺`** nach §5, zuerst Territorien (dort ist die Datenlage sauber) | mittel |
| 6 | **Quellen** nach §6 — *nach* Abgleich mit §9 | mittel |
| 7 | **Mobil**, Bildlaufleisten, Doku-Korrekturen aus §8 | gering |

### Warum Territorien eigens dran muss

Die anderen vier waren Maßarbeit an einer vorhandenen Struktur. Dieser nicht:

- **84 harte Schriftgrößen über drei Dateien**, darunter `10pt`, `9px`, `0.78em`,
  `0.85em`, `0.75rem` — die Größen liegen nicht neben der Leiter, sie sprechen
  vier verschiedene Einheiten.
- **Eigene Struktur.** Kein `.controls`, kein `.cols`/`.col`, sondern `.panel`,
  `.panel-header`, `.manual-data-columns`. Die Regeln der anderen vier greifen
  hier nicht.
- **Sein Menüband liegt woanders.** Die acht Kacheln aus dem Screenshot gehören
  dem WikiSync-Dialog (`review-wiki-sync.js`), nicht
  `html/political-territory-editor.html`. Der Editor ist **zwei** Oberflächen.
- **Generierte CSS** (§1.2): jede Änderung braucht `node
  tools/scope_editor_css.js` + `ASSET_VERSION`-Bump, sonst sieht der eingebettete
  Editor anders aus als der eigenständige.

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
| Reiterzeile (Vorkommen) | 39 hoch, aktiver Reiter unterstrichen |

Am Prüfgestell `verify-launcher-row.html` **gemessen** (Startknöpfe, alle Zustände):

| | Ergebnis |
|---|---|
| Kein Status / Status da / während Sync / danach | Knopf je 100 % Breite, Lücke rechts 0 |
| Höhe | konstant 44 in allen vier Zuständen — nichts springt, wenn das Datum eintrifft |
| Zeitstempel nach simuliertem Sync-Lauf | überlebt, Text unverändert |
| Beschriftung | wechselt korrekt auf „Synchronisiert…" und zurück |

**Nicht verifiziert** (Klassifizierer-Ausfälle während der Sitzung): Tippziele auf
schmalem Schirm, die vereinheitlichten Bildlaufleisten im echten Editor, und
sämtliche Aussagen am **laufenden** Produkt — die Editorlisten brauchen einen Login.
Der Owner-Browser ist die verlässliche Instanz.

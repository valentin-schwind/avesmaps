# Gemeinsame Designsprache der fünf Editoren (Design)

**Datum:** 2026-07-22 · **Auftraggeber:** Owner · **Maßstab:** `docs/design-language.md`,
AGENTS.md §12 · **Status:** in Umsetzung — Schritte 1–3 stehen, Schritt 4 ist für
**vier von fünf** Editoren gebaut (Siedlungen, Vorkommen, Abenteuer, Karten);
**Territorien** und die Schritte 5–7 sind offen. Fortschritt in §10, am echten
Editor gemessene Zahlen in §11.1.

> ⚠️ **Diese Spec ist ein Arbeitspapier, kein Protokoll.** Sie wurde beim Bauen
> mehrfach widerlegt und korrigiert — §1.2 (Dubletten), §4.6 (Bildlaufleisten,
> in *beiden* Hälften falsch), §8. Wer sie liest, prüft ihre Behauptungen gegen
> `git log` und gegen den Code, statt ihnen zu glauben. Was hier steht, war beim
> Schreiben wahr; was gemessen wurde, steht als Zahl da.

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

### 3.1a Hüllenmaße — verbindlich

> 💣 **Diese Tabelle fehlte, und das war die Ursache.** Die Spec legte Typografie
> (§4.1), Bedienhöhe (§4.3), Spaltenbreiten (§3.2) und Farben fest — aber **kein
> einziges Polstermaß**. Drei Sitzungen haben Menüband, Statuszeile, Spalten-
> Innenrand und Listenzeile deshalb geraten, dreimal verschieden, und der Owner
> sah es sofort: „vom design her sehen abenteuer und karteneditor anders aus".
> Gemessen waren es **15 Abweichungen** — Abenteuer 8, Karten 7. Es gab kein
> „einer ist richtig".

| Bauteil | Wert | = px |
|---|---|---|
| Menüband | `padding: var(--space-8) var(--space-12)`, `gap: var(--space-4)`, `background: var(--color-panel)` | 10/14, 6 |
| Statuszeile | `padding: var(--space-4) var(--space-12)`, `min-height: 30px`, `background: var(--color-panel-soft)` | 6/14 |
| Spalte (alle drei) | `padding: var(--space-6) var(--space-10)` | 8/12 |
| Detailkopf | `padding: var(--space-6) var(--space-10)`, **leer ⇒ `display: none`** | 8/12 |
| Speicherleiste | `padding: var(--space-6) var(--space-10)` | 8/12 |
| Listenzeile | `padding: var(--space-2) var(--space-4)`, `border-radius: var(--radius-md)`, `border: 1px solid transparent`, gewählt `border-color: var(--color-accent)` | 4/6 |
| Listenspalte | **kein eigener Hintergrund** — die Trennlinie genügt | — |

**Diese Werte stehen als Token in `css/components/editor-page.css`** — nicht in
den Editorseiten: `--avm-ribbon-pad`, `--avm-ribbon-gap`, `--avm-status-pad`,
`--avm-status-min-h`, `--avm-col-pad`, `--avm-row-pad`, `--avm-control-h`. Ein
Editor benutzt sie, er wiederholt sie nicht. Vor dem Umzug standen sie **elfmal**
über drei Dateien verstreut und die Bedienhöhe unter **drei Namen** — das ist
keine Kopie, das ist eine Divergenz-Fabrik. Wer einen weiteren Editor anschließt,
verlinkt die Datei und greift zu; wer einen Wert ändern will, ändert ihn dort.

**Zwei Regeln dazu, beide teuer gelernt:**

1. **Der Spaltentitel steht AUSSERHALB des Scrollbereichs**, nicht als
   `position: sticky` darin. Die Spalte ist `display: flex; flex-direction: column;
   overflow: hidden`, der Titel ihr erstes Kind, darunter ein
   `…__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto }`, **das die id
   trägt**. Sticky funktioniert zwar auch, braucht aber einen deckenden Hintergrund,
   ausblutende Ränder und kennt die Falle aus §8.9 — diese Bauweise kennt sie nicht.
2. **Die Listenzeile schwebt**, sie läuft nicht randlos mit Trennlinie durch. Der
   transparente 1px-Rahmen ist Pflicht: er ist immer da und wechselt beim Auswählen
   nur die Farbe, sonst springt die Zeile um zwei Pixel.

Wappen, Kreise und Vorschaubilder der Listenzeilen bleiben davon **unberührt** —
ein Buchcover ist hochkant (32 × 45), eine Karte querformat (56 × 40). Das ist
Inhalt, keine Abweichung.

### 3.1c Formularfeld — Beschriftung links, nicht darüber

> 💣 **Die Hüllenmaße aus §3.1a reichten nicht.** Nachdem alle drei Editoren dort
> auf 0 Abweichungen standen, sagte der Owner beim nächsten Blick trotzdem:
> „der abenteuer editor spricht doch eine total andere designsprache als z.B.
> siedlungen editieren". Er hatte recht — gemessen worden war die **Hülle**
> (Polsterungen, Menüband, Statuszeile, Spaltenmaße), nicht der **Inhalt** der
> Spalten. „0 Abweichungen" hieß nur: null in den fünfzehn Dingen, die geprüft
> wurden.

**Regel:** Beschriftung **links neben** dem Eingabefeld, feste Spalte
`--avm-field-label-w` (130px), damit die Feldkanten über alle Gruppen und alle
Editoren hinweg fluchten.

| Editor | vorher | jetzt |
|---|---|---|
| Siedlungen | `.dt-grid`, `minmax(90px, 0.35fr)` | Token |
| Karten | `.ce-row__label`, feste `130px` | Token |
| Abenteuer | `.ae-field { flex-direction: column }` — **gestapelt** | Token, `row` |

Abenteuer war der einzige, der stapelte. Bei rund fünfzehn Feldern ergibt das
doppelt so viele Zeilen wie nebenan — der Grund, warum die Detailspalte auf den
ersten Blick nach einem anderen Programm aussah.

**Zwei Ausnahmen, beide nötig:** ein Ankreuzfeld *ist* seine Beschriftung (das
`<input>` steckt darin) — es bekommt die volle Breite, sonst schneidet die
130px-Spalte es mittendrin ab. Und mehrzeilige Felder richten oben aus
(`align-items: flex-start`), sonst schwimmt die kurze Beschriftung in der Mitte
eines hohen Kastens.

### 3.1b Pillen — eine Vokabel, eine Betonung

> 💣 **Abenteuer- und Kartensammlungs-Editor färbten dieselbe Klasse
> gegensätzlich.** `manuell` schrie im einen in Gold und flüsterte im anderen in
> Grau; `Typ` genau umgekehrt. Wer zwischen den Editoren wechselt, lernt die
> Farbe zweimal verschieden.

**Regel: betont wird die Ausnahme, nicht die Einordnung.**

| Pille | Bedeutung | Optik |
|---|---|---|
| `--manual` | Ausnahme: von Hand gesetzt, der Sync fasst es nicht an | **Gold**, gefüllt, fett |
| `--kind` | Einordnung: Typ, Kategorie | ruhig grau |
| `--wiki` | Herkunft: aus der Datengrundlage | ruhig, randlos |
| `--unresolved` | offener Punkt | **Warnfarbe**, nicht `--color-danger` — Rot bleibt dem echten Fehler |

### 3.1d Der warme gerahmte Inhaltskasten — das, was „schön" aussieht

> 💣 **Der eigentliche Grund, warum ein Editor „nach einem anderen Programm"
> aussieht.** Der Owner beim Vergleich zweier Fenster: *„das braun im hintergrund
> und die schönen rahmen … es geht mir nur um form, farben, abstände, layout,
> ähnliche strukturen."* Nicht Maße — die **Schichtung**: dunkler Dialoggrund,
> darauf helle gerahmte Kästen, in denen der scrollende Spalteninhalt sitzt. Ohne
> sie läuft der Inhalt flach und kühl.

**Regel (word-for-word aus dem Siedlungseditor `#seTree/#seList/#seDetailBody`):**

```css
/* Dialog-Grund */                body      { background: var(--color-page-bg); }   /* dunkles Braun */
/* Spalte selbst */               .col      { background: transparent; }             /* zeigt den Grund */
/* scrollender Inhalt je Spalte */ .…__scroll { background: var(--color-panel);       /* heller Kasten */
                                              border: 1px solid var(--color-border);
                                              border-radius: 6px; padding: var(--space-2); }
```

Der Effekt lebt vom **Kontrast**: heller `--color-panel`-Kasten auf dunklem
`--color-page-bg`. Deshalb ist der Dialoggrund Teil der Regel — ein Editor auf
`--color-panel` (Abenteuer war der einzige) lässt den Rahmen im Nichts hängen.

> **`border-radius: 6px` ist bewusst der harte Wert**, nicht `--radius-sm` (5) oder
> `--radius-md` (8). Siedlungen trägt ihn seit jeher, Territorien hat ihn in
> `673413ce` exakt übernommen, und der Owner nennt beide als Vorbild. Word-for-word
> heißt hier: **auf denselben Pixel**. (Die Token-Leiter aus §4.2 verliert an
> genau dieser Stelle gegen das benannte Vorbild — notiert, nicht „korrigiert".)

**Lokal je Editor, nicht als gemeinsame Klasse.** Siedlungen, Territorien und der
Kartensammlungs-Editor tragen die Regel je in ihrer eigenen Datei, wortgleich.
Der erste Versuch, sie als `.avm-scrollbox` in `editor-page.css` zu zentralisieren,
wurde **zurückgenommen**: er drängte eine Abstraktion in eine Datei, an der
parallel gebaut wird, und wählte `--radius-md` statt der 6px des Vorbilds. Eine
spätere Zusammenlegung ist möglich — aber erst, wenn alle Editoren stehen und
niemand mehr an ihnen arbeitet, nicht mittendrin.

> ⚠️ **Stand 2026-07-23:** Abenteuer trägt die Kästen jetzt (word-for-word, 6px).
> **Karten weicht um 1px ab** — die Parallel-Session, die dort die Kästen einbaut,
> wählte `--radius-sm` (5px) statt der 6px des Vorbilds. Gemessen 5 gegen 6; sollte
> an Siedlungen/Territorien angeglichen werden, sobald die Datei frei ist.

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

> 💣 **`display: grid` ist hier keine Geschmacksfrage — Flex kann es nicht.**
> Zweimal gemessen, zweimal aus demselben Grund daneben:
>
> - **Abenteuer** stand auf `flex: 1 1 0` / `flex: 2 1 0` — das *müsste* exakt
>   1:2 ergeben, gemessen kam **483 / 458 / 458** heraus (1 : 1,898, Streuung
>   24,67px). Ursache: `flex-basis: 0` **mit `box-sizing: border-box`**. Eine
>   Border-Box kann nicht kleiner werden als ihr eigenes `padding + border`, also
>   wurde die Basis der linken Spalte auf **25px** angehoben (2×12px Polsterung +
>   1px Trenner), während die rechte — die keine eigene Polsterung hat — bei 0
>   blieb. Verteilt wurden damit nicht 1399, sondern 1374 → 458/916, und links
>   kamen die 25 obendrauf: 483. **border-box ist nicht der entlastete Verdächtige,
>   sondern der Täter** — nur andersherum, als man vermutet.
> - **Karten** hatte zwei Basen in einer Zeile: `.ce-panel` auf `flex-basis: 50%`,
>   `.ce-panel--orte` übersteuerte auf `0`. Gemessen **459 / 673 / 244**
>   (Streuung 429px) — die Orte-Spalte also *schmaler* als die feste Breite, die
>   sie ersetzt hatte.
>
> Gitterspuren kennen beides nicht: `minmax(0,1fr)` und `minmax(0,2fr)` sind
> exakt 1:2, gleichgültig wie sich die Kinder polstern. Den Kindern dann
> `min-width: 0; min-height: 0` geben (der `auto`-Mindestwert eines Gitterkindes
> drückt die Spur sonst auf). Ein vorhandenes `min-width: 240px` wandert an die
> Spur (`minmax(240px, 1fr)`): greift schmal, stört bei voller Breite nicht.
>
> **Prüfen heißt messen, nicht die Regel lesen.** Beide Fälle sahen im Stylesheet
> nach Dritteln aus.

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

✅ **Umgesetzt 2026-07-23.** Die Komponente lag lokal im Siedlungseditor und ist
nach **`css/components/editor-page.css`** gezogen (§4.6) — dabei auf die Leiter
gebracht: harte `8/10/12/11/4/8px`, ein handgeschriebener Schatten und
`font-weight: 600` sind weg (§4.1 kennt nur 400 und 700).

Der Abenteuer-Editor hatte stattdessen **sieben Filter dauerhaft offen** in der
Listenspalte — ein Kasten, der rund die halbe Spalte fraß und neben dem
Siedlungseditor („Filter ▾") wie ein anderes Programm aussah. Er benutzt jetzt
dieselbe Komponente.

> 💣 **Ein zugeklapptes Menü verbirgt, DASS gefiltert wird.** Ohne Rückmeldung
> sucht man den Fehler in den Daten, wenn die Liste plötzlich acht Einträge zeigt.
> Der Knopf trägt deshalb einen Zähler und färbt sich: `Filter ▾` → **`Filter (2) ▾`**
> in `--color-button`. Wer die Komponente an einem weiteren Editor anschließt,
> baut das mit — es ist kein Zierrat, sondern der Preis fürs Verstecken.
>
> Zweite Falle: der Außenklick-Schließer darf **Klicks im Menü nicht** schließen,
> sonst klappt es bei jeder Auswahl zu und das Ort-Autocomplete darin wird
> unbedienbar.

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
Diese Diagnose gilt weiter; der Befund daneben ist **überholt** (Stand bei
Abfassung, 2026-07-22 vormittags): damals hatten nur Abenteuer- und
Kartensammlungs-Editor den Block in ihr eigenes `<style>` **kopiert**, während
Siedlungs- und Territorien-Editor sowie das Vorkommen-Fenster ihn **nicht**
hatten und der Browser dort seine Standardleisten zeichnete. Wie es heute
aussieht, steht im Kasten darunter.

> ⚠️ **Korrektur 2026-07-22 (beim Bau geprüft). Die alte Anweisung an dieser
> Stelle war in beiden Hälften falsch** und hätte, befolgt, drei Commits
> rückgängig gemacht:
>
> - *„den Block einmal in `editor-shell.css` unterbringen, das jede Editor-Seite
>   ohnehin bindet"* — **keine** Editor-Seite bindet es. `editor-shell.css` kommt
>   über `css/styles.css:25` (`@import`) in die **App-Hülle**, also in
>   `index.html`; es stylt das äußere Overlay. Die Editor-iframes laden genau
>   zwei Dateien, `css/base/fonts.css` und `css/base/tokens.css` (geprüft in
>   allen drei `<head>`s). Ein gemeinsamer Block bräuchte ein **eigenes**
>   Stylesheet, das die Editor-Seiten wirklich verlinken — dann aber gleich für
>   Bildlaufleisten *und* `font-synthesis-weight` (§8.7).
> - *„die Kopien setzen `7px`, `base.css` einen anderen Wert"* — beide setzten
>   `7px`, sie waren identisch. Die Abweichung entstand **danach und andersherum**:
>   der Siedlungseditor ging in `6cc567db` bewusst auf **10px** mit rundem Daumen
>   und 2px Rand in Spurfarbe. Wer hier „angleichen" liest und auf `base.css`
>   zielt, zieht die Editoren zurück auf 7px.
>
> **Stand:** alle drei Editorseiten tragen denselben 10px-Block, zeichenweise
> gleich — Siedlungen `6cc567db`, Abenteuer `952fb225`, Karten `84b5781e`. Die
> App ringsum bleibt auf `base.css`' 7px. Das ist ein **Unterschied mit Absicht**
> (die Editoren sind Arbeitsflächen mit vielen Scrollbereichen), kein Rest.
>
> ✅ **Erledigt.** Das fehlende Stylesheet gibt es jetzt:
> **`css/components/editor-page.css`**, verlinkt von allen drei Editorseiten. Es
> trägt den Bildlaufleisten-Block **einmal** und dazu die Hüllenmaße aus §3.1a als
> `--avm-*`-Token. Die drei Kopien sind raus, ebenso die drei lokalen Namen für
> dieselbe Bedienhöhe (`--se-` / `--ae-` / `--ce-control-h` → `--avm-control-h`).
> Gemessen: alle Zahlen unverändert, Abweichungen weiterhin 0/0.
>
> 💣 **`editor-page.css` ≠ `editor-shell.css`.** Die Namen klingen gleich und
> meinen Gegenteiliges: `-shell` kommt über `styles.css` in die **App-Hülle**
> (index.html) und stylt das äußere Overlay; `-page` verlinken die **Editorseiten**
> selbst, es gilt also *im* iframe. Genau diese Verwechslung steckte in der alten
> Fassung dieses Abschnitts.

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

6. **⚠️ Der goldene Spaltentitel liegt im Hellmodus unter AA — Owner-Entscheid.**
   `--color-accent-strong` auf `--color-panel` misst **3,78:1** (hell `#9c7f22`
   auf `#fffdf9`); dunkel sind es 8,08. Bei 16px fett gilt die 4,5-Schwelle —
   16px fett ist *kein* „large text" (das beginnt bei 18,66px fett). Wichtig:
   das ist **die von dieser Spec vorgeschriebene Paarung** (§3.2) und steht im
   Siedlungseditor seit `6cc567db` genauso — also kein Alleingang eines Editors,
   sondern eine Frage an das Token. Wer es ändert, ändert es **global** und für
   alle fünf Editoren gleichzeitig, nicht in einer Datei.

7. **⚠️ Den Editor-iframes fehlt `font-synthesis-weight: none` — Owner-Entscheid.**
   Die Regel steht in `css/base/base.css:48`, das die iframes nicht laden (§4.6).
   Faculty Glyphic liefert nur Regular, also rendert jedes `font-weight: 700` in
   den Editoren als **synthetischer** Fettschnitt, während die App ringsum
   bewusst keinen hat. Ein Einzeiler — der aber allen Editoren sichtbar die
   Fettung nimmt, also nicht nebenbei erledigen. Gehört zusammen mit den
   Bildlaufleisten in das gemeinsame Editor-Stylesheet, das §4.6 noch braucht.

8. **`min-height` ist ein Boden, kein Maß.** Eine „Bedienhöhe 32px" über
   `min-height` plus senkrechte Polsterung ergibt **32,84**. Der Siedlungseditor
   schreibt an seinen Knöpfen `padding: 0 …` genau deswegen. Wer eine Höhe
   *behauptet*, misst sie; wer sie misst, misst nicht, was `min-height` sagt.

9. **Ein klebender Spaltentitel darf keinen negativen `margin-top` bekommen.**
   Naheliegend, um in die Panel-Polsterung auszubluten — verschiebt aber den
   Klebepunkt um genau diesen Betrag. Gemessen saß der Titel dann 14px unter der
   Panelkante, und der Inhalt lief durch den Spalt darüber. Stattdessen das
   **Panel oben entpolstern** und die Polsterung dem Titel geben; seitliches
   Ausbluten ist unbedenklich.

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
| 🔶 4 | **Je Editor** Typografie/Abstände/Spalten/Menüband. ✅ Siedlungen `6cc567db` (volle Sprache, **das Vorbild — hier abschreiben**) · ✅ Vorkommen `be08016c` (rem-Dialekt auf die Leiter) · ✅ Menüband aller vier auf volle Breite `19a042c9` · ✅ **Abenteuer `952fb225`** (Spaltentitel, Statuszeile, 32px-Bedienhöhe, Bildlaufleisten, exakte Drittel) · ✅ **Karten `6ba36307` + `84b5781e`** (dasselbe) · ⬜ **Territorien offen** — eigener Fall, siehe unten | mittel |
| 5 | **Herkunft & `↺`** nach §5, zuerst Territorien (dort ist die Datenlage sauber) | mittel |
| 6 | **Quellen** nach §6 — *nach* Abgleich mit §9 | mittel |
| 7 | **Mobil**; Bildlaufleisten sind inhaltlich erledigt (drei Editoren auf 10px), offen bleibt nur das Zusammenlegen der drei Kopien in ein Stylesheet, das die Editorseiten binden — zusammen mit `font-synthesis-weight` (§4.6, §8.7); Doku-Korrekturen aus §8 | gering |

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

### 11.1 Am echten Editor gemessen (nicht mehr am Muster)

Die Muster oben sind Attrappen. Ab Schritt 4 wird in der **echten** Datei
gemessen, über einen PHP-Server auf einem eigenen Port und ein Gestell, das den
Editor im 1400 × 880-Rahmen der Hülle iframed (`verify-adventure-editor.html`,
untracked wie die übrigen `verify-*.html`).

**Abenteuer-Editor** (`952fb225`), alles gemessen:

| | vorher | nachher |
|---|---|---|
| Drei Spalten | 483 / 458 / 458 (Streuung 24,67) | **466,66 / 466,67 / 466,67** (Streuung 0,01) |
| Spaltentitel | keiner in keiner Spalte | 3 × 16px / 700 / `--color-accent-strong`, die zwei scrollenden kleben |
| Statuszeile | fehlt ganz | volle Breite, konstant 31,84 hoch — lange Meldung schiebt die Spalten **nicht** |
| Bedienhöhen | gemischt | Suche / Auswahl / Auswahl / Jahr / Knopf = **je 32** |
| Menüband | 5 gleiche Kacheln | unverändert 5 × 263,2 (Streuung 0,01) |
| Klebender Titel | — | bündig an der Panelkante (Abstand 0), deckend, volle Scheibenbreite |
| Bildlaufleiste | 7px | 10px, runder Daumen, Tokens |

**Karten-Editor** (`6ba36307` + `84b5781e`): Spalten **458,66 / 458,67 / 458,67**
(vorher 459 / 673 / 244, Streuung 429), Bildlaufleiste gemessen 10px.

### 11.2 Alle drei nebeneinander (Hüllenmaße, §3.1a)

Gestell `verify-editor-diff.html`: lädt Siedlungs-, Abenteuer- und Karten-Editor
in je einen 1400 × 880-Rahmen und vergleicht jede Eigenschaft **gegen das
Vorbild**, nicht gegen die Mehrheit.

| | vorher | nachher |
|---|---|---|
| Abweichungen vom Vorbild | Abenteuer **8**, Karten **7** | **0 / 0** |
| Statuszeile | 6/18 · 6/14 | beide 6/14 |
| Menüband | 12/18 g12 · 12/14 g10 | beide 10/14, Abstand 6 |
| Spalten-Innenrand | 0/18/14 · 0/14/14 | beide 8/12 |
| Spaltentitel | klebend · nicht klebend | beide außerhalb des Scrollbereichs |
| Listenzeile | schwebend r8 · randlos mit Trennlinie | beide schwebend, 4/6, `--radius-md` |
| `.pill--manual` | Gold · transparent-grau | beide Gold |
| `.pill--kind` | grau · Gold | beide grau |

> **Warum nicht einfach „mach's wie den Siedlungseditor":** das Vorbild trägt an
> einigen Stellen `font-size: 10px` und `font-weight: 600` — Werte, die §4.1/§4.2
> anderswo streichen. Diese wurden nicht übernommen.
>
> ⚠️ **Korrektur 2026-07-23.** Frühere Fassungen dieses Absatzes zählten die
> **gerahmten Scrollkästen** (`#seList` & Co.) zu den „nicht zu übernehmenden"
> Dingen und beriefen sich auf AGENTS.md §12 („nach Trennern gruppieren, nicht
> nach gerahmten Kästen"). **Das war falsch, und der Owner hat es zweimal
> korrigiert** — mündlich („das braun im hintergrund und die schönen rahmen") und
> im Vergleich mit Territorien, das die Kästen in `673413ce` „word-for-word" vom
> Siedlungseditor übernommen hat. Die Kästen sind **Teil der Sprache**, nicht ihr
> Verstoß; §12 galt für Buttons/Popups, nicht für die Editor-Spalten. Sie sind
> jetzt in §3.1d verbindlich.

> 💣 **Die Lehre aus §3.1c: „0 Abweichungen" ist keine Aussage über das Ganze,
> sondern über die Liste, die man geprüft hat.** Nach der Hüllen-Angleichung stand
> hier 0/0 — und der Owner sah beim nächsten Blick sofort, dass die Editoren
> verschieden sprechen. Die Messung deckte Polsterungen und Maße ab, nicht den
> Aufbau der Felder und nicht die Filterdarstellung. Wer eine Gleichheit behauptet,
> nennt dazu, **was** verglichen wurde.

> **Falschmessungen, die erst auffielen, als sie fehlschlugen** — jedes Mal
> war die Erwartung falsch, nicht der Code:
> - Die Statuszeile *soll* nicht exakt 30 hoch sein. `min-height: 30px` ist ein
>   Boden; 13px Text plus 2×6px Polsterung ergeben 31,84, im Siedlungseditor mit
>   denselben Werten genauso. Zu prüfen ist die **Konstanz**, nicht die Zahl.
> - Ein klebender Titel kann die **Bildlaufleiste nicht überdecken**. Gegen
>   `clientWidth` messen, nicht gegen die Rahmenbox — sonst fehlen immer 11px
>   (10 Leiste + 1 Trenner) und man „repariert" etwas Heiles.
> - **Der Zoom des Prüf-Panes schwankt zwischen Läufen und skaliert jede Zahl
>   mit.** Ein Lauf meldete den 1px-Spaltentrenner als `0.666667px` (= 1 ÷ 1,5)
>   und damit zwei Fehlschläge, während im Stylesheet unverändert `1px` stand.
>   Zahlen aus zwei Läufen sind nur vergleichbar, wenn `devicePixelRatio` gleich
>   ist — das Gestell gibt es deshalb als erste Zeile aus. Für „gibt es eine
>   Linie?" nicht die benutzte Breite gegen `"1px"` prüfen, sondern `> 0` plus
>   die Deklaration im Stylesheet.
> - **Regeln in einer verlinkten Datei stehen nicht im `<style>` der Seite.** Als
>   der Bildlaufleisten-Block nach `editor-page.css` zog, meldeten vier Prüfungen
>   Fehler, die `document.querySelectorAll("style")` durchsuchten. Zusätzlich die
>   CSSOM lesen (`styleSheets` → `cssRules`) — **mit Positivkontrolle**, sonst
>   besteht jede „X kommt nicht mehr vor"-Prüfung, weil gar nichts gelesen wurde.
> - **Was erst mit Daten entsteht, ist ohne Login nicht messbar.** Formularfelder
>   und der Filterknopf existieren nur bei geladenem Eintrag; eine DOM-Messung
>   meldete „fehlt" statt eines Befunds. Dort die **Regel** vergleichen und das
>   auch so beschriften — oder den Zustand stubben, wo es geht.

**Nicht verifiziert:** Tippziele auf schmalem Schirm, und sämtliche Aussagen am
**laufenden** Produkt — die Editorlisten brauchen einen Login, lokal antwortet die
API mit 401 (was den Fehlerpfad der Statuszeile immerhin echt vorführt). Der
Owner-Browser ist die verlässliche Instanz. Ebenfalls offen: der Hell/Dunkel-
Vergleich im Browser-Pane ist unzuverlässig (gecachte `tokens.css`) — die
Kontrastzahlen in §8.6 sind deshalb aus den Token-Werten **gerechnet**, nicht
abgelesen.

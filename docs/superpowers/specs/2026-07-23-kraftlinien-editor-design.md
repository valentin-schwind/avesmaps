# Kraftlinien-Editor (sechster Editor) — Design

**Datum:** 2026-07-23 · **Auftraggeber:** Owner · **Bezug:** AGENTS.md §12
(Designsprache), `docs/superpowers/specs/2026-07-22-editor-designsprache-design.md`,
Vorbild `html/wiki-sync-settlement-editor.html` (Commit 6cc567db-Reihe).

## 1. Ausgangslage

Eine Kraftlinie ist **keine Zeile**, sondern viele `map_features`-Segmente
(`feature_type='powerline'`), allein über den gleichen `name` zusammengehalten.
Live gemessen (2026-07-22): **162 Segmente / ~40–61 Namen**. Jedes Segment
verbindet **genau zwei Knoten** (`properties.from_public_id` /
`to_public_id`) — echte Orte, entweder Nodix-Orte (`is_nodix`) oder Kreuzungen
(`feature_subtype='crossing'`). Manuelle Felder (`properties.description`,
`properties.wiki_url`, `show_label`), Quellen (`entity_type='powerline'`, je
Segment-`public_id`) und die Wiki-Daten (`properties.wiki_powerline`, vom
`sync_powerlines`-Reconciler) sitzen **heute pro Segment**.

Topologie ist gemischt (Kommentar in `map-features-powerlines.js:78`): 54 Namen
sind Stränge (2 Enden), 6 sind verzweigt (bis 6 Enden — Basiliuslinie,
Yaquirlinie, Elementares Hexagramm, Strick des Schwarzen Mannes …), einer ist ein
Ring (Hexenband, 0 Enden). Tippfehler zerlegen eine Linie in zwei Namen
(„Elementares Hexagramm" ≠ „Elementare Hexagramm").

**Einziger Editier-Weg heute:** das Karten-Popup `#powerline-edit-form`
(`index.html:1089`) → Aktion `update_powerline_details`
(`api/_internal/map/features.php:1422`). Es schreibt auf **ein** Segment. In der
Subjekt-Registry (`js/review/review-subjects.js:65`) hat `powerlines`
`editorButtonId: null` — genau das ändert sich.

**Schon vorhanden (verifiziert 2026-07-23):** der Kraftlinien-Wiki-Sync
(`sync_powerlines` in `api/edit/wiki/dump.php:616`, Reconciler
`api/_internal/wiki/powerlines.php`, Button `#wiki-sync-powerlines-sync`
`index.html:485`, Handler `bootstrap.js:351`, Infobox mit `wiki_powerline`-Block
`map-features-powerlines.js:342`). Die Infobox-Spec §5 hat den Sync als „Schritt
2" angekündigt; er ist inzwischen gebaut. **Der Editor baut also nichts am Sync,
er holt nur dessen einen Knopf ins Fenster.**

## 2. Die drei Weichen — Owner-Entscheidungen (2026-07-23)

1. **Datenmodell:** „**Linie = alle ihre Segmente**" — **kein Schema-Umbau**. Der
   Editor gruppiert über den Namen; Linien-Felder fließen auf alle Segmente.
2. **Knoten-Spalte:** „**volles Management im Editor**" — Knoten ansehen,
   hinzufügen (Nodix-Autocomplete), entfernen, umsortieren.
3. **Layout:** drei Spalten **Kraftlinien | Eigenschaften | Knoten** (Owner-Idee).

## 3. Konsequenz von „Linie = alle Segmente"

Der schöne Nebeneffekt: **Umbenennen IST Zusammenführen.** Bekommt „Elementare
Hexagramm" exakt den Namen „Elementares Hexagramm", sind sie ab dem Moment
dieselbe Linie (der Name ist das Band). Die Dubletten-Behebung fällt gratis mit
der Umbenennen-Funktion ab. Der Editor **markiert** Beinahe-Dubletten und
„URL-im-Namen"-Fälle als Zusammenführen-/Bereinigungs-Kandidaten (Kandidaten
fürs ⚖️ Konfliktzentrum, aber hier nur Anzeige).

**Regel für alle Linien-Schreibvorgänge:** Name, `show_label`, `description`,
`wiki_url` werden beim Speichern auf **alle** Segmente des (aktuellen) Namens
geschrieben. Weil die Infobox pro angeklicktem Segment liest, ist damit jedes
Segment nach dem Speichern konsistent — **die gelieferte Infobox bleibt
unverändert** (Ausnahme: die Quellenzeile, siehe §10).

## 4. Architektur & Verdrahtung (Siedlungs-Muster)

Der Siedlungseditor ist die **einzige** Referenz auf der neuen gemeinsamen Hülle
und damit die Vorlage. Er ist **kein** statisches Overlay in `index.html` und
**nicht** der Inline-Host, sondern ein per JS gebautes Overlay mit **iframe**:

* **Registry** `js/review/review-subjects.js:65`: `powerlines` bekommt
  `editorButtonId: "powerline-editor-open"`. Die Verb-Leiste zeigt dann
  „Bearbeiten"; `wikiSyncSubjectButtonId` liefert automatisch den Editor-Knopf
  statt des Sync-Knopfs (keine Doppelung, kein Zweitfeuer).
* **Knopf** im WikiSync-Panel (`index.html`, neben `#settlement-editor-open`):
  `<button id="powerline-editor-open" class="wiki-sync-panel__start">`.
* **Klick-Bindung** `js/app/bootstrap.js` (analog `:276`):
  `$("#powerline-editor-open").on("click", () => openAvesmapsPowerlineEditorOverlay());`
* **Overlay-Fabrik** modelliert nach
  `review-settlement-list.js:654-699` (`avm-editor-*`-Klassen aus
  `css/components/editor-shell.css`), iframe-`src =
  "/html/wiki-sync-powerline-editor.html?v=" + Date.now()`. Wieder-Öffnen
  ent-versteckt das bestehende Overlay. Sie darf in `review-settlement-list.js`
  wohnen (wie Karten/Abenteuer) oder — sauberer — in einem neuen kleinen Modul
  `js/review/review-powerline-list.js`; **Entscheidung: neues Modul**, damit die
  ohnehin große `review-settlement-list.js` nicht weiter wächst.
* **iframe-Seite** neu: `html/wiki-sync-powerline-editor.html`, self-contained,
  bindet `/css/base/fonts.css`, `/css/base/tokens.css`,
  `/css/components/editor-page.css`, `/css/components/source-autocomplete.css`,
  `/css/components/feature-sources.css` und die geteilten Skripte
  `/js/ui/source-autocomplete.js`, `/js/review/review-feature-sources.js`
  (`mountFeatureSourceEditor`), plus einen eigenen Inline-`<script>` mit
  `boot()`-Einstieg. Theme-Auflösung wie die anderen iframes (localStorage >
  prefers-color-scheme, Kopf von `wiki-sync-settlement-editor.html:8`).

**Kein `ASSET_VERSION`-Bump.** Der gilt nur für die dynamisch geladenen Assets des
Territorien-Inline-Hosts (AGENTS.md §7). Die iframe-`src` trägt einen
`Date.now()`-Cache-Buster; die verlinkten CSS/JS stempelt der Deploy.

## 5. Hülle & Designsprache

* **Drei GLEICHE Spalten per GRID** — `display:grid;
  grid-template-columns:repeat(3, minmax(0,1fr))`. **Nicht** `flex:1 1 0`
  (Owner-Hartregel „drei gleiche Spalten"; border-box + flex-basis ergibt keine
  sauberen Drittel — vgl. Memory `flex-basis-border-box-column-floor`).
* **Hintergründe** (der Owner-Hinweis 2026-07-23): Spaltenfläche =
  `--color-page-bg` (dunkler, dark #211f19), Scroll-/Listen-/Detailkästen =
  `--color-panel` (heller, dark #312e26). Menüband = `--color-panel`, Statuszeile
  = `--color-panel-soft`. Exakt wie im Siedlungseditor
  (`wiki-sync-settlement-editor.html` body=`--bg`, `#seList` etc.=`--color-panel`).
* **Menüband:** gleich breite Kacheln über die volle Breite
  (`grid-auto-flow:column; grid-auto-columns:minmax(0,1fr)`), `.btn2`
  zweizeilig. Drei Kacheln: **„⚡ Kraftlinien syncen"** (`.primary`, **nur diese
  trägt ein Icon**; ruft `window.parent.startWikiSyncPowerlines()` auf — der eine
  Sync-Knopf zieht ins Fenster, wie `#seSyncen` bei Siedlungen), **„Dubletten
  zeigen"** (Listenfilter, §6) und **„Nur Auswahl auf Karte"** (Karten-Filter-
  Toggle, wie im Siedlungseditor). Statuszeile darunter, eigene Zeile, feste
  Mindesthöhe.
* **Bildlaufleisten:** 10px, runder Daumen, 2px Rand in Spurfarbe — kommt aus
  `editor-page.css`, nicht der 7px-App-Wert.
* **Feldreihenfolge** der Eigenschaften-Spalte: Wappen → Bilder → Identität →
  Rest → Quellen. **Kraftlinien haben kein Wappen und keine eigenen Bilder → diese
  beiden Zeilen entfallen** (nicht erfinden). Also: Identität → Beschreibung →
  Quellen → (read-only) Wiki-Block.
* **Buttons-Hierarchie, Tokens, kein Blau, externe Links mit ↝** (AGENTS.md §12).
* Gerahmte Scroll-Kästen außen, innen offene Zeilen mit Trenner; Knoten als
  schwebende Kärtchen.

## 6. Spalte 1 — Kraftlinien

* Titel „Kraftlinien", Suchfeld, Scroll-Liste der **~40 Linien** (über den Namen
  gruppiert; Reihenfolge alphabetisch).
* Zeile (`.se-row`-Muster): **Name** (fett) + Typ-Kürzel rechts
  („Strang" / „verzweigt" / „Ring"); Zeile 2 = `Knoten · Segmente · Spanne`
  (grün = sauber) **oder** ein **⚠-Hinweis** (amber) für Beinahe-Dublette
  („zusammenführen?"), Ein-Segment-Tippfehler, „URL im Namen".
* Menüband-Kachel **„Dubletten zeigen"** filtert die Liste auf die
  markierten Kandidaten (Toggle, `is-active`-Einfärbung).
* Auswahl (`is-selected`) lädt Spalten 2+3.

## 7. Spalte 2 — Eigenschaften

Gruppen mit Trenner (`.dt-grp`), Felder im `.dt-grid`/`.dt-edit-grid`-Muster
(Beschriftung links, feste `--avm-field-label-w`):

* **Identität**
  * **Name** (`text`) — Hinweiszeile darunter: „schreibt auf alle N Segmente ·
    exakt gleicher Name wie eine andere Linie ⇒ beide verschmelzen".
  * **Name auf der Karte anzeigen** (`checkbox` → `show_label`).
  * **Wiki-Link** (`url`, **sichtbar**, mit `↝`-Öffnen) — ausdrücklich gesetzt,
    nie geraten (der Enrichment-Riegel für powerlines bleibt, §13).
* **Beschreibung** (`textarea`).
* **Quellen** — Container + `mountFeatureSourceEditor(el, "powerline",
  () => anchorPublicId)` (Anker-Segment, §10).
* **Aus dem Wiki** (read-only, `.dt-badge` „Sync · nicht editierbar"): Stärke,
  Affinität, Länge, Regionen aus `properties.wiki_powerline`. Sichtbar getrennt
  vom Editierbaren; leere Werte fallen weg.
* **Aktionen:** Speichern (primär), Löschen (die **ganze** Linie = alle
  Segmente; harte Rückfrage), Statuszeile („Gespeichert – auf N Segmente
  geschrieben.").

## 8. Spalte 3 — Knoten (volles Management)

Zwei Darstellungen, je nach Topologie — **ehrlich statt einheitlich**:

* **Strang (54 von 61) → Faden.** Geordnete Knotenkette; Enden markiert.
  Je Knoten ein Kärtchen: Name, Typ-Badge (Nodix / Kreuzung),
  Problem-Flag, ◎ „auf Karte zeigen" (Fly-to via
  `data-station-*`-Muster wie im Popup), ✕ entfernen. ⠿ ziehen zum **Umsortieren**.
  „**+ Knoten hinzufügen**" öffnet einen **Nodix-Autocomplete** (Muster
  `.dt-territory-picker`/`source-autocomplete`) über die Kandidatenliste.
* **Verzweigt (6) + Ring (1) → Kantenliste.** Ein Faden würde lügen. Statt der
  Kette eine Liste der **Segmente** „A — B", je mit ✕; „+ Kante hinzufügen"
  (zwei Knoten wählen). Trägt jede Topologie. Beim Ring oben der Hinweis
  „geschlossener Ring".

**Knoten-Operationen auf das Segment-Modell abgebildet (kein Schema-Umbau):**

* **Hinzufügen** = neues Segment mit dem **Namen der Linie** zwischen einem
  bestehenden Knoten und dem gewählten Nodix (`create_powerline` mit `name`,
  §9). Geometrie = gerade Linie zwischen beiden Orten (wie heute).
* **Entfernen** (Knoten) = die inzidenten Segmente löschen (`delete_feature`).
  Warnung, wenn das die Linie zerteilt. Ist das gelöschte Segment das
  Anker-Segment mit Quellen → Quellen vorher aufs neue Anker-Segment umhängen
  (§10).
* **Umsortieren** (nur Strang) = aus der neuen Knotenreihenfolge die
  Kantenmenge neu berechnen, gegen die aktuelle diffen, Differenz über
  `create_powerline`/`delete_feature` anwenden. Client-getrieben über die
  Primitive; Teil-Fehlschläge werden gemeldet und die Ansicht neu geladen.
  (Aufwändigste Knoten-Operation; siehe Bauabschnitte §14.)

**Kandidaten** für „hinzufügen": Orte mit `is_nodix=1` **oder**
`feature_subtype='crossing'`. Kommen einmal vom Lese-Endpunkt (§9), der Picker
filtert clientseitig.

## 9. Backend

**Lese-Endpunkt (neu):** `GET /api/edit/map/powerlines.php` (Capability `edit`,
Envelope `{ok:true,…}`). Liefert das Rohmaterial in einem Zug:

```
{ ok:true,
  segments: [ { public_id, name, from_public_id, to_public_id,
                show_label, description, wiki_url, wiki_powerline, revision } ],
  nodes:    { "<public_id>": { name, type, is_nodix } },   // für alle from/to
  nodix_candidates: [ { public_id, name, type } ] }         // is_nodix ODER crossing
```

Die **Gruppierung + Topologie** (Enden/Stationen/Ring) rechnet die iframe-Seite
mit **geteilten reinen Helfern** (§12), nicht der Endpunkt — so kann keine
zweite Topologie-Logik auseinanderlaufen. Quellen lädt/speichert der
`mountFeatureSourceEditor`-Widget selbst über die bestehenden
feature-sources-Endpunkte (Anker-`public_id`).

**Schreib-Aktionen** (über `submitMapFeatureEdit`, `api/edit/map/...`):

* **`update_powerline_line` (neu)** — Payload
  `{ current_name, new_name, show_label, description, wiki_url }`. Findet in einer
  Transaktion alle Segmente mit `current_name` und schreibt
  `new_name`/`show_label`/`description`/`wiki_url` auf **alle**. `new_name` gleich
  einem anderen bestehenden Namen ⇒ die Gruppen verschmelzen (nichts
  Zusätzliches nötig). Audit-Log je Segment (oder ein Gruppen-Eintrag). Bump
  `map_revision`.
* **`create_powerline` (erweitern)** — optionales `name` akzeptieren; ohne
  `name` bleibt das heutige Auto-„A - B". Der Editor übergibt beim
  Knoten-Hinzufügen `name` = Linienname + `from/to`.
* **`delete_feature` (vorhanden)** — Segment entfernen. Beim Löschen eines
  powerline-Segments, das Quellen trägt, dessen `feature_sources` auf ein anderes
  gleichnamiges Segment umhängen (Anker-Erhalt, §10).

**Optimistisches Sperren:** Linienweite Schreibvorgänge lösen die Gruppe zur
Schreibzeit über `current_name` neu auf (der Name ist das Band); der Client
schickt die zuletzt bekannte `map_revision`, die Aktion prüft/bumpt sie wie die
bestehenden Feature-Edits (`avesmapsAssertFeatureCanBeEdited`-Muster, auf die
Gruppe angewandt).

## 10. Quellen-Strategie — Anker-Segment (kein Zweitsystem, keine Vervielfachung)

Nach AGENTS.md §5 („Sources live in ONE place") ist `powerline` bereits ein
`entity_type` (Infobox-Spec §3.2, geliefert). **Für die Linie kein Fan-out auf N
Segmente**, sondern ein **Anker-Segment**:

* **Anker** = das Segment der Namensgruppe mit dem **kleinsten `public_id`**
  (deterministisch, überall ableitbar).
* Der Quellen-Editor mountet gegen den Anker; der Anker trägt die
  `feature_sources`-Zeilen. Keine Vervielfachung.
* **Infobox-Änderung (klein):** `powerlineInfoboxMarkup`
  (`map-features-powerlines.js:377`) liest die Quellen künftig vom **Anker der
  Namensgruppe** statt vom angeklickten Segment — so zeigt jeder Klick auf die
  Linie ihre Quellen (dieselbe Namens-Aggregation wie die „Verbindet"-Zeile
  bereits nutzt). ~3 Zeilen.
* **Anker-Erhalt:** Löscht man das Anker-Segment, hängen seine
  `feature_sources` vorher auf das neue Anker-Segment um (§9 `delete_feature`).

*Warum nicht Fan-out:* N Kopien je Quelle, plus „neues Segment ohne Quellen"-Lücke
und eine Reconcile-Maschinerie über die Gruppe. Der Anker ist eine
Infobox-Zeile Arbeit und hält die Quellen an EINER Stelle.

## 11. Kohärenz mit dem Karten-Popup

Mit „Linie = alle Segmente" ist die Ein-Segment-Bearbeitung des Popups
(`#powerline-edit-form`) ein Fußangel: den Namen *eines* Segments zu ändern
zerteilt die Linie. **Deshalb:** der Popup-Knopf „Bearbeiten"
(`data-popup-action="edit-powerline-details"`) öffnet künftig den **neuen
Linien-Editor** auf der angeklickten Linie
(`openAvesmapsPowerlineEditorOverlay({ preselectName })`), statt das alte
Ein-Segment-Formular. Das alte `#powerline-edit-form` kann danach entfallen
(eigener kleiner Aufräumschritt) oder vorerst ungenutzt bleiben.

## 12. Gemeinsame Topologie-Helfer (Refactor)

Die reinen Topologie-Funktionen aus `js/map-features/map-features-powerlines.js`
(`getPowerlineSegmentsSharingName`, `buildPowerlineAdjacency`,
`walkToNamedPowerlineEndpoint`, `getPowerlineTopology`) werden in ein
**dependency-freies** Modul `js/map-features/powerline-topology.js`
herausgezogen und um einen **Knoten-Info-Nachschlag als Parameter** entkoppelt
(statt des App-Globals `findLocationMarkerByPublicId` /
`CROSSING_LOCATION_TYPE`). Die App reicht ihren marker-basierten Nachschlag
hinein; die iframe-Seite reicht den Nachschlag aus dem Endpunkt (§9). Ein Modul,
zwei Aufrufer, keine zweite Topologie-Wahrheit. Unit-getestet (die Verzweigt-/
Ring-/Strang-Fälle wie im bestehenden Kommentar dokumentiert).

## 13. Bewusst NICHT / Randfälle

* **Kein Schema-Umbau**, kein Linien-Entity, keine zweite Quellen-Tabelle.
* **Kein geratener Wiki-Link:** `avesmapsEnrichMapFeatureWikiUrl` überspringt
  `powerline` weiterhin (Infobox-Spec §4) — der sichtbare Link ist die einzige
  Quelle des Werts.
* **Keine Facetten** für die Kraftlinien-Liste (Owner: 61 Namen zu wenig,
  `review-subjects.js:94`). Nur Suche + „Dubletten zeigen".
* **`show_label`** fließt auf alle Segmente; mehrfach identische Labels regelt
  das bestehende Label-Kollisionssystem (kein neues Verhalten hier).
* **Verzweigt/Ring:** keine „Verbindet"-Zeile mit zwei Enden, sondern „Verläuft
  über" (Infobox tut das schon) — der Editor spiegelt das in der Kantenliste.

## 14. Umfang, Bauabschnitte, Tests

**Neu:** `html/wiki-sync-powerline-editor.html`, `js/review/review-powerline-list.js`,
`js/map-features/powerline-topology.js`, `api/edit/map/powerlines.php`,
`js/map-features/__tests__/powerline-topology.test.*` (+ ggf. PHP-Test für
`update_powerline_line`).

**Berührt:** `js/review/review-subjects.js` (editorButtonId), `index.html`
(Knopf), `js/app/bootstrap.js` (Klick), `js/map-features/map-features-powerlines.js`
(Helfer-Auslagerung + Anker-Quellenzeile + Popup-„Bearbeiten" umleiten),
`api/_internal/map/features.php` (`update_powerline_line`, `create_powerline`
+`name`, `delete_feature` Quellen-Umhang).

**Bauabschnitte** (kleine, geprüfte Commits — Endzustand bleibt „volles
Management"):

1. Verdrahtung + Hülle: Registry, Knopf, Fabrik, iframe-Seite mit 3 Spalten
   (Design abgenommen). Liste (Spalte 1) + Auswahl. Lese-Endpunkt + Helfer-Refactor.
2. Eigenschaften (Spalte 2): `update_powerline_line` (Umbenennen = Verschmelzen,
   write-through), Wiki-Block read-only, Quellen am Anker + Infobox-Anker-Zeile.
3. Knoten (Spalte 3): Faden read-only + Fly-to; dann Hinzufügen
   (`create_powerline`+`name`, Nodix-Autocomplete) + Entfernen; dann
   Kantenliste für Verzweigt/Ring; dann Umsortieren (Strang).
4. Popup-„Bearbeiten" leitet auf den Editor um; altes `#powerline-edit-form`
   aufräumen.

**Tests:** `powerline-topology`-Helfer (Strang/verzweigt/Ring/leer);
`update_powerline_line` (write-through + Merge); Anker-Ableitung. Optik per
Live-/Screenshot-Check (Pflicht, nicht aus Struktur schließen).

## 15. Handbuch & Betrieb

* **Handbuch nicht selbst anfassen.** AGENTS.md §9 (Stand 2026-07-22): eine
  editor-sichtbare Änderung wird **im Commit-Betreff benannt**; die Nachtroutine
  `avesmaps-handbuch-pflege` schreibt `html/editor-handbuch.html` fort. (Die
  ältere „im selben Commit"-Regel ist überholt.)
* **Geteilter Working Tree:** nur eigene Pfade explizit stagen; geteilte Dateien
  (`index.html`, `review-subjects.js`, `bootstrap.js`,
  `map-features-powerlines.js`, `features.php`) vor dem Commit `git diff` lesen
  und fremde Hunks aussparen.
* **STRATO:** den Lese-Endpunkt beim Test nicht in der Schleife proben.

## 16. Abnahme

1. WikiSync-Panel → „Kraftlinien" zeigt „Bearbeiten"; Klick öffnet das
   Editor-Overlay mit drei gleichen Spalten, dunklerer Spaltenfläche und
   helleren Kästen wie in Siedlungen.
2. Spalte 1 listet ~40 Linien; Beinahe-Dubletten/URL-im-Namen sind markiert;
   „Dubletten zeigen" filtert darauf.
3. Namen einer Linie ändern schreibt auf alle Segmente; auf einen bestehenden
   Namen umbenennen **verschmilzt** die beiden Linien (Segmentzahl summiert
   sich, die Dublette verschwindet).
4. Beschreibung/Wiki-Link/Quellen einmal gesetzt erscheinen in der Infobox jedes
   Segments der Linie; ein gesetzter Wiki-Link mit `↝`; kein geratener Link.
5. Spalte 3: Strang als Faden mit Enden; Knoten hinzufügen (Nodix-Suche),
   entfernen, umsortieren wirkt auf der Karte; verzweigte Linie + Ring als
   Kantenliste.
6. Karten-Popup „Bearbeiten" öffnet denselben Editor auf der Linie.
7. Wege/Siedlungen/Regionen/Gebiete zeigen unverändert dieselben Quellen wie
   zuvor (die Anker-Zeile verschiebt nichts Bestehendes).

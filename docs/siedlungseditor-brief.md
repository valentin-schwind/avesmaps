# Siedlungseditor — Brief & Instruktionen für eine neue Session

> **Zweck:** Handoff-Dokument. Eine neue Claude-Session soll damit mit dem Owner
> ein **Mockup** für den Siedlungseditor planen und dann umsetzen. Dieses Doc ist
> die gegroundete Ausgangsbasis (echte Datei-/Datenreferenzen, die kniffligen
> Teile), **nicht** die fertige Spec — die entsteht im Brainstorming.

## 0. Auftrag an die neue Session (Prozess)

1. **Zuerst `superpowers:brainstorming`** — mit dem Owner das Mockup/Design im
   Dialog schärfen (der visuelle Companion bietet sich für die 3-Spalten-Optik an).
2. Dann `superpowers:writing-plans` → `superpowers:subagent-driven-development`.
3. **Konventionen (hart):** UI-Strings **Deutsch**; Code/Commits/interne
   API-`message`s **Englisch**. **Nur Editmodus**, Frontend bleibt unangetastet.
   Editor-Assets → `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js`
   bumpen + Hard-Reload. **Shared Working Tree:** nur eigene Dateien per Pfad
   stagen, nie `git add -A`, rebase-sicher pushen. **STRATO:** keine schweren
   Endpoints loopen (globaler Ray-Cast client-seitig batchen; Saves chunked +
   dry-run). **Keine Prod-DB-Writes durch den Agent** — self-healing DDL ok, echte
   Writes führt der Owner (phpMyAdmin/Konsole). **KERN-INVARIANTE** (teuer gelernt):
   der Territorien-Baum wird aus **`parent_wiki_key`** gebaut → Ahnen/Nachfahren
   **immer** über `parent_wiki_key`, **nie** über `affiliation_path`.

## 1. Ziel

Ein neuer **Siedlungseditor**, geöffnet wie der Territoriumseditor über einen
**„WikiSync & Editor"**-Button im **WikiSync → Siedlungen**-Tab. Er spiegelt den
Territoriumseditor (3 Spalten, Toolbar, Override-System, Wappen), bedient aber
Siedlungen. **Nur Editmodus** — das öffentliche Frontend ändert sich nicht.

## 2. Design-Vorlage: der bestehende Territoriumseditor

Ist bereits ein **standalone Iframe** `html/wiki-sync-monitor.html` (3 Spalten):
- **Öffnen:** `js/review/review-wiki-sync.js:1016–1077` — `openAvesmapsSyncEditorOverlay()`
  baut ein Overlay mit `<iframe src="/html/wiki-sync-monitor.html?v=…">`.
- **Layout:** `html/wiki-sync-monitor.html:188–252` — `.cols` (flex row) mit
  `#left` / `#right` / `#detail`; Header = Toolbar; `#status` = Statuszeile +
  Kontinent-Dropdown.
- **Detail-Panel:** `:580–708` — `DETAIL_FIELDS`-Array + Override-Anzeige
  (`<alt> → <neu>`, Badge `✎ manuell`, Reset `↺`, `effVal(n,key)=override ?? wiki`),
  Wappen-Upload + Lizenz, und ein **„🔗 Stadt aus Locations wählen"**-Picker für die
  Hauptstadt (d. h. eine Territorium→Siedlung-Verknüpfung für Hauptstädte existiert
  schon via `political_territory.capital_place_id`/`seat_place_id`).
- **Toolbar:** `:190–197` — Syncen / Hierarchie / Unterschiede / Test /
  Daten übernehmen / Modell übernehmen / Wappen lokalisieren.
- **Filter:** Kontinent-Dropdown (global), Zeit/BF (von–bis + „heute"),
  „nur Flächenländer" — pro Pane.

**Für den Siedlungseditor:** neue Datei `html/wiki-sync-settlement-editor.html`
(o. ä.) + neuer Button im Siedlungen-Tab; dasselbe Overlay-/Iframe-Muster.

## 3. Die drei Spalten (Owner-Vorgabe)

- **LINKS — Territorien-Hierarchie (read-only Abbild der bestehenden Liste).**
  Reines Filter-Werkzeug mit **Mehrfachauswahl (Häkchen)**. Quelle: derselbe
  Baum wie im WikiSync-Tab (`model_tree` / `js/territory/territory-wiki-tree.js`).
- **MITTE — „Alle Siedlungen".** Die bestehende flache Siedlungsliste, gefiltert
  durch die Territorien-Auswahl links **plus** Suche + Typ- + Kontinent-Filter +
  Tabs (wie heute).
- **RECHTS — Siedlungs-Eigenschaften.** Alle Felder (siehe §4) mit Wappen,
  Overrides und dem neuen **„Andere Quelle"**-Feld (gerade in die Editoren
  eingezogen, `c1c86a0f`/`795d35f2`).

## 4. Siedlungs-Datenmodell (gegroundet)

Siedlung = `map_features`-Zeile (`feature_type='location'`,
`feature_subtype ∈ {metropole, grossstadt, stadt, kleinstadt, dorf, gebaeude}`).
Metadaten in **`properties_json`**:
- `wiki_settlement` (aus {{Infobox Siedlung}}): `name, art, einwohner,
  bevoelkerung, oberhaupt, region, staat, lage, handelszone, verkehrswege, tempel,
  description, wappen_url, wiki_url` (+ `title/wiki_key/match_key/settlement_class/
  settlement_label`).
- `coat` (`url, source: own|wiki, license_status, author, attribution`).
- `is_nodix`, `is_ruined`, `wiki_url`, `description` + Overrides.
- Punkt-Geometrie: `geometry_json` (Point, GeoJSON `[lng, lat]`).

**Endpoints:** `api/edit/wiki/settlements.php` (u. a. `list_locations`, `search`,
`assignment`, `assign_to`, `set_coat`, `preview`) + `settlement-coat-upload.php`.
Liste/Tab: `index.html:407–411`, `js/review/review-settlement-list.js`.

> **KRITISCH:** Es gibt **keine** Siedlung→Territorium-Verknüpfung — nur die
> **Freitexte** `staat`/`region` aus dem Wiki. Genau das ist die „Siedlung weiß
> nicht wo sie ist"-Situation. Das Ray-Casting muss ein **neues, persistiertes
> Feld** setzen (Vorschlag: `properties_json.territory_wiki_key` + optional
> `territory_public_id`; alternativ eigene Spalte/Tabelle — im Brainstorming
> entscheiden).

## 5. Kniffliger Teil A — Territorien-Filter mit Hierarchie-Containment

Jede Siedlung bekommt (per Ray-Casting) ihr **tiefstes enthaltendes** Territorium
(z. B. Baronie A). Der Filter arbeitet dann über **Nachfahren-Containment**:

- Häkchen an Knoten **N** → zeige alle Siedlungen, deren zugeordnetes Territorium
  **N selbst oder ein Nachfahre von N** ist.
- Baronie A anhaken → nur Siedlungen in A. Grafschaft anhaken → Siedlungen in
  **allen** Baronien der Grafschaft. Staat anhaken → alles darunter.
- Owner-Beispiel: Siedlung in *Staat → Grafschaft → Baronie A* ist über A **und**
  über Grafschaft **und** über Staat sichtbar, aber **nicht** über Baronie B.

**Implementierungshinweis:** pro angehaktem Knoten die **Nachfahren-Menge** per
DFS über `parent_wiki_key`-Kinder bilden; Siedlung sichtbar, wenn ihr
`territory_wiki_key` in der Vereinigung aller Nachfahren-Mengen liegt. Die
Häkchen-**Kaskade** (Baronie wählen markiert visuell die Ahnen Grafschaft/Staat)
ist reine UI — die eigentliche Filterung ist die Nachfahren-Mengen-Prüfung.

## 6. Kniffliger Teil B — Jordan-Ray-Casting (Siedlung → Territorium)

**Existiert noch nicht** (weder Feature noch PIP-Util) → neu bauen.

- **Algorithmus:** even-odd/crossing-number Point-in-Polygon, **MultiPolygon-fähig**,
  **Loch-Ringe** (innere Ringe) korrekt behandeln. `polygon-clipping.umd.min.js`
  ist nur Boolean-Ops, kein PIP.
- **Geometrie-Quelle (Client):** `window.regionData` — GeoJSON-FeatureCollection,
  Koordinaten `[lng, lat]`, `Polygon`/`MultiPolygon`, `properties.territory_public_id`
  (`js/map-features/map-features-political-territory-loader.js:270`).
- **Siedlungs-Punkt:** `map_features.geometry_json` (Point `[lng, lat]`).
- **Zuordnung = tiefstes Territorium:** bei mehreren Treffern (verschachtelt) das
  mit dem **tiefsten Hierarchie-Level** bzw. der **kleinsten Fläche** wählen
  (Tiebreak im Brainstorming festlegen).
- **Zwei Trigger:**
  - **Lokal — Rechtsklick „Grenzen berechnen":** neue Kontextmenü-Aktion
    (`js/map-features/map-features-region-context-menu.js`, Trigger
    `map-features.js:474–487`) — nur für den geklickten Bereich/das Territorium.
  - **Global — Menüband-Button „Siedlungen zu Territorien zuweisen":** einmal über
    **alles** (analog dem `assign_all`-Muster der Labels/Regionen in
    `api/_internal/wiki/regions.php`, aber geometrisch statt namensbasiert).

> **⚠️ ZOOM-CULLING (die geahnte Falle):** Der Layer-Fetch schickt `zoom` mit und
> der Server **cullt nach `min_zoom`/`max_zoom`** → `regionData` enthält nur die
> **aktuell sichtbaren** Geometrien. Ein **globaler** Lauf **muss die volle
> Geometrie-Menge** nutzen — es gibt das Muster
> `POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS` (alle 7 Zoomstufen laden,
> `…political-territory-loader.js:350–393`) als Fallback, **oder** einen dedizierten
> „alle Geometrien"-Fetch bauen. Sonst bleiben Siedlungen unter gerade
> ausgeblendeten Territorien unzugeordnet.

- **Persistenz:** neues Feld schreiben (Save analog `assign_to` /
  `api/_internal/political/assignment.php`). **Dry-run/Preview vor dem globalen
  Apply**; den echten Prod-Write führt der Owner.

## 7. Kniffliger Teil C — „Nur Auswahl anzeigen" + Chip

- Toggle im Menüband: auf der **Live-Karte nur die aktuelle Siedlungs-Auswahl**
  (das Filter-Ergebnis der Mitte-Spalte) zeigen.
- Ein **Chip** signalisiert „gefilterte Ansicht aktiv".
- **Reversibel:** normale Ansicht per Editor/Menüband wiederherstellen.
- **Frontend unangetastet:** dieser Karten-Filter ist **edit-mode-only**, sauber
  abschaltbar, darf den normalen Layer-/Sichtbarkeits-State **nicht dauerhaft**
  verändern (kein Leck in die öffentliche Ansicht).

## 8. Suche + Filter (alle Listen)

Suchmasken + Filter wie in den heutigen Änderungen: Typ, Kontinent, Zeit/BF,
„nur X". Mirror der bestehenden `review-settlement-list.js`- und
`territory-wiki-tree.js`-Filter.

## 9. Offene Entscheidungen fürs Brainstorming/Mockup

- Persistenz: `properties_json.territory_wiki_key` vs. eigene Spalte/Tabelle?
- Tiebreak bei überlappenden Territorien (tiefste Hierarchie vs. kleinste Fläche).
- Detail-Panel: Gruppierung von Feldern + „Andere Quelle" + Wappen + Overrides.
- Häkchen-Kaskade-UX (Baronie→Grafschaft Auto-Markierung) genau.
- Chip-Optik + wo „normale Ansicht wiederherstellen" sitzt.
- Braucht der Editor **auch** Drag-Zuordnung (wie Territorien) oder rein Ray-Cast?
- Umfang des Dry-run/Preview vor globalem Apply.
- Was passiert mit Siedlungen, die in **kein** Territorium fallen (Meer, Lücke)?

## 10. Referenz-Dateien (gegroundet)

| Thema | Datei:Zeile |
|---|---|
| Editor öffnen (Overlay+Iframe) | `js/review/review-wiki-sync.js:1016–1077` |
| Editor-Layout / Detail-Felder / Toolbar | `html/wiki-sync-monitor.html:188–252`, `:580–708`, `:190–197` |
| Siedlungen-Tab (UI) | `index.html:407–411` |
| Siedlungsliste (JS) | `js/review/review-settlement-list.js` |
| Siedlungs-API | `api/edit/wiki/settlements.php`, `api/edit/wiki/settlement-coat-upload.php` |
| Territorien-Baum (Filter-Grundlage) | `js/territory/territory-wiki-tree.js` (`buildTree`, `parent_wiki_key`); Endpoint `sync-monitor.php?action=model_tree` |
| Territorien-Geometrie (Client) | `js/map-features/map-features-political-territory-loader.js:270` (`regionData`), `:350–393` (alle Zoomstufen) |
| Kontextmenü (für „Grenzen berechnen") | `js/map-features/map-features-region-context-menu.js`; Trigger `js/map-features/map-features.js:474–487` |
| Geometrie-Save-Backend (Muster) | `api/_internal/political/assignment.php` |
| Namensbasiertes `assign_all` (Muster) | `api/_internal/wiki/regions.php` + `js/review/review-region-sync.js` |
| Zoom-Culling | `js/map-features/map-features-region-rendering.js:117–120` (Client), Server-Filter im Layer-Fetch |

## 11. Verwandte Docs

`docs/territory-list-unification.md` (der Territorien-Baum + `parent_wiki_key`-Invariante),
`docs/political-territory-editor.md`, `docs/territories.md`, `AGENTS.md`.
